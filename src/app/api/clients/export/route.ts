import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { Client } from "@/lib/types";
import { CLIENT_COLUMNS } from "@/lib/clients-excel";
import { getPipelineConfig } from "@/lib/crm-config";
import { getEmployeesLite, getTags, TEMPERATURE_STYLE } from "@/lib/crm";
import { baghdadDate } from "@/lib/time";
import {
  applyClientListFilters,
  parseClientListFilters,
  type ClientListSearchParams,
} from "@/lib/client-list-filters";
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
export async function GET(request: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json(
      { error: "تصدير بيانات العملاء متاح للإدارة فقط." },
      { status: 403 }
    );
  }

  // مُرشِّحات القائمة نفسها (client-list-filters.ts): ما يراه المدير
  // في القائمة هو ما يُصدَّر. بلا مُرشِّح = كل العملاء كما كان.
  const sp = Object.fromEntries(new URL(request.url).searchParams) as ClientListSearchParams;
  const [cfg, tags, employees] = await Promise.all([getPipelineConfig(), getTags(), getEmployeesLite()]);
  const today = baghdadDate();
  const { filters: f } = parseClientListFilters(sp, {
    stages: Object.keys(cfg.colors),
    sources: cfg.sources,
    owners: employees,
    tags,
    temperatures: Object.keys(TEMPERATURE_STYLE),
    today,
  });

  const supabase = await createClient();

  let tagClientIds: string[] | null = null;
  if (f.tag) {
    const { data: links } = await supabase
      .from("client_tags").select("client_id").eq("tag_id", f.tag).limit(5000);
    tagClientIds = (links ?? []).map((l: { client_id: string }) => l.client_id);
  }

  const { data, error } = await applyClientListFilters(
    supabase.from("clients").select("*").order("created_at", { ascending: false }),
    f,
    { today, now: new Date(), tagClientIds }
  );

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
