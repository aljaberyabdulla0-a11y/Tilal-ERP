import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { canReadMarketingMoney } from "@/lib/auth";
import { baghdadDate } from "@/lib/time";
import { parseMktFilters } from "@/lib/marketing-filters";
import { buildReport, cellText } from "@/lib/marketing-reports";
import { ATTRIBUTION_MODELS } from "@/lib/marketing-style";
import { makeSheet, workbookToBuffer, XLSX_CONTENT_TYPE } from "@/lib/excel-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ============================================================
// تصدير تقارير التسويق — Excel و CSV.
//
// نفس الجلسة ونفس الدالّة التي تعرض الشاشة (buildReport): لا يخرج في
// الملف رقمٌ لم يظهر. ولا أسماء عملاء في أيّ تقرير تسويقي أصلاً —
// المجاميع وحدها (125).
// ============================================================
export async function GET(request: Request) {
  if (!(await canReadMarketingMoney())) {
    return NextResponse.json({ error: "تقارير التسويق ليست لدورك." }, { status: 403 });
  }
  const sp = Object.fromEntries(new URL(request.url).searchParams);
  const f = parseMktFilters(sp, baghdadDate());
  const report = await buildReport(sp.report ?? "overview", f);
  if (report.error) return NextResponse.json({ error: report.error }, { status: 500 });

  const subtitle = `${f.from ?? "البداية"} ← ${f.to ?? "اليوم"} · إسناد: ${ATTRIBUTION_MODELS[f.model]}`;
  const name = `marketing-${report.key}-${baghdadDate()}`;

  if (sp.format === "csv") {
    const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const lines = [
      [report.title], [subtitle], [],
      report.columns.map((c) => c.label),
      ...report.rows.map((r) => report.columns.map((c) => {
        const v = r[c.key];
        // الأرقام خاماً في CSV كي تُجمع في الجداول؛ النصّ كما هو
        return typeof v === "number" || (typeof v === "string" && v !== "" && !isNaN(Number(v)) && c.kind !== "text") ? String(v) : cellText(v, c.kind, r.kind as string);
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
      const kind = (r.kind as string) ?? c.kind;
      if (v === null || v === undefined || v === "") return null;
      if (kind !== "text" && !isNaN(Number(v))) return Number(v);
      return String(v);
    }));
    report.columns.forEach((c, i) => {
      const kind = (r.kind as string) ?? c.kind;
      if (kind === "money" || kind === "num") row.getCell(i + 1).numFmt = "#,##0";
      if (kind === "pct") row.getCell(i + 1).numFmt = '0.0"%"';
    });
  }
  ws.columns.forEach((col) => { col.width = 18; });
  ws.getColumn(1).width = 34;

  const buf = await workbookToBuffer(wb);
  return new NextResponse(new Uint8Array(buf), {
    headers: { "Content-Type": XLSX_CONTENT_TYPE, "Content-Disposition": `attachment; filename="${name}.xlsx"` },
  });
}
