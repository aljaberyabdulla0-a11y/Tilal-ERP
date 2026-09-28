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
//   قارن وادمج    يفتح شاشة الدمج (sql/104): البطاقتان جنباً إلى جنب،
//                 واختيار الباقية وكل حقل مختلف. الشاشة نفسها التي
//                 يستعملها الموظف — فلا دمجان بقاعدتين.
//   ليسا واحداً   قرار بشري يُسجَّل باسم صاحبه فلا يعود الزوج يظهر.
//   تجاهل         الآن لا أريد القرار — يبقى في السجلّ بلا إزعاج.
//
// لا زرّ «دمج الكل». الدمج فعل لا يُتراجع عنه آلياً (نقلٌ لا محو،
// لكن الفصل بعده يدوي)، فيُوقَّع زوجاً زوجاً.
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

  if (pairs.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
        <p className="mt-2 text-sm text-gray-400">لا أزواج.</p>
      </div>
    );
  }

  // الأقدم أولاً في الرابط: شاشة الدمج تقترحه باقياً افتراضياً
  function mergeHref(p: DuplicatePair): string {
    const [first, second] =
      p.a && p.b && p.b.created_at < p.a.created_at ? [p.client_b, p.client_a] : [p.client_a, p.client_b];
    return `/dashboard/clients/${first}/merge?with=${second}`;
  }

  async function resolve(p: DuplicatePair, status: "ليسا واحداً" | "مُتجاهَل") {
    setBusy(p.id);
    setErr(null);
    const { error } = await supabase.rpc("resolve_client_duplicate", {
      p_a: p.client_a,
      p_b: p.client_b,
      p_status: status,
    });
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
        {pairs.map((p) => (
          <li key={p.id} className="p-4">
            {p.requested_by_name && (
              <p className="mb-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">
                طلبه {p.requested_by_name}
                {p.requested_at && ` في ${p.requested_at.slice(0, 10)}`}
                {p.request_note && <>: «{p.request_note}»</>}
              </p>
            )}
            <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr_auto]">
              <Side c={p.a} />
              <div className="flex flex-col items-center justify-center text-xs text-gray-500">
                <span className="rounded-full bg-gray-100 px-2 py-0.5">{p.match_on}</span>
                {p.similarity !== null && <span className="mt-1">{Math.round(Number(p.similarity) * 100)}%</span>}
              </div>
              <Side c={p.b} />
              {canMerge && (
                <div className="flex flex-row items-center gap-2 md:flex-col md:items-stretch">
                  {p.a && p.b && (
                    <Link
                      href={mergeHref(p)}
                      className="rounded bg-brand-600 px-3 py-1.5 text-center text-xs font-semibold text-white hover:bg-brand-700"
                    >
                      قارن وادمج
                    </Link>
                  )}
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
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Side({ c }: { c: DuplicatePair["a"] }) {
  if (!c) return <p className="text-sm text-gray-400">عميل غير متاح لك</p>;
  return (
    <div className="rounded-lg border border-gray-200 p-3 text-sm">
      <Link href={`/dashboard/clients/${c.id}`} className="font-medium text-brand-700 hover:underline">
        {c.name}
      </Link>
      <p className="text-gray-600" dir="ltr">
        {c.phone ?? "—"}
      </p>
      <p className="text-xs text-gray-400">
        {c.stage} · أُنشئ {c.created_at.slice(0, 10)}
      </p>
    </div>
  );
}
