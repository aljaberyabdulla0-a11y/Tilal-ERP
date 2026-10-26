import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_UPDATES = 5000;
const PARALLEL = 20;
const MAX_PRICE = 1e13;

type Incoming = { id?: unknown; price?: unknown };

// ============================================================
// تحديث الأسعار — الخطوة ٢: الحفظ.
// لا نثق بالمتصفح: الوحدة يجب أن تكون من هذا المشروع، والسعر رقماً
// موجباً. ويُحفظ ما تغيّر وحده، فكل تعديل يُسجَّل في تاريخ الوحدة
// (track_unit_changes) مرّةً واحدة، وسعر المتر يحسبه stamp_unit.
// ============================================================
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "تعديل أسعار الوحدات للإدارة فقط." }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as { updates?: Incoming[] } | null;
  const incoming = body?.updates;
  if (!Array.isArray(incoming) || incoming.length === 0) {
    return NextResponse.json({ error: "لا أسعار للحفظ." }, { status: 400 });
  }
  if (incoming.length > MAX_UPDATES) {
    return NextResponse.json({ error: `الحدّ ${MAX_UPDATES} وحدة في المرّة.` }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: units, error: readErr } = await supabase
    .from("units")
    .select("id, price")
    .eq("project_id", params.id);
  if (readErr) {
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }
  const current = new Map((units ?? []).map((u) => [u.id as string, u.price as number | null]));

  const todo: { id: string; price: number }[] = [];
  const rejected: { id: string; error: string }[] = [];
  const seen = new Set<string>();
  for (const u of incoming) {
    const id = typeof u.id === "string" ? u.id : "";
    const price = typeof u.price === "number" ? Math.round(u.price) : NaN;
    if (!current.has(id)) {
      rejected.push({ id, error: "الوحدة ليست من هذا المشروع." });
    } else if (!Number.isFinite(price) || price <= 0 || price > MAX_PRICE) {
      rejected.push({ id, error: "سعر غير صالح." });
    } else if (seen.has(id)) {
      rejected.push({ id, error: "الوحدة مكرّرة في الطلب." });
    } else {
      seen.add(id);
      if (Number(current.get(id)) !== price) todo.push({ id, price });
    }
  }

  let updated = 0;
  for (let i = 0; i < todo.length; i += PARALLEL) {
    const chunk = todo.slice(i, i + PARALLEL);
    const results = await Promise.all(
      chunk.map((u) =>
        supabase.from("units").update({ price: u.price }).eq("id", u.id).select("id")
      )
    );
    // RLS يرفض بصمت: صفرُ صفوفٍ بلا خطأ يُعدّ رفضاً لا نجاحاً
    results.forEach((res, j) => {
      if (res.error) rejected.push({ id: chunk[j].id, error: res.error.message });
      else if (!res.data?.length) rejected.push({ id: chunk[j].id, error: "لم تُحدَّث (صلاحية)." });
      else updated++;
    });
  }

  return NextResponse.json({
    updated,
    unchanged: seen.size - todo.length,
    rejected,
  });
}
