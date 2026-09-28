"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Hit = { id: string; name: string; phone: string | null; stage: string | null; created_at: string };

// البحث عن البطاقة الأخرى حين لا يلتقطها الكشف الآلي (رقمان مختلفان
// واسمٌ مكتوب بطريقتين). يبحث فيما تراه وحده — RLS تسري.
export default function MergeSearch({ clientId }: { clientId: string }) {
  const supabase = createClient();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // الفاصلة والأقواس لها معنى في مُرشِّح or() — تُحذف من النصّ
    const term = q.replace(/[,()%*]/g, " ").trim();
    if (term.length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      setBusy(true);
      const { data } = await supabase
        .from("clients")
        .select("id,name,phone,stage,created_at")
        .or(`name.ilike.%${term}%,phone.ilike.%${term}%`)
        .neq("id", clientId)
        .order("created_at", { ascending: false })
        .limit(10);
      setBusy(false);
      setHits((data ?? []) as Hit[]);
    }, 300);
    return () => clearTimeout(t);
  }, [q, clientId]);

  return (
    <div>
      <h2 className="mb-2 font-semibold text-gray-800">أو ابحث عن البطاقة الأخرى</h2>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="الاسم أو جزء من الرقم"
        className="w-full rounded-lg border border-gray-300 px-4 py-2.5 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
      />
      {busy && <p className="mt-2 text-xs text-gray-400">يبحث…</p>}
      {hits.length > 0 && (
        <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          {hits.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
              <div>
                <p className="font-medium text-gray-800">{h.name}</p>
                <p className="text-xs text-gray-500">
                  <span dir="ltr">{h.phone ?? "—"}</span> · {h.stage ?? "ليد"} · منذ {h.created_at.slice(0, 10)}
                </p>
              </div>
              <Link
                href={`/dashboard/clients/${clientId}/merge?with=${h.id}`}
                className="rounded-lg border border-brand-300 px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-50"
              >
                قارن
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
