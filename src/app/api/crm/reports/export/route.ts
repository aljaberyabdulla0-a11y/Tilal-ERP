import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getUserRole } from "@/lib/auth";
import { baghdadDate, baghdadTime } from "@/lib/time";
import {
  DIM_LABELS, applyTemplateScope, dimValueLabel, filterSummary, generateReport, getDimLabels, getMetricDefs,
  getReportDrilldown, getReportTemplate, getWeekStartDow, logReportRun, REPORT_ROLES,
  type GeneratedReport, type SectionResult,
} from "@/lib/crm-reporting";
import { parseReportParams, toEngineFilters, BASIS_LABELS, type DateBasis, type RawSearchParams } from "@/lib/report-filters";
import { bucketLabel, COMPARE_LABELS, shortDate, type CompareMode, type RangePreset } from "@/lib/report-dates";
import { compareValues, valueOf, type MetricDef } from "@/lib/report-engine";
import { makeSheet, workbookToBuffer, stampedFileName, XLSX_CONTENT_TYPE } from "@/lib/excel-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ============================================================
// تصدير التقارير — Excel و CSV (§47 · §49 · §72).
//
// ===== الأمان: نفس الجلسة، نفس RLS =====
//
// التصدير يستدعي المحرّك نفسه بجلسة من طلبه — فلا يخرج في الملف
// صفٌّ لا يراه على الشاشة. والأسماء في «البيانات الخام» للمدير وحده:
// الملفّ يخرج من حكم RLS بعد خروجه، والبيانات الشخصية تُصدَّر بقرار
// الإدارة لا بزرّ (نفس مبدأ تصدير العملاء — §١٨ في CRM_ARCHITECTURE).
//
// ===== PDF =====
// من المتصفّح (/view?print=1) لا من هنا: مكتبات PDF على Node لا تُشكّل
// العربية. الطباعة تحفظ ما يُعرض بحروفه واتجاهه.
// ============================================================

const RAW_LIMIT = 5000;

