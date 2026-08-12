"use client";

import { useMemo } from "react";
import {
  COUNTRY_CODES,
  composePhone,
  countryByIso,
  isValidPhone,
  phoneHint,
  splitPhone,
} from "@/lib/types";

// ============================================================
// حقل هاتف بمفتاح دولة.
//
// العراق هو الافتراضي دائماً — وهو الحالة الغالبة — وبقية الدول
// متاحة لمن يحتاجها (عميل مغترب أو مقيم خارج العراق).
//
// المكوّن يتعامل مع **الرقم المخزَّن** كاملاً في `value` و`onChange`،
// ويفصل الدولة عن الجزء الوطني داخلياً. هكذا لا يحتاج النموذج أن
// يعرف شيئاً عن صيغ الحفظ، ولا نكرّر المنطق في كل حقل هاتف.
// ============================================================
export default function PhoneInput({
  value,
  onChange,
  required = false,
  id,
  autoFocus,
}: {
  value: string;
  onChange: (stored: string) => void;
  required?: boolean;
  id?: string;
  autoFocus?: boolean;
}) {
  const { iso, national } = useMemo(() => splitPhone(value), [value]);
  const country = countryByIso(iso);

  // خطأ يُعرض فقط بعد أن يكتب المستخدم شيئاً — لا نوبّخه على حقل فارغ
  const invalid = value.trim().length > 0 && !isValidPhone(value);

  function setCountry(nextIso: string) {
    onChange(composePhone(nextIso, national));
  }

  function setNumber(raw: string) {
    // نسمح بالأرقام والمسافات والشرطات أثناء الكتابة، والتنظيف في composePhone
    onChange(composePhone(iso, raw));
  }

  const base =
    "rounded-lg border px-4 py-2.5 focus:outline-none focus:ring-1 transition";
  const tone = invalid
    ? "border-red-400 focus:border-red-500 focus:ring-red-500"
    : "border-gray-300 focus:border-brand-500 focus:ring-brand-500";

  return (
    <div>
      <div className="flex gap-2">
        <select
          value={iso}
          onChange={(e) => setCountry(e.target.value)}
          aria-label="مفتاح الدولة"
          className={`${base} ${tone} w-40 shrink-0 bg-white`}
        >
          {COUNTRY_CODES.map((c) => (
            <option key={c.iso} value={c.iso}>
              {c.name} {c.dial}
            </option>
          ))}
        </select>

        <input
          id={id}
          type="tel"
          dir="ltr"
          required={required}
          autoFocus={autoFocus}
          value={national}
          onChange={(e) => setNumber(e.target.value)}
          className={`${base} ${tone} w-full text-start`}
          placeholder={iso === "IQ" ? "07701234567" : "5xxxxxxxx"}
        />
      </div>

      <p className={`mt-1 text-xs ${invalid ? "text-red-600" : "text-gray-400"}`}>
        {invalid ? `رقم غير مكتمل — ${phoneHint(iso)}` : phoneHint(iso)}
        {iso !== "IQ" && !invalid && (
          <span className="ms-1 text-gray-400">
            (يُحفظ بالصيغة الدولية {country.dial})
          </span>
        )}
      </p>
    </div>
  );
}
