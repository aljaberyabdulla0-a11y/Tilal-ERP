"use client";

import { useState } from "react";

// شعار "تلال العقارية"
// يعرض شعاراً نصّياً أنيقاً افتراضياً، ويستبدله بصورة public/logo.png فور توفّرها.
// (لا يظهر أبداً أي "صورة مكسورة" إن لم يوجد الملف)
export default function Logo({
  width = 180,
  className = "",
  onDark = false,
}: {
  width?: number;
  className?: string;
  /** فوق الشريط الجانبي الأخضر الغامق — يقلب ألوان الشعار النصّي */
  onDark?: boolean;
}) {
  const [loaded, setLoaded] = useState(false);

  return (
    <span className={`inline-flex items-center justify-center ${className}`}>
      {/* الشعار النصّي الافتراضي — يظهر حتى تُحمّل الصورة بنجاح */}
      {!loaded && (
        <span className="inline-flex items-center gap-2">
          <span
            className={
              onDark
                ? "flex h-9 w-9 items-center justify-center rounded-xl bg-white text-brand-600"
                : "flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white"
            }
          >
            <span className="material-symbols-outlined text-xl">apartment</span>
          </span>
          <span
            className={
              onDark
                ? "whitespace-nowrap text-lg font-extrabold text-white"
                : "whitespace-nowrap text-lg font-extrabold text-brand-900"
            }
          >
            تلال العقارية
          </span>
        </span>
      )}

      {/* صورة الشعار — مخفيّة حتى تُحمّل بنجاح (فلا تظهر أيقونة صورة مكسورة) */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo.png"
        alt="تلال العقارية"
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(false)}
        style={{ width, display: loaded ? "block" : "none" }}
        className="h-auto object-contain"
      />
    </span>
  );
}
