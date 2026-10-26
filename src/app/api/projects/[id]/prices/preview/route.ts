import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { isAdmin } from "@/lib/auth";
import { cellToText } from "@/lib/clients-excel";
import { getProject, getProjectUnits } from "@/lib/estate";
import { buildPricePreview, type SheetCells } from "@/lib/unit-prices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS_PER_SHEET = 5000;

// ============================================================
// تحديث الأسعار — الخطوة ١: قراءة ملف التسعير ومطابقته بوحدات
// المشروع **بلا أي حفظ**. كل الأوراق تُقرأ (ورقة لكل برج).
// سعر الوحدة للمدير وحده (guard_unit_authority)، فالمعاينة كذلك.
// ============================================================
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "تعديل أسعار الوحدات للإدارة فقط." }, { status: 403 });
  }

  const project = await getProject(params.id);
  if (!project) {
    return NextResponse.json({ error: "المشروع غير موجود." }, { status: 404 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "لم يُرفَق أي ملف." }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "الملف فارغ." }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "حجم الملف أكبر من 5 ميغابايت." }, { status: 400 });
  }

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(await file.arrayBuffer());
  } catch {
    return NextResponse.json(
      { error: "تعذّر فتح الملف. تأكّد أنه ملف اكسل بصيغة .xlsx (وليس .xls أو CSV)." },
      { status: 400 }
    );
  }

  const sheets: SheetCells[] = wb.worksheets
    .filter((ws) => ws.state === "visible" || ws.state === undefined)
    .map((ws) => {
      const rows: string[][] = [];
      const width = ws.columnCount;
      const last = Math.min(ws.rowCount, MAX_ROWS_PER_SHEET);
      for (let r = 1; r <= last; r++) {
        const row = ws.getRow(r);
        const cells: string[] = [];
        for (let c = 1; c <= width; c++) cells.push(cellToText(row.getCell(c).value));
        rows.push(cells);
      }
      return { name: ws.name, rows };
    });

  const units = await getProjectUnits(project.id);
  if (units.length === 0) {
    return NextResponse.json({ error: "لا وحدات في هذا المشروع بعد." }, { status: 400 });
  }

  const preview = buildPricePreview(sheets, units);
  if (!preview.sheets.some((s) => s.used)) {
    return NextResponse.json(
      {
        error:
          "لم نجد في الملف عمود سعر («السعر» أو «السعر الإجمالي» أو «سعر المتر») بجانب عمودٍ لأكواد الوحدات تطابق وحدات المشروع.",
      },
      { status: 400 }
    );
  }

  return NextResponse.json({ fileName: file.name, ...preview });
}
