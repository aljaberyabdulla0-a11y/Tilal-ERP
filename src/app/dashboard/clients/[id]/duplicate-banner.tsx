"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { ClientMatch } from "@/lib/crm";
import ClientMatchList from "@/components/client-match-list";

// ============================================================
// «يبدو أن هذا الشخص مسجّل في بطاقة أخرى» — أعلى صفحة العميل (104).
//
// الرقم نفسه أو البديل: تنبيهٌ ظاهر. تشابه الاسم وحده: سطرٌ مطويّ —
// «محمد علي» اسمٌ لعشرات، وتنبيهٌ دائم على كل واحد منهم يُعلِّم
// الموظفين تجاهل التنبيه كلّه.
//
// «ليسا الشخص نفسه» يُسجَّل فلا يعود التنبيه للزوج نفسه.
// ============================================================
export default function DuplicateBanner({ clientId, matches }: { clientId: string; matches: ClientMatch[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [showNames, setShowNames] = useState(false);

  const strong = matches.filter((m) => m.match_type !== "مرشّح");
  const names = matches.filter((m) => m.match_type === "مرشّح");
  if (matches.length === 0) return null;

  async function notSame(m: ClientMatch) {
    setBusy(m.id);
    setMsg(null);
    const { error } = await supabase.rpc("resolve_client_duplicate", {
      p_a: clientId,
      p_b: m.id,
      p_status: "ليسا واحداً",
    });
    setBusy(null);
    if (error) return setMsg(error.message);
    router.refresh();
  }

  async function request(m: ClientMatch) {
    setBusy(m.id);
    setMsg(null);
    const { error } = await supabase.rpc("request_client_merge", { p_a: clientId, p_b: m.id, p_note: null });
    setBusy(null);
    setMsg(error ? error.message : `وصل طلب دمج «${m.name}» إلى الإدارة ومدير المتابعة.`);
  }

  const actions = (m: ClientMatch) =>
    m.can_merge ? (
      <>
        <Link
          href={`/dashboard/clients/${clientId}/merge?with=${m.id}`}
          className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
        >
          قارن وادمج
        </Link>
        <button
          type="button"
          disabled={busy === m.id}
          onClick={() => notSame(m)}
          className="rounded-lg px-2 py-1.5 text-xs text-gray-500 hover:text-gray-800 disabled:opacity-50"
        >
          ليسا الشخص نفسه
        </button>
      </>
    ) : (
      <button
        type="button"
        disabled={busy === m.id}
        onClick={() => request(m)}
        className="rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
      >
        اطلب الدمج
      </button>
    );

  return (
    <div className="px-6 pt-4">
      <div
        className={`space-y-2 rounded-2xl border p-4 ${
          strong.length > 0 ? "border-amber-300 bg-amber-50" : "border-gray-200 bg-white"
        }`}
      >
        {strong.length > 0 && (
          <>
            <p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
              <span className="material-symbols-outlined text-[20px]">content_copy</span>
              يبدو أن هذا الشخص مسجّل في {strong.length === 1 ? "بطاقة أخرى" : `${strong.length} بطاقات أخرى`} — ادمجها
              ليجتمع تاريخه في مكان واحد:
            </p>
            <ClientMatchList matches={strong} actions={actions} />
          </>
        )}

        {names.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setShowNames((v) => !v)}
              className="text-xs text-gray-500 hover:text-gray-800"
            >
              {showNames ? "▾" : "▸"} {names.length} بطاقة باسمٍ مشابه — قد تكون للشخص نفسه برقم آخر
            </button>
            {showNames && (
              <div className="mt-2">
                <ClientMatchList matches={names} actions={actions} />
              </div>
            )}
          </div>
        )}

        {msg && <p className="text-xs text-gray-700">{msg}</p>}
      </div>
    </div>
  );
}
