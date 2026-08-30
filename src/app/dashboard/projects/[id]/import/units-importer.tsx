"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ProjectNode, UnitTypeRow } from "@/lib/types";

// ============================================================
// رفع الوحدات من CSV.
//
// ثلاث قواعد تحكم التصميم:
//  1. **يُعرض قبل أن يُحفظ.** الرفع الجماعي خطأ فيه جماعي، فيرى
//     المستخدم كل صف وحالته قبل أن يلمس النظام القاعدة.
//  2. **الموقع بالاسم لا بالمعرّف.** يكتب «برج A / الطابق 01» كما
//     يراه في الشاشة، ونحن نطابقه بالمسار — فلا يُطلب منه UUID.
//  3. **الصفوف السليمة تمرّ.** صفٌّ خاطئ لا يمنع الباقي؛ يُعرض
//     سببه ويُستثنى وحده.
// ============================================================

type Row = {
  line: number;
  code: string;
  type: string;
  location: string;
  area: string;
  rooms: string;
  bathrooms: string;
  price: string;
  notes: string;
  nodeId: string | null;
  error: string | null;
};

const HEADERS = [
  "رقم الوحدة",
  "النوع",
  "الموقع",
  "المساحة",
  "الغرف",
  "الحمامات",
  "السعر",
  "ملاحظات",
];

