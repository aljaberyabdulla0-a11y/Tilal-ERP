import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, getCurrentUser, canWriteCrm, getUserRole } from "@/lib/auth";
import {
  Client,
  PAYMENT_METHOD_COLORS,
  sinceColor,
  sinceLabel,
} from "@/lib/types";
import DeleteClientButton from "./delete-client-button";
import CrmTabs from "../crm/crm-tabs";
import StageSelect from "@/components/stage-select";
import { getPipelineConfig } from "@/lib/crm-config";
import { TEMPERATURE_STYLE, getSavedViews, getEmployeesLite } from "@/lib/crm";
import SavedViews from "@/components/saved-views";
import ClientsTable from "./clients-table";

// المُرشِّحات التي تصل من روابط «نظرة» و«الجودة» (§45): الرقم يُنقر
// فيفتح قائمته. كلها في العنوان فالرابط قابل للمشاركة.
const QUALITY_FILTERS: Record<string, { label: string; apply: (q: any) => any }> = {
  no_phone: { label: "بلا رقم هاتف", apply: (q) => q.or("phone.is.null,phone.eq.") },
  no_source: { label: "بلا مصدر", apply: (q) => q.or("source.is.null,source.eq.") },
  no_budget: { label: "بلا ميزانية", apply: (q) => q.is("budget_min", null).is("budget_max", null) },
  no_owner: { label: "بلا مالك", apply: (q) => q.is("owner_id", null) },
};

