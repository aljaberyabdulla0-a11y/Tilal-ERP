"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatPrice } from "@/lib/types";
import { Department, EmploymentType, JobGrade, Position, Role, departmentLabel } from "@/lib/org-types";

type PosForm = {
  id: string | null;
  code: string;
  title_ar: string;
  title_en: string;
  department_id: string;
  job_grade_id: string;
  reports_to_position_id: string;
  employment_type: string;
  default_role_code: string;
  headcount_budget: string;
  job_description: string;
  responsibilities: string;
  sort_order: string;
};

type GradeForm = {
  id: string | null;
  code: string;
  name_ar: string;
  level: string;
  salary_min: string;
  salary_max: string;
  notes: string;
};

// المناصب: إنشاء وتعديل وأرشفة. والدرجات: نطاق الراتب لكل درجة.
// حرّاس القاعدة (guard_position) يمنعون حلقة التبعية وأرشفة منصبٍ مشغول.
export default function PositionsManager({
  positions,
  departments,
  grades,
  employmentTypes,
  roles,
  holders,
  canManage,
}: {
  positions: Position[];
  departments: Department[];
  grades: JobGrade[];
  employmentTypes: EmploymentType[];
  roles: Role[];
  holders: Record<string, number>;
  canManage: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [pos, setPos] = useState<PosForm | null>(null);
  const [grade, setGrade] = useState<GradeForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const activeDeps = departments.filter((d) => d.status === "نشط");
  const gradeById = new Map(grades.map((g) => [g.id, g]));
  const posById = new Map(positions.map((p) => [p.id, p]));
  const roleByCode = new Map(roles.map((r) => [r.code, r]));
  const typeByCode = new Map(employmentTypes.map((t) => [t.code, t]));

  const visible = positions.filter((p) => showArchived || p.status === "نشط");
  const groups = activeDeps
    .concat(departments.filter((d) => d.status !== "نشط"))
    .map((d) => ({ d, items: visible.filter((p) => p.department_id === d.id) }))
    .filter((g) => g.items.length > 0)
    .sort((a, b) => departmentLabel(a.d, departments).localeCompare(departmentLabel(b.d, departments), "ar"));

  function editPos(p?: Position) {
    setError(null);
    setGrade(null);
    setPos(
      p
        ? {
            id: p.id,
            code: p.code,
            title_ar: p.title_ar,
            title_en: p.title_en ?? "",
            department_id: p.department_id,
            job_grade_id: p.job_grade_id ?? "",
            reports_to_position_id: p.reports_to_position_id ?? "",
            employment_type: p.employment_type,
            default_role_code: p.default_role_code ?? "",
            headcount_budget: p.headcount_budget?.toString() ?? "",
            job_description: p.job_description ?? "",
            responsibilities: p.responsibilities ?? "",
            sort_order: String(p.sort_order ?? 0),
          }
        : {
            id: null, code: "", title_ar: "", title_en: "", department_id: activeDeps[0]?.id ?? "",
            job_grade_id: "", reports_to_position_id: "", employment_type: "full_time",
            default_role_code: "employee", headcount_budget: "", job_description: "",
            responsibilities: "", sort_order: "0",
          }
    );
  }

  async function savePos(e: React.FormEvent) {
    e.preventDefault();
    if (!pos) return;
    setSaving(true);
    setError(null);
    const payload = {
      code: pos.code.trim().toUpperCase(),
      title_ar: pos.title_ar.trim(),
      title_en: pos.title_en.trim() || null,
      department_id: pos.department_id,
      job_grade_id: pos.job_grade_id || null,
      reports_to_position_id: pos.reports_to_position_id || null,
      employment_type: pos.employment_type,
      default_role_code: pos.default_role_code || null,
      headcount_budget: pos.headcount_budget ? Number(pos.headcount_budget) : null,
      job_description: pos.job_description.trim() || null,
      responsibilities: pos.responsibilities.trim() || null,
      sort_order: Number(pos.sort_order) || 0,
    };
    const { error } = pos.id
      ? await supabase.from("positions").update(payload).eq("id", pos.id)
      : await supabase.from("positions").insert(payload);
    setSaving(false);
    if (error) {
      setError(error.message.includes("positions_code_key") ? "هذا الرمز مستخدم لمنصب آخر." : error.message);
      return;
    }
    setPos(null);
    router.refresh();
  }

  async function setPosStatus(id: string, status: "نشط" | "مؤرشف") {
    setError(null);
    const { error } = await supabase.from("positions").update({ status }).eq("id", id);
    if (error) setError(error.message);
    else router.refresh();
  }

  function editGrade(g?: JobGrade) {
    setError(null);
    setPos(null);
    setGrade(
      g
        ? {
            id: g.id, code: g.code, name_ar: g.name_ar, level: String(g.level),
            salary_min: g.salary_min?.toString() ?? "", salary_max: g.salary_max?.toString() ?? "",
            notes: g.notes ?? "",
          }
        : { id: null, code: "", name_ar: "", level: String((grades[grades.length - 1]?.level ?? 0) + 1), salary_min: "", salary_max: "", notes: "" }
    );
  }

  async function saveGrade(e: React.FormEvent) {
    e.preventDefault();
    if (!grade) return;
    setSaving(true);
    setError(null);
    const payload = {
      code: grade.code.trim().toUpperCase(),
      name_ar: grade.name_ar.trim(),
      level: Number(grade.level),
      salary_min: grade.salary_min ? Number(grade.salary_min) : null,
      salary_max: grade.salary_max ? Number(grade.salary_max) : null,
      notes: grade.notes.trim() || null,
    };
    const { error } = grade.id
      ? await supabase.from("job_grades").update(payload).eq("id", grade.id)
      : await supabase.from("job_grades").insert(payload);
    setSaving(false);
    if (error) {
      setError(
        error.message.includes("job_grades_range")
          ? "الحدّ الأعلى للراتب يجب ألّا يقلّ عن الأدنى."
          : error.message.includes("job_grades_code_key")
          ? "هذا الرمز مستخدم لدرجة أخرى."
          : error.message
      );
      return;
    }
    setGrade(null);
    router.refresh();
  }

  // المنصب لا يتبع نفسه ولا من يتبعه — يُستبعد من القائمة، والقاعدة تمنعه أيضاً
  const below = new Set<string>();
  if (pos?.id) {
    const stack = [pos.id];
    while (stack.length) {
      const cur = stack.pop()!;
      below.add(cur);
      positions.filter((p) => p.reports_to_position_id === cur).forEach((p) => stack.push(p.id));
    }
  }

  const input =
    "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";
  const label = "mb-1 block text-xs font-medium text-gray-600";
  const btn = "rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50";
  const btn2 = "rounded-lg border px-4 py-2 text-sm text-gray-600 hover:bg-gray-50";

  return (
    <div className="space-y-6">
      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {canManage && !pos && !grade && (
        <div className="flex flex-wrap gap-2">
          <button onClick={() => editPos()} className={btn}>+ منصب جديد</button>
          <button onClick={() => editGrade()} className={btn2}>+ درجة وظيفية</button>
        </div>
      )}

      {pos && (
        <form onSubmit={savePos} className="space-y-4 rounded-2xl border bg-white p-6 shadow-sm">
          <h3 className="font-semibold text-gray-800">{pos.id ? "تعديل المنصب" : "منصب جديد"}</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className={label}>المسمّى بالعربية *</label>
              <input className={input} required value={pos.title_ar} onChange={(e) => setPos({ ...pos, title_ar: e.target.value })} />
            </div>
            <div>
              <label className={label}>المسمّى بالإنجليزية</label>
              <input className={input} dir="ltr" value={pos.title_en} onChange={(e) => setPos({ ...pos, title_en: e.target.value })} />
            </div>
            <div>
              <label className={label}>الرمز *</label>
              <input className={input} dir="ltr" required pattern="[A-Za-z0-9_\-]{2,30}" value={pos.code}
                onChange={(e) => setPos({ ...pos, code: e.target.value.toUpperCase() })} />
            </div>
            <div>
              <label className={label}>القسم *</label>
              <select className={input} required value={pos.department_id} onChange={(e) => setPos({ ...pos, department_id: e.target.value })}>
                {activeDeps.map((d) => <option key={d.id} value={d.id}>{departmentLabel(d, departments)}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>يتبع منصب</label>
              <select className={input} value={pos.reports_to_position_id}
                onChange={(e) => setPos({ ...pos, reports_to_position_id: e.target.value })}>
                <option value="">— لا أحد (رأس الهيكل) —</option>
                {positions.filter((p) => p.status === "نشط" && !below.has(p.id)).map((p) => (
                  <option key={p.id} value={p.id}>{p.title_ar}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>الدرجة الوظيفية</label>
              <select className={input} value={pos.job_grade_id} onChange={(e) => setPos({ ...pos, job_grade_id: e.target.value })}>
                <option value="">— بلا درجة —</option>
                {grades.filter((g) => g.status === "نشط").map((g) => (
                  <option key={g.id} value={g.id}>{g.code} — {g.name_ar}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>نوع التوظيف</label>
              <select className={input} value={pos.employment_type} onChange={(e) => setPos({ ...pos, employment_type: e.target.value })}>
                {employmentTypes.filter((t) => t.active).map((t) => <option key={t.code} value={t.code}>{t.name_ar}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>الدور المقترح لصاحبه</label>
              <select className={input} value={pos.default_role_code}
                onChange={(e) => setPos({ ...pos, default_role_code: e.target.value })}>
                <option value="">—</option>
                {roles.filter((r) => r.base_role !== "broker").map((r) => <option key={r.code} value={r.code}>{r.name_ar}</option>)}
              </select>
              <p className="mt-1 text-[11px] text-gray-400">اقتراح يظهر عند التعيين — لا يُغيّر صلاحية أحد تلقائياً.</p>
            </div>
            <div>
              <label className={label}>الملاك المعتمد (عدد)</label>
              <input className={input} type="number" min="0" dir="ltr" value={pos.headcount_budget}
                onChange={(e) => setPos({ ...pos, headcount_budget: e.target.value })} />
            </div>
            <div className="sm:col-span-3">
              <label className={label}>الوصف الوظيفي</label>
              <textarea className={input} rows={2} value={pos.job_description}
                onChange={(e) => setPos({ ...pos, job_description: e.target.value })} />
            </div>
            <div className="sm:col-span-3">
              <label className={label}>المسؤوليات</label>
              <textarea className={input} rows={3} value={pos.responsibilities}
                onChange={(e) => setPos({ ...pos, responsibilities: e.target.value })} />
            </div>
          </div>
          <div className="flex gap-2">
            <button disabled={saving} className={btn}>{saving ? "جاري الحفظ..." : "حفظ"}</button>
            <button type="button" onClick={() => setPos(null)} className={btn2}>إلغاء</button>
          </div>
        </form>
      )}

      {grade && (
        <form onSubmit={saveGrade} className="space-y-4 rounded-2xl border bg-white p-6 shadow-sm">
          <h3 className="font-semibold text-gray-800">{grade.id ? "تعديل الدرجة" : "درجة جديدة"}</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className={label}>الرمز *</label>
              <input className={input} dir="ltr" required pattern="[A-Za-z0-9_\-]{1,20}" value={grade.code}
                onChange={(e) => setGrade({ ...grade, code: e.target.value.toUpperCase() })} />
            </div>
            <div>
              <label className={label}>الاسم *</label>
              <input className={input} required value={grade.name_ar} onChange={(e) => setGrade({ ...grade, name_ar: e.target.value })} />
            </div>
            <div>
              <label className={label}>المستوى *</label>
              <input className={input} type="number" min="1" max="99" dir="ltr" required value={grade.level}
                onChange={(e) => setGrade({ ...grade, level: e.target.value })} />
            </div>
            <div>
              <label className={label}>أدنى راتب (د.ع)</label>
              <input className={input} type="number" min="0" step="any" dir="ltr" value={grade.salary_min}
                onChange={(e) => setGrade({ ...grade, salary_min: e.target.value })} />
            </div>
            <div>
              <label className={label}>أعلى راتب (د.ع)</label>
              <input className={input} type="number" min="0" step="any" dir="ltr" value={grade.salary_max}
                onChange={(e) => setGrade({ ...grade, salary_max: e.target.value })} />
            </div>
            <div>
              <label className={label}>ملاحظات</label>
              <input className={input} value={grade.notes} onChange={(e) => setGrade({ ...grade, notes: e.target.value })} />
            </div>
          </div>
          <div className="flex gap-2">
            <button disabled={saving} className={btn}>{saving ? "جاري الحفظ..." : "حفظ"}</button>
            <button type="button" onClick={() => setGrade(null)} className={btn2}>إلغاء</button>
          </div>
        </form>
      )}

      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-700">المناصب</h3>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          إظهار المؤرشف
        </label>
      </div>

      {groups.map(({ d, items }) => (
        <div key={d.id} className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
          <div className="border-b bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-700">{departmentLabel(d, departments)}</div>
          <table className="w-full min-w-[820px] text-sm">
            <thead className="border-b text-gray-500">
              <tr>
                <th className="px-4 py-2 text-start font-medium">المنصب</th>
                <th className="px-4 py-2 text-start font-medium">يتبع</th>
                <th className="px-4 py-2 text-start font-medium">الدرجة</th>
                <th className="px-4 py-2 text-start font-medium">النوع</th>
                <th className="px-4 py-2 text-start font-medium">الدور المقترح</th>
                <th className="px-4 py-2 text-start font-medium">يشغله / الملاك</th>
                {canManage && <th className="px-4 py-2" />}
              </tr>
            </thead>
            <tbody>
              {items.map((p) => {
                const n = holders[p.id] ?? 0;
                const over = p.headcount_budget != null && n > p.headcount_budget;
                const archived = p.status !== "نشط";
                return (
                  <tr key={p.id} className={`border-b last:border-0 ${archived ? "text-gray-400" : ""}`}>
                    <td className="px-4 py-2">
                      <span className="font-medium">{p.title_ar}</span>
                      <span className="ms-2 font-mono text-[10px] text-gray-400" dir="ltr">{p.code}</span>
                      {archived && <span className="ms-2 rounded bg-gray-200 px-1.5 text-[10px]">مؤرشف</span>}
                    </td>
                    <td className="px-4 py-2 text-gray-600">
                      {p.reports_to_position_id ? posById.get(p.reports_to_position_id)?.title_ar ?? "—" : "—"}
                    </td>
                    <td className="px-4 py-2 text-gray-600">{p.job_grade_id ? gradeById.get(p.job_grade_id)?.code ?? "•" : "—"}</td>
                    <td className="px-4 py-2 text-gray-600">{typeByCode.get(p.employment_type)?.name_ar ?? p.employment_type}</td>
                    <td className="px-4 py-2 text-gray-600">
                      {p.default_role_code ? roleByCode.get(p.default_role_code)?.name_ar ?? p.default_role_code : "—"}
                    </td>
                    <td className={`px-4 py-2 ${over ? "font-semibold text-amber-600" : "text-gray-600"}`}>
                      {n}{p.headcount_budget != null ? ` / ${p.headcount_budget}` : ""}
                    </td>
                    {canManage && (
                      <td className="whitespace-nowrap px-4 py-2 text-end text-xs">
                        {!archived ? (
                          <>
                            <button onClick={() => editPos(p)} className="text-brand-700 hover:underline">تعديل</button>
                            <span className="mx-1.5 text-gray-300">|</span>
                            <button onClick={() => setPosStatus(p.id, "مؤرشف")} className="text-gray-500 hover:text-red-600">أرشفة</button>
                          </>
                        ) : (
                          <button onClick={() => setPosStatus(p.id, "نشط")} className="text-brand-700 hover:underline">استعادة</button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}

      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <h3 className="mb-1 font-semibold text-gray-800">الدرجات الوظيفية</h3>
        <p className="mb-3 text-xs text-gray-500">
          نطاق الراتب لكل درجة. يراه الموارد البشرية والمالية فقط — المنصب يشير إلى درجته ولا يكشف أرقامها.
        </p>
        {grades.length === 0 ? (
          <p className="text-sm text-gray-400">لا درجات بعد. الأرقام يضعها المالك.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b text-gray-500">
              <tr>
                <th className="py-2 text-start font-medium">الدرجة</th>
                <th className="py-2 text-start font-medium">المستوى</th>
                <th className="py-2 text-start font-medium">النطاق</th>
                <th className="py-2 text-start font-medium">ملاحظات</th>
                {canManage && <th className="py-2" />}
              </tr>
            </thead>
            <tbody>
              {grades.map((g) => (
                <tr key={g.id} className="border-b last:border-0">
                  <td className="py-2"><span className="font-mono text-xs" dir="ltr">{g.code}</span> — {g.name_ar}</td>
                  <td className="py-2">{g.level}</td>
                  <td className="py-2" dir="ltr">
                    {g.salary_min != null ? formatPrice(g.salary_min) : "—"} – {g.salary_max != null ? formatPrice(g.salary_max) : "—"}
                  </td>
                  <td className="py-2 text-gray-500">{g.notes ?? ""}</td>
                  {canManage && (
                    <td className="py-2 text-end text-xs">
                      <button onClick={() => editGrade(g)} className="text-brand-700 hover:underline">تعديل</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
