import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { getSalesEmployeeNames } from "@/lib/hr";
import { CLIENT_COLUMNS, ParsedRow, cellToText, validateRow } from "@/lib/clients-excel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 ميغابايت
const MAX_ROWS = 3000;

// ============================================================
// الخطوة ١ من الاستيراد: قراءة الملف وفحصه **بدون أي حفظ**.
// نرجّع للمستخدم كل صف ومعه أخطاؤه إن وُجدت، ليقرّر قبل الحفظ.
// ============================================================
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json(
      { error: "رفع ملفات العملاء متاح للإدارة فقط." },
      { status: 403 }
    );
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
    return NextResponse.json(
      { error: "حجم الملف أكبر من 5 ميغابايت. قسّمه إلى ملفات أصغر." },
      { status: 400 }
    );
  }

  // قراءة الملف
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(await file.arrayBuffer());
  } catch {
    return NextResponse.json(
      { error: "تعذّر فتح الملف. تأكّد أنه ملف اكسل بصيغة .xlsx (وليس .xls أو CSV)." },
      { status: 400 }
    );
  }

  // نبحث عن ورقة «العملاء»، وإلا نأخذ أول ورقة فيها بيانات
  const ws =
    wb.getWorksheet("العملاء") ??
    wb.worksheets.find((s) => s.name !== "التعليمات" && s.rowCount > 1) ??
    wb.worksheets[0];

  if (!ws) {
    return NextResponse.json({ error: "الملف لا يحتوي على أي ورقة." }, { status: 400 });
  }

  // مطابقة العناوين بالاسم (يسمح بإعادة ترتيب الأعمدة)
  const headerRow = ws.getRow(1);
  const headerToIndex = new Map<string, number>();
  headerRow.eachCell((cell, colNumber) => {
    const text = cellToText(cell.value).trim();
    if (text) headerToIndex.set(text, colNumber);
  });

  const missingRequired = CLIENT_COLUMNS.filter(
    (c) => c.required && !headerToIndex.has(c.header)
  );
  if (missingRequired.length > 0) {
    return NextResponse.json(
      {
        error: `الملف ينقصه عمود «${missingRequired
          .map((c) => c.header)
          .join("» و«")}». نزّل القالب من النظام واستخدمه.`,
      },
      { status: 400 }
    );
  }

  // قراءة الصفوف
  const employeeNames = await getSalesEmployeeNames();
  const rows: ParsedRow[] = [];
  let truncated = false;

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // العناوين
    if (rows.length >= MAX_ROWS) {
      truncated = true;
      return;
    }

    const raw: Record<string, string> = {};
    let hasAnyValue = false;
    for (const col of CLIENT_COLUMNS) {
      const idx = headerToIndex.get(col.header);
      const text = idx ? cellToText(row.getCell(idx).value).trim() : "";
      raw[col.key] = text;
      if (text) hasAnyValue = true;
    }

    if (!hasAnyValue) return; // صف فارغ تماماً
    rows.push(validateRow(rowNumber, raw, employeeNames));
  });

  if (rows.length === 0) {
    return NextResponse.json(
      { error: "ما لقينا أي صف فيه بيانات تحت صف العناوين." },
      { status: 400 }
    );
  }

  // كشف التكرار: مقابل أرقام موجودة في النظام، ومقابل الملف نفسه
  const phones = rows
    .map((r) => r.values.phone)
    .filter((p): p is string => Boolean(p));

  const existing = new Set<string>();
  if (phones.length > 0) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("clients")
      .select("phone")
      .in("phone", Array.from(new Set(phones)));
    (data ?? []).forEach((c: { phone: string | null }) => {
      if (c.phone) existing.add(c.phone);
    });
  }

  const seenInFile = new Set<string>();
  for (const r of rows) {
    const phone = r.values.phone;
    if (!phone) continue;
    if (existing.has(phone)) {
      r.duplicate = true;
      r.errors.push(`رقم الهاتف ${phone} موجود مسبقاً في النظام.`);
    } else if (seenInFile.has(phone)) {
      r.duplicate = true;
      r.errors.push(`رقم الهاتف ${phone} مكرّر داخل الملف نفسه.`);
    }
    seenInFile.add(phone);
  }

  const valid = rows.filter((r) => r.errors.length === 0).length;

  return NextResponse.json({
    fileName: file.name,
    sheetName: ws.name,
    rows,
    summary: {
      total: rows.length,
      valid,
      invalid: rows.length - valid,
      duplicates: rows.filter((r) => r.duplicate).length,
      truncated,
      maxRows: MAX_ROWS,
    },
  });
}
