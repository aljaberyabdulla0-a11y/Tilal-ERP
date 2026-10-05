import Link from "next/link";
import { redirect } from "next/navigation";
import { canSeeBrokers, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getProjects } from "@/lib/projects";
import { getCommissionLedger } from "@/lib/brokers";
import {
  LEDGER_STATUS_COLORS,
  SALE_CHANNEL_COLORS,
  formatPrice,
} from "@/lib/types";
import BrokersTabs from "../brokers-tabs";
import AddPayment from "./add-payment";
import ReleaseCommission from "./release-commission";

// ============================================================
// تقرير العمولات (sql/129 commission_ledger) — أربع طبقات بأعمدة واحدة:
//   الوسيط · الموظف (مباشر) · مدير العلاقات (وسيط) · تلال من المطوّر.
// لكل صفّ: المستفيد، النوع، الخطة، الشريحة، النسبة، المبلغ، ومراحله
// الثلاث — مستحق ← قابل للصرف ← مدفوع — والرصيد.
//
// الدفتر عرضٌ بصلاحيات السائل (security_invoker): الـRM يرى عمولات
// شركاته، والمحاسب والمدير يرون الكل. والصرف للوسيط من هنا للمدير وحده،
// وعمولة الموظف تُصرف في كشف راتبه لا هنا.
// ============================================================
type SP = Record<string, string | undefined>;

const RECIPIENT_TYPES = ["وسيط", "موظف مباشر", "مدير علاقات", "تلال"] as const;
const STATUSES = Object.keys(LEDGER_STATUS_COLORS);

