"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CLIENT_COLUMNS, ParsedRow } from "@/lib/clients-excel";

type Preview = {
  fileName: string;
  sheetName: string;
  rows: ParsedRow[];
  summary: {
    total: number;
    valid: number;
    invalid: number;
    duplicates: number;
    truncated: boolean;
    maxRows: number;
  };
};

type Done = { inserted: number; rejected: { rowNumber: number; errors: string[] }[] };

// ============================================================
// استيراد العملاء من اكسل — ثلاث خطوات:
//   ١) نزّل القالب   ٢) ارفع الملف وشوف المعاينة   ٣) احفظ
// لا يُحفظ أي شي إلا بعد ما تشوف المعاينة وتضغط الحفظ.
// ============================================================
export default function ImportClients() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState<"" | "reading" | "saving">("");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
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
      const res = await fetch("/api/clients/import/preview", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "تعذّر قراءة الملف.");
      } else {
        setPreview(json as Preview);
      }
    } catch {
      setError("تعذّر الاتصال بالخادم. تأكّد من الإنترنت وأعد المحاولة.");
    } finally {
      setBusy("");
    }
  }

  async function save() {
    if (!preview) return;
    const good = preview.rows.filter((r) => r.errors.length === 0);
    if (good.length === 0) return;

    setError(null);
    setBusy("saving");
    try {
      const res = await fetch("/api/clients/import/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: good }),
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

  function reset() {
    setPreview(null);
    setDone(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  const goodCount = preview?.rows.filter((r) => r.errors.length === 0).length ?? 0;

  return (
    <div className="space-y-6">
      {/* الخطوات */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* ١) القالب */}
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 font-bold text-brand-700">
            ١
          </span>
          <h3 className="mt-3 font-semibold text-gray-800">نزّل القالب</h3>
          <p className="mt-1 text-sm text-gray-500">
            ملف اكسل جاهز بالأعمدة الصحيحة وقوائم منسدلة وورقة تعليمات.
          </p>
          <a
            href="/api/clients/template"
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
          >
            <span className="material-symbols-outlined text-[18px]">download</span>
            تحميل القالب
          </a>
        </div>

        {/* ٢) الرفع */}
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 font-bold text-brand-700">
            ٢
          </span>
          <h3 className="mt-3 font-semibold text-gray-800">املأه وارفعه</h3>
          <p className="mt-1 text-sm text-gray-500">
            امسح الصفّين الملوّنين (مثال) واكتب عملاءك مكانهما، ثم ارفع الملف.
          </p>
          <label className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-100">
            <span className="material-symbols-outlined text-[18px]">upload_file</span>
            {busy === "reading" ? "جاري القراءة..." : "اختر ملف .xlsx"}
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx"
              onChange={handleFile}
              disabled={busy !== ""}
              className="hidden"
            />
          </label>
        </div>

        {/* ٣) الحفظ */}
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 font-bold text-brand-700">
            ٣
          </span>
          <h3 className="mt-3 font-semibold text-gray-800">راجع واحفظ</h3>
          <p className="mt-1 text-sm text-gray-500">
            النظام يعرض لك كل صف وأخطاءه قبل الحفظ. الصفوف الخاطئة تُستبعد ولا تُحفظ.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      {/* نتيجة الحفظ */}
      {done && (
        <div className="rounded-2xl border border-green-200 bg-green-50 p-6">
          <h3 className="text-lg font-bold text-green-800">
            ✅ تم حفظ {done.inserted} عميل
          </h3>
          {done.rejected.length > 0 && (
            <p className="mt-1 text-sm text-green-900">
              واستُبعد {done.rejected.length} صف لوجود أخطاء فيه.
            </p>
          )}
          <div className="mt-4 flex gap-3">
            <Link
              href="/dashboard/clients"
              className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
            >
              عرض العملاء
            </Link>
            <button
              onClick={reset}
              className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
            >
              رفع ملف آخر
            </button>
          </div>
        </div>
      )}

      {/* المعاينة */}
      {preview && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <span className="text-gray-500">
                الملف: <b className="text-gray-800">{preview.fileName}</b>
              </span>
              <span className="rounded-full bg-gray-100 px-3 py-1 text-gray-700">
                {preview.summary.total} صف
              </span>
              <span className="rounded-full bg-green-100 px-3 py-1 text-green-700">
                {preview.summary.valid} جاهز للحفظ
              </span>
              {preview.summary.invalid > 0 && (
                <span className="rounded-full bg-red-100 px-3 py-1 text-red-700">
                  {preview.summary.invalid} فيه أخطاء
                </span>
              )}
              {preview.summary.duplicates > 0 && (
                <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-700">
                  {preview.summary.duplicates} مكرّر
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={save}
                disabled={busy !== "" || goodCount === 0}
                className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === "saving" ? "جاري الحفظ..." : `احفظ ${goodCount} عميل`}
              </button>
              <button
                onClick={reset}
                disabled={busy !== ""}
                className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-600 transition hover:bg-gray-100"
              >
                إلغاء
              </button>
            </div>
          </div>

          {preview.summary.truncated && (
            <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
              الملف أكبر من الحد المسموح — قرأنا أول {preview.summary.maxRows} صف فقط.
              قسّم الملف واستورده على دفعات.
            </div>
          )}

          {goodCount === 0 && (
            <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700">
              ما في أي صف صالح للحفظ. صحّح الأخطاء المبيّنة أدناه في ملف الاكسل وأعد رفعه.
            </div>
          )}

          <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
            <table className="w-full min-w-[1000px] text-start text-sm">
              <thead className="border-b bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-3 py-3 font-medium">الصف</th>
                  <th className="px-3 py-3 font-medium">الحالة</th>
                  {CLIENT_COLUMNS.map((c) => (
                    <th key={c.key} className="whitespace-nowrap px-3 py-3 font-medium">
                      {c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => {
                  const bad = r.errors.length > 0;
                  return (
                    <tr
                      key={r.rowNumber}
                      className={`border-b last:border-0 ${bad ? "bg-red-50/60" : ""}`}
                    >
                      <td className="px-3 py-3 text-gray-400" dir="ltr">
                        {r.rowNumber}
                      </td>
                      <td className="px-3 py-3">
                        {bad ? (
                          <div className="min-w-[220px]">
                            <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
                              {r.duplicate ? "مكرّر" : "خطأ"}
                            </span>
                            <ul className="mt-1 space-y-0.5 text-xs text-red-700">
                              {r.errors.map((e, i) => (
                                <li key={i}>• {e}</li>
                              ))}
                            </ul>
                          </div>
                        ) : (
                          <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                            جاهز
                          </span>
                        )}
                      </td>
                      {CLIENT_COLUMNS.map((c) => (
                        <td
                          key={c.key}
                          className="whitespace-nowrap px-3 py-3 text-gray-700"
                          dir={c.key === "phone" || c.key === "entry_date" ? "ltr" : undefined}
                        >
                          {r.values[c.key] || <span className="text-gray-300">—</span>}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
