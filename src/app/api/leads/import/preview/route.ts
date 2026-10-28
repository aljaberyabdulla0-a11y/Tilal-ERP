import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/server";
import { cellToText } from "@/lib/clients-excel";
import { decodeCsv, guessMapping, parseCsv } from "@/lib/lead-sheet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 3000;

// ============================================================
// استيراد Lead Sheet — الخطوة ١: قراءة الملف بلا أيّ حفظ (218).
// يُرجع العناوين والصفوف نصّاً ومطابقةً مقترحة وبصمة الملف. التحقّق
// والحفظ في المتصفّح ثم lead_import_rows — والقاعدة هي الحارس: تعيد
// تطبيع الهاتف وكشف التكرار بنفسها ولا تثق بالمعاينة.
// ============================================================
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("can_import_leads");
  if (allowed !== true) {
    return NextResponse.json({ error: "استيراد الليدات للإدارة ومدير المتابعة وفريق التسويق." }, { status: 403 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "لم يُرفَق أي ملف." }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: "الملف فارغ." }, { status: 400 });
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "حجم الملف أكبر من 5 ميغابايت. قسّمه إلى ملفات أصغر." }, { status: 400 });
  }

  const buf = new Uint8Array(await file.arrayBuffer());
  const fileHash = createHash("sha256").update(buf).digest("hex");
  const lower = file.name.toLowerCase();
  let table: string[][] = [];

  if (lower.endsWith(".csv") || lower.endsWith(".tsv") || lower.endsWith(".txt")) {
    table = parseCsv(decodeCsv(buf));
  } else if (lower.endsWith(".xlsx")) {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    } catch {
      return NextResponse.json({ error: "تعذّر فتح ملف Excel. احفظه بصيغة .xlsx أو صدّره CSV." }, { status: 400 });
    }
    const ws = wb.worksheets.find((s) => s.rowCount > 1) ?? wb.worksheets[0];
    if (!ws) return NextResponse.json({ error: "الملف لا يحتوي على أي ورقة." }, { status: 400 });
    const width = ws.columnCount;
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      for (let c = 1; c <= width; c++) cells.push(cellToText(row.getCell(c).value).trim());
      table.push(cells);
    });
  } else {
    return NextResponse.json({ error: "الصيغ المقبولة: .xlsx أو .csv" }, { status: 400 });
  }

  if (table.length < 2) {
    return NextResponse.json({ error: "لا صفوف تحت صفّ العناوين." }, { status: 400 });
  }
  const headers = table[0].map((h) => h.trim());
  const rows = table.slice(1, MAX_ROWS + 1);

  return NextResponse.json({
    fileName: file.name,
    fileHash,
    headers,
    rows,
    mapping: guessMapping(headers),
    truncated: table.length - 1 > MAX_ROWS,
    maxRows: MAX_ROWS,
  });
}
