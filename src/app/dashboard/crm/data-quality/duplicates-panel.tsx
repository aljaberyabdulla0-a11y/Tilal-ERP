"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { DuplicatePair } from "@/lib/crm";

// ============================================================
// أزواج التكرار — والقرار لكل زوج على حدة.
//
// ثلاثة قرارات:
//   دمج          يُبقي واحداً وينقل إليه كل ما للآخر (merge_clients).
//                 المحفوظ افتراضياً هو الأقدم — تاريخه أطول وسجلّاته
//                 أكثر — ويمكن عكسه.
//   ليسا واحداً   قرار بشري يُسجَّل باسم صاحبه فلا يعود الزوج يظهر.
//   تجاهل         الآن لا أريد القرار — يبقى في السجلّ بلا إزعاج.
//
// لا زرّ «دمج الكل». الدمج فعل لا يُتراجع عنه (نقلٌ لا محو، لكن
// الفصل بعده يدوي)، فيُوقَّع زوجاً زوجاً.
// ============================================================
export default function DuplicatesPanel({
  title,
  pairs,
  canMerge,
}: {
  title: string;
  pairs: DuplicatePair[];
  canMerge: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [keepSide, setKeepSide] = useState<Record<string, "a" | "b">>({});

  if (pairs.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
        <p className="mt-2 text-sm text-gray-400">لا أزواج.</p>
      </div>
    );
  }

  function keepOf(p: DuplicatePair): "a" | "b" {
    if (keepSide[p.id]) return keepSide[p.id];
    // الأقدم يُحفظ افتراضياً
    if (p.a && p.b) return p.a.created_at <= p.b.created_at ? "a" : "b";
    return "a";
  }

  async function merge(p: DuplicatePair) {
    if (!p.a || !p.b) return;
    const keep = keepOf(p) === "a" ? p.a : p.b;
    const gone = keepOf(p) === "a" ? p.b : p.a;
    if (
      !confirm(
        `سيُدمَج «${gone.name}» في «${keep.name}» وتُنقل إليه أنشطته وفرصه وحجوزاته. لا تراجع آلي. متابعة؟`
      )
    )
      return;

    setBusy(p.id);
    setErr(null);
    const { error } = await supabase.rpc("merge_clients", { p_keep_id: keep.id, p_merge_id: gone.id });
    if (!error) {
      await supabase
        .from("client_duplicates")
        .update({ status: "مدموج", resolved_at: new Date().toISOString() })
        .eq("id", p.id);
    }
    setBusy(null);
    if (error) return setErr(error.message);
    router.refresh();
  }

  async function resolve(p: DuplicatePair, status: "ليسا واحداً" | "مُتجاهَل") {
    setBusy(p.id);
    setErr(null);
    const { error } = await supabase
      .from("client_duplicates")
      .update({ status, resolved_at: new Date().toISOString() })
      .eq("id", p.id);
    setBusy(null);
    if (error) return setErr(error.message);
    router.refresh();
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
        <span className="text-xs text-gray-400">{pairs.length} زوجاً</span>
      </div>
      {err && <p className="border-b bg-red-50 px-4 py-2 text-xs text-red-700">{err}</p>}
      <ul className="divide-y divide-gray-100">
        {pairs.map((p) => {
          const k = keepOf(p);
          return (
            <li key={p.id} className="grid gap-3 p-4 md:grid-cols-[1fr_auto_1fr_auto]">
              <Side
                c={p.a}
                keep={k === "a"}
                onKeep={() => setKeepSide((s) => ({ ...s, [p.id]: "a" }))}
                canMerge={canMerge}
              />
              <div className="flex flex-col items-center justify-center text-xs text-gray-500">
                <span className="rounded-full bg-gray-100 px-2 py-0.5">{p.match_on}</span>
                {p.similarity !== null && <span className="mt-1">{Math.round(Number(p.similarity) * 100)}%</span>}
              </div>
              <Side
                c={p.b}
                keep={k === "b"}
                onKeep={() => setKeepSide((s) => ({ ...s, [p.id]: "b" }))}
                canMerge={canMerge}
              />
              {canMerge && (
                <div className="flex flex-row items-center gap-2 md:flex-col md:items-stretch">
                  <button
                    type="button"
                    disabled={busy === p.id || !p.a || !p.b}
                    onClick={() => merge(p)}
                    className="rounded bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                  >
                    ادمج في المحفوظ
                  </button>
                  <button
                    type="button"
                    disabled={busy === p.id}
                    onClick={() => resolve(p, "ليسا واحداً")}
                    className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:border-gray-500 disabled:opacity-50"
                  >
                    ليسا واحداً
                  </button>
                  <button
                    type="button"
                    disabled={busy === p.id}
                    onClick={() => resolve(p, "مُتجاهَل")}
                    className="rounded px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 disabled:opacity-50"
                  >
                    تجاهل
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Side({
  c,
  keep,
  onKeep,
  canMerge,
}: {
  c: DuplicatePair["a"];
  keep: boolean;
  onKeep: () => void;
  canMerge: boolean;
}) {
  if (!c) return <p className="text-sm text-gray-400">عميل غير متاح لك</p>;
  return (
    <div className={`rounded-lg border p-3 text-sm ${keep ? "border-brand-300 bg-brand-50" : "border-gray-200"}`}>
      <div className="flex items-center justify-between gap-2">
        <Link href={`/dashboard/clients/${c.id}`} className="font-medium text-brand-700 hover:underline">
          {c.name}
        </Link>
        {canMerge && (
          <label className="flex items-center gap-1 text-xs text-gray-500">
            <input type="radio" checked={keep} onChange={onKeep} />
            يُحفظ
          </label>
        )}
      </div>
      <p className="text-gray-600" dir="ltr">
        {c.phone ?? "—"}
      </p>
      <p className="text-xs text-gray-400">
        {c.stage} · أُنشئ {c.created_at.slice(0, 10)}
      </p>
    </div>
  );
}
