"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  NODE_KINDS,
  NODE_KIND_ICONS,
  NodeTree,
  STRUCTURE_PRESETS,
} from "@/lib/types";

// ============================================================
// بناء هيكل المشروع.
//
// المستويات (structure_kinds) تُحدَّد أولاً، ثم يُبنى الشجر داخلها.
// فائدتها أنها تقول للنظام: هنا برج ثم طابق — فيقترح النوع الصحيح
// عند كل إضافة بدل أن يسأل المستخدم في كل مرة.
//
// و«توليد متسلسل» هو ما يجعل برجاً بأربعين طابقاً عملية دقيقة
// واحدة بدل أربعين إدخالاً يدوياً.
// ============================================================
export default function StructureManager({
  projectId,
  structureKinds,
  tree,
  directUnits,
}: {
  projectId: string;
  structureKinds: string[];
  tree: NodeTree[];
  directUnits: Record<string, number>;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [kinds, setKinds] = useState<string[]>(structureKinds);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // نموذج الإضافة: تحت أي عقدة، وبأي نوع، وباسم واحد أو متسلسل
  const [parentId, setParentId] = useState<string>("");
  const [kind, setKind] = useState<string>(structureKinds[0] ?? "برج");
  const [name, setName] = useState("");
  const [seqFrom, setSeqFrom] = useState("");
  const [seqTo, setSeqTo] = useState("");
  const [pad, setPad] = useState(true);

  const input =
    "rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

  async function saveKinds(next: string[]) {
    setKinds(next);
    setBusy(true);
    setMsg(null);
    const { error } = await supabase
      .from("projects")
      .update({ structure_kinds: next })
      .eq("id", projectId);
    setBusy(false);
    if (error) setMsg("تعذّر الحفظ: " + error.message);
    else {
      setKind(next[0] ?? "برج");
      router.refresh();
    }
  }

  // العمق المسموح: مستوى الابن يتبع نوع أبيه في قائمة المستويات
  function suggestedKind(parent: NodeTree | null): string {
    if (kinds.length === 0) return kind;
    if (!parent) return kinds[0];
    const i = kinds.indexOf(parent.kind);
    return kinds[Math.min(i + 1, kinds.length - 1)] ?? kinds[kinds.length - 1];
  }

  const flat: { node: NodeTree; label: string }[] = [];
  (function walk(list: NodeTree[]) {
    for (const n of list) {
      flat.push({ node: n, label: "— ".repeat(n.depth) + n.name });
      walk(n.children);
    }
  })(tree);

  async function add() {
    setMsg(null);

    // اسم واحد، أو متسلسل من رقم إلى رقم
    let names: string[] = [];
    if (seqFrom && seqTo) {
      const from = Number(seqFrom);
      const to = Number(seqTo);
      if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
        setMsg("المدى غير صحيح — تأكّد أن «إلى» أكبر من «من».");
        return;
      }
      if (to - from > 199) {
        setMsg("المدى كبير جداً — أقصى 200 مستوى في المرة الواحدة.");
        return;
      }
      const prefix = name.trim();
      for (let i = from; i <= to; i++) {
        const num = pad ? String(i).padStart(2, "0") : String(i);
        names.push(prefix ? `${prefix} ${num}` : num);
      }
    } else {
      if (!name.trim()) {
        setMsg("اكتب اسم المستوى، أو حدّد مدى أرقام لتوليد عدّة مستويات.");
        return;
      }
      names = [name.trim()];
    }

    setBusy(true);
    const rows = names.map((n, i) => ({
      project_id: projectId,
      parent_id: parentId || null,
      kind,
      name: n,
      sort_order: i,
    }));

    const { error } = await supabase.from("project_nodes").insert(rows);
    setBusy(false);

    if (error) {
      // الاسم المكرّر داخل نفس الأب يرفضه فهرس فريد في القاعدة
      setMsg(
        error.code === "23505"
          ? "يوجد مستوى بنفس الاسم هنا بالفعل."
          : "تعذّرت الإضافة: " + error.message,
      );
      return;
    }

    setName("");
    setSeqFrom("");
    setSeqTo("");
    setMsg(`تمت إضافة ${names.length} مستوى ✓`);
    router.refresh();
  }

  async function rename(node: NodeTree) {
    const next = window.prompt("الاسم الجديد:", node.name);
    if (!next || next.trim() === node.name) return;
    setBusy(true);
    const { error } = await supabase
      .from("project_nodes")
      .update({ name: next.trim() })
      .eq("id", node.id);
    setBusy(false);
    if (error) setMsg("تعذّرت التسمية: " + error.message);
    else router.refresh();
  }

  async function remove(node: NodeTree) {
    const kids = node.children.length;
    const own = directUnits[node.id] ?? 0;
    const warn =
      kids || own
        ? `\n\n⚠️ يحتوي على ${kids} مستوى فرعي و${own} وحدة. حذفه يحذف المستويات التي تحته، وتصبح وحداتها بلا موقع في الهيكل (ولا تُحذف).`
        : "";
    if (!window.confirm(`حذف «${node.name}»؟${warn}`)) return;

    setBusy(true);
    const { error } = await supabase.from("project_nodes").delete().eq("id", node.id);
    setBusy(false);
    if (error) setMsg("تعذّر الحذف: " + error.message);
    else router.refresh();
  }

  function Row({ n }: { n: NodeTree }) {
    return (
      <div>
        <div
          style={{ paddingInlineStart: 8 + n.depth * 20 }}
          className="group flex items-center gap-2 rounded-lg py-2 pe-2 hover:bg-gray-50"
        >
          <span className="material-symbols-outlined text-[18px] text-brand-600">
            {NODE_KIND_ICONS[n.kind] ?? "folder"}
          </span>
          <span className="font-medium text-gray-800">{n.name}</span>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500">
            {n.kind}
          </span>
          {(directUnits[n.id] ?? 0) > 0 && (
            <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] text-brand-700">
              {directUnits[n.id]} وحدة
            </span>
          )}
          <div className="ms-auto flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
            <button
              onClick={() => setParentId(n.id)}
              title="إضافة تحته"
              className="rounded p-1 text-gray-500 hover:bg-gray-200 hover:text-brand-700"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
            </button>
            <button
              onClick={() => rename(n)}
              title="إعادة تسمية"
              className="rounded p-1 text-gray-500 hover:bg-gray-200 hover:text-brand-700"
            >
              <span className="material-symbols-outlined text-[18px]">edit</span>
            </button>
            <button
              onClick={() => remove(n)}
              title="حذف"
              className="rounded p-1 text-gray-500 hover:bg-red-100 hover:text-red-700"
            >
              <span className="material-symbols-outlined text-[18px]">delete</span>
            </button>
          </div>
        </div>
        {n.children.map((c) => (
          <Row key={c.id} n={c} />
        ))}
      </div>
    );
  }

  const parentNode = flat.find((f) => f.node.id === parentId)?.node ?? null;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_340px]">
      {/* الشجرة */}
      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-bold text-gray-700">المستويات</h2>
        {tree.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">
            لا مستويات بعد. اختر قالباً ثم أضف أول مستوى من اليسار.
          </p>
        ) : (
          tree.map((n) => <Row key={n.id} n={n} />)
        )}
      </div>

      <div className="space-y-5">
        {/* القالب */}
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="mb-1 text-sm font-bold text-gray-700">شكل المشروع</h2>
          <p className="mb-3 text-xs text-gray-500">
            يحدّد المستويات المتوقّعة، فيقترح النظام النوع الصحيح عند كل إضافة.
          </p>

          <div className="space-y-2">
            {STRUCTURE_PRESETS.map((p) => {
              const on = p.kinds.join() === kinds.join();
              return (
                <button
                  key={p.label}
                  disabled={busy}
                  onClick={() => saveKinds(p.kinds)}
                  className={
                    on
                      ? "w-full rounded-xl border-2 border-brand-600 bg-brand-50 p-3 text-start"
                      : "w-full rounded-xl border border-gray-200 p-3 text-start transition hover:border-brand-300 hover:bg-gray-50"
                  }
                >
                  <span className="block text-sm font-bold text-gray-800">
                    {p.label}
                  </span>
                  <span className="block text-xs text-gray-500">{p.hint}</span>
                </button>
              );
            })}
            <button
              disabled={busy}
              onClick={() => saveKinds([])}
              className={
                kinds.length === 0
                  ? "w-full rounded-xl border-2 border-brand-600 bg-brand-50 p-3 text-start"
                  : "w-full rounded-xl border border-gray-200 p-3 text-start transition hover:border-brand-300 hover:bg-gray-50"
              }
            >
              <span className="block text-sm font-bold text-gray-800">بلا هيكل</span>
              <span className="block text-xs text-gray-500">
                كل الوحدات في قائمة واحدة
              </span>
            </button>
          </div>
        </div>

        {/* الإضافة */}
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-bold text-gray-700">إضافة مستوى</h2>

          <label className="mb-1 block text-xs text-gray-500">تحت</label>
          <select
            value={parentId}
            onChange={(e) => {
              setParentId(e.target.value);
              const p = flat.find((f) => f.node.id === e.target.value)?.node ?? null;
              setKind(suggestedKind(p));
            }}
            className={input + " mb-3 w-full"}
          >
            <option value="">جذر المشروع</option>
            {flat.map((f) => (
              <option key={f.node.id} value={f.node.id}>
                {f.label}
              </option>
            ))}
          </select>

          <label className="mb-1 block text-xs text-gray-500">النوع</label>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className={input + " mb-3 w-full"}
          >
            {NODE_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>

          <label className="mb-1 block text-xs text-gray-500">
            الاسم {seqFrom && seqTo ? "(بادئة)" : ""}
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={kind === "طابق" ? "الطابق" : `${kind} A`}
            className={input + " mb-3 w-full"}
          />

          <label className="mb-1 block text-xs text-gray-500">
            توليد متسلسل (اختياري)
          </label>
          <div className="mb-2 flex items-center gap-2">
            <input
              value={seqFrom}
              onChange={(e) => setSeqFrom(e.target.value)}
              type="number"
              placeholder="من"
              className={input + " w-full"}
              dir="ltr"
            />
            <input
              value={seqTo}
              onChange={(e) => setSeqTo(e.target.value)}
              type="number"
              placeholder="إلى"
              className={input + " w-full"}
              dir="ltr"
            />
          </div>
          <label className="mb-3 flex items-center gap-2 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={pad}
              onChange={(e) => setPad(e.target.checked)}
              className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
            />
            صفر بادئ (01 بدل 1)
          </label>

          {seqFrom && seqTo && (
            <p className="mb-3 rounded-lg bg-gray-50 p-2 text-[11px] text-gray-600">
              سيُنشأ: {name.trim() ? name.trim() + " " : ""}
              {pad ? String(seqFrom).padStart(2, "0") : seqFrom} …{" "}
              {name.trim() ? name.trim() + " " : ""}
              {pad ? String(seqTo).padStart(2, "0") : seqTo}
            </p>
          )}

          <button
            onClick={add}
            disabled={busy}
            className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? "جارٍ…" : "إضافة"}
          </button>

          {parentNode && (
            <p className="mt-2 text-[11px] text-gray-500">
              سيُضاف تحت: {parentNode.path}
            </p>
          )}
          {msg && (
            <p
              className={`mt-2 text-xs ${
                msg.includes("✓") ? "text-green-600" : "text-red-600"
              }`}
            >
              {msg}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
