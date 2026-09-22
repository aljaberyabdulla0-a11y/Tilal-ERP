import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, canWriteCrm } from "@/lib/auth";
import {
  Client,
  ClientActivity,
  Reservation,
  isSystemActivity,
  sinceColor,
  sinceLabel,
  toIntlPhone,
  toLocalPhone,
} from "@/lib/types";
import DeleteClientButton from "../delete-client-button";
import AltContact from "./alt-contact";
import LogActivity from "./log-activity";
import ActivityTimeline from "@/components/activity-timeline";
import StageSelect from "@/components/stage-select";
import ReserveUnit from "./reserve-unit";
import CrmInsights from "@/components/crm-insights";
import CrmHistory from "@/components/crm-history";
import { getPipelineConfig } from "@/lib/crm-config";
import QualificationPanel from "./qualification-panel";
import NewOpportunity from "./new-opportunity";
import InterestsPanel from "./interests-panel";
import {
  getQualification,
  getProjectsLite,
  getStages,
  getClientInterests,
  getOwnerName,
  getClientOpportunities,
  TEMPERATURE_STYLE,
} from "@/lib/crm";

// صفحة تفاصيل عميل واحد — تعرض كل المعلومات المسجّلة
export default async function ClientDetailsPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = await createClient();
  const [{ data }, { data: acts }, { data: resv }, admin] = await Promise.all([
    supabase.from("clients").select("*").eq("id", params.id).single(),
    supabase
      .from("client_activities")
      .select("*")
      .eq("client_id", params.id)
      .order("occurred_at", { ascending: false })
      .limit(100),
    supabase
      .from("reservations")
      .select("*, units(project, unit_code)")
      .eq("client_id", params.id)
      .order("created_at", { ascending: false }),
    isAdmin(),
  ]);
  // من لا يكتب لا يُعرض له زرّ يكتب — RLS تمنعه صمتاً فيظنّ أنه حفظ
  const canWrite = await canWriteCrm();

  if (!data) notFound();
  const c = data as Client;

  // طبقة الـCRM الجديدة (070–080): تُقرأ بعد التأكّد من وجود العميل،
  // وكلها تُرجع فراغاً بلا خطأ إن لم تُشغَّل الهجرات بعد.
  const [qualification, projects, stages, interests, ownerName, cfg, opps] = await Promise.all([
    getQualification(c.id),
    getProjectsLite(),
    getStages(),
    getClientInterests(c.id),
    getOwnerName(c.owner_id),
    getPipelineConfig(),
    getClientOpportunities(c.id),
  ]);
  const openOpps = opps
    .filter((o) => o.stage_type === "open")
    .map((o) => ({ id: o.id, title: `${o.project_name ?? "بلا مشروع"} · ${o.stage_name}` }));
  const activities = (acts ?? []) as ClientActivity[];
  const reservations = (resv ?? []) as Reservation[];

  // عدّاد التواصل الفعلي (بدون تغييرات المرحلة التلقائية)
  const realContacts = activities.filter(
    (a) => !isSystemActivity(a.activity_type)
  ).length;

  // صفّان للهاتف: المحلي والدولي معاً للسهولة
  const phoneLocal = c.phone ? toLocalPhone(c.phone) : null;
  const phoneIntl = c.phone ? toIntlPhone(c.phone) : null;

  // مكوّن صغير لعرض حقل (عنوان + قيمة)
  const Field = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="border-b border-gray-100 py-3">
      <dt className="text-sm text-gray-500">{label}</dt>
      <dd className="mt-0.5 font-medium text-gray-800">{value || "—"}</dd>
    </div>
  );

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/clients"
            className="text-sm text-gray-500 hover:text-brand-700"
          >
            ← العملاء
          </Link>
          <h1 className="text-xl font-bold text-brand-700">{c.name}</h1>
        </div>
        {/* التعديل والحذف للمدراء فقط */}
        {admin && (
          <div className="flex items-center gap-3">
            <Link
              href={`/dashboard/clients/${c.id}/edit`}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
            >
              تعديل
            </Link>
            <DeleteClientButton id={c.id} name={c.name} />
          </div>
        )}
      </header>

      <section className="grid grid-cols-1 gap-6 p-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* ===== العمود الأول: بيانات العميل ===== */}
        <div className="space-y-6">
        {/* شريط حالة سريع */}
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border bg-white p-4 shadow-sm">
          {canWrite ? (
            <StageSelect clientId={c.id} stage={c.stage} size="md" stages={cfg.stages} />
          ) : (
            <span className={`rounded-full px-3 py-1.5 text-sm font-medium ${cfg.colors[c.stage ?? "ليد"] ?? "bg-gray-100 text-gray-700"}`}>
              {c.stage ?? "ليد"}
            </span>
          )}
          <span className="text-sm text-gray-500">
            آخر تواصل:{" "}
            <b className={sinceColor(c.last_contact_at, cfg.silence)}>
              {sinceLabel(c.last_contact_at)}
            </b>
          </span>
          <span className="text-sm text-gray-500">
            مرات التواصل: <b className="text-gray-800">{realContacts}</b>
          </span>
          {c.follow_up_date && (
            <span className="rounded-full bg-amber-50 px-3 py-1 text-sm text-amber-800">
              متابعة قادمة: <b dir="ltr">{c.follow_up_date}</b>
            </span>
          )}
          {/* رأس الـCRM: المالك بالمفتاح، والحرارة، والدرجة — إن وُجدت */}
          {(ownerName ?? c.sales_employee) && (
            <span className="text-sm text-gray-500">
              المالك: <b className="text-gray-800">{ownerName ?? c.sales_employee}</b>
            </span>
          )}
          {c.lead_temperature && (
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${TEMPERATURE_STYLE[c.lead_temperature] ?? "bg-gray-100 text-gray-500"}`}>
              {c.lead_temperature}
              {c.lead_score !== null && c.lead_score !== undefined && ` · ${c.lead_score}`}
            </span>
          )}
          {c.phone && (
            <a
              href={`tel:${toIntlPhone(c.phone)}`}
              className="ms-auto flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
            >
              <span className="material-symbols-outlined text-[18px]">call</span>
              اتصال
            </a>
          )}
          {c.phone && (
            <a
              href={`https://wa.me/${toIntlPhone(c.phone).replace("+", "")}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-green-700"
            >
              <span className="material-symbols-outlined text-[18px]">chat</span>
              واتساب
            </a>
          )}
        </div>

        {/* رؤى الـCRM: الإجراء التالي، الدرجة بأسبابها، الفرص، الوحدات
            المطابقة. تُعرض فوق الحجز لأن القرار يسبق الفعل. */}
        <CrmInsights clientId={c.id} />

        {/* التأهيل — ما يفرّق الليد عن الفرصة، وأثره يظهر في الدرجة فوراً */}
        {canWrite && stages.length > 0 && (
          <QualificationPanel client={c} qualification={qualification} projects={projects} />
        )}

        {/* فتح فرصة من الملف: الصفقة كيانٌ مستقل عن الشخص (sql/072) */}
        {canWrite && <NewOpportunity
          clientId={c.id}
          projects={projects}
          stages={stages}
          defaultProjectId={c.preferred_project_id ?? c.project_id}
          defaultPaymentMethod={c.payment_method}
        />}

        {canWrite && stages.length > 0 && (
          <InterestsPanel clientId={c.id} interests={interests} projects={projects} />
        )}

        {/* الحجز من ملفّ العميل: الموظف جالس معه فيحجز من مكانه،
            بدل أن يفتح المخزون ويبحث عن الوحدة ثم يعود لاختياره */}
        {canWrite && (
          <ReserveUnit
            clientId={c.id}
            clientName={c.name}
            existing={reservations}
          />
        )}

        <div className="rounded-2xl bg-white p-8 shadow-sm">
          <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
            <Field label="الاسم" value={c.name} />
            <Field
              label="رقم الهاتف"
              value={
                c.phone ? (
                  <span dir="ltr" className="inline-block text-start">
                    {phoneLocal}
                    <span className="block text-sm font-normal text-gray-400">
                      {phoneIntl}
                    </span>
                  </span>
                ) : null
              }
            />
            <Field label="المحافظة" value={c.governorate} />
            <Field label="المنطقة" value={c.area} />
            <Field label="الغرض من الشراء" value={c.purchase_purpose} />
            <Field label="طريقة الدفع" value={c.payment_method} />
            <Field label="مصدر العميل" value={c.source} />
            <Field label="موظف المبيعات" value={c.sales_employee} />
            <Field
              label="التاريخ"
              value={
                c.entry_date ? (
                  <span dir="ltr" className="inline-block text-start">
                    {c.entry_date}
                  </span>
                ) : null
              }
            />
          </dl>

          {/* من ينوب عن العميل — يضيفه الموظف من هنا بلا إذن مدير.
              الرقم يصله وهو جالس مع عميله، فيُكتب في حينه لا بعده. */}
          {canWrite && <AltContact
            clientId={c.id}
            name={c.alt_contact_name}
            phone={c.alt_contact_phone}
            relation={c.alt_contact_relation}
          />}

          {/* الملاحظات في مساحة عريضة */}
          <div className="mt-4">
            <dt className="text-sm text-gray-500">ملاحظات</dt>
            <dd className="mt-1 min-h-[80px] whitespace-pre-wrap rounded-lg bg-gray-50 p-4 text-gray-800">
              {c.notes || "لا توجد ملاحظات."}
            </dd>
          </div>
        </div>
        </div>

        {/* ===== العمود الثاني: سجلّ التواصل ===== */}
        <div className="space-y-4">
          {canWrite && (
            <LogActivity clientId={c.id} stage={c.stage} opportunities={openOpps} />
          )}

          <div>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-gray-800">سجلّ التواصل</h3>
              <span className="text-xs text-gray-400">
                {activities.length} حدث
              </span>
            </div>
            <ActivityTimeline
              activities={activities}
              canManage={admin}
              clientStage={c.stage}
            />
          </div>

          {/* الملكية والمراحل — سجلٌّ يكتبه المحفّز لا الواجهة */}
          <CrmHistory clientId={c.id} />
        </div>
      </section>
    </main>
  );
}
