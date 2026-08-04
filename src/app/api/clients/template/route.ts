import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { isAdmin } from "@/lib/auth";
import { getSalesEmployeeNames } from "@/lib/hr";
import { CLIENT_COLUMNS, TEMPLATE_SAMPLE_ROWS } from "@/lib/clients-excel";
import {
  makeSheet,
  writeHeader,
  applyColumnRules,
  addInstructionsSheet,
  workbookToBuffer,
  stampedFileName,
  XLSX_CONTENT_TYPE,
} from "@/lib/excel-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// قالب اكسل فارغ لإضافة العملاء دفعة واحدة — للمدير فقط
// (رفع الملفات الجماعية محصور بالإدارة، فالقالب كذلك)
export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json(
      { error: "تحميل القالب متاح للإدارة فقط." },
      { status: 403 }
    );
  }

  // أسماء الموظفين تصير قائمة منسدلة في عمود «موظف المبيعات»،
  // حتى يطابق الاسم ملف الموظفين حرفياً فتشتغل صلاحية رؤية العميل.
  const employeeNames = await getSalesEmployeeNames();
  const columns = CLIENT_COLUMNS.map((c) =>
    c.key === "sales_employee" && employeeNames.length > 0
      ? { ...c, list: employeeNames }
      : c
  );

  const wb = new ExcelJS.Workbook();
  wb.creator = "تلال ERP";
  wb.created = new Date();

  const ws = makeSheet(wb, "العملاء");
  writeHeader(ws, columns);

  // صفّان كمثال — ملوّنان بالأصفر ليعرف المستخدم أنهما للحذف
  TEMPLATE_SAMPLE_ROWS.forEach((sample) => {
    const row = ws.addRow(
      columns.map((c) =>
        // اسم الموظف في المثال يجي من ملف الموظفين الحقيقي
        c.key === "sales_employee" ? employeeNames[0] ?? "" : sample[c.key] ?? ""
      )
    );
    row.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF7E0" } };
      cell.font = { italic: true, color: { argb: "FF8A6D1B" } };
    });
  });

  // نجهّز القوائم المنسدلة لـ 500 صف قادمة
  applyColumnRules(ws, columns, 2, 500);
  addInstructionsSheet(wb, columns);

  const buffer = await workbookToBuffer(wb);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": XLSX_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${stampedFileName("tilal-clients-template")}"`,
      "Cache-Control": "no-store",
    },
  });
}
