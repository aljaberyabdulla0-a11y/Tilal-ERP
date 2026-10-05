import Link from "next/link";
import { redirect } from "next/navigation";
import { canSeeBrokers } from "@/lib/auth";
import { getProjects } from "@/lib/projects";
import {
  getBrokerPerformance,
  getDirectVsBroker,
  getRmPerformance,
  getSupervisorApprovalPerformance,
} from "@/lib/brokers";
import { formatPrice } from "@/lib/types";
import BrokersTabs from "../brokers-tabs";

// ============================================================
// الأداء (sql/130) — أربعة أسئلة للإدارة:
//   ١) مباشر أم وسيط؟ كم بعنا بكلٍّ وكم كلّفنا من عمولة.
//   ٢) أيّ شركة وسيطة أفضل؟ من الليد إلى البيع، بالترتيب.
//   ٣) أيّ مدير علاقات أفضل؟ سرعة المعالجة وما تحوّل بيعاً.
//   ٤) أين يختنق المسار؟ زمن الموافقة ونسبة الرفض لكل مشرف.
// كل دالّة تفحص النطاق في القاعدة: الـRM يرى شركاته، والمشرف مشاريعه.
// ============================================================
type SP = Record<string, string | undefined>;

const n = (v: number | null | undefined) => (v == null ? "—" : Number(v).toLocaleString("en-US"));
const pct = (v: number | null | undefined) => (v == null ? "—" : `${Number(v)}٪`);
const hrs = (v: number | null | undefined) => (v == null ? "—" : `${Number(v)} س`);

