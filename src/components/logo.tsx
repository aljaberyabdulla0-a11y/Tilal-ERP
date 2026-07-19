"use client";

import { useState } from "react";

// شعار "تلال العقارية"
// يعرض شعاراً نصّياً أنيقاً افتراضياً، ويستبدله بصورة public/logo.png فور توفّرها.
// (لا يظهر أبداً أي "صورة مكسورة" إن لم يوجد الملف)
export default function Logo({
  width = 180,
  className = "",
}: {
  width?: number;
  className?: string;
}) {
  const [loaded, setLoaded] = useState(false);

  return (
    <span className={`inline-flex items-center justify-center ${className}`}>
      {/* الشعار النصّي الافتراضي — يظهر حتى تُحمّل الصورة بنجاح */}
      {!loaded && (
        <span className="inline-flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white">
            <span className="material-symbols-outlined text-xl">apartment</span>
          </span>
          <span className="whitespace-nowrap text-lg font-extrabold text-brand-900">
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
