"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IRAQ_GOVERNORATES } from "@/lib/types";
import type { AssignmentRule, EmployeeLite, ProjectLite, Source } from "@/lib/crm";

// ============================================================
// قواعد الإسناد التلقائي (sql/073).
//
// ⚠️ القواعد **لا تعمل من تلقائها على كل ليد**. تُستدعى صراحةً:
//    من بوّابة الاستقبال (079) لكل ليد وارد، أو بزرّ «وزّع بلا مالك»
//    هنا. الليد الذي يُدخله موظف بيده يبقى له — لا يُنتزع منه بقاعدة.
//
// الترتيب بالأولوية: الأصغر يُفحص أولاً، وأول قاعدة منطبقة تفوز.
// وقاعدةٌ بلا شروط في آخر الأولويات تصلح شبكة أمان: لا ليد بلا مالك.
//
// ثلاث استراتيجيات:
//   دوري        بالدور أبجدياً — التوزيع العادل حين لا فرق
//   الأقل حِملاً من عنده أقلّ ليدات مفتوحة — يمنع التركّز من أصله
//   ثابت        شخص بعينه (مصدر يخصّه، أو مشروع يديره)
// ============================================================
export default function RulesPanel({
  rules,
  employees,
  projects,
  sources,
  ownerless,
}: {
  rules: AssignmentRule[];
  employees: EmployeeLite[];
  projects: ProjectLite[];
  sources: Source[];
  ownerless: number;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [f, setF] = useState({
    name: "",
    strategy: "الأقل حِملاً" as AssignmentRule["strategy"],
    match_source_id: "",
    match_project_id: "",
    match_governorate: "",
    target_team_id: "",
    target_owner_id: "",
    priority: "100",
  });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  const empName = (id: string | null) => employees.find((e) => e.id === id)?.full_name ?? "—";
  const projName = (id: string | null) => projects.find((p) => p.id === id)?.name ?? "—";
  const srcName = (id: string | null) => sources.find((s) => s.id === id)?.name ?? "—";

  async function add() {
    setErr(null);
    setMsg(null);
    if (!f.name.trim()) return setErr("اسمٌ للقاعدة — يظهر في سبب الإسناد على كل ليد.");
    if (f.strategy === "ثابت" && !f.target_owner_id) {
      return setErr("الاستراتيجية «ثابت» تحتاج موظفاً بعينه.");
    }
    const priority = Number(f.priority);
    if (!Number.isFinite(priority)) return setErr("الأولوية رقم.");

    setBusy("add");
    const { error } = await supabase.from("crm_assignment_rules").insert({
      name: f.name.trim(),
      strategy: f.strategy,
      match_source_id: f.match_source_id || null,
      match_project_id: f.match_project_id || null,
      match_governorate: f.match_governorate || null,
      target_team_id: f.target_team_id || null,
      target_owner_id: f.target_owner_id || null,
      priority,
    });
    setBusy(null);
    if (error) return setErr(error.message);
    setOpen(false);
    setF({ ...f, name: "", match_source_id: "", match_project_id: "", match_governorate: "", target_owner_id: "" });
    router.refresh();
  }

  async function toggle(r: AssignmentRule) {
    setBusy(r.id);
    const { error } = await supabase
      .from("crm_assignment_rules")
      .update({ is_active: !r.is_active })
      .eq("id", r.id);
    setBusy(null);
    if (error) return setErr(error.message);
    router.refresh();
  }

  async function remove(r: AssignmentRule) {
    if (!confirm(`حذف القاعدة «${r.name}»؟ الإسنادات السابقة تبقى بتاريخها.`)) return;
    setBusy(r.id);
    const { error } = await supabase.from("crm_assignment_rules").delete().eq("id", r.id);
    setBusy(null);
    if (error) return setErr(error.message);
    router.refresh();
  }

  // تشغيل القواعد على الليدات المفتوحة بلا مالك — المُسنَد لا يُمَسّ.
  // الحلقة في القاعدة لا هنا (sql/081): نداء واحد بدل مئتين، وكل
  // إسناد يمرّ بـ assign_client() فيُكتب له صفّ بسببه.
  async function assignOwnerless() {
    if (!confirm(`ستُوزَّع الليدات المفتوحة بلا مالك حسب القواعد الفعّالة. الليدات المُسنَدة والملفّات المغلقة لا تُمَسّ. متابعة؟`)) return;
    setBusy("run");
    setErr(null);
    setMsg(null);

    const { data, error } = await supabase.rpc("auto_assign_ownerless", { p_limit: 200 });
    setBusy(null);
    if (error) return setErr(error.message);

    const r = (Array.isArray(data) ? data[0] : data) as { assigned: number; skipped: number } | null;
    const assigned = Number(r?.assigned ?? 0);
    const skipped = Number(r?.skipped ?? 0);
    setMsg(
      `أُسنِد ${assigned} ليداً` +
        (skipped > 0
          ? ` · ${skipped} بلا قاعدة منطبقة فبقيت بلا مالك — أضِف قاعدة بلا شروط في آخر الأولويات كشبكة أمان.`
          : ".")
    );
    router.refresh();
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
        <div>
          <h2 className="font-bold text-gray-800">قواعد الإسناد التلقائي</h2>
          <p className="text-xs text-gray-500">
            تُطبَّق على الليدات الواردة من بوّابة الاستقبال، وعلى ما تُشغّله هنا يدوياً — لا تُنتزع ليداً من صاحبه.
          </p>
        </div>
        <div className="flex gap-2">
          {ownerless > 0 && rules.some((r) => r.is_active) && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={assignOwnerless}
              className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {busy === "run" ? "يوزّع…" : `وزّع ${ownerless} بلا مالك`}
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:border-brand-600 hover:text-brand-600"
          >
            {open ? "إغلاق" : "+ قاعدة"}
          </button>
        </div>
      </div>

      {err && <p className="border-b bg-red-50 px-5 py-2 text-xs text-red-700">{err}</p>}
      {msg && <p className="border-b bg-brand-50 px-5 py-2 text-xs text-brand-800">{msg}</p>}

      {rules.length === 0 ? (
        <p className="px-5 py-6 text-sm text-gray-400">
          لا قواعد بعد — كل ليد وارد يبقى بلا مالك حتى يُسنَد يدوياً.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">الأولوية</th>
                <th className="px-4 py-3 font-medium">القاعدة</th>
                <th className="px-4 py-3 font-medium">تنطبق على</th>
                <th className="px-4 py-3 font-medium">الاستراتيجية</th>
                <th className="px-4 py-3 font-medium">المستفيد</th>
                <th className="px-4 py-3 font-medium">فعّالة</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rules.map((r) => {
                const conds = [
                  r.match_source_id ? `مصدر: ${srcName(r.match_source_id)}` : null,
                  r.match_project_id ? `مشروع: ${projName(r.match_project_id)}` : null,
                  r.match_governorate ? `محافظة: ${r.match_governorate}` : null,
                ].filter(Boolean);
                return (
                  <tr key={r.id} className={r.is_active ? "" : "opacity-50"}>
                    <td className="px-4 py-2 text-gray-500" dir="ltr">{r.priority}</td>
                    <td className="px-4 py-2 font-medium text-gray-800">{r.name}</td>
                    <td className="px-4 py-2 text-gray-600">
                      {conds.length > 0 ? conds.join(" · ") : <span className="text-amber-700">كل الليدات (شبكة أمان)</span>}
                    </td>
                    <td className="px-4 py-2 text-gray-600">{r.strategy}</td>
                    <td className="px-4 py-2 text-gray-600">
                      {r.target_owner_id ? empName(r.target_owner_id) : r.target_team_id ? `فريق ${projName(r.target_team_id)}` : "كل الفريق"}
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="checkbox"
                        checked={r.is_active}
                        disabled={busy === r.id}
                        onChange={() => toggle(r)}
                      />
                    </td>
                    <td className="px-4 py-2">
                      <button
                        type="button"
                        disabled={busy === r.id}
                        onClick={() => remove(r)}
                        className="text-xs text-gray-400 hover:text-red-600 disabled:opacity-50"
                      >
                        حذف
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <div className="grid gap-3 border-t bg-gray-50 p-4 text-sm sm:grid-cols-3">
          <label className="block sm:col-span-2">
            <span className="text-xs text-gray-500">اسم القاعدة (يظهر في سبب الإسناد)</span>
            <input value={f.name} onChange={(e) => set("name", e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5" placeholder="ليدات سوشيل ميديا — بالتناوب" />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">الأولوية (الأصغر أولاً)</span>
            <input type="number" value={f.priority} onChange={(e) => set("priority", e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5" dir="ltr" />
          </label>

          <label className="block">
            <span className="text-xs text-gray-500">المصدر (فارغ = الكل)</span>
            <select value={f.match_source_id} onChange={(e) => set("match_source_id", e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5">
              <option value="">كل المصادر</option>
              {sources.filter((s) => s.is_active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">المشروع (فارغ = الكل)</span>
            <select value={f.match_project_id} onChange={(e) => set("match_project_id", e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5">
              <option value="">كل المشاريع</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">المحافظة (فارغ = الكل)</span>
            <select value={f.match_governorate} onChange={(e) => set("match_governorate", e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5">
              <option value="">كل المحافظات</option>
              {IRAQ_GOVERNORATES.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="text-xs text-gray-500">الاستراتيجية</span>
            <select value={f.strategy} onChange={(e) => set("strategy", e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5">
              <option value="الأقل حِملاً">الأقل حِملاً — يمنع التركّز</option>
              <option value="دوري">دوري — بالتناوب</option>
              <option value="ثابت">ثابت — شخص بعينه</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">فريق المشروع (يحصر المرشّحين)</span>
            <select value={f.target_team_id} onChange={(e) => set("target_team_id", e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5" disabled={f.strategy === "ثابت"}>
              <option value="">كل الموظفين</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">الموظف {f.strategy === "ثابت" ? "(إلزامي)" : "(للثابت فقط)"}</span>
            <select value={f.target_owner_id} onChange={(e) => set("target_owner_id", e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5" disabled={f.strategy !== "ثابت"}>
              <option value="">—</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
          </label>

          <div className="flex gap-2 sm:col-span-3">
            <button type="button" disabled={busy === "add"} onClick={add} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
              أضف القاعدة
            </button>
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600">
              إلغاء
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
