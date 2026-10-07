"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Client } from "@/lib/types";

// ============================================================
// شاشة الدمج: بطاقتان جنباً إلى جنب (sql/104).
//
// ثلاثة أنواع من الحقول، والسؤال للنوع الأول وحده:
//   متعارض   قيمتان مختلفتان ← الموظف يختار
//   ناقص     في إحداهما فقط  ← يُملأ بلا سؤال
//   متطابق   نفس القيمة      ← لا يُعرض إلا عدّه
//
// ما يُرسَل إلى merge_clients(): أيّ البطاقتين تبقى، وقائمة الحقول
// التي اختار الموظف فيها قيمة الأخرى (p_take). كل ما عداها تقرّره
// القاعدة: التواريخ الأقدم، والملاحظات مجموعة، والعدّادات من الأنشطة.
//
// (169) ownerLocked: الدامج لا يملك البطاقتين (دمجٌ بالتطابق مع بطاقة
// زميل) ⇒ المالك لا يُسأل عنه: العميل لمالك البطاقة الأقدم، ومن خسر
// الملكية يبقى يرى البطاقة. القاعدة تفرضه ولو أُرسل «owner».
// ============================================================

export type MergeSide = {
  client: Client;
  ownerName: string | null;
  counts: { activities: number; opportunities: number; reservations: number; tasks: number; documents: number };
};

type StageLite = { name: string; sort_order: number; stage_type: "open" | "won" | "lost" };
type Side = "a" | "b";

// رقمٌ واحد بكتابات مختلفة (07… و+964…) لا يُعدّ تعارضاً
function phoneKey(p: string | null | undefined): string {
  const d = (p ?? "").replace(/\D/g, "");
  return d.replace(/^(00964|964|0)/, "");
}

function yesNo(v: boolean | null | undefined): string {
  return v === true ? "نعم" : v === false ? "لا" : "";
}

function money(n: number | null | undefined): string {
  return n === null || n === undefined ? "…" : Number(n).toLocaleString("en-US");
}

type FieldDef = {
  key: string; // اسم الحقل في p_take (sql/104)
  label: string;
  value: (s: MergeSide, projects: Map<string, string>) => string;
  same?: (x: MergeSide, y: MergeSide) => boolean;
  ltr?: boolean;
};

const FIELDS: FieldDef[] = [
  { key: "name", label: "الاسم", value: (s) => s.client.name },
  {
    key: "phone",
    label: "رقم الهاتف",
    value: (s) => s.client.phone ?? "",
    same: (x, y) => phoneKey(x.client.phone) === phoneKey(y.client.phone),
    ltr: true,
  },
  {
    key: "alt_contact",
    label: "جهة الاتصال البديلة",
    value: (s) =>
      [s.client.alt_contact_name, s.client.alt_contact_phone, s.client.alt_contact_relation].filter(Boolean).join(" · "),
  },
  { key: "stage", label: "المرحلة", value: (s) => s.client.stage ?? "ليد" },
  { key: "owner", label: "المالك", value: (s) => s.ownerName ?? "" },
  { key: "governorate", label: "المحافظة", value: (s) => s.client.governorate ?? "" },
  { key: "area", label: "المنطقة", value: (s) => s.client.area ?? "" },
  { key: "purchase_purpose", label: "الغرض من الشراء", value: (s) => s.client.purchase_purpose ?? "" },
  { key: "source", label: "المصدر", value: (s) => s.client.source ?? "" },
  { key: "payment_method", label: "طريقة الدفع", value: (s) => s.client.payment_method ?? "" },
  {
    key: "budget",
    label: "الميزانية",
    value: (s) =>
      s.client.budget_min == null && s.client.budget_max == null
        ? ""
        : `${money(s.client.budget_min)} – ${money(s.client.budget_max)}`,
  },
  { key: "purchase_timeline", label: "موعد الشراء", value: (s) => s.client.purchase_timeline ?? "" },
  { key: "urgency", label: "الاستعجال", value: (s) => s.client.urgency ?? "" },
  { key: "is_decision_maker", label: "صاحب القرار", value: (s) => yesNo(s.client.is_decision_maker) },
  { key: "financing_required", label: "يحتاج تمويلاً", value: (s) => yesNo(s.client.financing_required) },
  {
    key: "preferred_project_id",
    label: "المشروع المفضّل",
    value: (s, p) => (s.client.preferred_project_id ? p.get(s.client.preferred_project_id) ?? "مشروع" : ""),
  },
  { key: "preferred_area", label: "المساحة المفضّلة", value: (s) => s.client.preferred_area ?? "" },
  { key: "preferred_unit_type", label: "نوع الوحدة", value: (s) => s.client.preferred_unit_type ?? "" },
];

