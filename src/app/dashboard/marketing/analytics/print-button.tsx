"use client";

// PDF بالطباعة من المتصفّح — يحفظ العربية بحروفها واتجاهها
export default function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="rounded-lg border px-3 py-2 text-sm">
      اطبع / PDF
    </button>
  );
}
