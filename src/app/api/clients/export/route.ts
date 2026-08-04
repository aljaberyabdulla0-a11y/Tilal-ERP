import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { Client } from "@/lib/types";
import { CLIENT_COLUMNS } from "@/lib/clients-excel";
import {
  makeSheet,
  writeHeader,
  workbookToBuffer,
  stampedFileName,
  XLSX_CONTENT_TYPE,
} from "@/lib/excel-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ============================================================
// تصدير العملاء إلى اكسل — **للمدير فقط**.
// التحقّق هنا على الخادم، فحتى لو فتح الموظف الرابط مباشرة يأخذ 403.
// وحماية الصفوف في القاعدة تمنعه أصلاً من قراءة عملاء غيره.
// ============================================================
export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json(
      { error: "تصدير بيانات العملاء متاح للإدارة فقط." },
      { status: 403 }
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: "تعذّر جلب العملاء: " + error.message },
      { status: 500 }
    );
  }

  const clients = (data ?? []) as Client[];

  const wb = new ExcelJS.Workbook();
  wb.creator = "تلال ERP";
  wb.created = new Date();

  const ws = makeSheet(wb, "العملاء");
  // نضيف عمود تاريخ الإنشاء في التصدير فقط (ليس جزءاً من قالب الاستيراد)
  const columns = [
    ...CLIENT_COLUMNS,
    { key: "created_at", header: "تاريخ الإضافة", width: 20 },
  ];
  writeHeader(ws, columns);

  clients.forEach((c) => {
    const record = c as unknown as Record<string, unknown>;
    ws.addRow(
      columns.map((col) => {
        const v = record[col.key];
        if (v === null || v === undefined) return "";
        if (col.key === "created_at") return String(v).slice(0, 10);
        return v as string;
      })
    );
  });

  // رقم الهاتف كنص حتى لا يبتلع اكسل الصفر الأول
  const phoneIndex = columns.findIndex((c) => c.key === "phone") + 1;
  if (phoneIndex > 0) ws.getColumn(phoneIndex).numFmt = "@";

  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columns.length },
  };

  const buffer = await workbookToBuffer(wb);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": XLSX_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${stampedFileName("tilal-clients")}"`,
      "Cache-Control": "no-store",
    },
  });
}