export default async function BrokerPerformancePage({ searchParams }: { searchParams: SP }) {
  if (!(await canSeeBrokers())) redirect("/dashboard");

  const range = { from: searchParams.from ?? null, to: searchParams.to ?? null, project: searchParams.project ?? null };
  const [dvb, brokers, rms, sups, projects] = await Promise.all([
    getDirectVsBroker(range),
    getBrokerPerformance(range),
    getRmPerformance(range),
    getSupervisorApprovalPerformance(range),
    getProjects(),
  ]);

  const th = "px-3 py-2 text-start font-medium";
  const td = "px-3 py-2";
  const inputCls = "rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none";
  const card = (title: string, sub: string, body: React.ReactNode) => (
    <div className="glass-card p-5">
      <h2 className="text-lg font-bold text-gray-800">{title}</h2>
      <p className="mb-3 text-xs text-gray-500">{sub}</p>
      <div className="overflow-x-auto">{body}</div>
    </div>
  );
  const empty = <p className="text-sm text-gray-400">لا بيانات في هذا النطاق.</p>;

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link href="/dashboard" className="text-sm text-gray-500 hover:text-brand-700">
          ← لوحة التحكم
        </Link>
        <h1 className="text-xl font-bold text-brand-700">أداء الوساطة</h1>
      </header>

      <BrokersTabs active="performance" />

      <section className="space-y-5 p-6">
        <form method="get" className="glass-card flex flex-wrap items-end gap-2 p-4">
          <label className="text-xs text-gray-500">
            من <input type="date" name="from" defaultValue={range.from ?? ""} className={inputCls + " ms-1"} dir="ltr" />
          </label>
          <label className="text-xs text-gray-500">
            إلى <input type="date" name="to" defaultValue={range.to ?? ""} className={inputCls + " ms-1"} dir="ltr" />
          </label>
          <select name="project" defaultValue={range.project ?? ""} className={inputCls}>
            <option value="">كل المشاريع</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">عرض</button>
          <span className="text-xs text-gray-400">مرشّح المشروع يسري على الشركات ومدراء العلاقات</span>
        </form>

        {card("مباشر مقابل وسيط", "المبيعات المكتملة في النطاق وكلفة عمولاتها على تلال — والصافي بعد عمولة المطوّر", dvb.length === 0 ? empty : (
          <table className="w-full min-w-[1000px] text-sm">
            <thead className="border-b bg-gray-50 text-xs text-gray-600">
              <tr>
                <th className={th}>المشروع</th><th className={th}>مباشر</th><th className={th}>قيمته</th>
                <th className={th}>وسيط</th><th className={th}>قيمته</th><th className={th}>من المطوّر</th>
                <th className={th}>عمولة مباشرة</th><th className={th}>عمولة وسطاء</th><th className={th}>عمولة RM</th>
                <th className={th}>كلفة العمولات</th><th className={th}>الصافي</th>
              </tr>
            </thead>
            <tbody>
              {dvb.map((r) => (
                <tr key={r.project_id} className="border-b last:border-0">
                  <td className={td + " font-semibold"}>{r.project_name}</td>
                  <td className={td}>{n(r.direct_sales)}</td>
                  <td className={td} dir="ltr">{formatPrice(Number(r.direct_value))}</td>
                  <td className={td}>{n(r.broker_sales)}</td>
                  <td className={td} dir="ltr">{formatPrice(Number(r.broker_value))}</td>
                  <td className={td + " text-emerald-700"} dir="ltr">{formatPrice(Number(r.developer_commission))}</td>
                  <td className={td} dir="ltr">{formatPrice(Number(r.direct_commission))}</td>
                  <td className={td} dir="ltr">{formatPrice(Number(r.broker_commission))}</td>
                  <td className={td} dir="ltr">{formatPrice(Number(r.rm_commission))}</td>
                  <td className={td + " font-semibold text-amber-700"} dir="ltr">{formatPrice(Number(r.total_commission_cost))}</td>
                  <td className={td + " font-bold"} dir="ltr">{formatPrice(Number(r.net_commission))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}

        {card("أداء الشركات الوسيطة", "مرتّبة بالمبيعات ثم قيمتها. التحويل = مبيعات ÷ ليدات · الضائع = طلبات مرفوضة ومنتهية + حجوزات أُلغيت", brokers.length === 0 ? empty : (
          <table className="w-full min-w-[1200px] text-sm">
            <thead className="border-b bg-gray-50 text-xs text-gray-600">
              <tr>
                <th className={th}>#</th><th className={th}>الشركة</th><th className={th}>ليدات</th><th className={th}>مؤهّلة</th>
                <th className={th}>طلبات</th><th className={th}>وافق</th><th className={th}>رُفض</th><th className={th}>حجوزات</th>
                <th className={th}>مبيعات</th><th className={th}>التحويل</th><th className={th}>قيمة المبيعات</th>
                <th className={th}>العمولة</th><th className={th}>أيام للبيع</th><th className={th}>ليدات انتهت</th><th className={th}>ضائعة</th>
              </tr>
            </thead>
            <tbody>
              {brokers.map((r) => (
                <tr key={r.company_id} className="border-b last:border-0">
                  <td className={td + " font-bold text-gray-400"}>{r.rank}</td>
                  <td className={td}>
                    <Link href={`/dashboard/brokers/${r.company_id}`} className="font-semibold text-brand-700 hover:underline">{r.company_name}</Link>
                    {!r.is_active && <span className="ms-1 text-[10px] text-gray-400">موقوفة</span>}
                  </td>
                  <td className={td}>{n(r.leads)}</td><td className={td}>{n(r.qualified_leads)}</td>
                  <td className={td}>{n(r.requests)}</td><td className={td + " text-emerald-700"}>{n(r.approved)}</td>
                  <td className={td + " text-red-700"}>{n(r.rejected)}</td><td className={td}>{n(r.reservations)}</td>
                  <td className={td + " font-bold"}>{n(r.sales)}</td><td className={td}>{pct(r.conversion_rate)}</td>
                  <td className={td} dir="ltr">{formatPrice(Number(r.sales_value))}</td>
                  <td className={td} dir="ltr">{formatPrice(Number(r.commission))}</td>
                  <td className={td}>{n(r.avg_days_to_sale)}</td><td className={td}>{n(r.expired_leads)}</td>
                  <td className={td + " text-red-700"}>{n(r.lost_opportunities)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}

        {card("أداء مدراء العلاقات", "زمن المعالجة = من الرفع إلى أول فعلٍ للـRM · الاسترداد = ليدات شركاته العائدة لتلال ثم بيعت ÷ العائدة", rms.length === 0 ? empty : (
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="border-b bg-gray-50 text-xs text-gray-600">
              <tr>
                <th className={th}>مدير العلاقات</th><th className={th}>شركات</th><th className={th}>ليدات</th>
                <th className={th}>طلبات</th><th className={th}>راجعها</th><th className={th}>زمن المعالجة</th>
                <th className={th}>حجوزات</th><th className={th}>مبيعات</th><th className={th}>قيمتها</th>
                <th className={th}>عمولة وسطاء</th><th className={th}>عمولته</th><th className={th}>الاسترداد</th>
              </tr>
            </thead>
            <tbody>
              {rms.map((r) => (
                <tr key={r.rm_id} className="border-b last:border-0">
                  <td className={td + " font-semibold"}>{r.rm_name}</td>
                  <td className={td}>{n(r.companies)}</td><td className={td}>{n(r.leads)}</td>
                  <td className={td}>{n(r.requests)}</td><td className={td}>{n(r.reviewed)}</td>
                  <td className={td}>{hrs(r.avg_handling_hours)}</td><td className={td}>{n(r.reservations)}</td>
                  <td className={td + " font-bold"}>{n(r.sales)}</td>
                  <td className={td} dir="ltr">{formatPrice(Number(r.sales_value))}</td>
                  <td className={td} dir="ltr">{formatPrice(Number(r.broker_commission))}</td>
                  <td className={td} dir="ltr">{formatPrice(Number(r.rm_commission))}</td>
                  <td className={td}>{pct(r.recovery_rate)} <span className="text-[11px] text-gray-400">({r.recovered_leads}/{r.returned_leads})</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}

        {card("أداء الموافقات — أين الاختناق؟", "المعلّق الآن وأقدمه، زمن القرار من الرفع ومن توصية الـRM، ونسبة الرفض، وما تحوّل من حجز إلى بيع", sups.length === 0 ? empty : (
          <table className="w-full min-w-[1000px] text-sm">
            <thead className="border-b bg-gray-50 text-xs text-gray-600">
              <tr>
                <th className={th}>المشرف</th><th className={th}>المشروع</th><th className={th}>معلّق الآن</th>
                <th className={th}>أقدمه</th><th className={th}>قُرّر</th><th className={th}>وافق</th><th className={th}>رفض</th>
                <th className={th}>نسبة الرفض</th><th className={th}>زمن القرار</th><th className={th}>بعد التوصية</th>
                <th className={th}>حجز ← بيع</th>
              </tr>
            </thead>
            <tbody>
              {sups.map((r) => (
                <tr key={r.project_id} className="border-b last:border-0">
                  <td className={td + " font-semibold"}>{r.supervisor_name ?? "— (الإدارة)"}</td>
                  <td className={td}>{r.project_name}</td>
                  <td className={td + (r.pending_now ? " font-bold text-orange-700" : "")}>{n(r.pending_now)}</td>
                  <td className={td}>{hrs(r.oldest_pending_hours)}</td>
                  <td className={td}>{n(r.decided)}</td><td className={td + " text-emerald-700"}>{n(r.approved)}</td>
                  <td className={td + " text-red-700"}>{n(r.rejected)}</td><td className={td}>{pct(r.rejection_rate)}</td>
                  <td className={td}>{hrs(r.avg_approval_hours)}</td><td className={td}>{hrs(r.avg_wait_after_review_hours)}</td>
                  <td className={td}>{pct(r.reservation_conversion)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </section>
    </main>
  );
}
