import Link from "next/link";
import { redirect } from "next/navigation";
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
import { TEMPERATURE_STYLE, getSavedViews, getEmployeesLite, getTags, getTagsForClients } from "@/lib/crm";
import SavedViews from "@/components/saved-views";
import ClientsTable from "./clients-table";
import ClientFilterBar from "./client-filter-bar";
import Pager from "@/components/pager";
import { baghdadDate } from "@/lib/time";
import {
  applyClientListFilters,
  parseClientListFilters,
  type ClientListSearchParams,
} from "@/lib/client-list-filters";

// ============================================================
// حجم الصفحة (§62). خمسون صفّاً: ما يُقرأ بالنظر لا بالتمرير، وما
// يُختار جماعةً بمراجعة لا بثقة. ورفعه يعني جلب آلاف الصفوف إلى
// المتصفّح — وهو ما نُصلحه هنا لا ما نُعيده.
// ============================================================
const PAGE_SIZE = 50;

// صفحة قائمة العملاء (CRM)
// المُرشِّحات كلها في العنوان (client-list-filters.ts) — ومنها ما يصل
// من روابط «نظرة» و«الجودة» (§45): الرقم يُنقر فيفتح قائمته.
export default async function ClientsPage({
  searchParams,
}: {
  searchParams: ClientListSearchParams;
}) {
  // ⚠️ التسويق لا يتصفّح الأشخاص (092). الحارس هنا لا في الرابط وحده:
  //    من يعرف المسار يكتبه.
  if ((await getUserRole()) === "marketing") redirect("/dashboard/crm/overview");

  const supabase = await createClient();
  // القوائم تُجلب أولاً: منها يُقبل المُرشِّح أو يُرفض، وتُعرض في الشريط.
  // والموظفون من team_members — فالمشرف يرى فريقه والموظف نفسه.
  const [cfg, tags, employees] = await Promise.all([getPipelineConfig(), getTags(), getEmployeesLite()]);
  const today = baghdadDate();
  const temperatures = Object.keys(TEMPERATURE_STYLE);

  const parsed = parseClientListFilters(searchParams, {
    // cfg.colors يشمل المراحل غير الفعّالة — رابطٌ قديم لمرحلة أُوقفت يبقى يعمل
    stages: Object.keys(cfg.colors),
    sources: cfg.sources,
    owners: employees,
    tags,
    temperatures,
    today,
  });
  const f = parsed.filters;

  const page = Math.max(1, Number(searchParams.page) || 1);

  // المُرشِّح بالوسم: معرّفات عملائه أولاً — الربط في جدول ثانٍ
  // فلا يُرشَّح عليه في نفس الاستعلام.
  let tagClientIds: string[] | null = null;
  if (f.tag) {
    const { data: links } = await supabase
      .from("client_tags").select("client_id").eq("tag_id", f.tag).limit(5000);
    tagClientIds = (links ?? []).map((l: { client_id: string }) => l.client_id);
  }

  // count: "exact" يُرجع الإجمالي مع الصفحة في رحلة واحدة — فيُعرض
  // العدد الحقيقي لا عدد المعروض.
  const query = applyClientListFilters(
    supabase.from("clients").select("*", { count: "exact" }).order("created_at", { ascending: false }),
    f,
    { today, now: new Date(), tagClientIds }
  );

  const { data, error, count } = await query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  const clients = (data ?? []) as Client[];
  const total = count ?? clients.length;
  const filtered = parsed.chips.length > 0;

  // هل المستخدم الحالي مدير؟ (لإظهار أزرار التعديل والحذف)
  // ⚠️ canWrite ليس حماية — الحماية في RLS. لكن RLS تمنع صمتاً
  //    (صفر صفوف بلا خطأ)، فزرٌّ ظاهر لمن لا يملك يقول «حُفظ» كاذباً.
  const [admin, user, views, canWrite, role] = await Promise.all([
    isAdmin(),
    getCurrentUser(),
    getSavedViews("clients"),
    canWriteCrm(),
    getUserRole(),
  ]);
  // وسوم الصفحة المعروضة دفعةً واحدة — لا استعلام لكل صفّ (§62)
  const tagsMap = await getTagsForClients(clients.map((c) => c.id));
  const tagsByClient = Object.fromEntries(tagsMap);
  // الإسناد فعلٌ محروس في القاعدة (assign_client): المدير ومدير
  // المتابعة والمشرف في نطاقه. غيرهم يرى بقيّة الإجراءات بلا هذا.
  const canAssign = role === "admin" || role === "followup_manager" || role === "supervisor";
  // المُرشِّحات الفعّالة كما هي في العنوان — هي ما يُحفظ باسم، ويُرقَّم
  // به، ويُصدَّر به
  const currentFilters = parsed.params;
  const exportQuery = new URLSearchParams(currentFilters).toString();

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
              {/* التصدير يحمل المُرشِّحات نفسها: ما تراه هو ما يُصدَّر */}
              <a
                href={`/api/clients/export${exportQuery ? `?${exportQuery}` : ""}`}
                className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
              >
                <span className="material-symbols-outlined text-[18px]">download</span>
                {filtered ? `تصدير المُرشَّح (${total})` : "تصدير اكسل"}
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

        {/* البحث والمُرشِّحات — كلها في الرابط */}
        <ClientFilterBar
          parsed={parsed}
          owners={employees}
          stages={cfg.stageNames}
          sources={cfg.sources}
          temperatures={temperatures}
          tags={tags}
        />

        {/* العروض المحفوظة — المُرشِّح باسمٍ يُنقر (§46) */}
        <SavedViews
          entity="clients"
          basePath="/dashboard/clients"
          current={currentFilters}
          views={views}
          userId={user?.id ?? null}
        />

        {filtered && !error && (
          <p className="mb-3 text-sm text-gray-600">
            <b className="text-gray-900">{total}</b> عميلاً مطابقاً
          </p>
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
            {filtered ? "لا يوجد عميل مطابق." : "لا يوجد عملاء بعد — أضف أول عميل."}
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
            canExport={admin}
            tags={tags}
            tagsByClient={tagsByClient}
          />
        )}

        {/* الترقيم — يعرض الإجمالي الحقيقي لا عدد المعروض (§62) */}
        {!error && (
          <Pager
            total={total}
            page={page}
            pageSize={PAGE_SIZE}
            basePath="/dashboard/clients"
            params={currentFilters}
            unit="عميلاً"
          />
        )}
      </section>
    </main>
  );
}
