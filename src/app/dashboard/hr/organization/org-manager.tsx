"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Branch, Department, DepartmentNode, UNIT_TYPES } from "@/lib/org-types";

type Person = { id: string; full_name: string; employee_code: string };

type FormState = {
  id: string | null;
  code: string;
  name_ar: string;
  name_en: string;
  unit_type: string;
  parent_id: string;
  manager_id: string;
  branch_id: string;
  description: string;
  sort_order: string;
};

const EMPTY: FormState = {
  id: null,
  code: "",
  name_ar: "",
  name_en: "",
  unit_type: "إدارة",
  parent_id: "",
  manager_id: "",
  branch_id: "",
  description: "",
  sort_order: "0",
};

// شجرة الأقسام + نموذج الإنشاء والتعديل والأرشفة.
// القواعد (لا حلقة، لا أرشفة لقسمٍ حيّ، المدير نشط) في محفّز القاعدة
// guard_department — رسالته تظهر هنا كما هي.
export default function OrgManager({
  tree,
  departments,
  branches,
  people,
  canManage,
  viewable,
}: {
  tree: DepartmentNode[];
  departments: Department[];
  branches: Branch[];
  people: Person[];
  canManage: boolean;
  viewable: string[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byId = new Map(departments.map((d) => [d.id, d]));
  const totalPeople = tree.filter((n) => !n.parent_id).reduce((s, n) => s + n.total_headcount, 0);
  const unassigned = canManage ? people.length - totalPeople : 0;

  function openNew(parent?: DepartmentNode) {
    setError(null);
    setForm({
      ...EMPTY,
      parent_id: parent?.id ?? "",
      unit_type: parent ? (parent.unit_type === "إدارة" ? "قسم فرعي" : "فريق") : "إدارة",
      branch_id: parent ? byId.get(parent.id)?.branch_id ?? "" : branches[0]?.id ?? "",
      code: parent ? `${parent.code}-` : "",
    });
  }

  function openEdit(id: string) {
    const d = byId.get(id);
    if (!d) return;
    setError(null);
    setForm({
      id: d.id,
      code: d.code,
      name_ar: d.name_ar,
      name_en: d.name_en ?? "",
      unit_type: d.unit_type,
      parent_id: d.parent_id ?? "",
      manager_id: d.manager_id ?? "",
      branch_id: d.branch_id ?? "",
      description: d.description ?? "",
      sort_order: String(d.sort_order ?? 0),
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setError(null);
    const payload = {
      code: form.code.trim().toUpperCase(),
      name_ar: form.name_ar.trim(),
      name_en: form.name_en.trim() || null,
      unit_type: form.unit_type,
      parent_id: form.parent_id || null,
      manager_id: form.manager_id || null,
      branch_id: form.branch_id || null,
      description: form.description.trim() || null,
      sort_order: Number(form.sort_order) || 0,
    };
    const { error } = form.id
      ? await supabase.from("departments").update(payload).eq("id", form.id)
      : await supabase.from("departments").insert(payload);
    setSaving(false);
    if (error) {
      setError(
        error.message.includes("departments_code_key")
          ? "هذا الرمز مستخدم لقسم آخر."
          : error.message.includes("departments_name_under_parent")
          ? "يوجد قسم بالاسم نفسه تحت الأب نفسه."
          : error.message
      );
      return;
    }
    setForm(null);
    router.refresh();
  }

  async function setStatus(id: string, status: "نشط" | "مؤرشف") {
    setError(null);
    const { error } = await supabase.from("departments").update({ status }).eq("id", id);
    if (error) {
      setError(error.message);
      return;
    }
    router.refresh();
  }

  // الأب لا يكون القسم نفسه ولا أحد فروعه — يُستبعد من القائمة، والقاعدة تمنعه أيضاً
  const descendants = new Set<string>();
  if (form?.id) {
    const stack = [form.id];
    while (stack.length) {
      const cur = stack.pop()!;
      descendants.add(cur);
      departments.filter((d) => d.parent_id === cur).forEach((d) => stack.push(d.id));
    }
  }

  const input =
    "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";
  const label = "mb-1 block text-xs font-medium text-gray-600";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="الإدارات" value={tree.filter((n) => n.unit_type === "إدارة" && n.status === "نشط").length} />
        <Stat label="الأقسام الفرعية والفرق" value={tree.filter((n) => n.unit_type !== "إدارة" && n.status === "نشط").length} />
        <Stat label="موظفون على رأس العمل" value={totalPeople} />
        {canManage && <Stat label="بلا قسم" value={Math.max(unassigned, 0)} warn={unassigned > 0} />}
      </div>

      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {canManage && !form && (
        <button
          onClick={() => openNew()}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          + إدارة جديدة
        </button>
      )}

      {form && (
        <form onSubmit={save} className="space-y-4 rounded-2xl border bg-white p-6 shadow-sm">
          <h3 className="font-semibold text-gray-800">{form.id ? "تعديل القسم" : "قسم جديد"}</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className={label}>الاسم بالعربية *</label>
              <input className={input} required value={form.name_ar}
                onChange={(e) => setForm({ ...form, name_ar: e.target.value })} />
            </div>
            <div>
              <label className={label}>الاسم بالإنجليزية</label>
              <input className={input} dir="ltr" value={form.name_en}
                onChange={(e) => setForm({ ...form, name_en: e.target.value })} />
            </div>
            <div>
              <label className={label}>الرمز * (حروف إنجليزية كبيرة وأرقام و -)</label>
              <input className={input} dir="ltr" required pattern="[A-Za-z0-9_\-]{2,30}" value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
            </div>
            <div>
              <label className={label}>النوع</label>
              <select className={input} value={form.unit_type}
                onChange={(e) => setForm({ ...form, unit_type: e.target.value })}>
                {UNIT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>يتبع</label>
              <select className={input} value={form.parent_id}
                onChange={(e) => setForm({ ...form, parent_id: e.target.value })}>
                <option value="">— أعلى الهيكل —</option>
                {tree
                  .filter((n) => n.status === "نشط" && !descendants.has(n.id))
                  .map((n) => (
                    <option key={n.id} value={n.id}>
                      {"  ".repeat(n.depth)}{n.name_ar}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className={label}>المدير</label>
              <select className={input} value={form.manager_id}
                onChange={(e) => setForm({ ...form, manager_id: e.target.value })}>
                <option value="">— بلا مدير —</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>{p.full_name} ({p.employee_code})</option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>الفرع</label>
              <select className={input} value={form.branch_id}
                onChange={(e) => setForm({ ...form, branch_id: e.target.value })}>
                <option value="">—</option>
                {branches.filter((b) => b.status === "نشط").map((b) => (
                  <option key={b.id} value={b.id}>{b.name_ar}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>الترتيب</label>
              <input className={input} type="number" dir="ltr" value={form.sort_order}
                onChange={(e) => setForm({ ...form, sort_order: e.target.value })} />
            </div>
            <div className="sm:col-span-3">
              <label className={label}>الوصف</label>
              <textarea className={input} rows={2} value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
          </div>
          <div className="flex gap-2">
            <button disabled={saving}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
              {saving ? "جاري الحفظ..." : "حفظ"}
            </button>
            <button type="button" onClick={() => setForm(null)}
              className="rounded-lg border px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
              إلغاء
            </button>
          </div>
        </form>
      )}

      <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b bg-gray-50 text-gray-600">
            <tr>
              <th className="px-4 py-3 text-start font-medium">القسم</th>
              <th className="px-4 py-3 text-start font-medium">المدير</th>
              <th className="px-4 py-3 text-start font-medium">الموظفون</th>
              <th className="px-4 py-3 text-start font-medium">المناصب</th>
              {canManage && <th className="px-4 py-3 text-start font-medium" />}
            </tr>
          </thead>
          <tbody>
            {tree.map((n) => {
              const open = canManage || viewable.includes(n.id);
              const archived = n.status !== "نشط";
              return (
                <tr key={n.id} className={`border-b last:border-0 ${archived ? "bg-gray-50 text-gray-400" : "hover:bg-gray-50"}`}>
                  <td className="px-4 py-2.5" style={{ paddingInlineStart: `${1 + n.depth * 1.5}rem` }}>
                    <div className="flex items-center gap-2">
                      {n.depth > 0 && <span className="text-gray-300">└</span>}
                      {open ? (
                        <Link href={`/dashboard/hr/organization/${n.id}`} className="font-medium text-brand-700 hover:underline">
                          {n.name_ar}
                        </Link>
                      ) : (
                        <span className="font-medium text-gray-800">{n.name_ar}</span>
                      )}
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] text-gray-500" dir="ltr">{n.code}</span>
                      {n.unit_type !== "إدارة" && (
                        <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600">{n.unit_type}</span>
                      )}
                      {archived && <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px]">مؤرشف</span>}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">{n.manager_name ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <span className="font-semibold text-gray-800">{n.total_headcount}</span>
                    {n.total_headcount !== n.direct_headcount && (
                      <span className="text-xs text-gray-400"> ({n.direct_headcount} مباشرةً)</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">{n.positions_count}</td>
                  {canManage && (
                    <td className="whitespace-nowrap px-4 py-2.5 text-end text-xs">
                      {!archived && (
                        <>
                          <button onClick={() => openEdit(n.id)} className="text-brand-700 hover:underline">تعديل</button>
                          <span className="mx-1.5 text-gray-300">|</span>
                          <button onClick={() => openNew(n)} className="text-brand-700 hover:underline">+ فرعي</button>
                          <span className="mx-1.5 text-gray-300">|</span>
                          <button onClick={() => setStatus(n.id, "مؤرشف")} className="text-gray-500 hover:text-red-600">أرشفة</button>
                        </>
                      )}
                      {archived && (
                        <button onClick={() => setStatus(n.id, "نشط")} className="text-brand-700 hover:underline">استعادة</button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <span className="text-xs text-gray-500">{label}</span>
      <p className={`mt-1 text-2xl font-bold ${warn ? "text-amber-600" : "text-gray-800"}`}>{value}</p>
    </div>
  );
}