export default function MergeWizard({
  a,
  b,
  stages,
  projects,
  canMerge,
  ownerLocked,
  matchOn,
}: {
  a: MergeSide;
  b: MergeSide;
  stages: StageLite[];
  projects: { id: string; name: string }[];
  canMerge: boolean;
  ownerLocked: boolean;
  matchOn: string | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const sides = { a, b };
  const projectNames = new Map(projects.map((p) => [p.id, p.name]));

  // المُسنَدة لوسيط لا تُطوى (القاعدة ترفض) — فهي الباقية افتراضياً.
  // وإلا فالأقدم: تاريخه أطول، ومنه يُحسب عمر الليد.
  const brokerSide: Side | null =
    a.client.broker_company_id && !b.client.broker_company_id
      ? "a"
      : b.client.broker_company_id && !a.client.broker_company_id
      ? "b"
      : null;
  const [keep, setKeep] = useState<Side>(brokerSide ?? (a.client.created_at <= b.client.created_at ? "a" : "b"));
  const gone: Side = keep === "a" ? "b" : "a";
  const [picked, setPicked] = useState<Record<string, Side>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [requested, setRequested] = useState(false);

  // المرحلة: الأكثر تقدّماً افتراضياً — ليدٌ «فشل» ثم عاد ببطاقة جديدة
  // مفتوحة هو ليدٌ مفتوح. الفوز فوق كل مفتوح، والخسارة تحتها.
  const rank = (name: string | undefined) => {
    const s = stages.find((x) => x.name === (name ?? "ليد"));
    if (!s) return 0;
    return s.stage_type === "won" ? 1000 : s.stage_type === "lost" ? -1 : s.sort_order;
  };

  // العميل للأقدم (169) — نفس ترتيب القاعدة: التاريخ ثم المعرّف،
  // وإن كانت الأقدم بلا مالك فالمالك من الأخرى
  const older: Side =
    a.client.created_at < b.client.created_at ||
    (a.client.created_at === b.client.created_at && a.client.id < b.client.id)
      ? "a"
      : "b";
  const younger: Side = older === "a" ? "b" : "a";
  const ownerSide: Side = sides[older].client.owner_id || sides[older].client.sales_employee ? older : younger;
  const ownerOwnerName = sides[ownerSide].ownerName;
  const loserOwnerName = sides[ownerSide === "a" ? "b" : "a"].ownerName;

  const rows = FIELDS.filter((f) => !(ownerLocked && f.key === "owner")).map((f) => {
    const vk = f.value(sides[keep], projectNames);
    const vg = f.value(sides[gone], projectNames);
    const equal = f.same ? f.same(sides[keep], sides[gone]) : vk === vg;
    const kind: "same" | "fill" | "conflict" =
      (!vk && !vg) || equal ? "same" : !vk || !vg ? "fill" : "conflict";
    let chosen: Side = keep;
    if (kind === "conflict") {
      chosen =
        picked[f.key] ??
        (f.key === "stage" && rank(sides[gone].client.stage) > rank(sides[keep].client.stage) ? gone : keep);
    }
    return { f, vk, vg, kind, chosen };
  });

  const conflicts = rows.filter((r) => r.kind === "conflict");
  const fills = rows.filter((r) => r.kind === "fill" && !r.vk);
  const sameCount = rows.filter((r) => r.kind === "same").length;
  const take = conflicts.filter((r) => r.chosen === gone).map((r) => r.f.key);

  const brokerBlock =
    sides[gone].client.broker_company_id &&
    sides[gone].client.broker_company_id !== sides[keep].client.broker_company_id;

  async function doMerge() {
    const k = sides[keep].client;
    const g = sides[gone].client;
    if (
      !confirm(
        `ستُطوى «${g.name}» في «${k.name}»، وينتقل إليها كل تاريخها. البطاقة المطويّة لا تُحذف لكن الفصل بعد الدمج يدوي. متابعة؟`
      )
    )
      return;
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc("merge_clients", { p_keep_id: k.id, p_merge_id: g.id, p_take: take });
    if (error) {
      setBusy(false);
      return setErr(error.message);
    }
    router.push(`/dashboard/clients/${k.id}`);
    router.refresh();
  }

  async function notSame() {
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc("resolve_client_duplicate", {
      p_a: a.client.id,
      p_b: b.client.id,
      p_status: "ليسا واحداً",
    });
    setBusy(false);
    if (error) return setErr(error.message);
    router.push(`/dashboard/clients/${a.client.id}`);
    router.refresh();
  }

  async function requestMerge() {
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc("request_client_merge", {
      p_a: a.client.id,
      p_b: b.client.id,
      p_note: note.trim() || null,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    setRequested(true);
  }

  return (
    <div className="max-w-4xl space-y-6">
      {/* ===== أيّ البطاقتين تبقى ===== */}
      <div>
        <h2 className="mb-2 font-semibold text-gray-800">أيّ البطاقتين تبقى؟</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {(["a", "b"] as Side[]).map((s) => (
            <SideCard
              key={s}
              side={sides[s]}
              keep={keep === s}
              disabled={!canMerge}
              onKeep={() => setKeep(s)}
            />
          ))}
        </div>
      </div>

      {/* ===== الحقول ===== */}
      <div className="rounded-xl border bg-white">
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold text-gray-800">المعلومات بعد الدمج</h2>
          <p className="text-xs text-gray-500">
            {conflicts.length > 0
              ? `${conflicts.length} حقلاً مختلفاً — اختر الصحيح في كلٍّ منها.`
              : "لا تعارض بين البطاقتين."}
            {sameCount > 0 && ` · ${sameCount} حقلاً متطابقاً أو فارغاً في الاثنتين.`}
          </p>
        </div>

        {ownerLocked && canMerge && (
          <p className="border-b bg-sky-50 px-4 py-3 text-sm text-sky-900">
            {matchOn && <>البطاقتان متطابقتان ({matchOn}). </>}
            العميل يبقى عند <b>{ownerOwnerName ?? "صاحب البطاقة الأقدم"}</b> — صاحب البطاقة الأقدم تسجيلاً
            {loserOwnerName && loserOwnerName !== ownerOwnerName && (
              <>، و«{loserOwnerName}» يبقى يرى البطاقة وتاريخها كاملاً</>
            )}
            .
          </p>
        )}

        {conflicts.length > 0 && (
          <ul className="divide-y divide-gray-100">
            {conflicts.map((r) => (
              <li key={r.f.key} className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[10rem_1fr_1fr]">
                <span className="font-medium text-gray-600">{r.f.label}</span>
                {([keep, gone] as Side[]).map((s) => {
                  const v = s === keep ? r.vk : r.vg;
                  const on = r.chosen === s;
                  return (
                    <label
                      key={s}
                      className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 ${
                        on ? "border-brand-400 bg-brand-50 text-brand-900" : "border-gray-200 text-gray-600"
                      } ${!canMerge ? "cursor-default" : ""}`}
                    >
                      <input
                        type="radio"
                        name={r.f.key}
                        checked={on}
                        disabled={!canMerge}
                        onChange={() => setPicked((p) => ({ ...p, [r.f.key]: s }))}
                      />
                      <span dir={r.f.ltr ? "ltr" : undefined}>{v}</span>
                    </label>
                  );
                })}
              </li>
            ))}
          </ul>
        )}

        {fills.length > 0 && (
          <div className="border-t px-4 py-3 text-sm">
            <p className="mb-1 text-xs font-semibold text-gray-500">يُملأ من البطاقة المطويّة (فارغ في الباقية):</p>
            <ul className="flex flex-wrap gap-2">
              {fills.map((r) => (
                <li key={r.f.key} className="rounded-full bg-emerald-50 px-3 py-1 text-xs text-emerald-800">
                  {r.f.label}: <span dir={r.f.ltr ? "ltr" : undefined}>{r.vg}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="border-t px-4 py-3 text-xs text-gray-500">
          الملاحظات تُجمع من البطاقتين، ويُكتب فيها الرقم الآخر إن اختلف الرقمان. تاريخ الدخول والتأهيل = الأقدم.
          وعدد مرات التواصل يُعاد حسابه من الأنشطة مجتمعة.
        </p>
      </div>

      {/* ===== ما سينتقل ===== */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        <p>
          ينتقل من «{sides[gone].client.name}» إلى «{sides[keep].client.name}»:{" "}
          <b>
            {sides[gone].counts.activities} نشاط · {sides[gone].counts.opportunities} فرصة ·{" "}
            {sides[gone].counts.reservations} حجز · {sides[gone].counts.tasks} مهمة · {sides[gone].counts.documents}{" "}
            مستند
          </b>
          ، والفواتير والوسوم والعمولات.
        </p>
        <p className="mt-1 text-xs text-slate-500">
          فرصتان مفتوحتان على المشروع نفسه تصيران واحدة (الأكثر تقدّماً)، فلا يُحسب الشخص ليدين. البطاقة المطويّة لا
          تُحذف: تُحفظ صورتها في سجلّ الدمج، ورابطها القديم يقود إلى الباقية.
        </p>
      </div>

      {err && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{err}</p>}

      {/* ===== الفعل ===== */}
      {canMerge ? (
        <div className="flex flex-wrap items-center gap-3">
          {brokerBlock && (
            <p className="w-full rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              «{sides[gone].client.name}» مُسنَدة لشركة وساطة — اجعلها هي الباقية، أو اسحب الإسناد أولاً.
            </p>
          )}
          <button
            type="button"
            onClick={doMerge}
            disabled={busy || Boolean(brokerBlock)}
            className="rounded-lg bg-brand-600 px-6 py-2.5 font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? "يدمج…" : "ادمج البطاقتين"}
          </button>
          <button
            type="button"
            onClick={notSame}
            disabled={busy}
            className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-700 hover:border-gray-500 disabled:opacity-50"
          >
            ليسا الشخص نفسه
          </button>
          <Link href={`/dashboard/clients/${a.client.id}`} className="px-2 text-sm text-gray-500 hover:text-gray-800">
            إلغاء
          </Link>
        </div>
      ) : requested ? (
        <p className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800">
          وصل طلب الدمج إلى مشرف الفريق (والإدارة)، ويظهر لهم في «الجودة». لا تعمل على البطاقتين معاً حتى
          يُقرَّر.
        </p>
      ) : (
        <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-900">
            البطاقتان لا تتطابقان بالرقم ولا بالاسم، فالدمج بموافقة مشرف الفريق. أرسل له طلباً:
          </p>
          <textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="ملاحظة اختيارية: لماذا تراهما الشخص نفسه؟"
            className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={requestMerge}
            disabled={busy}
            className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {busy ? "يرسل…" : "اطلب الدمج"}
          </button>
        </div>
      )}
    </div>
  );
}

function SideCard({
  side,
  keep,
  disabled,
  onKeep,
}: {
  side: MergeSide;
  keep: boolean;
  disabled: boolean;
  onKeep: () => void;
}) {
  const c = side.client;
  return (
    <label
      className={`block rounded-xl border-2 p-4 text-sm transition ${
        keep ? "border-brand-500 bg-brand-50" : "border-gray-200 bg-white"
      } ${disabled ? "" : "cursor-pointer hover:border-brand-300"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-bold text-gray-900">{c.name}</p>
          <p className="text-gray-600" dir="ltr">
            {c.phone ?? "—"}
          </p>
        </div>
        <span className="flex items-center gap-1.5 text-xs font-semibold">
          <input type="radio" checked={keep} disabled={disabled} onChange={onKeep} />
          {keep ? <span className="text-brand-700">تبقى</span> : <span className="text-gray-500">تُطوى</span>}
        </span>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        {c.stage ?? "ليد"} · {side.ownerName ?? "بلا مالك"} · أُنشئت {c.created_at.slice(0, 10)}
      </p>
      <p className="mt-1 text-xs text-gray-500">
        {side.counts.activities} نشاط · {side.counts.opportunities} فرصة · {side.counts.reservations} حجز ·{" "}
        {side.counts.tasks} مهمة · {side.counts.documents} مستند
      </p>
      <Link href={`/dashboard/clients/${c.id}`} target="_blank" className="mt-2 inline-block text-xs text-brand-700 hover:underline">
        افتح البطاقة ↗
      </Link>
    </label>
  );
}
