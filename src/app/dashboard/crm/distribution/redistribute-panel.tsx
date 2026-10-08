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
  focusOwner,
  focusAct,
  canMove,
}: {
  owners: OwnerLoad[];
  unworked: UnworkedLead[];
  // من أزرار التنبيهات (page.tsx): الحالة الأولى تُقرأ منها مرّة
  focusOwner: string | null;
  focusAct: "unworked" | "move" | "handover" | null;
  canMove: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();

  const focused = owners.find((o) => o.owner_id === focusOwner);
  const moving = focusAct === "move" || focusAct === "handover";

  const [fromOwner, setFromOwner] = useState(moving && focused ? focused.owner_id : "");
  const [toOwners, setToOwners] = useState<string[]>([]);
  // العدد المقترح = كل ما يُنقل بهذا الإعداد، لا رقم ثابت يُنسى تعديله
  const [limit, setLimit] = useState(
    moving && focused
      ? String(focusAct === "handover" ? focused.open_leads : focused.never_contacted)
      : "25"
  );
  const [onlyUnworked, setOnlyUnworked] = useState(focusAct !== "handover");
  const [listOwner, setListOwner] = useState<string | null>(focused ? focused.owner_id : null);
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

  const listed = listOwner ? unworked.filter((u) => u.owner_id === listOwner) : unworked;
  const listOwnerName = owners.find((o) => o.owner_id === listOwner)?.owner_name;
  const batch = listOwner ? batchShape(listed) : null;

  // اختيار «من» يُسقطه من المستلمين: شريحته تختفي من القائمة، فلو بقي
  // مختاراً لما رآه المستخدم ولا استطاع إلغاءه.
  const pickFrom = (id: string) => {
    setFromOwner(id);
    setToOwners((prev) => prev.filter((x) => x !== id));
  };

  const toggleTarget = (id: string) =>
    setToOwners((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  async function run() {
    setError(null);
    setResult(null);

    if (!fromOwner) return setError("اختر الموظف المنقول منه.");
    if (toOwners.length === 0) return setError("اختر موظفاً واحداً على الأقل للاستلام.");
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
      {/* المشرف يرى القائمة ولا ينقل: النموذج يُخفى بدل أن يرفضه الخادم */}
      {canMove && (
      <div
        id="redistribute"
        className={`scroll-mt-4 ${moving ? "-m-2 rounded-lg p-2 ring-2 ring-brand-500" : ""}`}
      >
      <h2 className="font-bold text-gray-800">إعادة توزيع</h2>
      <p className="mt-1 text-sm text-gray-500">
        كل نقل يُسجَّل باسمك وسببه في تاريخ ملكية الليد.
      </p>
      {moving && focused && (
        <p className="mt-2 rounded-lg bg-brand-50 p-3 text-sm text-brand-700">
          {focusAct === "handover"
            ? `تسليم عهدة «${focused.owner_name}»: كل ليداته المفتوحة (${focused.open_leads}). اختر المستلمين واذكر السبب.`
            : `نقل ما لم يُشتغَل عليه من ليدات «${focused.owner_name}» (${focused.never_contacted}). اختر المستلمين واذكر السبب.`}
        </p>
      )}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {/* من */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">النقل من</label>
          <select
            value={fromOwner}
            onChange={(e) => pickFrom(e.target.value)}
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
      </div>
      )}

      {/* ===== الليدات غير المُشتغَل عليها ===== */}
      <div id="unworked" className={`scroll-mt-4 ${canMove ? "mt-8" : ""}`}>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-bold text-gray-800">
            لم يُشتغَل عليها
            <span className="ms-2 text-sm font-normal text-gray-500">({listed.length})</span>
          </h3>
          {listOwner && (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-3 py-1 text-xs text-brand-700">
              ليدات «{listOwnerName}» فقط
              <button
                type="button"
                onClick={() => setListOwner(null)}
                className="ms-1 font-bold hover:text-brand-900"
                aria-label="عرض الكل"
              >
                ×
              </button>
            </span>
          )}
        </div>

        {/* «افحص إن كانت دفعة مستوردة» — الفحص نفسه هنا لا في ذهن القارئ:
            متى أُسندت ومن أي مصدر؟ يومٌ واحد يجمع أغلبها = خلل توزيع. */}
        {batch && batch.groups.length > 0 && (
          <div
            className={`mt-3 rounded-lg border p-3 text-sm ${
              batch.isBatch
                ? "border-amber-300 bg-amber-50 text-amber-900"
                : "border-red-200 bg-red-50 text-red-800"
            }`}
          >
            <p className="font-bold">
              {batch.isBatch
                ? `دفعة واحدة: ${batch.topCount} من ${listed.length} أُسندت يوم ${batch.topDay} — خلل توزيع قبل أن يكون تقصيراً.`
                : `أُسندت متفرّقة على ${batch.days} يوماً — ليست دفعة مستوردة؛ هذا عملٌ لم يُنجز.`}
            </p>
            <ul className="mt-2 space-y-0.5 text-xs">
              {batch.groups.slice(0, 5).map((g) => (
                <li key={`${g.day}-${g.source}`}>
                  {g.day} · {g.source} · <span className="font-semibold">{g.count}</span> ليداً
                </li>
              ))}
            </ul>
            {canMove && (
              <button
                type="button"
                onClick={() => {
                  pickFrom(listOwner as string);
                  setOnlyUnworked(true);
                  setLimit(String(listed.length));
                  document.getElementById("redistribute")?.scrollIntoView({ behavior: "smooth" });
                }}
                className="mt-3 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700"
              >
                أعد توزيعها ↑
              </button>
            )}
          </div>
        )}

        {listed.length === 0 ? (
          <p className="mt-3 rounded-lg border border-gray-200 px-4 py-6 text-center text-sm text-gray-400">
            لا ليدات مهمَلة منذ الإسناد.
          </p>
        ) : (
          <div className="mt-3 max-h-96 overflow-auto rounded-lg border border-gray-200">
            <table className="w-full text-right text-sm">
              <thead className="sticky top-0 bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-2 font-medium">العميل</th>
                  <th className="px-4 py-2 font-medium">الهاتف</th>
                  <th className="px-4 py-2 font-medium">المرحلة</th>
                  <th className="px-4 py-2 font-medium">المصدر</th>
                  <th className="px-4 py-2 font-medium">المالك</th>
                  <th className="px-4 py-2 font-medium">أُسند في</th>
                  <th className="px-4 py-2 font-medium">منذ الإسناد</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {listed.slice(0, 200).map((u) => (
                  <tr key={u.client_id}>
                    <td className="px-4 py-2">
                      <a
                        href={`/dashboard/clients/${u.client_id}`}
                        className="font-medium text-brand-600 hover:underline"
                      >
                        {u.client_name}
                      </a>
                    </td>
                    <td className="px-4 py-2 text-gray-600" dir="ltr">
                      {u.phone ? (
                        <a href={`tel:${u.phone}`} className="hover:text-brand-600 hover:underline">
                          {u.phone}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-2 text-gray-600">{u.stage}</td>
                    <td className="px-4 py-2 text-gray-500">{u.source ?? "—"}</td>
                    <td className="px-4 py-2 text-gray-600">{u.owner_name ?? "بلا مالك"}</td>
                    <td className="px-4 py-2 text-xs text-gray-500">{baghdadDay(u.assigned_at)}</td>
                    <td className="px-4 py-2 font-semibold text-red-700">
                      {u.days_since_assignment} يوماً
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {listed.length > 200 && (
              <p className="border-t border-gray-200 px-4 py-2 text-xs text-gray-500">
                تُعرض ٢٠٠ من {listed.length} — أعد التوزيع على دفعات.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

const baghdadDay = (ts: string) =>
  new Date(ts).toLocaleDateString("en-CA", { timeZone: "Asia/Baghdad" });

// شكل الدفعة: كم ليداً أُسند في كل يوم ومن أي مصدر. يومٌ واحد يحمل
// النصف فأكثر = دفعة أُسندت جملةً (نفس عتبة تنبيه unworked_batch).
function batchShape(leads: UnworkedLead[]) {
  const map = new Map<string, { day: string; source: string; count: number }>();
  const perDay = new Map<string, number>();
  for (const u of leads) {
    const day = baghdadDay(u.assigned_at);
    const source = u.source ?? "بلا مصدر";
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
    const k = `${day}|${source}`;
    const g = map.get(k) ?? { day, source, count: 0 };
    g.count += 1;
    map.set(k, g);
  }
  const groups = Array.from(map.values()).sort((a, b) => b.count - a.count);
  // الحكم باليوم وحده: يومٌ واحد بمصدرين ما زال دفعة واحدة
  const [topDay, topCount] =
    Array.from(perDay.entries()).sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  const isBatch = topCount * 2 >= leads.length && leads.length > 0;
  return { groups, days: perDay.size, topDay, topCount, isBatch };
}
