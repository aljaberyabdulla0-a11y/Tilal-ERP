import { createClient } from "@/lib/supabase/server";
import RpcForm from "./rpc-form";

// ============================================================
// «من أين جاء هذا العميل؟» — لمسات التسويق في ملفّ العميل (sql/124).
//
// موظف المبيعات يرى السلسلة كاملة (إعلان ← QR ← نموذج) بقراءة
// can_see_client، ويضيف ما يعرفه هو: «جاء من المعرض»، «إحالة». فلا
// يبقى مصدر الليد ما تذكّره العميل في أول مكالمة.
// ============================================================
export default async function ClientTouchpoints({ clientId, canWrite }: { clientId: string; canWrite: boolean }) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("mkt_touchpoints")
    .select("id, occurred_at, touch_type, campaign_id, channel_id, medium, content_ref, note")
    .eq("client_id", clientId)
    .order("occurred_at");
  if (error) return null; // قبل sql/124: لا قسم
  const [{ data: camps }, { data: chans }] = await Promise.all([
    supabase.from("crm_campaigns").select("id, name, is_active").order("created_at", { ascending: false }).limit(200),
    supabase.from("mkt_channels").select("id, name").eq("is_active", true).order("sort_order"),
  ]);
  const cn = new Map((camps ?? []).map((c) => [c.id, c.name]));
  const hn = new Map((chans ?? []).map((c) => [c.id, c.name]));
  const rows = data ?? [];

  return (
    <section className="mt-6 rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="mb-1 font-semibold text-gray-800">المسار التسويقي</h3>
      <p className="mb-3 text-xs text-gray-500">كل لمسة قبل التسجيل وبعده — منها تُنسب البيعة إلى حملتها.</p>
      {rows.length === 0 ? <p className="text-sm text-gray-400">لا لمسات مسجّلة — المصدر من بطاقة العميل وحدها.</p> : (
        <ol className="space-y-1.5 border-s-2 border-brand-100 ps-3 text-sm">
          {rows.map((t) => (
            <li key={t.id}>
              <span className="font-medium">{t.touch_type}</span>
              {t.channel_id && <span className="text-gray-600"> · {hn.get(t.channel_id) ?? ""}</span>}
              {t.campaign_id && <span className="text-brand-700"> · {cn.get(t.campaign_id) ?? ""}</span>}
              {t.content_ref && <span className="text-xs text-gray-400" dir="ltr"> · {t.content_ref}</span>}
              <span className="ms-2 text-xs text-gray-400" dir="ltr">{t.occurred_at.slice(0, 16).replace("T", " ")}</span>
              {t.note && <span className="block text-xs text-gray-500">{t.note}</span>}
            </li>
          ))}
        </ol>
      )}
      {canWrite && (
        <div className="mt-3">
          <RpcForm fn="mkt_add_touchpoint" fixed={{ p_client: clientId }} openLabel="+ سجّل مصدراً عرفته" submitLabel="سجّل"
            fields={[
              { name: "p_type", label: "النوع", type: "select", required: true, options: ["حضور فعالية", "إحالة", "مؤثر", "يدوي"] },
              { name: "p_campaign", label: "الحملة", type: "select", options: (camps ?? []).filter((c) => c.is_active).map((c) => ({ value: c.id, label: c.name })) },
              { name: "p_channel", label: "القناة", type: "select", options: (chans ?? []).map((c) => ({ value: c.id, label: c.name })) },
              { name: "p_note", label: "ملاحظة", span: 3, placeholder: "قال إنه رأى اللوحة على طريق المطار" },
            ]} />
        </div>
      )}
    </section>
  );
}
