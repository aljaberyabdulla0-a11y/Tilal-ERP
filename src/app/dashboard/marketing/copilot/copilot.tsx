"use client";

import { useEffect, useRef, useState } from "react";

type Turn = { role: "user" | "assistant"; content: string; tools?: string[] };

const ASK = [
  "أيّ حملة جلبت أكثر الليدات المؤهَّلة هذا الشهر؟",
  "أيّ مشروع كلفة الليد فيه أقل؟",
  "أيّ قناة عائد إعلانها (ROAS) الأعلى هذه السنة؟",
  "كم صرفنا على التسويق هذا الشهر، وأين؟",
  "لماذا قلّت الليدات هذا الأسبوع مقارنةً بالأسبوع الماضي؟",
  "أيّ الحملات يجب أن نوقفها؟ ولماذا؟",
  "أين نتجاوز الميزانية؟",
  "أعطني تقرير التسويق الشهري، وقارنه بالشهر الماضي.",
  "قارن ميتا بتيك توك في الكلفة والليدات والبيع.",
  "أيّ مؤثر جلب أكثر الليدات؟",
  "أيّ الأنشطة الميدانية جلبت ليدات؟",
  "أيّ مشروع يحتاج تسويقاً أكثر؟",
];
const GENERATE = [
  "اكتب موجز حملة لمشروع (اذكر اسمه) تستهدف المستثمرين.",
  "اقترح تقويم محتوى للأسبوع القادم لمشروع (اذكر اسمه).",
  "اكتب ٣ نصوص إعلان فيسبوك قصيرة مع نداء إجراء لمشروع (اذكر اسمه).",
  "اكتب نصوص منشورات إنستغرام وهاشتاغات لمشروع (اذكر اسمه).",
  "اكتب سيناريو ريلز ٣٠ ثانية بثلاثة خطّافات افتتاحية لمشروع (اذكر اسمه).",
  "اكتب رسالة واتساب ورسالة SMS لليد جديد عن مشروع (اذكر اسمه).",
  "اكتب نصّ صفحة هبوط لمشروع (اذكر اسمه).",
  "اكتب موجزاً لمؤثر عن مشروع (اذكر اسمه) مع ما يجب ذكره وما يُمنع.",
  "اقترح ٥ أفكار حملات للربع القادم بناءً على أداء القنوات.",
];

export default function Copilot({ initial }: { initial: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState(initial);
  const [mode, setMode] = useState<"سؤال" | "توليد">(initial ? "توليد" : "سؤال");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [turns, busy]);

  async function send(text?: string) {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    const next: Turn[] = [...turns, { role: "user", content: q }];
    setTurns(next);
    setInput("");
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/marketing/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, history: next.map(({ role, content }) => ({ role, content })) }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error ?? "تعذّر"); setTurns(turns); setInput(q); }
      else setTurns([...next, { role: "assistant", content: data.answer, tools: data.tools }]);
    } catch {
      setErr("تعذّر الاتصال."); setTurns(turns); setInput(q);
    }
    setBusy(false);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
      <section className="flex min-h-[60vh] flex-col rounded-lg border border-gray-200 bg-white">
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {turns.length === 0 && (
            <p className="py-10 text-center text-sm text-gray-400">اسأل عن أداء الحملات والقنوات والمشاريع، أو اطلب نصّاً تسويقياً. الأمثلة على الجانب.</p>
          )}
          {turns.map((t, i) => (
            <div key={i} className={t.role === "user" ? "flex justify-start" : "flex justify-end"}>
              <div className={`max-w-[90%] rounded-xl px-4 py-3 text-sm ${t.role === "user" ? "bg-brand-600 text-white" : "border border-gray-200 bg-gray-50 text-gray-800"}`}>
                {t.role === "assistant" ? <Markdown text={t.content} /> : <p className="whitespace-pre-wrap">{t.content}</p>}
                {t.tools && t.tools.length > 0 && (
                  <p className="mt-2 border-t pt-1 text-[11px] text-gray-400">من القاعدة: {Array.from(new Set(t.tools)).join("، ")}</p>
                )}
              </div>
            </div>
          ))}
          {busy && <p className="text-end text-sm text-gray-400">يقرأ الأرقام ويفكّر…</p>}
          <div ref={end} />
        </div>
        {err && <p className="border-t bg-red-50 px-4 py-2 text-sm text-red-700">{err}</p>}
        <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-end gap-2 border-t p-3">
          <select value={mode} onChange={(e) => setMode(e.target.value as "سؤال" | "توليد")} className="rounded border px-2 py-2 text-sm">
            <option value="سؤال">سؤال عن الأرقام</option>
            <option value="توليد">توليد محتوى</option>
          </select>
          <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="اكتب سؤالك…" className="flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          <button disabled={busy || !input.trim()} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">أرسل</button>
        </form>
      </section>
      <aside className="space-y-4 text-sm">
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="mb-2 text-xs font-semibold text-gray-500">أسئلة</p>
          {ASK.map((q) => <button key={q} type="button" onClick={() => { setMode("سؤال"); send(q); }} className="mb-1 block w-full rounded px-2 py-1 text-start text-gray-700 hover:bg-brand-50">{q}</button>)}
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="mb-2 text-xs font-semibold text-gray-500">توليد — عدّل اسم المشروع ثم أرسل</p>
          {GENERATE.map((q) => <button key={q} type="button" onClick={() => { setMode("توليد"); setInput(q); }} className="mb-1 block w-full rounded px-2 py-1 text-start text-gray-700 hover:bg-brand-50">{q}</button>)}
        </div>
      </aside>
    </div>
  );
}

// ماركداون مصغّر: عناوين، قوائم، غامق، جداول. يُبنى عناصرَ React لا HTML ملصقاً.
function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let i = 0;
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, k) =>
    p.startsWith("**") && p.endsWith("**") ? <b key={k}>{p.slice(2, -2)}</b> : <span key={k}>{p}</span>);
  while (i < lines.length) {
    const l = lines[i];
    if (l.trim().startsWith("|") && lines[i + 1]?.trim().match(/^\|?\s*:?-{2,}/)) {
      const rows: string[][] = [];
      const cells = (s: string) => s.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = cells(l);
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) { rows.push(cells(lines[i])); i++; }
      out.push(
        <div key={`t${i}`} className="my-2 overflow-x-auto">
          <table className="w-full text-xs"><thead><tr>{head.map((h, k) => <th key={k} className="border-b px-2 py-1 text-start font-semibold">{inline(h)}</th>)}</tr></thead>
            <tbody>{rows.map((r, k) => <tr key={k}>{r.map((c, m) => <td key={m} className="border-b border-gray-100 px-2 py-1">{inline(c)}</td>)}</tr>)}</tbody></table>
        </div>
      );
      continue;
    }
    if (/^#{1,4}\s/.test(l)) out.push(<p key={i} className="mt-2 font-bold">{inline(l.replace(/^#+\s/, ""))}</p>);
    else if (/^\s*[-*•]\s/.test(l)) out.push(<p key={i} className="ps-3">• {inline(l.replace(/^\s*[-*•]\s/, ""))}</p>);
    else if (/^\s*\d+[.)]\s/.test(l)) out.push(<p key={i} className="ps-3">{inline(l.trim())}</p>);
    else if (l.trim() === "") out.push(<div key={i} className="h-2" />);
    else out.push(<p key={i}>{inline(l)}</p>);
    i++;
  }
  return <div className="space-y-0.5 leading-relaxed">{out}</div>;
}
