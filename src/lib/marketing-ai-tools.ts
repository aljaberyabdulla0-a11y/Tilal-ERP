import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// أدوات المساعد التسويقي — كلٌّ دالّةٌ في القاعدة، قراءةً فقط، تُنفَّذ
// بجلسة السائل نفسه (فتسري صلاحيته: المحاسب يرى المال، والمُطالِع يقرأ،
// ومن خارج الفريق يُرفض).
//
// ⚠️ لا أداة كتابة واحدة. المساعد يقترح نصّاً ويحلّل أرقاماً، والإنسان
//    يُدخل ما يُقرّه من شاشته. ولا أداة SQL حرّة: قائمةٌ مغلقة من دوالّ
//    125 بمعاملاتٍ تُفحص هنا قبل أن تصل القاعدة.
// ============================================================

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MODELS = ["last", "first", "linear", "position", "time_decay", "campaign"];
const DIMS = ["campaign", "channel", "project", "activity", "influencer", "content", "landing", "vendor", "category", "employee", "month"];

const filterProps = {
  from: { type: "string", description: "بداية المدة YYYY-MM-DD (اختياري)" },
  to: { type: "string", description: "نهاية المدة YYYY-MM-DD (اختياري)" },
  project_id: { type: "string", description: "معرّف المشروع uuid من list_projects (اختياري)" },
  campaign_id: { type: "string", description: "معرّف الحملة uuid من list_campaigns (اختياري)" },
  channel_id: { type: "string", description: "معرّف القناة uuid من list_channels (اختياري)" },
} as const;

export const AI_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "get_kpis",
    description: "مؤشّرات التسويق لمدة ومُرشِّحات: الكلفة، الليدات، المؤهَّلون، الحجوزات، البيعات المنسوبة، عمولة تلال، قيمة البيع، CPL، CPQL، CPA، CAC، CTR، CPC، ROAS، ROI، ونِسب التحويل. الإيراد = عمولة تلال لا قيمة الوحدة.",
    input_schema: { type: "object", properties: { ...filterProps, model: { type: "string", enum: MODELS, description: "نموذج الإسناد، الافتراضي last" } } },
  },
  {
    name: "get_breakdown",
    description: "الأرقام مفصّلة ببُعد: campaign, channel, project, activity (ميداني/فعالية), influencer, content, landing, vendor, category (تصنيف المصروف), employee (صاحب الحملة), month. مرتّبة بالعمولة ثم الليدات.",
    input_schema: { type: "object", properties: { dimension: { type: "string", enum: DIMS }, ...filterProps, model: { type: "string", enum: MODELS } }, required: ["dimension"] },
  },
  {
    name: "get_trend",
    description: "الكلفة والليدات والمؤهَّلون والبيعات والعمولة عبر الزمن بدقّة day أو week أو month — للمقارنة بين فترات ومعرفة متى تغيّر شيء.",
    input_schema: { type: "object", properties: { grain: { type: "string", enum: ["day", "week", "month"] }, ...filterProps }, required: ["grain"] },
  },
  {
    name: "get_funnel",
    description: "القمع من الظهور إلى البيع بنسبة كل خطوة.",
    input_schema: { type: "object", properties: { ...filterProps } },
  },
  {
    name: "get_budget_status",
    description: "الميزانيات: المخطّط والمعتمد والملتزم والمصروف والمتبقّي ونسبة الاستهلاك والتنبيه.",
    input_schema: { type: "object", properties: { from: filterProps.from, to: filterProps.to } },
  },
  {
    name: "get_ad_performance",
    description: "أداء الإعلانات المدفوعة لكل حملة إعلانية ومجموعة وإعلان: مصروف المنصّة، الظهور، النقر، CTR، CPC، ليدات المنصّة، الليدات الفعلية، CPL.",
    input_schema: { type: "object", properties: { from: filterProps.from, to: filterProps.to, campaign_id: filterProps.campaign_id } },
  },
  {
    name: "get_forecast",
    description: "تنبؤ ثلاثة سيناريوهات (متحفّظ/أساسي/طموح) لميزانية شهرية وعدد أشهر، من نِسب آخر ١٨٠ يوماً.",
    input_schema: { type: "object", properties: { monthly_budget: { type: "number" }, months: { type: "integer" }, project_id: filterProps.project_id }, required: ["monthly_budget"] },
  },
  {
    name: "get_data_quality",
    description: "مشكلات جودة بيانات التسويق: ليدات بلا مصدر، حملات بلا ميزانية، روابط معطوبة، حملات منتهية ما زالت نشطة، مصروفات غير منسوبة…",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_calendar",
    description: "ما هو مجدول بين تاريخين: حملات، محتوى، فعاليات، أنشطة ميدانية، مهامّ، تسليمات مؤثرين.",
    input_schema: { type: "object", properties: { from: filterProps.from, to: filterProps.to }, required: ["from", "to"] },
  },
  {
    name: "list_projects",
    description: "قائمة المشاريع بمعرّفاتها — لتحويل اسم مشروع (مثل «لاماك») إلى project_id.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_campaigns",
    description: "قائمة الحملات بمعرّفاتها ورموزها وحالاتها.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_channels",
    description: "قائمة القنوات (فيسبوك، تيك توك، لوحات…) بمعرّفاتها.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_project_brief",
    description: "حقائق مشروع من قاعدة الوحدات: الموقع، الوحدات المتاحة بأنواعها ومساحاتها وأسعارها، خطط الدفع. استعملها قبل كتابة أي محتوى عن مشروع — ولا تذكر ما ليس فيها.",
    input_schema: { type: "object", properties: { project_id: filterProps.project_id }, required: ["project_id"] },
  },
  {
    name: "search_marketing",
    description: "بحث في القسم: حملات، محتوى، أنشطة، مؤثرون، موردون، روابط، صفحات، أصول، خطط.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
];