// صفحة قائمة العملاء (CRM)
// تقرأ العملاء من قاعدة البيانات وتعرضهم في جدول، مع بحث بالاسم أو الجوال
export default async function ClientsPage({
  searchParams,
}: {
  searchParams: { q?: string; filter?: string; temperature?: string; stage?: string };
}) {
  const supabase = await createClient();
  const cfg = await getPipelineConfig();

  // نص البحث — ننظّفه من الرموز التي قد تكسر الاستعلام
  const q = (searchParams.q ?? "").trim().replace(/[%,()]/g, "");
  const filter = searchParams.filter && QUALITY_FILTERS[searchParams.filter] ? searchParams.filter : null;
  const temperature = searchParams.temperature && TEMPERATURE_STYLE[searchParams.temperature] ? searchParams.temperature : null;
  const stage = searchParams.stage && cfg.colors[searchParams.stage] ? searchParams.stage : null;

  let query = supabase
    .from("clients")
    .select("*")
    .order("created_at", { ascending: false });

  if (filter) query = QUALITY_FILTERS[filter].apply(query);
  if (temperature) query = query.eq("lead_temperature", temperature);
  if (stage) query = query.eq("stage", stage);
  const activeFilters = [
    filter ? QUALITY_FILTERS[filter].label : null,
    temperature ? `حرارة: ${temperature}` : null,
    stage ? `مرحلة: ${stage}` : null,
  ].filter(Boolean) as string[];

  // البحث يشمل جهة الاتصال البديلة أيضاً: حين يتصل القريب أو مدير
  // الأعمال من رقمه هو، يجب أن يصل الموظف لملف العميل برقم المتصل.
  if (q) {
    query = query.or(
      `name.ilike.%${q}%,phone.ilike.%${q}%,` +
        `alt_contact_name.ilike.%${q}%,alt_contact_phone.ilike.%${q}%`
    );
  }

  const { data, error } = await query;
  const clients = (data ?? []) as Client[];

  // هل المستخدم الحالي مدير؟ (لإظهار أزرار التعديل والحذف)
  // ⚠️ canWrite ليس حماية — الحماية في RLS. لكن RLS تمنع صمتاً
  //    (صفر صفوف بلا خطأ)، فزرٌّ ظاهر لمن لا يملك يقول «حُفظ» كاذباً.
  const [admin, user, views, canWrite, role, employees] = await Promise.all([
    isAdmin(),
    getCurrentUser(),
    getSavedViews("clients"),
    canWriteCrm(),
    getUserRole(),
    getEmployeesLite(),
  ]);
  // الإسناد فعلٌ محروس في القاعدة (assign_client): المدير ومدير
  // المتابعة والمشرف في نطاقه. غيرهم يرى بقيّة الإجراءات بلا هذا.
  const canAssign = role === "admin" || role === "followup_manager" || role === "supervisor";
  // المُرشِّحات الفعّالة كما هي في العنوان — هي ما يُحفظ باسم
  const currentFilters: Record<string, string> = {};
  if (q) currentFilters.q = q;
  if (filter) currentFilters.filter = filter;
  if (temperature) currentFilters.temperature = temperature;
  if (stage) currentFilters.stage = stage;

  return (
    <main className="min-h-screen bg-gray-50">
      {/* الشريط العلوي */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="text-sm text-gray-500 hover:text-brand-700"
          >
            ← لوحة التحكم
          </Link>
          <h1 className="text-xl font-bold text-brand-700">CRM</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* تبديل العرض: قائمة / لوحة */}
          <div className="flex rounded-lg border p-0.5 text-sm">
            <span className="rounded-md bg-brand-600 px-3 py-1.5 font-semibold text-white">
              قائمة
            </span>
            <Link
              href="/dashboard/clients/board"
              className="rounded-md px-3 py-1.5 text-gray-500 hover:bg-gray-100"
            >
              لوحة المبيعات
            </Link>
          </div>
          {/* الاستيراد والتصدير للإدارة فقط */}
          {admin && (
            <>
              <Link
                href="/dashboard/clients/import"
                className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
              >
                <span className="material-symbols-outlined text-[18px]">upload_file</span>
                استيراد اكسل
              </Link>
              <a
                href="/api/clients/export"
                className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
              >
                <span className="material-symbols-outlined text-[18px]">download</span>
                تصدير اكسل
              </a>
            </>
          )}
          {canWrite && (
            <Link
              href="/dashboard/clients/new"
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
            >
              + عميل جديد
            </Link>
          )}
        </div>
      </header>

      <CrmTabs active="clients" />

      <section className="p-6">
        {/* توضيح للموظف: القائمة تعرض عملاءه فقط */}
        {!admin && (
          <div className="mb-4 flex items-start gap-2 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-800">
            <span className="material-symbols-outlined text-[18px]">lock</span>
            <span>
              تشوف هنا العملاء الذين أضفتهم أو المُسندين لك فقط. لعرض عميل غير ظاهر
              لك، راجع الإدارة.
            </span>
          </div>
        )}

        {/* صندوق البحث */}
        <form className="mb-4 flex gap-2">
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="ابحث بالاسم أو رقم الهاتف..."
            className="w-full max-w-sm rounded-lg border border-gray-300 px-4 py-2 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          <button
            type="submit"
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 transition hover:bg-gray-100"
          >
            بحث
          </button>
          {(q || activeFilters.length > 0) && (
            <Link
              href="/dashboard/clients"
              className="rounded-lg px-3 py-2 text-sm text-gray-500 hover:text-gray-700"
            >
              مسح
            </Link>
          )}
        </form>

        {/* العروض المحفوظة — المُرشِّح باسمٍ يُنقر (§46) */}
        <SavedViews
          entity="clients"
          basePath="/dashboard/clients"
          current={currentFilters}
          views={views}
          userId={user?.id ?? null}
        />

        {/* مُرشِّح وصل من رابط: يُعرض باسمه كي يعرف القارئ لماذا القائمة أقصر */}
        {activeFilters.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-gray-500">مُرشَّح:</span>
            {activeFilters.map((f) => (
              <span key={f} className="rounded-full bg-brand-50 px-3 py-1 text-brand-800">{f}</span>
            ))}
          </div>
        )}

        {/* رسالة خطأ إن فشل جلب البيانات (غالباً: الجدول غير محدّث بعد) */}
        {error && (
          <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
            تعذّر جلب العملاء: {error.message}
            <br />
            تأكّد من تشغيل ملف SQL الأحدث في Supabase لتحديث جدول العملاء.
          </div>
        )}

        {/* لا يوجد عملاء */}
        {!error && clients.length === 0 && (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
            {q || activeFilters.length > 0 ? "لا يوجد عميل مطابق." : "لا يوجد عملاء بعد — أضف أول عميل."}
          </div>
        )}

        {/* الجدول — مكوّن عميل لأجل الاختيار الجماعي (§47) */}
        {!error && clients.length > 0 && (
          <ClientsTable
            clients={clients}
            admin={admin}
            canWrite={canWrite}
            canAssign={canAssign}
            stages={cfg.stages}
            colors={cfg.colors}
            silence={cfg.silence}
            employees={employees}
          />
        )}

        {/* عدّاد */}
        {!error && clients.length > 0 && (
          <p className="mt-3 text-sm text-gray-500">
            الإجمالي: {clients.length} عميل
          </p>
        )}
      </section>
    </main>
  );
}
