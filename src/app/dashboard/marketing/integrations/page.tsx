import { createClient } from "@/lib/supabase/server";
import { requireMktRead } from "@/lib/marketing-guard";
import { isMarketingManager } from "@/lib/auth";
import { INTEGRATION_PROVIDERS } from "@/lib/marketing-style";
import { Badge, Card, PageHead } from "@/components/marketing/ui";
import { SimpleTable } from "@/components/marketing/table";
import RecordForm from "@/components/marketing/record-form";
import RpcForm from "@/components/marketing/rpc-form";
import { ToggleField } from "@/components/marketing/actions";
import SyncNow from "./sync-now";

// ============================================================
// التكاملات — Meta و Google و TikTok و LinkedIn و YouTube و Analytics
// و GTM و واتساب والبريد والرسائل.
//
// المفتاح يُكتب ولا يُقرأ: يذهب إلى Supabase Vault، ولا تعود منه إلى
// الشاشة إلا «محفوظ». تقرؤه دالّة الحافة marketing-sync وحدها
// (service_role). والسجلّ يحفظ ما حدث لا الحمولة.
//
// الجاهز اليوم: موصّل Meta (رؤى الإعلانات اليومية). الباقي إطارٌ
// مكتمل (اتصال، حالة، سجلّ، أخطاء، إعادة محاولة) بلا موصّل — والاستيراد
// بملف CSV يغطّيه حتى يُبنى.
// ============================================================
export default async function IntegrationsPage() {
  await requireMktRead();
  const supabase = await createClient();
  const [manager, { data: integrations }, { data: logs }, { data: accounts }] = await Promise.all([
    isMarketingManager(),
    supabase.from("mkt_integrations").select("*").order("created_at"),
    supabase.from("mkt_sync_logs").select("*").order("started_at", { ascending: false }).limit(40),
    supabase.from("mkt_accounts").select("id, name").eq("kind", "حساب إعلانات"),
  ]);
  const secrets = await Promise.all((integrations ?? []).map(async (i) => {
    const { data } = await supabase.rpc("mkt_has_integration_secret", { p_integration: i.id });
    return [i.id, data === true] as const;
  }));
  const hasSecret = new Map(secrets);
  const name = new Map((integrations ?? []).map((i) => [i.id, i.name]));

  return (
    <>
      <PageHead title="التكاملات" sub="اتصال المنصّات الإعلانية والتحليلات والرسائل. المفاتيح في Vault ولا تظهر في الواجهة أبداً." />
      {manager && (
        <RecordForm table="mkt_integrations" openLabel="تكامل جديد" initial={{ provider: "meta", auth_type: "token", sync_frequency: "يومي" }}
          fields={[
            { name: "name", label: "الاسم", required: true },
            { name: "provider", label: "المنصّة", type: "select", required: true, options: Object.entries(INTEGRATION_PROVIDERS).map(([v, p]) => ({ value: v, label: p.label + (p.ready ? "" : " (إطار — بلا موصّل بعد)") })) },
            { name: "account_ref", label: "معرّف الحساب", ltr: true, placeholder: "act_1234567890" },
            { name: "account_id", label: "حساب الإعلانات في تلال", type: "select", options: (accounts ?? []).map((a) => ({ value: a.id, label: a.name })) },
            { name: "auth_type", label: "المصادقة", type: "select", options: [{ value: "token", label: "رمز وصول (System User)" }, { value: "oauth", label: "OAuth" }, { value: "api_key", label: "مفتاح API" }], required: true },
            { name: "sync_frequency", label: "المزامنة", type: "select", options: ["يدوي", "كل ساعة", "يومي"], required: true },
          ]} />
      )}

      <Card title="التكاملات">
        <SimpleTable empty="لا تكاملات. أضِف Meta بمعرّف حساب الإعلانات ورمز System User طويل الأمد."
          head={["التكامل", "المنصّة", "الحساب", "الحالة", "المفتاح", "آخر مزامنة", "آخر نجاح", "الخطأ", ""]}
          rows={(integrations ?? []).map((i) => {
            const p = INTEGRATION_PROVIDERS[i.provider];
            return [
              i.name, <span key="p" className="text-xs">{p?.label ?? i.provider}{!p?.ready && <span className="block text-amber-700">بلا موصّل — استورد CSV</span>}</span>,
              <span key="a" dir="ltr" className="text-xs">{i.account_ref ?? "—"}</span>,
              <Badge key="s">{i.status}</Badge>,
              <span key="k" className="text-xs">
                {hasSecret.get(i.id) ? "محفوظ في Vault" : <span className="text-amber-700">غير مضبوط</span>}
                {manager && <span className="mt-1 block"><RpcForm fn="mkt_set_integration_secret" fixed={{ p_integration: i.id }} openLabel={hasSecret.get(i.id) ? "بدّل المفتاح" : "اضبط المفتاح"} submitLabel="احفظ في Vault" compact
                  fields={[{ name: "p_secret", label: "الرمز/المفتاح", required: true, ltr: true, hint: "يُحفظ مشفّراً ولا يُعرض بعدها" }]} /></span>}
              </span>,
              <span key="ls" dir="ltr" className="text-xs">{i.last_sync_at?.slice(0, 16).replace("T", " ") ?? "—"}</span>,
              <span key="lo" dir="ltr" className="text-xs">{i.last_success_at?.slice(0, 16).replace("T", " ") ?? "—"}</span>,
              <span key="e" className="text-xs text-red-700">{i.last_error ?? ""}</span>,
              <span key="x" className="flex flex-col gap-1">
                {p?.ready && hasSecret.get(i.id) && <SyncNow integrationId={i.id} />}
                {manager && <ToggleField table="mkt_integrations" id={i.id} column="is_active" value={i.is_active} />}
              </span>,
            ];
          })} />
      </Card>

      <Card title="سجلّ المزامنة">
        <SimpleTable empty="لا مزامنات بعد."
          head={["بدأ", "التكامل", "المصدر", "المحاولة", "الحالة", "صفوف", "الخطأ"]}
          rows={(logs ?? []).map((l) => [
            <span key="s" dir="ltr" className="text-xs">{l.started_at.slice(0, 19).replace("T", " ")}</span>, name.get(l.integration_id) ?? "—",
            l.trigger, l.attempt, <Badge key="st">{l.status}</Badge>, l.rows_in ?? "—", <span key="e" className="text-xs text-red-700">{l.error ?? ""}</span>,
          ])} />
      </Card>

      <Card title="ربط Meta — الخطوات">
        <ol className="list-decimal space-y-1 pe-5 text-sm text-gray-700">
          <li>في Business Manager: أنشئ System User، وامنحه حساب الإعلانات بصلاحية <span dir="ltr">ads_read</span>، وولّد له رمزاً طويل الأمد.</li>
          <li>هنا: «تكامل جديد» بمنصّة Meta ومعرّف الحساب (<span dir="ltr">act_…</span>)، ثم «اضبط المفتاح» والصق الرمز.</li>
          <li>«زامن الآن»: تُنشأ الحملات الإعلانية ومجموعاتها وإعلاناتها تلقائياً وتدخل مقاييس آخر ٧ أيام يومياً.</li>
          <li>اربط كل «حملة إعلانية» بحملة تلال من صفحة الإعلانات — أو سمِّ الحملة عند ميتا برمز حملة تلال (<span dir="ltr">cmp-0001</span>) فتُربط تلقائياً.</li>
          <li>المزامنة المجدولة تحتاج تفعيل <span dir="ltr">pg_net</span> — الأمر معلَّق في آخر <span dir="ltr">sql/126</span>.</li>
        </ol>
      </Card>
    </>
  );
}