type Input = Record<string, unknown>;

function id(v: unknown): string | null {
  return typeof v === "string" && UUID.test(v) ? v : null;
}
function date(v: unknown): string | null {
  return typeof v === "string" && DATE.test(v) ? v : null;
}
function f(i: Input) {
  return {
    p_from: date(i.from), p_to: date(i.to),
    p_project: id(i.project_id), p_campaign: id(i.campaign_id), p_channel: id(i.channel_id),
  };
}

/** يُرجع JSON نصّاً للنموذج — أو خطأً يقرؤه فيصحّح */
export async function runAiTool(supabase: SupabaseClient, name: string, input: Input): Promise<{ text: string; isError: boolean }> {
  const model = MODELS.includes(String(input.model)) ? String(input.model) : "last";
  let res: { data: unknown; error: { message: string } | null };
  switch (name) {
    case "get_kpis":
      res = await supabase.rpc("mkt_kpis", { ...f(input), p_model: model }); break;
    case "get_breakdown":
      if (!DIMS.includes(String(input.dimension))) return { text: "بُعد غير معروف", isError: true };
      res = await supabase.rpc("mkt_breakdown", { p_dim: input.dimension, ...f(input), p_model: model }); break;
    case "get_trend":
      res = await supabase.rpc("mkt_trend", { p_grain: ["day", "week", "month"].includes(String(input.grain)) ? input.grain : "month", ...f(input) }); break;
    case "get_funnel":
      res = await supabase.rpc("mkt_funnel", f(input)); break;
    case "get_budget_status":
      res = await supabase.rpc("mkt_budget_status", { p_from: date(input.from), p_to: date(input.to) }); break;
    case "get_ad_performance":
      res = await supabase.rpc("mkt_ad_performance", { p_from: date(input.from), p_to: date(input.to), p_campaign: id(input.campaign_id) }); break;
    case "get_forecast": {
      const b = Number(input.monthly_budget);
      const m = Number(input.months ?? 3);
      if (!(b > 0) || !(m >= 1 && m <= 24)) return { text: "الميزانية موجبة والأشهر ١–٢٤", isError: true };
      res = await supabase.rpc("mkt_forecast", { p_monthly_budget: b, p_months: Math.round(m), p_project: id(input.project_id), p_channel: null }); break;
    }
    case "get_data_quality":
      res = await supabase.rpc("mkt_data_quality"); break;
    case "get_calendar": {
      const a = date(input.from), z = date(input.to);
      if (!a || !z) return { text: "from و to بصيغة YYYY-MM-DD", isError: true };
      res = await supabase.rpc("mkt_calendar", { p_from: a, p_to: z }); break;
    }
    case "list_projects":
      res = await supabase.rpc("mkt_projects"); break;
    case "list_campaigns":
      res = await supabase.from("crm_campaigns").select("id, name, code, status, campaign_type, project_id, channel_id, start_date, end_date, budget, spent, expected_leads").order("created_at", { ascending: false }).limit(200); break;
    case "list_channels":
      res = await supabase.from("mkt_channels").select("id, name, mode, utm_source, utm_medium").eq("is_active", true); break;
    case "get_project_brief": {
      const p = id(input.project_id);
      if (!p) return { text: "project_id مطلوب — من list_projects", isError: true };
      res = await supabase.rpc("mkt_project_brief", { p_project: p }); break;
    }
    case "search_marketing":
      res = await supabase.rpc("mkt_search", { p_q: String(input.query ?? "").slice(0, 80), p_limit: 30 }); break;
    default:
      return { text: `أداة غير معروفة: ${name}`, isError: true };
  }
  if (res.error) return { text: `خطأ من القاعدة: ${res.error.message}`, isError: true };
  // سقفٌ للحجم: نتيجةٌ ضخمة تُقصّ بإعلان — لا صمتاً
  const json = JSON.stringify(res.data ?? null);
  return json.length > 60000
    ? { text: json.slice(0, 60000) + `\n[…قُصّت النتيجة: ${json.length} حرفاً — ضيّق المُرشِّحات]`, isError: false }
    : { text: json, isError: false };
}
