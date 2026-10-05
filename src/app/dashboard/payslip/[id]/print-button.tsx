"use client";

// الطباعة — ومنها «حفظ PDF» في المتصفح
export default function PrintButton() {
  return (
    <button onClick={() => window.print()}
      className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
      طباعة / PDF
    </button>
  );
}
