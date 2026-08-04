import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { getSalesEmployeeNames } from "@/lib/hr";
import { CLIENT_COLUMNS, validateRow } from "@/lib/clients-excel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ROWS = 3000;
const CHUNK = 200; // نحفظ على دفعات حتى لا يكبر الطلب على القاعدة

type IncomingRow = { rowNumber?: number; values?: Record<string, unknown> };

// ============================================================
// الخطوة ٢ من الاستيراد: الحفظ الفعلي.
// نعيد التحقّق من كل صف هنا من جديد — ما نثق بما يرسله المتصفح
// حتى لو كان جاء من شاشة المعاينة.
// ============================================================
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json(
      { error: "استيراد العملاء متاح للإدارة فقط." },
      { status: 403 }
    );
  }

  const body = (await req.json().catch(() => null)) as { rows?: IncomingRow[] } | null;
  const incoming = body?.rows;
  if (!Array.isArray(incoming) || incoming.length === 0) {
    return NextResponse.json({ error: "لا توجد صفوف للحفظ." }, { status: 400 });
  }
  if (incoming.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `الحد الأقصى ${MAX_ROWS} صف في المرة الواحدة.` },
      { status: 400 }
    );
  }

  // إعادة تحقّق كاملة من جهة الخادم
  const employeeNames = await getSalesEmployeeNames();
  const payload: Record<string, string | null>[] = [];
  const rejected: { rowNumber: number; errors: string[] }[] = [];

  incoming.forEach((row, i) => {
    const raw: Record<string, string> = {};
    for (const col of CLIENT_COLUMNS) {
      const v = row.values?.[col.key];
      raw[col.key] = v === null || v === undefined ? "" : String(v);
    }
    const checked = validateRow(row.rowNumber ?? i + 2, raw, employeeNames);
    if (checked.errors.length > 0) {
      rejected.push({ rowNumber: checked.rowNumber, errors: checked.errors });
      return;
    }
    payload.push(checked.values);
  });

  if (payload.length === 0) {
    return NextResponse.json(
      { error: "كل الصفوف المرسلة فيها أخطاء ولم يُحفَظ شيء.", rejected },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let inserted = 0;
  for (let i = 0; i < payload.length; i += CHUNK) {
    const chunk = payload
      .slice(i, i + CHUNK)
      .map((r) => ({ ...r, created_by: user?.id ?? null }));

    const { error, count } = await supabase
      .from("clients")
      .insert(chunk, { count: "exact" });

    if (error) {
      return NextResponse.json(
        {
          error: `توقّف الحفظ بعد ${inserted} عميل بسبب: ${error.message}`,
          inserted,
          rejected,
        },
        { status: 500 }
      );
    }
    inserted += count ?? chunk.length;
  }

  return NextResponse.json({ inserted, rejected });
}
