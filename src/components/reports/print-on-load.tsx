"use client";

import { useEffect } from "react";

// صفحة الطباعة تفتح حوار «حفظ كـPDF» حين تكتمل. الـPDF من المتصفّح لا
// من مكتبة على الخادم: مكتبات PDF على Node لا تُشكّل الحروف العربية
// (تظهر منفصلة معكوسة) — والمتصفّح يطبع ما يعرضه تماماً.
export default function PrintOnLoad() {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, []);
  return null;
}
