import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { canReadMarketingMoney } from "@/lib/auth";
import { baghdadDate } from "@/lib/time";
import { AI_TOOLS, runAiTool } from "@/lib/marketing-ai-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// ============================================================
// المساعد التسويقي — Claude بأدواتٍ للقراءة فقط (marketing-ai-tools).
//
//   • الأدوات تُنفَّذ بجلسة السائل: لا مفتاح خدمة، ولا قراءة فوق صلاحيته.
//   • لا أداة كتابة: يحلّل ويقترح نصّاً، والإنسان يُدخل ما يقرّه.
//   • كل سؤال يُسجَّل في mkt_ai_log بأدواته وجوابه (التدقيق).
//   • المفتاح ANTHROPIC_API_KEY في بيئة الخادم وحدها — لا يصل المتصفّح.
// ============================================================

const SYSTEM = `أنت المساعد التسويقي لشركة تلال — وسيط عقاري في العراق يسوّق مشاريع مطوّرين ويأخذ عمولة على البيع.

قواعد لا تُكسر:
- الأرقام من الأدوات وحدها. لا تقدّر رقماً ولا تكمل ناقصاً من عندك. إن لم تُرجع الأداة شيئاً قل ذلك.
- الإيراد = عمولة تلال (commission) لا قيمة الوحدة (sale_value). اذكر قيمة البيع باسمها إن ذكرتها.
- «—» أو null في الكلفة تعني «لا كلفة مسجّلة»، لا صفراً ولا مجّاناً.
- الليدات تُعدّ بتاريخ دخولها، والبيعات بتاريخ تأكيد المقدمة — فوجان مختلفان.
- قبل كتابة محتوى عن مشروع: استدعِ get_project_brief، واستعمل حقائقه فقط. لا تخترع ميزةً أو سعراً أو موعد تسليم أو خدمةً ليست في الحقائق.
- المبالغ بالدينار العراقي. اكتب الأرقام بفواصل الآلاف.
- اسم مشروع أو حملة في السؤال → حوّله إلى معرّف بـ list_projects أو list_campaigns أولاً.
- لا صلاحية كتابة لك. إن طُلب تنفيذ شيء (إنشاء حملة، إيقاف إعلان) اقترحه وقل أين يُنفَّذ في النظام.

الأسلوب: العربية ما لم يُسأل بغيرها. ابدأ بالجواب ثم الدليل. جدولٌ صغير بالماركداون حين تقارن. توصيةٌ واضحة حين تُسأل «ماذا نفعل»، بسببها من الأرقام.`;

type Turn = { role: "user" | "assistant"; content: string };

export async function POST(request: Request) {
  if (!(await canReadMarketingMoney())) {
    return NextResponse.json({ error: "المساعد التسويقي لفريق التسويق والمالية." }, { status: 403 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "المساعد غير مفعّل: أضِف ANTHROPIC_API_KEY في متغيّرات بيئة الخادم (Vercel)." }, { status: 503 });
  }

  let body: { history?: Turn[]; mode?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "طلب تالف" }, { status: 400 }); }
  const history = (body.history ?? [])
    .filter((t) => (t.role === "user" || t.role === "assistant") && typeof t.content === "string" && t.content.trim())
    .slice(-12)
    .map((t) => ({ role: t.role, content: t.content.slice(0, 8000) }));
  if (history.length === 0 || history[history.length - 1].role !== "user") {
    return NextResponse.json({ error: "اكتب سؤالاً." }, { status: 400 });
  }
  const mode = body.mode === "توليد" ? "توليد" : "سؤال";
  const prompt = history[history.length - 1].content;

  const supabase = await createClient();
  const client = new Anthropic();
  // التاريخ في رسالة سياقٍ لا في التعليمات — فتبقى التعليمات ثابتةً تُخزَّن مؤقتاً
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: `(سياق: اليوم ${baghdadDate()} بتوقيت بغداد)` },
    { role: "assistant", content: "حسناً." },
    ...history,
  ];
  const used: { tool: string; input: unknown; error?: boolean }[] = [];
  let tokensIn = 0, tokensOut = 0;
  let answer = "";
  let model = "claude-opus-5-5";

  try {
    for (let round = 0; round < 8; round++) {
      const response = await client.beta.messages.create({
        model: "claude-opus-5-5",
        max_tokens: 16000,
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        output_config: { effort: mode === "توليد" ? "medium" : "high" },
        // رفضٌ أمنيّ من النموذج يُعاد على نموذج بديل داخل النداء نفسه
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        tools: AI_TOOLS,
        messages,
      });
      tokensIn += response.usage.input_tokens;
      tokensOut += response.usage.output_tokens;
      model = response.model;

      if (response.stop_reason === "refusal") {
        answer = "تعذّر الجواب على هذا الطلب. أعد صياغته بسؤالٍ عن أرقام التسويق أو محتوى المشاريع.";
        break;
      }
      if (response.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: response.content });
        continue;
      }

      const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (toolUses.length === 0 || response.stop_reason !== "tool_use") {
        answer = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
        if (response.stop_reason === "max_tokens") answer += "\n\n[انقطع الجواب لطوله — اطلب جزءاً أصغر.]";
        break;
      }

      messages.push({ role: "assistant", content: response.content });
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = await Promise.all(toolUses.map(async (t) => {
        const r = await runAiTool(supabase, t.name, (t.input ?? {}) as Record<string, unknown>);
        used.push({ tool: t.name, input: t.input, error: r.isError || undefined });
        return { type: "tool_result" as const, tool_use_id: t.id, content: r.text, is_error: r.isError };
      }));
      messages.push({ role: "user", content: results });
    }
    if (!answer) answer = "لم يكتمل الجواب في عدد الخطوات المسموح — ضيّق السؤال.";
  } catch (e) {
    const msg = e instanceof Anthropic.RateLimitError ? "ضغطٌ على خدمة الذكاء — حاول بعد دقيقة."
      : e instanceof Anthropic.AuthenticationError ? "مفتاح ANTHROPIC_API_KEY غير صالح."
      : e instanceof Anthropic.APIError ? `خطأ من خدمة الذكاء (${e.status}).`
      : "تعذّر الاتصال بخدمة الذكاء.";
    await supabase.from("mkt_ai_log").insert({ mode, prompt: prompt.slice(0, 4000), tools: used, error: msg, model });
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  await supabase.from("mkt_ai_log").insert({
    mode, prompt: prompt.slice(0, 4000), tools: used, answer: answer.slice(0, 20000), model, tokens_in: tokensIn, tokens_out: tokensOut,
  });
  return NextResponse.json({ answer, tools: used.map((u) => u.tool) });
}
