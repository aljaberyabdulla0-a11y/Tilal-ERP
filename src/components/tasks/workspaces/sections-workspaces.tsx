import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import TaskSection from "./task-section";

type Section = { title: string; icon: string; types?: string[]; bucket?: string; tone?: string; empty: string; hint?: string };

// قسم بأنواعه داخل مساحة — استعلام واحد لكل قسم، ٦ صفوف
function Sections({ ws, sections, todayISO, myUserId }: {
  ws: string; sections: Section[]; todayISO: string; myUserId: string;
}) {
  return (
    <div className="grid gap-7 xl:grid-cols-2">
      {sections.map((s) => (
        <TaskSection
          key={s.title}
          title={s.title}
          icon={s.icon}
          tone={s.tone}
          todayISO={todayISO}
          myUserId={myUserId}
          limit={6}
          payload={{ workspace: ws, bucket: s.bucket ?? "open", ...(s.types ? { task_type: s.types } : {}), sort: "due" }}
          listParams={{ workspace: ws, bucket: s.bucket ?? "open", ...(s.types ? { type: s.types[0] } : {}), sort: "due" }}
          empty={s.empty}
          hint={s.hint}
        />
      ))}
    </div>
  );
}

// ============================================================
// الموارد البشرية — مهام الموظفين بمراحل حياتهم.
// التهيئة لها اليوم onboarding_tasks (151) بقواعده التلقائية: نعرض
// معلّقها هنا بجانب مهام HR (طبقة توافق) ولا نكرّرها.
// ============================================================
export async function HrWorkspace({ todayISO, myUserId }: { todayISO: string; myUserId: string }) {
  const supabase = await createClient();
  const { count: onbPending } = await supabase
    .from("onboarding_tasks").select("id", { count: "exact", head: true }).eq("status", "معلّقة");

  return (
    <div className="space-y-7">
      <TaskSection title="بانتظار إجراء" icon="pending_actions" tone="text-purple-700" todayISO={todayISO} myUserId={myUserId}
        payload={{ workspace: "hr", bucket: "waiting" }} listParams={{ workspace: "hr", bucket: "waiting" }}
        empty="لا شيء معلّق." hint="موافقات معلّقة، أو مهام تنتظر غيرها، أو موقوفة بسبب." />

      <section className="dash-card flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <h2 className="flex items-center gap-2 font-bold text-ink">
            <span aria-hidden="true" className="material-symbols-outlined">person_add</span>قوائم التهيئة (الموظفون الجدد)
          </h2>
          <p className="text-sm text-ink-muted">
            {onbPending == null ? "—" : `${onbPending} بند تهيئة معلّق`} — تُدار من لوحة التهيئة وتُنجَز بنودها الآلية وحدها.
          </p>
        </div>
        <Link href="/dashboard/hr/onboarding" className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium hover:border-brand-500">لوحة التهيئة</Link>
      </section>

      <Sections ws="hr" todayISO={todayISO} myUserId={myUserId} sections={[
        { title: "مهام الموظفين", icon: "badge", empty: "لا مهام HR مفتوحة.", types: undefined },
        { title: "التهيئة", icon: "person_add", types: ["onboarding", "documents", "contract"], empty: "لا مهام تهيئة." },
        { title: "إنهاء الخدمة", icon: "person_remove", types: ["offboarding"], empty: "لا مهام إنهاء خدمة." },
        { title: "الطلبات", icon: "assignment_ind", types: ["hr_request"], empty: "لا طلبات موظفين مفتوحة." },
        { title: "التقييمات والمراجعات", icon: "insights", types: ["evaluation", "performance_review"], empty: "لا تقييمات مفتوحة." },
        { title: "التدريب ومتابعة الدوام", icon: "school", types: ["training", "attendance_followup"], empty: "لا تدريب ولا متابعات دوام." },
      ]} />
    </div>
  );
}

// ============================================================
// المحاسبة — حسب طبيعة العمل المالي.
// ============================================================
export function AccountingWorkspace({ todayISO, myUserId }: { todayISO: string; myUserId: string }) {
  return (
    <div className="space-y-7">
      <TaskSection title="متأخرة" icon="warning" tone="text-red-700" todayISO={todayISO} myUserId={myUserId}
        payload={{ workspace: "accounting", bucket: "late" }} listParams={{ workspace: "accounting", bucket: "late" }}
        empty="لا متأخرات مالية." />
      <Sections ws="accounting" todayISO={todayISO} myUserId={myUserId} sections={[
        { title: "تحصيل ومتابعة دفعات", icon: "request_quote", types: ["collection", "payment_followup"], empty: "لا تحصيل مفتوح." },
        { title: "مراجعة فواتير", icon: "receipt_long", types: ["invoice_review"], empty: "لا فواتير للمراجعة." },
        { title: "اعتماد مصروفات وطلبات دفع", icon: "price_check", types: ["expense_approval", "payment_request"], empty: "لا اعتمادات معلّقة." },
        { title: "تسويات بنكية", icon: "account_balance", types: ["bank_reconciliation"], empty: "لا تسويات." },
        { title: "تقارير وإقفال شهري", icon: "lock_clock", types: ["financial_report", "monthly_closing"], empty: "لا تقارير أو إقفال مفتوح." },
        { title: "بانتظار الموافقة", icon: "verified", bucket: "pending_approval", tone: "text-purple-700", empty: "لا شيء بانتظار الموافقة." },
      ]} />
    </div>
  );
}

// ============================================================
// مساحة عامة — لأي قسم بلا تخطيط خاص (العمليات، الإدارية، الإدارة
// العليا، وأي قسم يُضاف لاحقاً بلا كود).
// ============================================================
export function GenericWorkspace({ deptId, todayISO, myUserId }: { deptId: string; todayISO: string; myUserId: string }) {
  const base = { department_id: deptId };
  const lp = { dept: deptId };
  return (
    <div className="space-y-7">
      <TaskSection title="متأخرة" icon="warning" tone="text-red-700" todayISO={todayISO} myUserId={myUserId}
        payload={{ ...base, bucket: "late" }} listParams={{ ...lp, bucket: "late" }} empty="لا متأخرات." />
      <TaskSection title="اليوم" icon="today" todayISO={todayISO} myUserId={myUserId}
        payload={{ ...base, bucket: "today" }} listParams={{ ...lp, bucket: "today" }} empty="لا مهام اليوم." />
      <TaskSection title="قادمة" icon="upcoming" todayISO={todayISO} myUserId={myUserId}
        payload={{ ...base, bucket: "upcoming", sort: "due" }} listParams={{ ...lp, bucket: "upcoming", sort: "due" }} empty="لا مهام قادمة." />
      <TaskSection title="بانتظار" icon="pause_circle" tone="text-amber-800" todayISO={todayISO} myUserId={myUserId}
        payload={{ ...base, bucket: "waiting" }} listParams={{ ...lp, bucket: "waiting" }} empty="لا مهام بانتظار." />
    </div>
  );
}
