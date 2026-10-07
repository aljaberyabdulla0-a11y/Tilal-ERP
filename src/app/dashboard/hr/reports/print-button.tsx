"use client";

export default function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50">
      طباعة / PDF
    </button>
  );
}
