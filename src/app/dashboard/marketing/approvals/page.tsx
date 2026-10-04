import Link from "next/link";
import { requireMktRead } from "@/lib/marketing-guard";
import { getUserRole, isMarketingManager } from "@/lib/auth";
import { getApprovals } from "@/lib/marketing";
import { fmt } from "@/lib/marketing-style";
import { Badge, Card, PageHead } from "@/components/marketing/ui";
import { SimpleTable } from "@/components/marketing/table";
import { RpcButton } from "@/components/marketing/actions";

// صندوق الموافقات — كل ما ينتظر قراراً في القسم، بمن يعتمده.
// الطالب لا يعتمد طلبه (إلا المدير) — القاعدة ترفض، والزرّ يُخفى.
const LINK: Record<string, (id: string) => string> = {
  "حملة": (id) => `/dashboard/marketing/campaigns/${id}?tab=approvals`,
  "خطة": (id) => `/dashboard/marketing/plans/${id}`,
  "محتوى": (id) => `/dashboard/marketing/content/${id}`,
  "مؤثر": () => `/dashboard/marketing/influencers`,
  "نشاط": (id) => `/dashboard/marketing/offline/${id}`,
  "ميزانية": () => `/dashboard/marketing/budget`,
  "مصروف": () => `/dashboard/marketing/expenses`,
  "شراء": () => `/dashboard/marketing/procurement`,
};

export default async function ApprovalsPage({ searchParams }: { searchParams: Record<string, string> }) {
  await requireMktRead();
  const history = searchParams.view === "history";
  const [rows, manager, role] = await Promise.all([getApprovals(history ? null : "معلّق"), isMarketingManager(), getUserRole()]);
  const admin = role === "admin";
  const canDecide = (approver: string) => admin || (approver === "مدير التسويق" && manager);

  return (
    <>
      <PageHead title="الموافقات" sub="الاعتماد لا يقع بتعديل حالة — يقع هنا، ويُسجَّل من طلب ومن قرّر ومتى ولماذا." />
      <div className="flex gap-2 text-sm">
        <Link href="/dashboard/marketing/approvals" className={!history ? "rounded-full bg-brand-600 px-3 py-1 text-white" : "rounded-full border px-3 py-1"}>المعلّقة</Link>
        <Link href="/dashboard/marketing/approvals?view=history" className={history ? "rounded-full bg-brand-600 px-3 py-1 text-white" : "rounded-full border px-3 py-1"}>السجلّ</Link>
      </div>
      <Card>
        <SimpleTable
          empty={history ? "لا سجلّ." : "لا شيء ينتظر قراراً."}
          head={["النوع", "العنوان", "المبلغ", "طلبه", "متى", "يعتمده", "الحالة", history ? "القرار" : "إجراء"]}
          rows={rows.map((a) => [
            a.entity_type,
            <span key="t">
              <Link href={(LINK[a.entity_type] ?? (() => "#"))(a.entity_id)} className="font-medium hover:text-brand-600">{a.title}</Link>
              {a.note && <span className="block text-xs text-gray-500">«{a.note}»</span>}
              {a.escalated_reason && <span className="block text-xs text-amber-700">رُفع إلى المدير: {a.escalated_reason}</span>}
            </span>,
            fmt(a.amount),
            a.requested_by_name ?? "—",
            <span key="d" dir="ltr" className="text-xs">{a.requested_at.slice(0, 16).replace("T", " ")}</span>,
            a.approver,
            <Badge key="s">{a.status}</Badge>,
            history ? (
              <span key="r" className="text-xs">{a.decided_by_name ?? "—"}{a.reason ? ` — ${a.reason}` : ""}</span>
            ) : canDecide(a.approver) ? (
              <span key="a" className="flex flex-wrap gap-1">
                <RpcButton small fn="mkt_decide_approval" args={{ p_id: a.id, p_approve: true }} label="اعتمد" icon="check" />
                <RpcButton small fn="mkt_decide_approval" args={{ p_id: a.id, p_approve: false }} label="ارفض" tone="danger"
                  prompt="سبب الرفض — يصل إلى من طلب" promptKey="p_reason" promptRequired />
              </span>
            ) : (
              <span key="w" className="text-xs text-gray-400">ينتظر {a.approver}</span>
            ),
          ])}
        />
      </Card>
    </>
  );
}
