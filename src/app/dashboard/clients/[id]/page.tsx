import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, canWriteCrm, getUserRole, canEditClientCard } from "@/lib/auth";
import { redirect } from "next/navigation";
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
import ContactCorrection from "./contact-correction";
import LogActivity from "./log-activity";
import ActivityTimeline from "@/components/activity-timeline";
import StageSelect from "@/components/stage-select";
import ReserveUnit from "./reserve-unit";
import CrmInsights from "@/components/crm-insights";
import CrmHistory from "@/components/crm-history";
import ClientTouchpoints from "@/components/marketing/client-touchpoints";
import SalesHistory from "@/components/lost-sale/sales-history";
import { getPipelineConfig } from "@/lib/crm-config";
import QualificationPanel from "./qualification-panel";
import JourneyPanel from "@/components/journey/journey-panel";
import InterestsPanel from "./interests-panel";
import DocumentsPanel from "./documents-panel";
import ClientTabs, { type ClientTab } from "./client-tabs";
import {
  getQualification,
  getProjectsLite,
  getStages,
  getClientInterests,
  getOwnerName,
  getClientOpportunities,
  getClientDocuments,
  getClientMatchCandidates,
  TEMPERATURE_STYLE,
} from "@/lib/crm";
import DuplicateBanner from "./duplicate-banner";
import ClientProjectPicker from "./client-project-picker";
import { getTeamMembers } from "@/lib/projects";
import RelatedTasks from "@/components/tasks/related-tasks";
import type { Stage, ProjectLite, ClientInterest, ClientDocument } from "@/lib/crm";

