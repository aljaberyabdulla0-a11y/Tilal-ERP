import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { baghdadDate } from "@/lib/time";
import { getHrReport, hrCellText, parseHrFilters } from "@/lib/hr-reports";
import { makeSheet, workbookToBuffer, XLSX_CONTENT_TYPE } from "@/lib/excel-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ============================================================
// تصدير تقارير HR — Excel و CSV.
//
// نفس الجلسة ونفس الدالّة التي تعرض الشاشة (hr_report): لا يخرج في
// الملف رقمٌ لم يظهر، والنطاق والصلاحية تفرضهما القاعدة — تقرير ليس
// لدورك يُرفض هناك لا هنا (165).
// ============================================================
export async function GET(request: Request) {
  const sp = Object.fromEntries(new URL(request.url).searchParams);
  const f = parseHrFilters(sp);
  const { report, error } = await getHrReport(f);
  if (error || !report) return NextResponse.json({ error: error ?? "تعذّر بناء التقرير" }, { status: 403 });

  const subtitle = `${report.from} ← ${report.to}`;
  const name = `hr-${report.key}-${baghdadDate()}`;

  if (sp.format === "csv") {
    const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const lines = [
      [report.title], [subtitle], [],
      report.columns.map((c) => c.label),
      ...report.rows.map((r) => report.columns.map((c) => {
        const v = r[c.key];
        // الأرقام خاماً في CSV كي تُجمع في الجداول؛ النصّ كما هو
        if (v === null || v === undefined) return "";
        return c.kind === "money" || c.kind === "num" || c.kind === "pct" ? String(v) : hrCellText(v, c.kind);
      })),
    ];
    return new NextResponse("﻿" + lines.map((l) => l.map((x) => esc(String(x))).join(",")).join("\r\n"), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"` },
    });
  }

  const wb = new ExcelJS.Workbook();
  const ws = makeSheet(wb, report.title.slice(0, 31));
  ws.addRow([report.title]).font = { bold: true, size: 14 };
  ws.addRow([subtitle]).font = { color: { argb: "FF6B7280" } };
  ws.addRow([]);
  const head = ws.addRow(report.columns.map((c) => c.label));
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF064E3B" } }; });
  for (const r of report.rows) {
    const row = ws.addRow(report.columns.map((c) => {
      const v = r[c.key];
      if (v === null || v === undefined || v === "") return null;
      if (c.kind !== "text" && c.kind !== "date" && !isNaN(Number(v))) return Number(v);
      return String(v);
    }));
    report.columns.forEach((c, i) => {
      if (c.kind === "money") row.getCell(i + 1).numFmt = "#,##0";
      if (c.kind === "num") row.getCell(i + 1).numFmt = "#,##0.#";
      if (c.kind === "pct") row.getCell(i + 1).numFmt = '0.0"%"';
    });
  }
  ws.columns.forEach((col) => { col.width = 18; });
  ws.getColumn(1).width = 30;

  const buf = await workbookToBuffer(wb);
  return new NextResponse(new Uint8Array(buf), {
    headers: { "Content-Type": XLSX_CONTENT_TYPE, "Content-Disposition": `attachment; filename="${name}.xlsx"` },
  });
}
