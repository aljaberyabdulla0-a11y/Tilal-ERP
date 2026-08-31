"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  CommissionTier,
  EmployeeCommissionRule,
  Project,
  ProjectCommission,
  RULE_KINDS,
  SaleCommission,
  TeamMember,
  formatPrice,
  isRateKind,
} from "@/lib/types";

// ============================================================
// إدارة العمولات: نسب المشاريع، قواعد الموظفين، وما استُحقّ.
//
// النسب والقواعد تُحفظ فوراً عند التعديل لا بزرّ حفظ عام: الجدول
// طويل، وزرٌّ واحد في أسفله كان سيجعل المستخدم لا يدري ما حُفظ
// وما ضاع.
// ============================================================
export default function CommissionsTabs({
  isAdmin,
  projects,
  employees,
  rates,
  tiers,
  rules,
  earned,
}: {
  isAdmin: boolean;
  projects: Project[];
  employees: TeamMember[];
  rates: ProjectCommission[];
  tiers: CommissionTier[];
  rules: EmployeeCommissionRule[];
  earned: SaleCommission[];
}) {
  const [tab, setTab] = useState<"projects" | "rules" | "earned">("projects");

  const projectName = useMemo(() => {
    const m = new Map(projects.map((p) => [p.id, p.name]));
    return (id: string | null) => (id ? m.get(id) ?? "—" : "كل المشاريع");
  }, [projects]);

  const employeeName = useMemo(() => {
    const m = new Map(employees.map((e) => [e.id, e.full_name]));
    return (id: string | null) => (id ? m.get(id) ?? "—" : "كل الموظفين");
  }, [employees]);

  const tabBtn = (key: typeof tab, label: string, n: number) => (
    <button
      onClick={() => setTab(key)}
      className={
        tab === key
          ? "flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white"
          : "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-100"
      }
    >
      {label}
      <span
        className={
          tab === key
            ? "rounded-full bg-white/20 px-2 py-0.5 text-[11px]"
            : "rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500"
        }
      >
        {n}
      </span>
    </button>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-1 rounded-xl border border-gray-200 bg-white p-1 shadow-sm">
        {tabBtn("projects", "نسب المشاريع", projects.length)}
        {tabBtn("rules", "قواعد الموظفين", rules.length)}
        {tabBtn("earned", "عمولات الصفقات", earned.length)}
      </div>

      {tab === "projects" && (
        <ProjectRates
          isAdmin={isAdmin}
          projects={projects}
          rates={rates}
          tiers={tiers}
          earned={earned}
        />
      )}
      {tab === "rules" && (
        <EmployeeRules
          isAdmin={isAdmin}
          projects={projects}
          employees={employees}
          rules={rules}
          projectName={projectName}
          employeeName={employeeName}
        />
      )}
      {tab === "earned" && (
        <Earned
          earned={earned}
          projectName={projectName}
          employeeName={employeeName}
        />
      )}
    </div>
  );
}

