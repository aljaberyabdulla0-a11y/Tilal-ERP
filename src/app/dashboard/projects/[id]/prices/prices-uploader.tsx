"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fmt } from "@/lib/crm-style";
import {
  newPrice,
  priceUpdates,
  type PriceMode,
  type PricePreview,
  type PriceRow,
} from "@/lib/unit-prices";

type Preview = PricePreview & { fileName: string };
type Done = { updated: number; unchanged: number; rejected: { id: string; error: string }[] };

const ISSUE_TEXT: Record<NonNullable<PriceRow["issue"]>, string> = {
  not_found: "لا وحدة بهذا الكود",
  no_price: "بلا سعر",
  duplicate: "مكرّرة في الملف",
};

// ============================================================
// تحديث أسعار المشروع من اكسل: ارفع ← عاين ← اعتمد.
// كل صفّ في الملف سعرُ وحدةٍ بعينها (إجمالي وسعر متر)، والمعاينة
// تعرض القديم والجديد لكل وحدة قبل أي حفظ.
// ============================================================
export default function PricesUploader({ projectId }: { projectId: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState<"" | "reading" | "saving">("");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mode, setMode] = useState<PriceMode>("total");
  const [onlyChanges, setOnlyChanges] = useState(true);
  const [done, setDone] = useState<Done | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setDone(null);
    setPreview(null);
    setBusy("reading");

    const body = new FormData();
    body.append("file", file);
    try {
      const res = await fetch(`/api/projects/${projectId}/prices/preview`, {
        method: "POST",
        body,
      });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "تعذّر قراءة الملف.");
      else setPreview(json as Preview);
    } catch {
      setError("تعذّر الاتصال بالخادم. تأكّد من الإنترنت وأعد المحاولة.");
    } finally {
      setBusy("");
    }
  }

  const updates = useMemo(() => (preview ? priceUpdates(preview.rows, mode) : []), [preview, mode]);

  const stats = useMemo(() => {
    const rows = preview?.rows ?? [];
    return {
      matched: rows.filter((r) => !r.issue).length,
      problems: rows.filter((r) => r.issue).length,
      mismatch: rows.filter((r) => !r.issue && r.mismatch).length,
      areaDiff: rows.filter((r) => !r.issue && r.areaDiff).length,
    };
  }, [preview]);

  const shown = useMemo(() => {
    const rows = preview?.rows ?? [];
    if (!onlyChanges) return rows;
    return rows.filter((r) => r.issue || r.mismatch || r.areaDiff || newPrice(r, mode) !== r.oldPrice);
  }, [preview, onlyChanges, mode]);

  async function save() {
    if (updates.length === 0) return;
    setError(null);
    setBusy("saving");
    try {
      const res = await fetch(`/api/projects/${projectId}/prices/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "تعذّر الحفظ.");
      } else {
        setDone(json as Done);
        setPreview(null);
        if (fileRef.current) fileRef.current.value = "";
        router.refresh();
      }
    } catch {
      setError("تعذّر الاتصال بالخادم أثناء الحفظ.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <h3 className="font-semibold text-gray-800">ارفع جدول التسعير</h3>
        <p className="mt-1 text-sm text-gray-500">
          ملف .xlsx فيه عمود لكود الوحدة (مثل A101 أو الباركود) وعمود «السعر الإجمالي» و/أو
          «سعر المتر». تُقرأ كل الأوراق (ورقة لكل برج تصلح)، وأعمدة الدفعات الأخرى تُتجاهل.
        </p>
        <label className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700">
          <span className="material-symbols-outlined text-[18px]">upload_file</span>
          {busy === "reading" ? "جاري القراءة..." : "اختر ملف .xlsx"}
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            disabled={busy !== ""}
            onChange={handleFile}
          />
        </label>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      {done && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          <p className="font-semibold">
            حُدّث سعر {fmt(done.updated)} وحدة
            {done.unchanged > 0 && ` · ${fmt(done.unchanged)} بلا تغيير`}
          </p>
          {done.rejected.length > 0 && (
            <p className="mt-1 text-red-700">
              تعذّر تحديث {fmt(done.rejected.length)}: {done.rejected[0].error}
            </p>
          )}
          <Link href={`/dashboard/projects/${projectId}`} className="mt-2 inline-block font-medium underline">
            العودة إلى المشروع
          </Link>
        </div>
      )}

      {preview && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="وحدات مطابَقة" value={stats.matched} tone="border-s-brand-500" />
            <Stat label="سيتغيّر سعرها" value={updates.length} tone="border-s-green-500" />
            <Stat label="صفوف بمشكلة" value={stats.problems} tone="border-s-red-500" />
            <Stat label="وحدات غائبة عن الملف" value={preview.missing.length} tone="border-s-gray-400" />
          </div>

          <div className="rounded-xl border bg-white p-4 text-sm text-gray-600">
            <p className="font-medium text-gray-800">{preview.fileName}</p>
            <ul className="mt-1 space-y-0.5">
              {preview.sheets.map((s) => (
                <li key={s.name}>
                  <b>{s.name}:</b>{" "}
                  {s.used
                    ? `الكود من «${s.codeHeader}»` +
                      (s.totalHeader ? ` · الإجمالي من «${s.totalHeader}»` : "") +
                      (s.ppmHeader ? ` · سعر المتر من «${s.ppmHeader}»` : "")
                    : "تُخطّيت — لا جدول أسعار مطابق فيها"}
                </li>
              ))}
            </ul>
          </div>

          {stats.mismatch > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-semibold">
                في {fmt(stats.mismatch)} وحدة الإجمالي في الملف لا يساوي المساحة × سعر المتر. أيّهما
                يُعتمد؟
              </p>
              <div className="mt-2 flex flex-wrap gap-4">
                <label className="flex items-center gap-2">
                  <input type="radio" checked={mode === "total"} onChange={() => setMode("total")} />
                  السعر الإجمالي كما في الملف
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" checked={mode === "ppm"} onChange={() => setMode("ppm")} />
                  مساحة الوحدة في النظام × سعر المتر
                </label>
              </div>
            </div>
          )}

          {stats.areaDiff > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              مساحة {fmt(stats.areaDiff)} وحدة في الملف تختلف عن مساحتها في النظام — راجعها في الجدول.
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={onlyChanges} onChange={(e) => setOnlyChanges(e.target.checked)} />
              اعرض ما يتغيّر وما فيه ملاحظة فقط
            </label>
            <button
              onClick={save}
              disabled={busy !== "" || updates.length === 0}
              className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
            >
              {busy === "saving" ? "جاري الحفظ..." : `اعتمد الأسعار (${fmt(updates.length)} وحدة)`}
            </button>
          </div>

          <div className="max-h-[60vh] overflow-auto rounded-xl border bg-white">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-3 py-2 text-start">الورقة / الصف</th>
                  <th className="px-3 py-2 text-start">الكود</th>
                  <th className="px-3 py-2 text-start">الوحدة</th>
                  <th className="px-3 py-2 text-start">الحالة</th>
                  <th className="px-3 py-2 text-start">المساحة</th>
                  <th className="px-3 py-2 text-start">سعر المتر</th>
                  <th className="px-3 py-2 text-start">السعر الحالي</th>
                  <th className="px-3 py-2 text-start">السعر الجديد</th>
                  <th className="px-3 py-2 text-start">ملاحظة</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const p = newPrice(r, mode);
                  const changed = p !== null && p !== r.oldPrice;
                  return (
                    <tr key={`${r.sheet}-${r.row}`} className={`border-t ${r.issue ? "bg-red-50" : ""}`}>
                      <td className="px-3 py-1.5 text-gray-500">
                        {r.sheet} / {r.row}
                      </td>
                      <td className="px-3 py-1.5 font-mono">{r.code || "—"}</td>
                      <td className="px-3 py-1.5">{r.unitLabel ?? "—"}</td>
                      <td className="px-3 py-1.5 text-gray-500">{r.status ?? "—"}</td>
                      <td className={`px-3 py-1.5 ${r.areaDiff ? "font-semibold text-amber-700" : ""}`}>
                        {r.dbArea ?? "—"}
                        {r.areaDiff && ` (الملف ${r.fileArea})`}
                      </td>
                      <td className="px-3 py-1.5">{fmt(r.ppm)}</td>
                      <td className="px-3 py-1.5 text-gray-500">{fmt(r.oldPrice)}</td>
                      <td className={`px-3 py-1.5 ${changed ? "font-semibold text-green-700" : ""}`}>
                        {fmt(p)}
                      </td>
                      <td className="px-3 py-1.5 text-xs">
                        {r.issue ? (
                          <span className="text-red-700">{ISSUE_TEXT[r.issue]}</span>
                        ) : r.mismatch ? (
                          <span className="text-amber-700">
                            الإجمالي {fmt(r.byTotal)} ≠ المتر × المساحة {fmt(r.byPpm)}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-3 py-6 text-center text-gray-400">
                      لا شيء يتغيّر — الأسعار في النظام مطابقة للملف.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {preview.missing.length > 0 && (
            <details className="rounded-xl border bg-white p-4 text-sm text-gray-600">
              <summary className="cursor-pointer font-medium">
                {fmt(preview.missing.length)} وحدة في المشروع ليست في الملف — تبقى أسعارها كما هي
              </summary>
              <p className="mt-2 leading-7">{preview.missing.map((m) => m.label).join(" · ")}</p>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`rounded-xl border border-s-4 bg-white p-4 shadow-sm ${tone}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-800">{fmt(value)}</p>
    </div>
  );
}
