"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  ARMS,
  MoneyDirection,
  Partner,
  categoriesFor,
  findCategory,
  formatPrice,
} from "@/lib/types";

// ============================================================
// نموذج تسجيل حركة مالية — مصمَّم لمن لا يعرف المحاسبة إطلاقاً.
// أربعة أسئلة فقط: صرفت أم قبضت؟ كم؟ على شنو؟ مين دفع؟
// وفي الأسفل يشرح النظام بالعربي ماذا سيفعل قبل الحفظ.
// ============================================================
export default function MoveForm({
  partners,
  initialDirection = "صرف",
}: {
  partners: Partner[];
  initialDirection?: MoneyDirection;
}) {
  const router = useRouter();
  const supabase = createClient();
  const today = new Date().toISOString().slice(0, 10);

  const [direction, setDirection] = useState<MoneyDirection>(initialDirection);
  const [category, setCategory] = useState(categoriesFor(initialDirection)[0].label);
  const [amount, setAmount] = useState("");
  const [arm, setArm] = useState<string>("إداري عام");
  const [method, setMethod] = useState<"نقد" | "بنك">("نقد");
  const [payer, setPayer] = useState<string>("company"); // company | معرّف الشريك
  const [description, setDescription] = useState("");
  const [moveDate, setMoveDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cats = categoriesFor(direction);
  const cat = findCategory(direction, category) ?? cats[0];
  const isPartnerRefund = direction === "صرف" && cat.account === "2500";
  const isPartnerDeposit = direction === "قبض" && cat.account === "2500";
  // الشريك مطلوب في: إيداع من شريك، سداد لشريك، أو مصروف دفعه شريك من جيبه
  const needsPartner = isPartnerRefund || isPartnerDeposit;
  const partnerId = payer !== "company" ? payer : null;
  const fromPocket = direction === "صرف" && !!partnerId && !isPartnerRefund;

  function changeDirection(d: MoneyDirection) {
    setDirection(d);
    setCategory(categoriesFor(d)[0].label);
    setPayer("company");
  }

  function changeCategory(label: string) {
    setCategory(label);
    const c = findCategory(direction, label);
    // التصنيفات الخاصة بالشركاء تتطلب اختيار شريك
    if (c?.partnerOnly || c?.account === "2500") {
      if (payer === "company") setPayer(partners[0]?.id ?? "company");
    }
  }

  // شرح بالعربي البسيط لما سيحدث — يجعل المستخدم واثقاً بلا معرفة محاسبية
  function explain(): string {
    const value = amount ? formatPrice(Number(amount)) : "المبلغ";
    const who = partners.find((p) => p.id === partnerId)?.name ?? "";
    if (isPartnerDeposit)
      return `${who} يضيف ${value} إلى صندوق الشركة. سيُحتسب لصالحه عند تصفية الحسابات، ويزيد رصيد الشركة.`;
    if (isPartnerRefund)
      return `الشركة تُرجع ${value} إلى ${who} من ${method === "بنك" ? "البنك" : "الصندوق"}. سينقص ما له عند الشركة بنفس المبلغ.`;
    if (fromPocket)
      return `${who} دفع ${value} من حسابه الخاص على "${category}" في ذراع ${arm}. سيُسجَّل مصروفاً على الشركة، ويصبح ${who} دائناً بهذا المبلغ عند التصفية.`;
    if (direction === "صرف")
      return `الشركة صرفت ${value} على "${category}" في ذراع ${arm} من ${method === "بنك" ? "البنك" : "الصندوق"}. سينقص رصيد الشركة ويزيد إجمالي المصاريف.`;
    return `الشركة قبضت ${value} من "${category}" في ذراع ${arm} إلى ${method === "بنك" ? "البنك" : "الصندوق"}. سيزيد رصيد الشركة والإيرادات.`;
  }

  async function save() {
    setError(null);
    const value = Number(amount);
    if (!value || value <= 0) return setError("اكتب المبلغ أولاً.");
    if (!description.trim()) return setError("اكتب بياناً مختصراً (على شنو صُرف/قُبض؟).");
    if (needsPartner && !partnerId) return setError("اختر الشريك المعني بهذه الحركة.");

    setSaving(true);
    const { error } = await supabase.from("cash_moves").insert({
      move_date: moveDate,
      direction,
      amount: value,
      category,
      account_code: cat.account,
      arm,
      method,
      partner_id: partnerId,
      description: description.trim(),
      notes: notes.trim() || null,
    });
    setSaving(false);

    if (error) return setError("تعذّر الحفظ: " + error.message);
    router.push("/dashboard/accounting/moves");
    router.refresh();
  }

  const input =
    "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";
  const label = "mb-1.5 block text-sm font-medium text-gray-700";

  return (
    <div className="space-y-6">
      {/* 1) صرف أم قبض */}
      <div className="glass-card p-5">
        <p className={label}>١. شنو صار؟</p>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => changeDirection("صرف")}
            className={`rounded-xl border-2 p-4 text-center transition ${
              direction === "صرف"
                ? "border-red-500 bg-red-50 text-red-700"
                : "border-gray-200 text-gray-500 hover:border-gray-300"
            }`}
          >
            <span className="material-symbols-outlined text-3xl">arrow_upward</span>
            <p className="mt-1 font-bold">صرفنا فلوس</p>
            <p className="text-xs opacity-70">مصروف خرج من الشركة</p>
          </button>
          <button
            type="button"
            onClick={() => changeDirection("قبض")}
            className={`rounded-xl border-2 p-4 text-center transition ${
              direction === "قبض"
                ? "border-green-600 bg-green-50 text-green-700"
                : "border-gray-200 text-gray-500 hover:border-gray-300"
            }`}
          >
            <span className="material-symbols-outlined text-3xl">arrow_downward</span>
            <p className="mt-1 font-bold">قبضنا فلوس</p>
            <p className="text-xs opacity-70">مبلغ دخل للشركة</p>
          </button>
        </div>
      </div>

      {/* 2) المبلغ */}
      <div className="glass-card p-5">
        <label className={label}>٢. كم المبلغ؟ (دينار)</label>
        <input
          type="number"
          min="0"
          dir="ltr"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0"
          className="w-full rounded-lg border border-gray-300 px-4 py-3 text-left text-2xl font-bold text-gray-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
        {!!Number(amount) && (
          <p className="mt-1.5 text-sm text-gray-500" dir="ltr">
            {formatPrice(Number(amount))} د.ع
          </p>
        )}
      </div>

      {/* 3) التصنيف */}
      <div className="glass-card p-5">
        <p className={label}>
          ٣. {direction === "صرف" ? "على شنو صرفناها؟" : "من وين جت الفلوس؟"}
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {cats.map((c) => (
            <button
              key={c.label}
              type="button"
              onClick={() => changeCategory(c.label)}
              className={`flex items-center gap-2 rounded-xl border p-3 text-right text-sm transition ${
                category === c.label
                  ? "border-brand-500 bg-brand-50 font-semibold text-brand-700"
                  : "border-gray-200 text-gray-600 hover:border-gray-300"
              }`}
            >
              <span className="material-symbols-outlined text-xl">{c.icon}</span>
              <span className="leading-tight">{c.label}</span>
            </button>
          ))}
        </div>
        {cat.hint && <p className="mt-3 text-xs text-gray-400">{cat.hint}</p>}
      </div>

      {/* 4) الذراع ومن دفع */}
      <div className="glass-card space-y-5 p-5">
        <div>
          <p className={label}>٤. أي ذراع في الشركة؟</p>
          <div className="flex flex-wrap gap-2">
            {ARMS.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setArm(a)}
                className={`rounded-lg border px-4 py-2 text-sm transition ${
                  arm === a
                    ? "border-brand-500 bg-brand-50 font-semibold text-brand-700"
                    : "border-gray-200 text-gray-600 hover:border-gray-300"
                }`}
              >
                {a}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-gray-400">
            يساعدك لاحقاً على معرفة كم يكلّفك كل نشاط على حدة.
          </p>
        </div>

        {(direction === "صرف" || needsPartner) && (
          <div>
            <p className={label}>
              {isPartnerRefund
                ? "٥. لأي شريك نُرجع المبلغ؟"
                : isPartnerDeposit
                ? "٥. أي شريك أودع المبلغ؟"
                : "٥. مين دفع؟"}
            </p>
            <div className="flex flex-wrap gap-2">
              {!needsPartner && (
                <button
                  type="button"
                  onClick={() => setPayer("company")}
                  className={`rounded-lg border px-4 py-2 text-sm transition ${
                    payer === "company"
                      ? "border-brand-500 bg-brand-50 font-semibold text-brand-700"
                      : "border-gray-200 text-gray-600 hover:border-gray-300"
                  }`}
                >
                  الشركة (من صندوقها)
                </button>
              )}
              {partners.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPayer(p.id)}
                  className={`rounded-lg border px-4 py-2 text-sm transition ${
                    payer === p.id
                      ? "border-brand-500 bg-brand-50 font-semibold text-brand-700"
                      : "border-gray-200 text-gray-600 hover:border-gray-300"
                  }`}
                >
                  {p.name}
                  {direction === "صرف" && !isPartnerRefund ? " (من جيبه)" : ""}
                </button>
              ))}
            </div>
            {!needsPartner && (
              <p className="mt-2 text-xs text-gray-400">
                إذا دفع شريك من حسابه الخاص، اختر اسمه — النظام يحسبها له تلقائياً عند التصفية.
              </p>
            )}
          </div>
        )}

        {/* وسيلة الدفع تظهر فقط عندما تتحرك فلوس الشركة فعلاً */}
        {!fromPocket && (
          <div>
            <p className={label}>٦. نقد أم بنك؟</p>
            <div className="flex gap-2">
              {(["نقد", "بنك"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  className={`rounded-lg border px-4 py-2 text-sm transition ${
                    method === m
                      ? "border-brand-500 bg-brand-50 font-semibold text-brand-700"
                      : "border-gray-200 text-gray-600 hover:border-gray-300"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* التفاصيل */}
      <div className="glass-card grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={label}>البيان (بكلمات بسيطة)</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={input}
            placeholder={
              direction === "صرف"
                ? "مثال: إعلان ممول انستغرام لمشروع تلال"
                : "مثال: دفعة من العميل علي على شقة A12"
            }
          />
        </div>
        <div>
          <label className={label}>التاريخ</label>
          <input
            type="date"
            dir="ltr"
            value={moveDate}
            onChange={(e) => setMoveDate(e.target.value)}
            className={input + " text-left"}
          />
        </div>
        <div>
          <label className={label}>ملاحظات (اختياري)</label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={input}
            placeholder="أي تفصيل إضافي"
          />
        </div>
      </div>

      {/* شرح ما سيفعله النظام */}
      <div className="rounded-2xl border border-brand-200 bg-brand-50 p-5">
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined text-brand-600">lightbulb</span>
          <div>
            <p className="font-semibold text-brand-800">شنو راح يسوي النظام؟</p>
            <p className="mt-1 text-sm leading-relaxed text-gray-700">{explain()}</p>
            <p className="mt-2 text-xs text-gray-500">
              القيد المحاسبي المزدوج يُسجَّل تلقائياً — لا تحتاج تعرف شيئاً عن المدين والدائن.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      <div className="flex gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-brand-600 px-6 py-3 font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? "جارٍ الحفظ..." : "حفظ الحركة"}
        </button>
        <button
          onClick={() => router.back()}
          className="rounded-lg border border-gray-300 px-6 py-3 font-medium text-gray-600 transition hover:bg-gray-50"
        >
          إلغاء
        </button>
      </div>
    </div>
  );
}