export default async function CommissionReportPage({ searchParams }: { searchParams: SP }) {
  if (!(await canSeeBrokers())) redirect("/dashboard");

  const f = {
    from: searchParams.from,
    to: searchParams.to,
    project: searchParams.project,
    recipientType: searchParams.type,
    recipient: searchParams.recipient,
    status: searchParams.status,
    channel: searchParams.channel,
  };

  const supabase = await createClient();
  const [rows, projects, admin] = await Promise.all([getCommissionLedger(f), getProjects(), isAdmin()]);

  const unitIds = Array.from(new Set(rows.map((r) => r.unit_id).filter(Boolean) as string[]));
  const { data: unitRows } = unitIds.length
    ? await supabase.from("units").select("id, unit_code").in("id", unitIds)
    : { data: [] as { id: string; unit_code: string | null }[] };
  const unitCode = new Map((unitRows ?? []).map((u) => [u.id, u.unit_code]));
  const projectName = new Map(projects.map((p) => [p.id, p.name]));

  // صرف الوسيط يحتاج صافي المصروف لكل عمولة — هو paid_amount في الدفتر
  const live = rows.filter((r) => !r.reversed_at);
  const sum = (pred: (r: (typeof rows)[number]) => boolean, k: "amount" | "paid_amount" | "balance") =>
    live.filter(pred).reduce((s, r) => s + Number(r[k]), 0);
  const cost = (r: (typeof rows)[number]) => r.recipient_type !== "تلال";

  const totals = [
    { label: "عمولة تلال من المطوّر", value: sum((r) => r.recipient_type === "تلال", "amount"), color: "text-emerald-700" },
    { label: "كلفة العمولات (وسيط + موظفين)", value: sum(cost, "amount"), color: "text-gray-800" },
    { label: "مدفوع منها", value: sum(cost, "paid_amount"), color: "text-sky-700" },
    { label: "رصيد مستحق علينا", value: sum(cost, "balance"), color: "text-amber-700" },
  ];

  const recipients = Array.from(
    new Map(rows.filter((r) => r.recipient_id).map((r) => [r.recipient_id as string, `${r.recipient_name} (${r.recipient_type})`])).entries()
  );

  const inputCls = "rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none";

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link href="/dashboard" className="text-sm text-gray-500 hover:text-brand-700">
          ← لوحة التحكم
        </Link>
        <h1 className="text-xl font-bold text-brand-700">تقرير العمولات</h1>
      </header>

      <BrokersTabs active="commissions" />

      <section className="space-y-5 p-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {totals.map((t) => (
            <div key={t.label} className="glass-card p-4">
              <span className="text-xs font-bold text-gray-400">{t.label}</span>
              <p className={`mt-1 text-xl font-bold ${t.color}`} dir="ltr">{formatPrice(t.value)}</p>
            </div>
          ))}
        </div>

        <form method="get" className="glass-card flex flex-wrap items-end gap-2 p-4">
          <label className="text-xs text-gray-500">
            من <input type="date" name="from" defaultValue={f.from} className={inputCls + " ms-1"} dir="ltr" />
          </label>
          <label className="text-xs text-gray-500">
            إلى <input type="date" name="to" defaultValue={f.to} className={inputCls + " ms-1"} dir="ltr" />
          </label>
          <select name="project" defaultValue={f.project ?? ""} className={inputCls}>
            <option value="">كل المشاريع</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select name="type" defaultValue={f.recipientType ?? ""} className={inputCls}>
            <option value="">كل الأنواع</option>
            {RECIPIENT_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
          <select name="recipient" defaultValue={f.recipient ?? ""} className={inputCls}>
            <option value="">كل المستفيدين</option>
            {recipients.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
          </select>
          <select name="channel" defaultValue={f.channel ?? ""} className={inputCls}>
            <option value="">مباشر ووسيط</option>
            <option>مباشر</option>
            <option>وسيط</option>
          </select>
          <select name="status" defaultValue={f.status ?? ""} className={inputCls}>
            <option value="">كل الحالات</option>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
          <button className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">تصفية</button>
          <Link href="/dashboard/brokers/commissions" className="px-2 py-2 text-sm text-gray-500 hover:text-brand-700">مسح</Link>
        </form>

        {rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
            لا عمولات في هذا النطاق.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
            <table className="w-full min-w-[1300px] text-sm">
              <thead className="border-b bg-gray-50 text-xs text-gray-600">
                <tr>
                  {["الصفقة", "الوحدة", "المشروع", "المستفيد", "النوع", "الشريحة", "النسبة", "المبلغ", "استُحقّت", "قابلة للصرف", "مدفوع", "الرصيد", "الحالة", ""].map((h, i) => (
                    <th key={i} className="px-3 py-3 text-start font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const broker = r.recipient_type === "وسيط";
                  return (
                    <tr key={`${r.recipient_type}-${r.entry_id}`} className="border-b align-top last:border-0 hover:bg-gray-50">
                      <td className="px-3 py-2">
                        {r.reservation_id ? (
                          <Link href={`/dashboard/reservations/${r.reservation_id}`} className="text-brand-700 hover:underline" dir="ltr">
                            {formatPrice(Number(r.deal_amount))}
                          </Link>
                        ) : "—"}
                        <span className={`ms-1 rounded-full px-1.5 py-0.5 text-[10px] ${SALE_CHANNEL_COLORS[r.sale_channel] ?? ""}`}>{r.sale_channel}</span>
                      </td>
                      <td className="px-3 py-2 text-gray-600">{(r.unit_id && unitCode.get(r.unit_id)) ?? "—"}</td>
                      <td className="px-3 py-2 text-gray-600">{(r.project_id && projectName.get(r.project_id)) ?? "—"}</td>
                      <td className="px-3 py-2">
                        {broker && r.recipient_id ? (
                          <Link href={`/dashboard/brokers/${r.recipient_id}`} className="font-semibold text-brand-700 hover:underline">{r.recipient_name}</Link>
                        ) : (
                          <span className="font-semibold text-gray-800">{r.recipient_name}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-600">{r.commission_type}</td>
                      <td className="px-3 py-2 text-xs text-gray-500">
                        {r.plan_name ?? r.formula ?? "—"}
                        {r.tier_measure != null && (
                          <span className="block">
                            {r.basis === "قيمة المبيعات" ? formatPrice(Number(r.tier_measure)) : `${Number(r.tier_measure)} وحدة`}
                            {r.period ? ` · ${r.period}` : ""}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-600" dir="ltr">
                        {r.rate != null ? `${Number(r.rate)}%` : "—"}
                        {r.fixed_amount ? ` + ${formatPrice(Number(r.fixed_amount))}` : ""}
                      </td>
                      <td className="px-3 py-2 font-bold text-gray-800" dir="ltr">{formatPrice(Number(r.amount))}</td>
                      <td className="px-3 py-2 text-xs text-gray-500" dir="ltr">{r.earned_at}</td>
                      <td className="px-3 py-2 text-xs text-gray-500" dir="ltr">{r.payable_at ?? "—"}</td>
                      <td className="px-3 py-2 text-sky-700" dir="ltr">{formatPrice(Number(r.paid_amount))}</td>
                      <td className="px-3 py-2 font-semibold text-amber-700" dir="ltr">{formatPrice(Number(r.balance))}</td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${LEDGER_STATUS_COLORS[r.status] ?? "bg-gray-100"}`}>{r.status}</span>
                      </td>
                      <td className="px-3 py-2">
                        {admin && broker && !r.reversed_at && (
                          <div className="flex flex-col items-start gap-1">
                            {r.payable_at && Number(r.balance) > 0 && <AddPayment commissionId={r.entry_id} remaining={Number(r.balance)} />}
                            {!r.payable_at && Number(r.balance) > 0 && <ReleaseCommission commissionId={r.entry_id} />}
                            {Number(r.paid_amount) > 0 && <AddPayment commissionId={r.entry_id} remaining={Number(r.paid_amount)} kind="استرداد" />}
                          </div>
                        )}
                        {admin && broker && r.reversed_at && Number(r.paid_amount) > 0 && (
                          <AddPayment commissionId={r.entry_id} remaining={Number(r.paid_amount)} kind="استرداد" />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {rows.length >= 1000 && (
          <p className="text-xs text-amber-700">يُعرض أول ١٠٠٠ صفّ — ضيّق المرشّحات.</p>
        )}
      </section>
    </main>
  );
}
