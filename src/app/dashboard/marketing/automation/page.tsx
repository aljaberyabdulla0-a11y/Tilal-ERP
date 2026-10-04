import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireMktRead } from "@/lib/marketing-guard";
import { canWriteMarketing, isMarketingManager } from "@/lib/auth";
import { Badge, Card, PageHead } from "@/components/marketing/ui";
import { SimpleTable } from "@/components/marketing/table";
import { RpcButton, ToggleField } from "@/components/marketing/actions";
import RuleParams from "./rule-params";

// ============================================================
// الأتمتة — قواعد بأنواعٍ مغلقة (126)، وتنبيهاتٌ تُطلق مرّة بمفتاحها،
// وسجلّ كل تشغيل. المهمة mkt-automation-scan تعمل ٧:٠٠ بغداد يومياً.
// القاعدة تُعدَّل معاملاتها (النسبة، الأيام) وتُوقف — ولا تُكتب شرطاً.
// ============================================================
export default async function AutomationPage({ searchParams }: { searchParams: Record<string, string> }) {
  await requireMktRead();
  const supabase = await createClient();
  const showResolved = searchParams.resolved === "1";
  let aq = supabase.from("mkt_alerts").select("*").order("created_at", { ascending: false }).limit(200);
  if (!showResolved) aq = aq.is("resolved_at", null);
  const [manager, write, { data: rules }, { data: alerts }, { data: runs }] = await Promise.all([
    isMarketingManager(), canWriteMarketing(),
    supabase.from("mkt_automation_rules").select("*").order("code"),
    aq,
    supabase.from("mkt_automation_runs").select("*").order("started_at", { ascending: false }).limit(15),
  ]);

  return (
    <>
      <PageHead title="الأتمتة والتنبيهات" sub="تجاوز الميزانية، ارتفاع كلفة الليد، بلوغ الهدف، تأخّر الموافقة أو المؤثر أو المحتوى، انتهاء الحملة أو اللوحة، ليدٌ بلا متابعة، تكاملٌ متعطّل."
        actions={manager && <RpcButton fn="mkt_run_automation" args={{ p_trigger: "يدوي" }} label="شغّل الفحص الآن" icon="bolt" />} />

      <Card title="التنبيهات" actions={<Link href={showResolved ? "?" : "?resolved=1"} className="text-xs text-brand-600">{showResolved ? "المفتوحة فقط" : "مع المغلقة"}</Link>}>
        <SimpleTable empty="لا تنبيهات."
          head={["متى", "التنبيه", "التفاصيل", "الأهمية", "أُشعر", ""]}
          rows={(alerts ?? []).map((a) => [
            <span key="d" dir="ltr" className="text-xs">{a.created_at.slice(0, 16).replace("T", " ")}</span>,
            a.link ? <Link key="t" href={a.link} className="font-medium hover:text-brand-600">{a.title}</Link> : a.title,
            <span key="b" className="text-xs text-gray-600">{a.body}</span>,
            <Badge key="s">{a.severity}</Badge>, a.notified,
            a.resolved_at ? <span key="r" className="text-xs text-gray-400">أُغلق</span>
              : write ? <RpcButton key="r" small tone="plain" fn="mkt_resolve_alert" args={{ p_id: a.id }} label="أغلق" /> : null,
          ])} />
      </Card>

      <Card title="القواعد">
        <SimpleTable
          head={["القاعدة", "النوع", "المعاملات", "يُشعر", "الأهمية", "آخر تشغيل", "الحالة"]}
          rows={(rules ?? []).map((r) => [
            r.name, <span key="k" className="text-xs">{r.trigger_kind}</span>,
            manager ? <RuleParams key="p" id={r.id} params={r.params} /> : <span key="p" dir="ltr" className="text-xs">{JSON.stringify(r.params)}</span>,
            <span key="n" className="text-xs">{(r.notify as string[]).join("، ")}</span>, r.severity,
            <span key="l" dir="ltr" className="text-xs">{r.last_run_at?.slice(0, 16).replace("T", " ") ?? "—"}</span>,
            manager ? <ToggleField key="a" table="mkt_automation_rules" id={r.id} column="is_active" value={r.is_active} on="فعّالة" off="موقوفة" /> : (r.is_active ? "فعّالة" : "موقوفة"),
          ])} />
      </Card>

      <Card title="سجلّ التشغيل">
        <SimpleTable empty="لم يُشغَّل الفحص بعد."
          head={["بدأ", "انتهى", "المصدر", "الحالة", "أُطلق", "أخطاء"]}
          rows={(runs ?? []).map((r) => [
            <span key="s" dir="ltr" className="text-xs">{r.started_at.slice(0, 19).replace("T", " ")}</span>,
            <span key="f" dir="ltr" className="text-xs">{r.finished_at?.slice(11, 19) ?? "—"}</span>,
            r.trigger, <Badge key="st">{r.status}</Badge>, r.fired,
            <span key="e" className="text-xs text-red-700">{(r.errors as { rule: string; error: string }[]).map((e) => `${e.rule}: ${e.error}`).join(" · ")}</span>,
          ])} />
      </Card>
    </>
  );
}