export async function GET(request: Request) {
  const role = await getUserRole();
  if (!REPORT_ROLES.includes(role)) {
    return NextResponse.json({ error: "التقارير ليست لدورك." }, { status: 403 });
  }
  const sp = Object.fromEntries(new URL(request.url).searchParams) as RawSearchParams & Record<string, string>;
  const format = sp.format === "csv" ? "csv" : "xlsx";
  const today = baghdadDate();
  const weekStartDow = await getWeekStartDow();
  const admin = role === "admin";

  const template = sp.template ? await getReportTemplate(sp.template) : null;
  const defaults = template ? {
    preset: (template.definition.default_range ?? "last_7") as RangePreset,
    compare: (template.definition.compare ?? "previous_period") as CompareMode,
    basis: (template.definition.basis ?? "event") as DateBasis,
  } : { preset: "last_7" as RangePreset };
  const params = applyTemplateScope(parseReportParams(sp, { today, weekStartDow, defaults }), template);

  // ===== النزول وحده (من صفحة الصفوف) =====
  if (sp.drill === "1") {
    const defs = await getMetricDefs();
    const metric = defs.find((m) => m.code === sp.metric);
    if (!metric) return NextResponse.json({ error: "مقياس غير معروف." }, { status: 400 });
    let cell: Record<string, string | null> = {};
    try { cell = sp.cell ? JSON.parse(sp.cell) : {}; } catch { /* تالف */ }
    const t0 = Date.now();
    const [res, labels] = await Promise.all([
      getReportDrilldown({ metric: metric.code, range: params.range, filters: toEngineFilters(params), dims: cell,
        basis: params.basis, state: sp.state === "current" ? "current" : "snapshot", limit: RAW_LIMIT, offset: 0 }),
      getDimLabels(),
    ]);
    if (res.error) return NextResponse.json({ error: res.error }, { status: 500 });
    const table = rawTable(res.rows, metric.source, labels, admin);
    await logReportRun({ templateId: template?.id ?? null, name: `صفوف: ${metric.name_ar}`, trigger: "export", format: "csv",
      params: { metric: metric.code, cell, filters: params.filters }, range: params.range, rows: res.rows.length,
      durationMs: Date.now() - t0, errors: [] });
    return csvResponse([[`${metric.name_ar} — ${params.range.from} ← ${params.range.to}`], [], ...table], `tilal-${metric.code.toLowerCase()}`);
  }

  if (!template || template.definition.link) {
    return NextResponse.json({ error: "قالب غير موجود أو ليس لدورك." }, { status: 404 });
  }

  const report = await generateReport(template, params, today, weekStartDow);

  // البيانات الخام: صفوف أول مقياس حدثي في التقرير (§50)
  const firstEvent = report.sections
    .flatMap((s) => ("metrics" in s && Array.isArray(s.metrics) ? s.metrics : "metric" in s ? [s.metric] : []))
    .find((m) => m.source === "events" && m.agg !== "ratio");
  const raw = firstEvent
    ? await getReportDrilldown({ metric: firstEvent.code, range: params.range, filters: toEngineFilters(params), dims: {},
        basis: params.basis, state: "snapshot", limit: RAW_LIMIT, offset: 0 })
    : null;

  const meta: string[][] = [
    ["التقرير", template.name],
    ["الشركة", "تلال"],
    ["المدى", `${params.range.label}: ${params.range.from} ← ${params.range.to}`],
    ["المقارنة", params.compareRange ? `${COMPARE_LABELS[params.compare]}: ${params.compareRange.from} ← ${params.compareRange.to}` : "—"],
    ["أساس التاريخ", BASIS_LABELS[params.basis]],
    ["المُرشِّحات", filterSummary(params, report.labels)],
    ["وُلِّد", `${baghdadDate(report.generatedAt)} ${baghdadTime(report.generatedAt)} (Asia/Baghdad)`],
    ["آخر لقطة", report.lastSnapshot ?? "لا لقطات"],
    ["النسخة", `قالب v${template.version} · محرّك 1`],
    ["المصدر", "crm_event_facts + crm_snapshot_rows — بصلاحية من صدّر"],
  ];

  await logReportRun({
    templateId: template.id, name: template.name, trigger: "export", format,
    params: { preset: params.preset, compare: params.compare, basis: params.basis, filters: params.filters },
    range: params.range, rows: report.rows + (raw?.rows.length ?? 0), durationMs: report.durationMs, errors: report.errors,
  });

  if (format === "csv") {
    const rows: (string | number | null)[][] = [...meta, []];
    for (const s of report.sections) {
      const t = sectionTable(s, report);
      if (!t) continue;
      rows.push([`— ${s.def.title} —`], ...t, []);
    }
    return csvResponse(rows, `tilal-${template.code ?? "report"}`);
  }

  // ===== Excel: ملخّص + ورقة لكل قسم + بيانات خام =====
  const wb = new ExcelJS.Workbook();
  wb.creator = "تلال ERP";
  wb.created = new Date();

  const summary = makeSheet(wb, "ملخّص");
  summary.columns = [{ width: 28 }, { width: 18 }, { width: 18 }, { width: 14 }, { width: 12 }];
  summary.addRow([template.name]).font = { bold: true, size: 14, color: { argb: "FF064E3B" } };
  for (const m of meta.slice(1)) summary.addRow(m);
  summary.addRow([]);
  for (const s of report.sections.filter((x) => x.type === "kpis")) {
    if (s.type !== "kpis") continue;
    styleHeader(summary.addRow([s.def.title, "الحالي", "السابق", "الفرق", "٪"]));
    for (const m of s.metrics) {
      const d = compareValues(valueOf(s.current, m), s.previous ? valueOf(s.previous, m) : null, m.good_direction);
      summary.addRow([m.name_ar, d.current, d.previous, d.change, d.pct]);
    }
    summary.addRow([]);
  }

  const used = new Set<string>(["ملخّص"]);
  for (const s of report.sections) {
    if (s.type === "kpis") continue;
    const t = sectionTable(s, report);
    if (!t || t.length === 0) continue;
    let name = sheetName(s.def.title);
    for (let i = 2; used.has(name); i++) name = sheetName(`${s.def.title} ${i}`);
    used.add(name);
    const ws = makeSheet(wb, name);
    styleHeader(ws.addRow(t[0]));
    for (const r of t.slice(1)) {
      const row = ws.addRow(r);
      if (r[0] === "المجموع") row.font = { bold: true };
    }
    ws.columns.forEach((c, i) => { c.width = i === 0 ? 26 : 14; });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: t[0].length } };
  }

  if (raw && firstEvent && !raw.error) {
    const ws = makeSheet(wb, sheetName(`خام — ${firstEvent.name_ar}`));
    const t = rawTable(raw.rows, "events", report.labels, admin);
    styleHeader(ws.addRow(t[0]));
    for (const r of t.slice(1)) ws.addRow(r);
    ws.columns.forEach((c) => { c.width = 18; });
    if (raw.total > RAW_LIMIT) ws.addRow([`… ${raw.total - RAW_LIMIT} صفّاً أخرى — صدّرها من صفحة الصفوف بمُرشِّح أضيق`]);
  }

  const buffer = await workbookToBuffer(wb);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": XLSX_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${stampedFileName(`tilal-${template.code ?? "report"}`)}"`,
      "Cache-Control": "no-store",
    },
  });
}

// ===== جدول لكل قسم — صفّ عناوين ثم صفوف =====
function sectionTable(s: SectionResult, report: GeneratedReport): (string | number | null)[][] | null {
  const L = report.labels;
  const label = (dim: string, v: string | null) =>
    dim === "day" || dim === "week" || dim === "month" ? bucketLabel(dim, v ?? "") : dimValueLabel(dim, v, L);
  switch (s.type) {
    case "kpis": {
      return [["المقياس", "الحالي", "السابق", "الفرق", "٪"], ...s.metrics.map((m) => {
        const d = compareValues(valueOf(s.current, m), s.previous ? valueOf(s.previous, m) : null, m.good_direction);
        return [m.name_ar, d.current, d.previous, d.change, d.pct];
      })];
    }
    case "trend":
      return [[DIM_LABELS[s.grain], ...s.metrics.map((m) => m.name_ar)],
        ...s.rows.map((r) => [label(s.grain, r.dims[s.grain] ?? null), ...s.metrics.map((m) => valueOf(r, m))])];
    case "table": {
      const head = [...s.dims.map((d) => DIM_LABELS[d] ?? d), ...s.metrics.map((m) => m.name_ar)];
      const body = s.rows.map((r) => [...s.dims.map((d) => label(d, r.dims[d] ?? null)), ...s.metrics.map((m) => valueOf(r, m))]);
      const tot = s.total ? [["المجموع", ...s.dims.slice(1).map(() => ""), ...s.metrics.map((m: MetricDef) => valueOf(s.total, m))]] : [];
      return [head, ...body, ...tot];
    }
    case "matrix": {
      const mx = s.matrix;
      const colName = (c: string) => s.colDim === "day" ? shortDate(c) : label(s.colDim, c === "∅" ? null : c);
      return [
        [DIM_LABELS[s.rowDim], ...mx.colKeys.map(colName), "المجموع"],
        ...mx.rowKeys.map((rk) => [label(s.rowDim, rk === "∅" ? null : rk), ...mx.colKeys.map((ck) => mx.cells.get(`${rk}¦${ck}`) ?? 0), mx.rowTotals.get(rk) ?? null]),
        ["المجموع", ...mx.colKeys.map((ck) => mx.colTotals.get(ck) ?? 0), mx.grand],
      ];
    }
    case "funnel":
      return [["الخطوة", "العدد", "٪ من الأول", "التحويل من السابق", "التسرّب", "الفترة السابقة"],
        ...s.steps.map((st, i) => [s.metrics[i]?.name_ar ?? st.code, st.value, st.pctOfFirst, st.stepConversion, st.dropOff, s.previous?.[i]?.value ?? null])];
    case "movement": {
      const m = s.movement;
      return [["البند", "العدد"], ["الافتتاح", m.openingCount], ["فرص جديدة", m.newOpps], ["أُعيد فتحها", m.reopened],
        ["تقدّم", m.progressions], ["تراجع", m.regressions], ["فوز", m.won], ["خسارة", m.lost],
        ["الإقفال", m.closingCount], ["الصافي", m.netCount], ["غير مفسَّر", m.unexplained],
        ["قيمة الافتتاح", m.openingValue], ["قيمة الإقفال", m.closingValue]];
    }
    case "insights":
      return [["ملاحظة"], ...s.insights.map((i) => [i.text])];
    case "campaign_costs":
      return [["الحملة", "المصروف", "ليدات", "مؤهَّل", "فوز", "كلفة الليد", "الاستحواذ", "العائد ٪"],
        ...s.rows.map((c) => [c.campaign_name, c.spent, c.leads, c.qualified, c.won, c.cost_per_lead, c.cac, c.roi_pct])];
  }
}

function rawTable(rows: Record<string, unknown>[], source: string, labels: GeneratedReport["labels"], withNames: boolean): (string | number | null)[][] {
  const n = (dim: string, v: unknown) => dimValueLabel(dim, (v as string | null) ?? null, labels);
  if (source === "events") {
    return [
      ["الوقت (بغداد)", "الحدث", ...(withNames ? ["العميل"] : []), "معرّف العميل", "الموظف", "المشروع", "المصدر", "النتيجة", "من مرحلة", "إلى مرحلة", "القيمة"],
      ...rows.map((r) => [
        `${baghdadDate(String(r.event_at))} ${baghdadTime(String(r.event_at))}`,
        String(r.activity_type ?? r.event_subtype ?? r.event_type),
        ...(withNames ? [String(r.client_name ?? "")] : []),
        String(r.client_id ?? ""), n("employee", r.employee_id), n("project", r.project_id), n("source", r.source_id),
        (r.result as string) ?? null, (r.from_stage as string) ?? null, (r.to_stage as string) ?? null,
        r.value === null || r.value === undefined ? null : Number(r.value),
      ]),
    ];
  }
  return [
    ["اللقطة", ...(withNames ? ["العميل"] : []), "معرّف العميل", "المالك", "المشروع", "المرحلة", "الخطوة القادمة", "صامت (يوم)", "الحرارة", "القيمة"],
    ...rows.map((r) => [
      String(r.snapshot_date), ...(withNames ? [String(r.client_name ?? "")] : []), String(r.client_id ?? ""),
      n("employee", r.owner_id), n("project", r.project_id), (r.stage_name as string) ?? null,
      (r.next_action_date as string) ?? null, (r.days_silent as number) ?? null, (r.temperature as string) ?? null,
      r.expected_value === null || r.expected_value === undefined ? null : Number(r.expected_value),
    ]),
  ];
}

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF3F7255" } };
    c.alignment = { horizontal: "center", vertical: "middle" };
  });
  row.height = 22;
}

function sheetName(s: string): string {
  return s.replace(/[\[\]:*?/\\]/g, " ").slice(0, 31);
}

// CSV بعلامة BOM: بدونها يفتح Excel العربية حروفاً مكسورة
function csvResponse(rows: (string | number | null)[][], base: string) {
  const esc = (v: string | number | null) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = "﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n");
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${stampedFileName(base).replace(/\.xlsx$/, ".csv")}"`,
      "Cache-Control": "no-store",
    },
  });
}