// صفحة تفاصيل عميل واحد — تعرض كل المعلومات المسجّلة
export default async function ClientDetailsPage({
  params,
  searchParams,
}: {
  params: { id: string };
  // ?tab= يفتح تبويباً بعينه — تستعمله روابط «الإجراء التالي» (080):
  // «اعرض عليه وحدات» تفتح تبويب العقار لا الصفحة من أولها.
  // ?journey= مسارٌ بعينه، و?analyse= يفتح استمارة الخسارة (مهامّ 175)
  searchParams: { tab?: string; journey?: string; analyse?: string };
}) {
  // التسويق لا يفتح ملفّ شخص (092)
  if ((await getUserRole()) === "marketing") redirect("/dashboard/crm/overview");

  const supabase = await createClient();
  const [{ data }, { data: acts }, { data: resv }, admin] = await Promise.all([
    supabase
      .from("clients")
      .select("*, lead_project_id, broker_companies!clients_broker_company_id_fkey(name)")
      .eq("id", params.id)
      .single(),
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
  const canEditCard = await canEditClientCard();

  if (!data) {
    // بطاقةٌ دُمجت (104): رابطها القديم — من إشعار أو مهمة أو مفضّلة —
    // يقود إلى الباقية بدل «غير موجود»
    const { data: target } = await supabase.rpc("client_merged_into", { p_client_id: params.id });
    if (typeof target === "string") redirect(`/dashboard/clients/${target}`);
    notFound();
  }
  const c = data as Client;

  // طبقة الـCRM الجديدة (070–080): تُقرأ بعد التأكّد من وجود العميل،
  // وكلها تُرجع فراغاً بلا خطأ إن لم تُشغَّل الهجرات بعد.
  const [qualification, projects, stages, interests, ownerName, cfg, opps, matches] = await Promise.all([
    getQualification(c.id),
    getProjectsLite(),
    getStages(),
    getClientInterests(c.id),
    getOwnerName(c.owner_id),
    getPipelineConfig(),
    getClientOpportunities(c.id),
    canWrite ? getClientMatchCandidates(c.id) : Promise.resolve([]),
  ]);
  const documents = await getClientDocuments(c.id);
  const openOpps = opps
    .filter((o) => o.stage_type === "open")
    .map((o) => ({ id: o.id, title: `${o.project_name ?? "بلا مشروع"} · ${o.stage_name}` }));
  const role = await getUserRole();
  const isManager = role === "admin" || role === "followup_manager" || role === "supervisor";

  // مشروع العميل (217): يُختار من مشاريع مالكه (216) — وإن لم يكن المالك
  // في نطاق السائل فمن المشاريع الظاهرة له. ليد الوسيط مشروعه من بوّابته.
  const members = await getTeamMembers();
  const owner = members.find((m) => m.id === c.owner_id);
  const ownerProjectIds = owner
    ? owner.project_ids?.length ? owner.project_ids : owner.project_id ? [owner.project_id] : []
    : [];
  const projectChoiceIds = ownerProjectIds.length > 0 ? ownerProjectIds : projects.map((p) => p.id);
  if (c.lead_project_id && !projectChoiceIds.includes(c.lead_project_id)) projectChoiceIds.push(c.lead_project_id);
  const projectChoices = projectChoiceIds
    .map((id) => projects.find((p) => p.id === id))
    .filter((p): p is ProjectLite => Boolean(p));
  const leadProjectName = projects.find((p) => p.id === c.lead_project_id)?.name ?? null;
  const canPickProject = canWrite && !c.broker_company_id && role !== "broker" && projectChoices.length > 1;
  const activities = (acts ?? []) as ClientActivity[];
  const reservations = (resv ?? []) as Reservation[];

  // عدّاد التواصل الفعلي (بدون تغييرات المرحلة التلقائية)
  const realContacts = activities.filter(
    (a) => !isSystemActivity(a.activity_type)
  ).length;

  const tabs = buildTabs({
    c, canWrite, admin, stages, projects, interests, documents,
    qualification, activities, openOpps, reservations,
    journeys: opps, isManager,
    journeyParam: searchParams.journey ?? null,
    analyse: searchParams.analyse ?? null,
  });
  // روابط قديمة: «الصفقات» و«تحليل الخسارة» صارا تبويب المسار
  const initialTab = searchParams.tab === "deals" || searchParams.tab === "lost" ? "journey" : searchParams.tab;

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
        <div className="flex items-center gap-3">
          {/* الدمج لكل من يكتب؛ الصلاحية الفعلية (ملكية البطاقتين) تقرّرها القاعدة */}
          {canWrite && (
            <Link
              href={`/dashboard/clients/${c.id}/merge`}
              className="flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 transition hover:border-brand-500 hover:text-brand-700"
            >
              <span className="material-symbols-outlined text-[18px]">merge</span>
              دمج مع بطاقة أخرى
            </Link>
          )}
          {/* موظف المبيعات: تصحيح الاسم والرقم مرة واحدة (220) — الحدّ في القاعدة */}
          {canWrite && !canEditCard && role !== "broker" && (
            <ContactCorrection
              clientId={c.id}
              name={c.name}
              phone={c.phone}
              correctedAt={c.contact_corrected_at ?? null}
            />
          )}
          {/* التعديل للمدير ومدير التسويق (212) ومشرف المبيعات على فريقه، والحذف للمدير وحده */}
          {canEditCard && (
            <Link
              href={`/dashboard/clients/${c.id}/edit`}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
            >
              تعديل
            </Link>
          )}
          {admin && <DeleteClientButton id={c.id} name={c.name} />}
        </div>
      </header>

      {canWrite && <DuplicateBanner clientId={c.id} matches={matches} />}

      {/* ============================================================
          شريط الحالة يبقى فوق التبويبات دائماً (§34).

          ما فيه هو ما يُسأل عنه في كل زيارة: المرحلة، وآخر تواصل،
          والمالك، والحرارة، وزرّا الاتصال والواتساب. وإخفاؤه خلف
          تبويب يعني نقرةً قبل كل مكالمة.
          ============================================================ */}
      <div className="px-6 pt-6">
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border bg-white p-4 shadow-sm">
          {canWrite ? (
            <StageSelect clientId={c.id} stage={c.stage} size="md" stages={cfg.stages} isAdmin={admin} />
          ) : (
            <span className={`rounded-full px-3 py-1.5 text-sm font-medium ${cfg.colors[c.stage ?? "ليد"] ?? "bg-gray-100 text-gray-700"}`}>
              {c.stage ?? "ليد"}
            </span>
          )}
          {c.stage_entered_at && (
            <span className="text-sm text-gray-500" title="منذ دخول المرحلة الحالية">
              في المرحلة منذ <b className="text-gray-800">{Math.max(0, Math.floor((Date.now() - new Date(c.stage_entered_at).getTime()) / 86400000))}</b> يوم
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
          {/* ليد الوسيط: الشركة صاحبته، والـRM متابعه في تلال (188) */}
          {c.broker_company_id ? (
            <span className="text-sm text-gray-500">
              المالك: <b className="text-gray-800">{c.broker_companies?.name ?? "شركة وسيطة"}</b>
              <span className="ms-1 rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">وسيط</span>
              {" · "}المتابعة (RM): <b className="text-gray-800">{ownerName ?? c.sales_employee ?? "—"}</b>
            </span>
          ) : (
            (ownerName ?? c.sales_employee) && (
              <span className="text-sm text-gray-500">
                المالك: <b className="text-gray-800">{ownerName ?? c.sales_employee}</b>
              </span>
            )
          )}
          {canPickProject ? (
            <ClientProjectPicker clientId={c.id} value={c.lead_project_id ?? null} options={projectChoices} />
          ) : (
            leadProjectName && (
              <span className="text-sm text-gray-500">
                المشروع: <b className="text-gray-800">{leadProjectName}</b>
              </span>
            )
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
      </div>

      <ClientTabs initial={initialTab} tabs={tabs} />
    </main>
  );
}

// مكوّن صغير لعرض حقل (عنوان + قيمة)
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="border-b border-gray-100 py-3">
      <dt className="text-sm text-gray-500">{label}</dt>
      <dd className="mt-0.5 font-medium text-gray-800">{value || "—"}</dd>
    </div>
  );
}

type TabArgs = {
  c: Client;
  canWrite: boolean;
  admin: boolean;
  stages: Stage[];
  projects: ProjectLite[];
  interests: ClientInterest[];
  documents: ClientDocument[];
  qualification: string | null;
  activities: ClientActivity[];
  openOpps: { id: string; title: string }[];
  reservations: Reservation[];
  journeys: { id: string; project_name: string | null; stage_name: string; stage_type: string; created_at: string }[];
  isManager: boolean;
  journeyParam: string | null;
  analyse: string | null;
};

// ============================================================
// بناء التبويبات — دالة مستقلة كي تبقى الصفحة أعلاه مقروءة.
//
// الترتيب هو ترتيب الاستعمال لا ترتيب البناء: «نظرة» أولاً لأنها
// ما يُقرأ في كل مرة، ثم «التواصل» لأنه ما يُفعل في كل مرة، ثم
// الباقي بحسب ندرته.
// ============================================================
function buildTabs(a: TabArgs): ClientTab[] {
  const { c, canWrite, admin, stages, projects, interests, documents,
          qualification, activities, openOpps, reservations, journeys, isManager,
          journeyParam, analyse } = a;

  // صفّان للهاتف: المحلي والدولي معاً للسهولة
  const phoneLocal = c.phone ? toLocalPhone(c.phone) : null;
  const phoneIntl = c.phone ? toIntlPhone(c.phone) : null;

  return [
    {
      key: "overview",
      label: "نظرة",
      icon: "dashboard",
      content: (
        <div className="space-y-6">
          {/* رؤى الـCRM: الإجراء التالي، الدرجة بأسبابها، الفرص،
              الوحدات المطابقة. القرار يسبق الفعل. */}
          <CrmInsights clientId={c.id} />

        </div>
      ),
    },

    // ——— التواصل: ما يُفعل في كل زيارة ———
    {
      key: "activity",
      label: "التواصل",
      icon: "call",
      badge: activities.length,
      content: (
        <div className="mx-auto max-w-3xl space-y-4">
          {canWrite && (
            <LogActivity clientId={c.id} stage={c.stage} opportunities={openOpps} />
          )}
          <RelatedTasks entityType="client" entityId={c.id} variant="sales" />
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-gray-800">سجلّ التواصل</h3>
              <span className="text-xs text-gray-400">{activities.length} حدث</span>
            </div>
            <ActivityTimeline
              activities={activities}
              canManage={admin}
              clientStage={c.stage}
            />
          </div>
        </div>
      ),
    },

    // ——— المسار: رحلة البيع كاملة من البطاقة (201) ———
    {
      key: "journey",
      label: "المسار",
      icon: "route",
      badge: journeys.length > 1 ? journeys.length : undefined,
      content: (
        <JourneyPanel
          clientId={c.id}
          journeys={journeys}
          currentJourneyId={c.current_journey_id ?? null}
          selectedJourneyId={journeyParam}
          analyse={analyse}
          canWrite={canWrite}
          isManager={isManager}
          isAdmin={admin}
          defaultProjectId={c.preferred_project_id ?? c.project_id}
        />
      ),
    },

    // ——— التأهيل والاهتمامات: ما يفرّق الليد عن المشتري، منفصلٌ عن المرحلة ———
    {
      key: "qualification",
      label: "التأهيل",
      icon: "fact_check",
      content: (
        <div className="mx-auto max-w-3xl space-y-6">
          {canWrite && stages.length > 0 && (
            <QualificationPanel client={c} qualification={qualification} projects={projects} />
          )}
          {canWrite && stages.length > 0 && (
            <InterestsPanel clientId={c.id} interests={interests} projects={projects} />
          )}
          {!canWrite && qualification && (
            <p className="rounded-2xl bg-white p-4 text-sm text-gray-700 shadow-sm">{qualification}</p>
          )}
        </div>
      ),
    },

    // ——— العقار والحجوزات: المعاملة العقارية مستقلة عن مرحلة المسار ———
    {
      key: "property",
      label: "الحجوزات",
      icon: "apartment",
      badge: reservations.length || undefined,
      content: (
        <div className="mx-auto max-w-3xl space-y-6">
          {/* الحجز من ملفّ العميل: الموظف جالس معه فيحجز من مكانه،
              والحجز ينقل المسار إلى «حجز» تلقائياً (201) */}
          {canWrite && (
            <ReserveUnit clientId={c.id} clientName={c.name} existing={reservations} />
          )}
        </div>
      ),
    },

    // ——— المستندات ———
    {
      key: "documents",
      label: "المستندات",
      icon: "folder",
      badge: documents.length,
      content: (
        <div className="mx-auto max-w-3xl">
          <DocumentsPanel clientId={c.id} documents={documents} canWrite={canWrite} />
        </div>
      ),
    },

    // ——— البيانات ———
    {
      key: "data",
      label: "البيانات",
      icon: "badge",
      content: (
        <div className="mx-auto max-w-3xl rounded-2xl bg-white p-8 shadow-sm">
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
            {c.broker_company_id && (
              <Field label="الشركة الوسيطة" value={c.broker_companies?.name ?? "شركة وسيطة"} />
            )}
            <Field label={c.broker_company_id ? "مسؤول المتابعة (RM)" : "موظف المبيعات"} value={c.sales_employee} />
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
      ),
    },

    // ——— التاريخ: الملكية والمراحل، يكتبه المحفّز لا الواجهة ———
    {
      key: "history",
      label: "التاريخ",
      icon: "history",
      content: (
        <div className="mx-auto max-w-3xl">
          <CrmHistory clientId={c.id} />
          <ClientTouchpoints clientId={c.id} canWrite={canWrite} />
        </div>
      ),
    },
  ];
}