// ============================================================
// نسب المشاريع وشرائحها
// ============================================================
function ProjectRates({
  isAdmin,
  projects,
  rates,
  tiers,
  earned,
}: {
  isAdmin: boolean;
  projects: Project[];
  rates: ProjectCommission[];
  tiers: CommissionTier[];
  earned: SaleCommission[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const rateOf = (id: string) => rates.find((r) => r.project_id === id) ?? null;
  const tiersOf = (id: string) => tiers.filter((t) => t.project_id === id);
  const salesOf = (id: string) =>
    earned.filter((e) => e.project_id === id).length;

  async function saveRate(projectId: string, patch: Partial<ProjectCommission>) {
    setBusy(projectId);
    setMsg(null);
    const cur = rateOf(projectId);
    const row = {
      project_id: projectId,
      base_rate: patch.base_rate ?? cur?.base_rate ?? 0,
      target_sales: patch.target_sales ?? cur?.target_sales ?? null,
    };
    const { error } = await supabase
      .from("project_commissions")
      .upsert(row, { onConflict: "project_id" });
    setBusy(null);
    if (error) setMsg("تعذّر الحفظ: " + error.message);
    else router.refresh();
  }

  async function addTier(projectId: string) {
    const minStr = window.prompt("الشريحة تبدأ من الصفقة رقم:");
    if (!minStr) return;
    const rateStr = window.prompt("النسبة الجديدة (%):");
    if (!rateStr) return;

    const min_sales = Number(minStr);
    const rate = Number(rateStr);
    if (!Number.isFinite(min_sales) || min_sales < 1 || !Number.isFinite(rate)) {
      setMsg("أرقام غير صحيحة.");
      return;
    }

    setBusy(projectId);
    const { error } = await supabase
      .from("commission_tiers")
      .insert({ project_id: projectId, min_sales, rate });
    setBusy(null);
    if (error)
      setMsg(
        error.code === "23505"
          ? "توجد شريحة تبدأ من هذا الرقم بالفعل."
          : "تعذّرت الإضافة: " + error.message,
      );
    else router.refresh();
  }

  async function removeTier(id: string) {
    if (!window.confirm("حذف هذه الشريحة؟")) return;
    const { error } = await supabase.from("commission_tiers").delete().eq("id", id);
    if (error) setMsg("تعذّر الحذف: " + error.message);
    else router.refresh();
  }

  const input =
    "w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-gray-700">
        <b className="text-blue-800">كيف تُقرأ الشرائح؟</b> النسبة الأساسية تسري
        من الصفقة الأولى. وكل شريحة تقول «من الصفقة رقم كذا فصاعداً تصير النسبة
        كذا» — فمشروع أساسه 2% وشريحته تبدأ من الصفقة 31 بنسبة 2.5%، تُحتسب
        صفقاته الثلاثون الأولى بـ2% وما بعدها بـ2.5%. والترتيب داخل المشروع لا
        في الشركة كلها.
      </div>

      {msg && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{msg}</p>
      )}

      {projects.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
          لا مشاريع بعد.
        </div>
      ) : (
        <div className="space-y-3">
          {projects.map((p) => {
            const r = rateOf(p.id);
            const ts = tiersOf(p.id);
            const sold = salesOf(p.id);
            const target = r?.target_sales ?? null;
            const pct =
              target && target > 0 ? Math.min(100, (sold / target) * 100) : null;

            return (
              <div key={p.id} className="rounded-2xl bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                  <h3 className="min-w-[140px] text-base font-bold text-gray-800">
                    {p.name}
                  </h3>

                  <label className="flex items-center gap-2 text-sm text-gray-600">
                    النسبة الأساسية
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      dir="ltr"
                      disabled={!isAdmin || busy === p.id}
                      defaultValue={r?.base_rate ?? 0}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v) && v !== (r?.base_rate ?? 0))
                          saveRate(p.id, { base_rate: v });
                      }}
                      className={input}
                    />
                    %
                  </label>

                  <label className="flex items-center gap-2 text-sm text-gray-600">
                    التاركت
                    <input
                      type="number"
                      min="0"
                      dir="ltr"
                      disabled={!isAdmin || busy === p.id}
                      defaultValue={r?.target_sales ?? ""}
                      onBlur={(e) => {
                        const v = e.target.value ? Number(e.target.value) : null;
                        if (v !== (r?.target_sales ?? null))
                          saveRate(p.id, { target_sales: v });
                      }}
                      className={input}
                    />
                    صفقة
                  </label>

                  <span className="ms-auto text-sm text-gray-500">
                    المنجز: <b className="text-gray-800">{sold}</b>
                    {target ? ` / ${target}` : ""}
                  </span>
                </div>

                {pct !== null && (
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100">
                    <div
                      className={`h-full rounded-full ${
                        pct >= 100 ? "bg-green-500" : "bg-brand-500"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
                  <span className="text-xs font-medium text-gray-500">
                    الشرائح:
                  </span>
                  {ts.length === 0 && (
                    <span className="text-xs text-gray-400">
                      لا شرائح — النسبة ثابتة.
                    </span>
                  )}
                  {ts.map((t) => (
                    <span
                      key={t.id}
                      className="flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700"
                    >
                      من {t.min_sales} → {t.rate}%
                      {isAdmin && (
                        <button
                          onClick={() => removeTier(t.id)}
                          className="text-brand-400 transition hover:text-red-600"
                          title="حذف"
                        >
                          ×
                        </button>
                      )}
                    </span>
                  ))}
                  {isAdmin && (
                    <button
                      onClick={() => addTier(p.id)}
                      className="rounded-full border border-dashed border-gray-300 px-3 py-1 text-xs text-gray-600 transition hover:border-brand-400 hover:text-brand-700"
                    >
                      + شريحة
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================
// قواعد عمولة الموظفين
// ============================================================
function EmployeeRules({
  isAdmin,
  projects,
  employees,
  rules,
  projectName,
  employeeName,
}: {
  isAdmin: boolean;
  projects: Project[];
  employees: TeamMember[];
  rules: EmployeeCommissionRule[];
  projectName: (id: string | null) => string;
  employeeName: (id: string | null) => string;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [employeeId, setEmployeeId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [kind, setKind] = useState<string>(RULE_KINDS[0]);
  const [value, setValue] = useState("");
  const [minArea, setMinArea] = useState("");
  const [maxArea, setMaxArea] = useState("");

  async function add() {
    setErr(null);
    const v = Number(value);
    if (!Number.isFinite(v) || v < 0) {
      setErr("اكتب قيمة صحيحة.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("employee_commission_rules").insert({
      employee_id: employeeId || null,
      project_id: projectId || null,
      kind,
      value: v,
      min_area: minArea ? Number(minArea) : null,
      max_area: maxArea ? Number(maxArea) : null,
    });
    setBusy(false);
    if (error) {
      setErr("تعذّرت الإضافة: " + error.message);
      return;
    }
    setOpen(false);
    setValue("");
    setMinArea("");
    setMaxArea("");
    router.refresh();
  }

  async function toggle(r: EmployeeCommissionRule) {
    const { error } = await supabase
      .from("employee_commission_rules")
      .update({ active: !r.active })
      .eq("id", r.id);
    if (!error) router.refresh();
  }

  async function remove(r: EmployeeCommissionRule) {
    if (!window.confirm("حذف هذه القاعدة؟ الصفقات المحسوبة بها لا تتغيّر.")) return;
    const { error } = await supabase
      .from("employee_commission_rules")
      .delete()
      .eq("id", r.id);
    if (!error) router.refresh();
  }

  const input =
    "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-gray-700">
        <b className="text-blue-800">الأخصّ يسبق الأعمّ.</b> قاعدة موظف في مشروع
        معيّن تسبق قاعدته العامة، وتلك تسبق قاعدة المشروع للجميع، وتلك تسبق
        القاعدة العامة. وقاعدةٌ تحدّد شريحة مساحة تسبق قاعدةً لا تحدّدها — فتضع
        قاعدةً عامة «20% من عمولة الشركة»، وأخرى «مليون ونصف مقطوعاً للمساحات
        فوق 200 م²»، فتُطبَّق الثانية على الكبيرة والأولى على ما عداها.
      </div>

      {isAdmin && (
        <button
          onClick={() => setOpen(true)}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          + قاعدة جديدة
        </button>
      )}

      {rules.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
          لا قواعد بعد — لن تُحتسب عمولة لأي موظف حتى تضيف واحدة.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
          <table className="w-full min-w-[760px] text-start text-sm">
            <thead className="border-b bg-gray-50 text-gray-600">
              <tr>
                <th className="px-4 py-3 text-start font-medium">الموظف</th>
                <th className="px-4 py-3 text-start font-medium">المشروع</th>
                <th className="px-4 py-3 text-start font-medium">القاعدة</th>
                <th className="px-4 py-3 text-start font-medium">المساحة</th>
                <th className="px-4 py-3 text-start font-medium">الحالة</th>
                {isAdmin && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr
                  key={r.id}
                  className={
                    r.active
                      ? "border-b last:border-0 hover:bg-gray-50"
                      : "border-b bg-gray-50/60 text-gray-400 last:border-0"
                  }
                >
                  <td className="px-4 py-3 font-medium text-gray-800">
                    {employeeName(r.employee_id)}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {projectName(r.project_id)}
                  </td>
                  <td className="px-4 py-3 text-gray-800">
                    {r.kind}{" "}
                    <b dir="ltr" className="text-brand-700">
                      {isRateKind(r.kind)
                        ? `${r.value}%`
                        : formatPrice(r.value)}
                    </b>
                  </td>
                  <td className="px-4 py-3 text-gray-600" dir="ltr">
                    {r.min_area === null && r.max_area === null
                      ? "—"
                      : `${r.min_area ?? 0} – ${r.max_area ?? "∞"} م²`}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        r.active
                          ? "bg-green-100 text-green-700"
                          : "bg-gray-200 text-gray-600"
                      }`}
                    >
                      {r.active ? "سارية" : "موقوفة"}
                    </span>
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => toggle(r)}
                          className="text-xs text-gray-500 hover:text-brand-700"
                        >
                          {r.active ? "إيقاف" : "تفعيل"}
                        </button>
                        <button
                          onClick={() => remove(r)}
                          className="text-xs text-gray-400 hover:text-red-600"
                        >
                          حذف
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => !busy && setOpen(false)}
          />
          <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="mb-4 text-lg font-bold text-brand-700">قاعدة عمولة</h3>

            <label className="mb-1 block text-xs font-medium text-gray-600">
              الموظف
            </label>
            <select
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className={input + " mb-3"}
            >
              <option value="">كل الموظفين</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.full_name}
                </option>
              ))}
            </select>

            <label className="mb-1 block text-xs font-medium text-gray-600">
              المشروع
            </label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className={input + " mb-3"}
            >
              <option value="">كل المشاريع</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            <label className="mb-1 block text-xs font-medium text-gray-600">
              نوع الاحتساب
            </label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className={input + " mb-3"}
            >
              {RULE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>

            <label className="mb-1 block text-xs font-medium text-gray-600">
              {isRateKind(kind) ? "النسبة (%)" : "المبلغ (د.ع)"}
            </label>
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              type="number"
              min={0}
              step={isRateKind(kind) ? "0.1" : "1"}
              dir="ltr"
              className={input + " mb-3"}
            />

            <label className="mb-1 block text-xs font-medium text-gray-600">
              شريحة المساحة (اختياري)
            </label>
            <div className="mb-1 flex items-center gap-2">
              <input
                value={minArea}
                onChange={(e) => setMinArea(e.target.value)}
                type="number"
                min={0}
                placeholder="من م²"
                dir="ltr"
                className={input}
              />
              <input
                value={maxArea}
                onChange={(e) => setMaxArea(e.target.value)}
                type="number"
                min={0}
                placeholder="إلى م²"
                dir="ltr"
                className={input}
              />
            </div>
            <p className="mb-4 text-[11px] text-gray-500">
              اتركهما فارغين لتسري على كل المساحات.
            </p>

            {err && (
              <p className="mb-3 rounded-lg bg-red-50 p-2 text-xs text-red-700">
                {err}
              </p>
            )}

            <div className="flex items-center gap-2">
              <button
                onClick={add}
                disabled={busy}
                className="flex-1 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
              >
                {busy ? "جارٍ…" : "إضافة"}
              </button>
              <button
                onClick={() => setOpen(false)}
                disabled={busy}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// ما استُحقّ من الصفقات
// ============================================================
function Earned({
  earned,
  projectName,
  employeeName,
}: {
  earned: SaleCommission[];
  projectName: (id: string | null) => string;
  employeeName: (id: string | null) => string;
}) {
  const totals = useMemo(() => {
    let company = 0;
    let employee = 0;
    let uncollected = 0;
    for (const e of earned) {
      company += Number(e.company_amount);
      employee += Number(e.employee_amount);
      if (!e.collected_at) uncollected += Number(e.company_amount);
    }
    return { company, employee, uncollected };
  }, [earned]);

  const tile = "glass-card border-s-4 p-4";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className={tile + " border-s-brand-500"}>
          <span className="text-sm text-gray-500">عمولة الشركة</span>
          <p className="mt-1 text-xl font-bold text-gray-800" dir="ltr">
            {formatPrice(totals.company)}
          </p>
        </div>
        <div className={tile + " border-s-amber-500"}>
          <span className="text-sm text-gray-500">لم تُحصَّل بعد</span>
          <p className="mt-1 text-xl font-bold text-amber-700" dir="ltr">
            {formatPrice(totals.uncollected)}
          </p>
        </div>
        <div className={tile + " border-s-blue-500"}>
          <span className="text-sm text-gray-500">نصيب الموظفين</span>
          <p className="mt-1 text-xl font-bold text-blue-700" dir="ltr">
            {formatPrice(totals.employee)}
          </p>
        </div>
      </div>

      {earned.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
          لا عمولات بعد. تُسجَّل آلياً عند إتمام بيع وحدة.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
          <table className="w-full min-w-[900px] text-start text-sm">
            <thead className="border-b bg-gray-50 text-gray-600">
              <tr>
                <th className="px-4 py-3 text-start font-medium">المشروع</th>
                <th className="px-4 py-3 text-start font-medium">الصفقة</th>
                <th className="px-4 py-3 text-start font-medium">قيمة البيع</th>
                <th className="px-4 py-3 text-start font-medium">نسبة الشركة</th>
                <th className="px-4 py-3 text-start font-medium">عمولة الشركة</th>
                <th className="px-4 py-3 text-start font-medium">الموظف</th>
                <th className="px-4 py-3 text-start font-medium">نصيبه</th>
              </tr>
            </thead>
            <tbody>
              {earned.map((e) => (
                <tr key={e.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-800">
                    {projectName(e.project_id)}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs">
                      #{e.sales_index}
                    </span>
                    {e.unit_area && (
                      <span className="ms-2 text-[11px] text-gray-400" dir="ltr">
                        {e.unit_area} م²
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-800" dir="ltr">
                    {formatPrice(e.deal_amount)}
                  </td>
                  <td className="px-4 py-3 text-gray-600" dir="ltr">
                    {e.company_rate}%
                  </td>
                  <td className="px-4 py-3 font-semibold text-brand-700" dir="ltr">
                    {formatPrice(e.company_amount)}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {employeeName(e.employee_id)}
                    {e.employee_basis && (
                      <span className="block text-[11px] text-gray-400">
                        {e.employee_basis}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-semibold text-blue-700" dir="ltr">
                    {formatPrice(e.employee_amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="rounded-xl bg-gray-50 p-3 text-xs text-gray-600">
        عمولة الشركة تُسجَّل عند إتمام البيع بنسبة المشروع وشريحته يومَها، ولا
        تتغيّر بتعديل النسب لاحقاً. ونصيب الموظف يدخل كشف راتبه عند{" "}
        <b className="text-gray-800">اكتمال سداد فاتورة العميل</b> — عمولة على
        مبلغ لم يُقبض وعدٌ لا استحقاق.
      </p>
    </div>
  );
}
