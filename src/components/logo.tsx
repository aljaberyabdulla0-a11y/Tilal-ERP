"use client";

import { useEffect, useRef, useState } from "react";

// ============================================================
// شعار "تلال العقارية".
//
// نسختان في public: logo.png خضراء للخلفيات الفاتحة،
// و logo-white.png بيضاء للشريط الجانبي الأخضر الغامق.
//
// وإن غاب الملف يظهر شعار نصّي أنيق بدلاً منه — فلا تظهر أبداً
// أيقونة "صورة مكسورة".
// ============================================================
export default function Logo({
  width = 180,
  className = "",
  onDark = false,
}: {
  width?: number;
  className?: string;
  /** فوق الشريط الجانبي الأخضر الغامق — يستعمل النسخة البيضاء */
  onDark?: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // الصورة موجودة في HTML القادم من الخادم، فقد يفرغ المتصفح من
  // تحميلها **قبل** أن يربط React المستمع onLoad — فيضيع الحدث ويبقى
  // الشعار مخفياً إلى الأبد. لذلك نسأل الصورة نفسها عند التركيب.
  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) setLoaded(true);
  }, []);

  return (
    <span className={`inline-flex items-center justify-center ${className}`}>
      {/* الشعار النصّي الاحتياطي — يظهر حتى تُحمّل الصورة بنجاح */}
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

      {/* صورة الشعار — مخفيّة حتى تُحمّل بنجاح */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={onDark ? "/logo-white.png" : "/logo.png"}
        alt="تلال العقارية"
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(false)}
        style={{ width, display: loaded ? "block" : "none" }}
        className="h-auto object-contain"
      />
    </span>
  );
}
