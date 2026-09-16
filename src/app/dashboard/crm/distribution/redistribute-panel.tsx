"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { OwnerLoad, UnworkedLead } from "@/lib/crm";

// ============================================================
// إعادة التوزيع.
//
// الفكرة التي يجب أن تصل من الشاشة نفسها قبل أي شرح:
//
//     لا يُنقل إلا ما لم يُشتغَل عليه.
//
// سحبُ ليد بدأ صاحبه العمل عليه يُضيّع علاقةً بُنيت ويُربك العميل
// حين يتصل به شخص ثانٍ يسأله ما سُئل عنه. ولهذا الخيار الافتراضي
// مقفل على «غير المُشتغَل»، وفتحُه يُظهر تحذيراً — لا يُمنع، لأن
// تسليم العهدة عند ترك الموظف حالةٌ مشروعة.
//
// والنقل يمرّ بـ assign_client() في القاعدة لا بتحديث مباشر: فيخضع
// لفحص الصلاحية، ويُكتب له صفٌّ في client_assignments بسببه. لا نقل
// جماعي بلا أثر فردي لكل ليد.
// ============================================================
export default function RedistributePanel({
  owners,
  unworked,
}: {
  owners: OwnerLoad[];
  unworked: UnworkedLead[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const [fromOwner, setFromOwner] = useState("");
  const [toOwners, setToOwners] = useState<string[]>([]);
  const [limit, setLimit] = useState("25");
  const [onlyUnworked, setOnlyUnworked] = useState(true);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // كم ليداً قابلاً للنقل عند هذا الموظف بالإعداد الحالي؟
  const source = owners.find((o) => o.owner_id === fromOwner);
  const available = source
    ? onlyUnworked
      ? Number(source.never_contacted)
      : Number(source.open_leads)
    : 0;

  const toggleTarget = (id: string) =>
    setToOwners((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  async function run() {
    setError(null);
    setResult(null);

    if (!fromOwner) return setError("اختر الموظف المنقول منه.");
    if (toOwners.length === 0) return setError("اختر موظفاً واحداً على الأقل للاستلام.");
    if (toOwners.includes(fromOwner))
      return setError("لا يُنقل الموظف إلى نفسه — اختر مستلمين آخرين.");
    if (!reason.trim())
      return setError("اذكر سبب النقل — نقلٌ بلا سبب لا يُراجَع لاحقاً.");

    setBusy(true);
    const { data, error: rpcError } = await supabase.rpc("redistribute_leads", {
      p_from_owner_id: fromOwner,
      p_to_owner_ids: toOwners,
      p_limit: Number(limit) || 0,
      p_only_unworked: onlyUnworked,
      p_reason: reason.trim(),
    });
    setBusy(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setResult(`نُقل ${data ?? 0} ليداً، وسُجّل لكلٍّ منها صفٌّ في تاريخ الإسناد.`);
    setReason("");
    router.refresh();
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="font-bold text-gray-800">إعادة توزيع</h2>
      <p className="mt-1 text-sm text-gray-500">
        كل نقل يُسجَّل باسمك وسببه في تاريخ ملكية الليد.
      </p>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {/* من */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">النقل من</label>
          <select
            value={fromOwner}
            onChange={(e) => setFromOwner(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">— اختر الموظف —</option>
            {owners.map((o) => (
              <option key={o.owner_id} value={o.owner_id}>
                {o.owner_name} — {o.open_leads} مفتوح، {o.never_contacted} بلا تواصل
              </option>
            ))}
          </select>
        </div>

        {/* العدد */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            العدد الأقصى
            {source && (
              <span className="ms-2 text-xs font-normal text-gray-500">
                (المتاح للنقل: {available})
              </span>
            )}
          </label>
          <input
            type="number"
            min={1}
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      {/* إلى */}
      <div className="mt-4">
        <label className="mb-2 block text-sm font-medium text-gray-700">
          التوزيع على (بالتناوب)
        </label>
        <div className="flex flex-wrap gap-2">
          {owners
            .filter((o) => o.owner_id !== fromOwner)
            .map((o) => {
              const on = toOwners.includes(o.owner_id);
              return (
                <button
                  key={o.owner_id}
                  type="button"
                  onClick={() => toggleTarget(o.owner_id)}
                  className={
                    on
                      ? "rounded-full bg-brand-600 px-3 py-1.5 text-sm text-white"
                      : "rounded-full border border-gray-300 px-3 py-1.5 text-sm text-gray-600 transition hover:border-brand-600 hover:text-brand-600"
                  }
                >
                  {o.owner_name}
                  <span className="ms-1.5 text-xs opacity-70">({o.open_leads})</span>
                </button>
              );
            })}
        </div>
      </div>

      {/* السبب */}
      <div className="mt-4">
        <label className="mb-1 block text-sm font-medium text-gray-700">سبب النقل</label>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="مثال: إعادة توزيع دفعة الاستيراد التي لم تُوزَّع"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
      </div>

      {/* الحارس */}
      <label className="mt-4 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={onlyUnworked}
          onChange={(e) => setOnlyUnworked(e.target.checked)}
          className="mt-0.5"
        />
        <span className="text-gray-700">
          غير المُشتغَل عليه فقط
          <span className="block text-xs text-gray-500">
            الليدات التي لم يُسجَّل عليها تواصل واحد منذ إسنادها.
          </span>
        </span>
      </label>

      {!onlyUnworked && (
        <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          ⚠️ سيشمل النقل ليدات بدأ صاحبها العمل عليها فعلاً. لا تفعل هذا إلا عند
          تسليم عهدة أو مغادرة موظف — العميل الذي يتصل به شخصان يسألانه نفس الأسئلة
          يفقد الثقة بالشركة كلها.
        </p>
      )}

      {error && (
        <p className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}
      {result && (
        <p className="mt-3 rounded-lg border border-brand-300 bg-brand-50 p-3 text-sm text-brand-700">
          {result}
        </p>
      )}

      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="mt-4 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
      >
        {busy ? "جارٍ النقل…" : "نفّذ إعادة التوزيع"}
      </button>

      {/* ===== الليدات غير المُشتغَل عليها ===== */}
      <div className="mt-8">
        <h3 className="font-bold text-gray-800">
          لم يُشتغَل عليها
          <span className="ms-2 text-sm font-normal text-gray-500">
            ({unworked.length})
          </span>
        </h3>
        {unworked.length === 0 ? (
          <p className="mt-3 rounded-lg border border-gray-200 px-4 py-6 text-center text-sm text-gray-400">
            لا ليدات مهمَلة منذ الإسناد.
          </p>
        ) : (
          <div className="mt-3 max-h-96 overflow-auto rounded-lg border border-gray-200">
            <table className="w-full text-right text-sm">
              <thead className="sticky top-0 bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-2 font-medium">العميل</th>
                  <th className="px-4 py-2 font-medium">المرحلة</th>
                  <th className="px-4 py-2 font-medium">المصدر</th>
                  <th className="px-4 py-2 font-medium">المالك</th>
                  <th className="px-4 py-2 font-medium">منذ الإسناد</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {unworked.slice(0, 200).map((u) => (
                  <tr key={u.client_id}>
                    <td className="px-4 py-2">
                      <a
                        href={`/dashboard/clients/${u.client_id}`}
                        className="font-medium text-brand-600 hover:underline"
                      >
                        {u.client_name}
                      </a>
                    </td>
                    <td className="px-4 py-2 text-gray-600">{u.stage}</td>
                    <td className="px-4 py-2 text-gray-500">{u.source ?? "—"}</td>
                    <td className="px-4 py-2 text-gray-600">{u.owner_name ?? "بلا مالك"}</td>
                    <td className="px-4 py-2 font-semibold text-red-700">
                      {u.days_since_assignment} يوماً
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {unworked.length > 200 && (
              <p className="border-t border-gray-200 px-4 py-2 text-xs text-gray-500">
                تُعرض ٢٠٠ من {unworked.length} — أعد التوزيع على دفعات.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
