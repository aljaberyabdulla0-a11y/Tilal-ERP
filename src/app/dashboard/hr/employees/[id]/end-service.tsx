"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Employee } from "@/lib/types";

// ============================================================
// إنهاء خدمة موظف وتسليم ملفاته.
//
// الخروج بلا تسليم يُجمّد عملاء الموظف: ملفاتهم باسمه فلا يراها
// أحد، ومتابعاتهم تتوقّف. لذلك الشاشة **تُلزم باختيار خَلَف** —
// لا زرّ «إنهاء» وحده.
//
// والتنفيذ نداء واحد لدالة في القاعدة، لا سلسلة تحديثات من هنا:
// انقطاع الشبكة في المنتصف كان سيترك نصف العملاء منقولين ونصفهم
// معلّقاً باسم من غادر (sql/045).
// ============================================================
export default function EndService({
  employee,
  candidates,
}: {
  employee: Employee;
  candidates: Employee[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const [toId, setToId] = useState("");
  const [note, setNote] = useState("");
  const [revoke, setRevoke] = useState(true);

  const ended = employee.status !== "active";

  async function run() {
    setErr(null);
    if (!toId) {
      setErr("اختر الموظف الذي سيستلم الملفات — الإنهاء بلا تسليم يوقف متابعة عملائه.");
      return;
    }

    const to = candidates.find((c) => c.id === toId);
    if (
      !window.confirm(
        `إنهاء خدمة ${employee.full_name} ونقل كل عملائه ومهامّه المفتوحة وحجوزاته القائمة إلى ${to?.full_name}؟` +
          (revoke ? "\n\nوسيُغلق حسابه فلا يستطيع الدخول." : ""),
      )
    ) {
      return;
    }

    setBusy(true);
    const { data, error } = await supabase.rpc("handover_employee", {
      p_from: employee.id,
      p_to: toId,
      p_note: note.trim() || null,
      p_end_service: true,
      p_revoke_access: revoke,
    });
    setBusy(false);

    if (error) {
      setErr(error.message);
      return;
    }

    const r = data as {
      clients: number;
      tasks: number;
      reservations: number;
      to: string;
    };
    setDone(
      `انتقل ${r.clients} عميلاً و${r.tasks} مهمة و${r.reservations} حجزاً إلى ${r.to}.`,
    );
    setOpen(false);
    router.refresh();
  }

  async function reactivate() {
    if (
      !window.confirm(
        `إعادة تفعيل ${employee.full_name}؟ سيُفتح حسابه ويعود على رأس العمل.\n\nملاحظة: الملفات التي سُلّمت لا تعود إليه — تُنقل بتسليم عكسي إن أردت.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc("reactivate_employee", {
      p_employee: employee.id,
    });
    setBusy(false);
    if (error) setErr(error.message);
    else router.refresh();
  }

  const input =
    "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

  if (ended) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-gray-200 px-3 py-1 text-xs font-medium text-gray-600">
          انتهت الخدمة
          {employee.end_date ? ` · ${employee.end_date}` : ""}
        </span>
        <button
          onClick={reactivate}
          disabled={busy}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-50"
        >
          إعادة تفعيل
        </button>
        {err && <span className="text-xs text-red-600">{err}</span>}
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50"
      >
        إنهاء الخدمة وتسليم الملفات
      </button>

      {done && (
        <p className="w-full rounded-lg bg-green-50 p-2 text-xs text-green-700">
          {done}
        </p>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => !busy && setOpen(false)}
          />
          <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="mb-1 text-lg font-bold text-brand-700">
              إنهاء خدمة {employee.full_name}
            </h3>
            <p className="mb-4 text-sm text-gray-500">
              اختر من يستلم ملفاته حتى لا تتوقّف متابعة عملائه.
            </p>

            <label className="mb-1 block text-xs font-medium text-gray-600">
              يستلم الملفات *
            </label>
            <select
              value={toId}
              onChange={(e) => setToId(e.target.value)}
              className={input + " mb-4"}
            >
              <option value="">— اختر موظفاً —</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name}
                  {c.job_title ? ` — ${c.job_title}` : ""}
                </option>
              ))}
            </select>

            <div className="mb-4 rounded-xl bg-gray-50 p-3 text-xs text-gray-600">
              <b className="text-gray-800">ما ينتقل:</b> العملاء المسندون إليه،
              والمهام غير المنجزة، والحجوزات القائمة.
              <br />
              <b className="text-gray-800">ما يبقى له:</b> سجلّ تواصله مع
              العملاء، وعمولاته ورواتبه — استُحقّت له ولا تُنقل.
              <br />
              <b className="text-gray-800">ما لا يُمسّ:</b> ليدات الشركات
              الوسيطة، فهي ملك الشركة لا الموظف.
            </div>

            <label className="mb-1 block text-xs font-medium text-gray-600">
              السبب / ملاحظة
            </label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="استقالة، نهاية عقد، …"
              className={input + " mb-3"}
            />

            <label className="mb-4 flex items-start gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={revoke}
                onChange={(e) => setRevoke(e.target.checked)}
                className="mt-0.5 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
              />
              <span>
                إغلاق حسابه
                <span className="block text-xs text-gray-500">
                  يُمنع من الدخول فوراً. أبقِه مفتوحاً فقط إن كان سيعود قريباً.
                </span>
              </span>
            </label>

            {err && (
              <p className="mb-3 rounded-lg bg-red-50 p-2 text-xs text-red-700">
                {err}
              </p>
            )}

            <div className="flex items-center gap-2">
              <button
                onClick={run}
                disabled={busy}
                className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
              >
                {busy ? "جارٍ التسليم…" : "إنهاء الخدمة ونقل الملفات"}
              </button>
              <button
                onClick={() => setOpen(false)}
                disabled={busy}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
