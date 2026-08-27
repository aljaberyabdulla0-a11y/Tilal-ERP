import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isBroker } from "@/lib/auth";
import {
  Client,
  ClientActivity,
  formatPrice,
  leadDaysLeft,
  leadDeadlineColor,
  leadDeadlineLabel,
  toIntlPhone,
} from "@/lib/types";
import StageSelect from "@/components/stage-select";
import ActivityTimeline from "@/components/activity-timeline";
import LogActivity from "@/app/dashboard/clients/[id]/log-activity";

// ============================================================
// ملفّ الليد — شاشة الشركة الوسيطة.
//
// ما تحتاجه الشركة هنا ثلاثة: كم بقي من المهلة، وكيف تتصل بالعميل،
// وأين تسجّل ما دار في التواصل. وما عدا ذلك (الوحدات، الحجوزات،
// الفواتير) شأن تلال ولا يظهر.
// ============================================================
export default async function BrokerLeadPage({
  params,
}: {
  params: { id: string };
}) {
  if (!(await isBroker())) redirect("/dashboard");

  const supabase = await createClient();
  const [{ data }, { data: acts }] = await Promise.all([
    supabase
      .from("clients")
      .select("*, projects(name)")
      .eq("id", params.id)
      .maybeSingle(),
    supabase
      .from("client_activities")
      .select("*")
      .eq("client_id", params.id)
      .order("occurred_at", { ascending: false }),
  ]);

  // RLS تُرجع لا شيء إن لم يكن الليد لشركة صاحب الحساب
  if (!data) notFound();

  const lead = data as Client;
  const activities = (acts ?? []) as ClientActivity[];
  const closed = lead.stage === "بيع";
  const days = closed ? null : leadDaysLeft(lead.broker_deadline);
  const intl = lead.phone ? toIntlPhone(lead.phone) : "";

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/broker/leads"
            className="text-sm text-gray-500 hover:text-brand-700"
          >
            ← ليداتنا
          </Link>
          <div>
            <h1 className="text-xl font-bold text-brand-700">{lead.name}</h1>
            <p className="text-sm text-gray-500">
              {lead.projects?.name ?? "بلا مشروع"}
              {lead.phone && ` · ${lead.phone}`}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {closed ? (
            <span className="rounded-full bg-emerald-100 px-3 py-1.5 text-sm font-bold text-emerald-700">
              أُغلق بيعاً ✓
            </span>
          ) : (
            <span
              className={`rounded-full px-3 py-1.5 text-sm font-bold ${leadDeadlineColor(days)}`}
            >
              {leadDeadlineLabel(days)}
            </span>
          )}
          <StageSelect clientId={lead.id} stage={lead.stage} size="md" />
          {intl && (
            <>
              <a
                href={`tel:${intl}`}
                className="rounded-lg bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100"
              >
                اتصال
              </a>
              <a
                href={`https://wa.me/${intl.replace("+", "")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg bg-green-50 px-3 py-2 text-sm font-semibold text-green-700 transition hover:bg-green-100"
              >
                واتساب
              </a>
            </>
          )}
        </div>
      </header>

      <section className="grid grid-cols-1 gap-5 p-6 lg:grid-cols-3">
        {/* بيانات الليد */}
        <div className="space-y-5">
          <div className="glass-card p-6">
            <h2 className="mb-4 text-lg font-bold text-gray-800">بيانات العميل</h2>
            <dl className="space-y-3 text-sm">
              {[
                { label: "المحافظة", value: lead.governorate ?? "—" },
                { label: "المنطقة", value: lead.area ?? "—" },
                { label: "الغرض من الشراء", value: lead.purchase_purpose ?? "—" },
                { label: "طريقة الدفع", value: lead.payment_method ?? "—" },
                {
                  label: "تاريخ الإدخال",
                  value: lead.broker_assigned_at
                    ? new Date(lead.broker_assigned_at).toLocaleDateString("ar")
                    : "—",
                },
                { label: "آخر يوم في المهلة", value: lead.broker_deadline ?? "—" },
                { label: "مرات التواصل", value: String(lead.contact_count ?? 0) },
              ].map((f) => (
                <div key={f.label} className="flex justify-between gap-3">
                  <dt className="text-gray-500">{f.label}</dt>
                  <dd className="font-medium text-gray-800">{f.value}</dd>
                </div>
              ))}
            </dl>
            {lead.notes && (
              <p className="mt-4 rounded-xl bg-gray-50 p-4 text-sm text-gray-600">
                {lead.notes}
              </p>
            )}
          </div>

          {!closed && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              متى يُغلق الليد؟ حين تُحوَّل مرحلته إلى <b>«بيع»</b> بعد إتمام
              الصفقة مع تلال. عندها تتوقّف المهلة وتُسجَّل عمولتكم تلقائياً.
            </div>
          )}
        </div>

        {/* التواصل */}
        <div className="space-y-5 lg:col-span-2">
          <div className="glass-card p-6">
            <h2 className="mb-4 text-lg font-bold text-gray-800">تسجيل تواصل</h2>
            <LogActivity clientId={lead.id} stage={lead.stage} />
          </div>

          <div className="glass-card p-6">
            <h2 className="mb-4 text-lg font-bold text-gray-800">
              سجلّ التواصل ({activities.length})
            </h2>
            {activities.length === 0 ? (
              <p className="text-sm text-gray-400">
                لا تواصل مسجّل بعد. سجّل أول مكالمة من الأعلى.
              </p>
            ) : (
              <ActivityTimeline activities={activities} clientStage={lead.stage} />
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
