// ============================================================
// أدوات توليد ملفات الاكسل على الخادم (exceljs).
// الملفات تُبنى هنا وليس في المتصفح، حتى يبقى التحقّق من الصلاحية
// على الخادم فلا يمكن تجاوزه.
// ============================================================

import ExcelJS from "exceljs";
import { CLIENT_COLUMNS, ClientColumn } from "@/lib/clients-excel";

// حدّ اكسل لقائمة منسدلة مكتوبة مباشرة داخل الخلية
const INLINE_LIST_LIMIT = 250;

// ورقة عربية: اتجاه من اليمين، عناوين ملوّنة ومجمّدة
export function makeSheet(wb: ExcelJS.Workbook, name: string) {
  const ws = wb.addWorksheet(name, {
    views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }],
  });
  return ws;
}

// صف العناوين بأسلوب موحّد
export function writeHeader(ws: ExcelJS.Worksheet, columns: ClientColumn[]) {
  ws.columns = columns.map((c) => ({ key: c.key, width: c.width }));

  const header = ws.getRow(1);
  columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 12 };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF3F7255" }, // أخضر البراند
    };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = { bottom: { style: "thin", color: { argb: "FF335C46" } } };
  });
  header.height = 26;
}

// تنسيق أعمدة النص (يحمي الصفر في بداية رقم الهاتف) + القوائم المنسدلة
export function applyColumnRules(
  ws: ExcelJS.Worksheet,
  columns: ClientColumn[],
  fromRow: number,
  toRow: number
) {
  columns.forEach((col, i) => {
    const colIndex = i + 1;

    if (col.text) {
      ws.getColumn(colIndex).numFmt = "@";
    }

    if (col.list) {
      const inline = `"${col.list.join(",")}"`;
      // القوائم الطويلة لا يقبلها اكسل داخل الخلية — يبقى التحقّق
      // عند الاستيراد على أي حال، وورقة «التعليمات» تسرد القيم.
      if (inline.length <= INLINE_LIST_LIMIT) {
        for (let r = fromRow; r <= toRow; r++) {
          ws.getCell(r, colIndex).dataValidation = {
            type: "list",
            allowBlank: true,
            formulae: [inline],
            showErrorMessage: true,
            errorStyle: "warning",
            errorTitle: "قيمة غير مسموحة",
            error: `اختر من القائمة: ${col.list.join(" / ")}`,
          };
        }
      }
    }
  });
}

// ورقة تعليمات تشرح كل عمود وقيمه المسموحة
export function addInstructionsSheet(
  wb: ExcelJS.Workbook,
  columns: ClientColumn[] = CLIENT_COLUMNS
) {
  const ws = wb.addWorksheet("التعليمات", {
    views: [{ rightToLeft: true }],
  });
  ws.columns = [{ width: 22 }, { width: 12 }, { width: 78 }];

  const title = ws.addRow(["كيف تملأ ملف العملاء"]);
  title.font = { bold: true, size: 14, color: { argb: "FF3F7255" } };
  ws.addRow([]);

  [
    "١) لا تغيّر أسماء الأعمدة ولا ترتيبها في ورقة «العملاء».",
    "٢) الصفّان الملوّنان في القالب مجرد مثال — امسحهما قبل الرفع.",
    "٣) عمود «الاسم» إلزامي، وباقي الأعمدة اختيارية.",
    "٤) الأعمدة التي لها قائمة مسموحة: اكتب القيمة كما هي بالضبط.",
    "٥) رقم الهاتف يُحفظ كنص حتى لا يضيع الصفر الأول.",
    "٦) «موظف المبيعات» اختره من القائمة — الاسم يحدّد أي موظف يشوف هذا العميل،",
    "    فلو كُتب ناقصاً أو غلط ما راح يظهر العميل لموظفه.",
    "٧) عند الرفع يعرض لك النظام معاينة بكل صف قبل الحفظ، ويوقف الصفوف الخاطئة.",
  ].forEach((t) => {
    const r = ws.addRow([t]);
    ws.mergeCells(r.number, 1, r.number, 3);
    r.getCell(1).alignment = { horizontal: "right" };
  });

  ws.addRow([]);
  const head = ws.addRow(["العمود", "إلزامي؟", "القيم المسموحة / الملاحظات"]);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF3F7255" } };
    cell.alignment = { horizontal: "center" };
  });

  columns.forEach((c) => {
    const allowed = c.list ? c.list.join(" / ") : c.hint ?? "نص حر";
    const row = ws.addRow([c.header, c.required ? "نعم" : "لا", allowed]);
    row.getCell(3).alignment = { wrapText: true, horizontal: "right", vertical: "top" };
    row.getCell(2).alignment = { horizontal: "center" };
  });

  return ws;
}

// نحوّل مخرجات exceljs إلى ما يقبله Response في Next
export async function workbookToBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  const data = await wb.xlsx.writeBuffer();
  return Buffer.from(data);
}

// اسم ملف آمن يحمل تاريخ اليوم
export function stampedFileName(prefix: string): string {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
  return `${prefix}-${stamp}.xlsx`;
}

export const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