/** مقسّم CSV يحترم علامات الاقتباس، فالملاحظة التي فيها فاصلة لا تُشقّ */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export default function UnitsImporter({
  projectId,
  nodes,
  unitTypes,
  isAdmin,
}: {
  projectId: string;
  nodes: ProjectNode[];
  unitTypes: UnitTypeRow[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [rows, setRows] = useState<Row[]>([]);
  const [fileName, setFileName] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const typeNames = new Set(unitTypes.map((t) => t.name));

  function parse(text: string) {
    const lines = text
      .replace(/^﻿/, "")           // BOM من إكسل
      .split(/\r?\n/)
      .filter((l) => l.trim() !== "");

    if (lines.length < 2) {
      setRows([]);
      setResult("الملف فارغ أو فيه سطر العناوين فقط.");
      return;
    }

    const seen = new Set<string>();
    const parsed: Row[] = [];

    for (let i = 1; i < lines.length; i++) {
      const c = splitCsvLine(lines[i]);
      const row: Row = {
        line: i + 1,
        code: c[0] ?? "",
        type: c[1] ?? "",
        location: c[2] ?? "",
        area: c[3] ?? "",
        rooms: c[4] ?? "",
        bathrooms: c[5] ?? "",
        price: c[6] ?? "",
        notes: c[7] ?? "",
        nodeId: null,
        error: null,
      };

      if (!row.code) row.error = "رقم الوحدة مفقود";
      else if (seen.has(row.code)) row.error = "رقم مكرّر داخل الملف";
      else if (row.type && !typeNames.has(row.type))
        row.error = `نوع غير معروف: ${row.type}`;
      else if (row.location) {
        // المطابقة بالمسار الكامل أوّلاً ثم بالاسم المفرد
        const exact = nodes.find((n) => n.path === row.location);
        const byName = nodes.filter((n) => n.name === row.location);
        if (exact) row.nodeId = exact.id;
        else if (byName.length === 1) row.nodeId = byName[0].id;
        else if (byName.length > 1)
          row.error = `«${row.location}» يطابق أكثر من مستوى — اكتب المسار كاملاً`;
        else row.error = `الموقع غير موجود: ${row.location}`;
      }

      if (!row.error) seen.add(row.code);
      parsed.push(row);
    }

    setRows(parsed);
    setResult(null);
  }

  async function save() {
    const good = rows.filter((r) => !r.error);
    if (good.length === 0) return;

    setSaving(true);
    setResult(null);

    const payload = good.map((r) => {
      const row: Record<string, unknown> = {
        project_id: projectId,
        node_id: r.nodeId,
        unit_code: r.code,
        unit_type: r.type || unitTypes[0]?.name || "شقة",
        status: "متاحة",
        space_m2: r.area ? Number(r.area) : null,
        rooms: r.rooms ? Number(r.rooms) : null,
        bathrooms: r.bathrooms ? Number(r.bathrooms) : null,
        notes: r.notes || null,
      };
      if (isAdmin) row.price = r.price ? Number(r.price) : null;
      return row;
    });

    // على دفعات: طلب واحد بألف صف يسقط على المهلة
    let done = 0;
    for (let i = 0; i < payload.length; i += 200) {
      const chunk = payload.slice(i, i + 200);
      const { error } = await supabase.from("units").insert(chunk);
      if (error) {
        setSaving(false);
        setResult(
          `توقّف بعد ${done} وحدة — ${error.message}. الوحدات المحفوظة قبل التوقّف باقية.`,
        );
        router.refresh();
        return;
      }
      done += chunk.length;
    }

    setSaving(false);
    setResult(`تم رفع ${done} وحدة ✓`);
    setRows([]);
    router.refresh();
  }

  const ok = rows.filter((r) => !r.error).length;
  const bad = rows.length - ok;

  const template =
    HEADERS.join(",") +
    "\n101,شقة,برج A / الطابق 01,120,3,2,250000000,\n" +
    "102,شقة,برج A / الطابق 01,95,2,1,190000000,زاوية";

  return (
    <div className="max-w-5xl space-y-5">
      <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm text-gray-700">
        <b className="text-blue-800">شكل الملف.</b> السطر الأول عناوين، ثم سطر لكل
        وحدة بهذا الترتيب:
        <div className="mt-2 overflow-x-auto">
          <code className="whitespace-nowrap rounded bg-white px-2 py-1 text-xs text-gray-800">
            {HEADERS.join(" , ")}
          </code>
        </div>
        <p className="mt-2 text-xs text-gray-600">
          «الموقع» يُكتب كما يظهر في الهيكل — المسار الكامل «برج A / الطابق 01»،
          أو اسم المستوى وحده إن لم يتكرّر. اتركه فارغاً لوحدة خارج الهيكل. كل
          الوحدات تُرفع بحالة <b>متاحة</b>.
          {!isAdmin && " وعمود السعر يُتجاهل لأن تعديل الأسعار للمدير وحده."}
        </p>
        <a
          href={"data:text/csv;charset=utf-8,%EF%BB%BF" + encodeURIComponent(template)}
          download="نموذج-الوحدات.csv"
          className="mt-3 inline-block rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-blue-800 shadow-sm hover:bg-blue-100"
        >
          تنزيل ملف نموذجي
        </a>
      </div>

      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <label className="mb-1 block text-xs font-medium text-gray-600">
          ملف CSV
        </label>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setFileName(f.name);
            const reader = new FileReader();
            reader.onload = () => parse(String(reader.result ?? ""));
            reader.readAsText(f, "utf-8");
          }}
          className="w-full rounded-lg border border-gray-300 p-2 text-sm file:me-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-brand-700"
        />
        {fileName && (
          <p className="mt-2 text-xs text-gray-500">
            {fileName} — {rows.length} صفّاً، {ok} صالح
            {bad > 0 && <span className="text-red-600">، {bad} به خطأ</span>}
          </p>
        )}
      </div>

      {rows.length > 0 && (
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full min-w-[720px] text-start text-sm">
              <thead className="sticky top-0 border-b bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">#</th>
                  <th className="px-3 py-2 text-start font-medium">رقم الوحدة</th>
                  <th className="px-3 py-2 text-start font-medium">النوع</th>
                  <th className="px-3 py-2 text-start font-medium">الموقع</th>
                  <th className="px-3 py-2 text-start font-medium">المساحة</th>
                  <th className="px-3 py-2 text-start font-medium">السعر</th>
                  <th className="px-3 py-2 text-start font-medium">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.line}
                    className={
                      r.error
                        ? "border-b bg-red-50 last:border-0"
                        : "border-b last:border-0"
                    }
                  >
                    <td className="px-3 py-2 text-gray-400">{r.line}</td>
                    <td className="px-3 py-2 font-medium text-gray-800">{r.code}</td>
                    <td className="px-3 py-2 text-gray-600">{r.type || "—"}</td>
                    <td className="px-3 py-2 text-gray-600">{r.location || "—"}</td>
                    <td className="px-3 py-2 text-gray-600" dir="ltr">
                      {r.area || "—"}
                    </td>
                    <td className="px-3 py-2 text-gray-600" dir="ltr">
                      {r.price || "—"}
                    </td>
                    <td className="px-3 py-2">
                      {r.error ? (
                        <span className="text-xs font-medium text-red-700">
                          {r.error}
                        </span>
                      ) : (
                        <span className="text-xs font-medium text-green-700">
                          جاهز
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-gray-50 px-4 py-3">
            <p className="text-sm text-gray-600">
              سيُرفع <b className="text-green-700">{ok}</b> وحدة
              {bad > 0 && (
                <>
                  ، ويُستثنى <b className="text-red-700">{bad}</b> صفّاً به خطأ
                </>
              )}
              .
            </p>
            <button
              onClick={save}
              disabled={saving || ok === 0}
              className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
            >
              {saving ? "جارٍ الرفع…" : `رفع ${ok} وحدة`}
            </button>
          </div>
        </div>
      )}

      {result && (
        <p
          className={`rounded-lg p-3 text-sm ${
            result.includes("✓")
              ? "bg-green-50 text-green-700"
              : "bg-red-50 text-red-700"
          }`}
        >
          {result}
        </p>
      )}
    </div>
  );
}
