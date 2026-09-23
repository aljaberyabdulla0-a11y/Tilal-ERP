"use client";

// ============================================================
// تقرير أسباب الرفض — يُنزَّل CSV (§48).
//
// لماذا CSV لا شاشة: الغاية أن يُفتح بجانب الملفّ الأصلي في اكسل،
// فيُصحَّح الصفّ ٤ والصفّ ١٧ ثم يُعاد الرفع. تقريرٌ يُقرأ على الشاشة
// ولا يُفتح مع الملفّ يُحبط ولا يُصلِح.
//
// وBOM في أوله ضروري: اكسل يقرأ CSV بترميز النظام لا UTF-8، فبلا
// BOM تظهر العربية حروفاً مشوّهة — وهو أسوأ من لا تقرير.
// ============================================================
export default function RejectionReport({
  fileName,
  createdAt,
  rejections,
}: {
  fileName: string | null;
  createdAt: string;
  rejections: { rowNumber: number; errors: string[] }[];
}) {
  function download() {
    const head = ["رقم الصفّ في الملفّ", "سبب الرفض"];
    const rows = rejections.flatMap((r) =>
      (r.errors ?? []).map((e) => [String(r.rowNumber), e])
    );

    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const csv = "﻿" + [head, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");

    const base = (fileName ?? "استيراد").replace(/\.[^.]+$/, "");
    const stamp = createdAt.slice(0, 10);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `أخطاء-${base}-${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const n = rejections.reduce((s, r) => s + (r.errors?.length ?? 0), 0);

  return (
    <button
      type="button"
      onClick={download}
      className="flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
    >
      <span className="material-symbols-outlined text-[16px]">download</span>
      نزّل ({n} سبباً)
    </button>
  );
}
