import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, getUserRole } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ============================================================
// البحث الشامل (Ctrl+K) — مجموعات: عملاء، مشاريع، وحدات، حجوزات،
// موظفون، وسطاء، فواتير، مهام. خمس نتائج لكل مجموعة.
//
// ⚠️ الحماية في القاعدة: كل استعلام يمرّ بـRLS بجلسة المستخدم، فلا
//    يرى في النتائج إلا ما يراه في شاشاته. وقائمة المجموعات لكل دور
//    (GROUPS) ليست صلاحية — هي تمنع روابط إلى شاشات ليست له (المحاسب
//    لا يُعرض له «عميل» يفتح شاشة CRM لا يدخلها).
// ============================================================

type Group = "clients" | "projects" | "units" | "reservations" | "employees" | "brokers" | "invoices" | "tasks";
export type SearchHit = { id: string; title: string; sub: string | null; href: string };

const GROUPS: Record<string, Group[]> = {
  admin: ["clients", "projects", "units", "reservations", "employees", "brokers", "invoices", "tasks"],
  supervisor: ["clients", "projects", "units", "reservations", "invoices", "brokers", "tasks"],
  employee: ["clients", "projects", "units", "reservations", "tasks"],
  followup_manager: ["employees", "tasks"],
  relationship_manager: ["clients", "brokers", "tasks"],
  accountant: ["invoices", "tasks"],
  hr: ["employees", "tasks"],
  marketing: ["projects"],
  viewer: ["clients", "projects", "units"],
  broker: ["clients"],
};

const LIMIT = 5;

// نصّ آمن لمرشّح ilike داخل or(): بلا فواصل وأقواس ونجوم ونسب
function clean(q: string): string {
  return q.replace(/[%,()*\\"'.:]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const q = clean(new URL(request.url).searchParams.get("q") ?? "");
  if (q.length < 2) return NextResponse.json({ groups: {} });

  const role = await getUserRole();
  const groups = GROUPS[role] ?? GROUPS.employee;
  const broker = role === "broker";
  const like = `%${q}%`;
  const supabase = await createClient();

  const run: Record<Group, () => Promise<SearchHit[]>> = {
    clients: async () => {
      const { data } = await supabase
        .from("clients")
        .select("id, name, phone, stage")
        .is("deleted_at", null)
        .or(`name.ilike.${like},phone.ilike.${like}`)
        .order("created_at", { ascending: false })
        .limit(LIMIT);
      return (data ?? []).map((c) => ({
        id: c.id, title: c.name, sub: [c.phone, c.stage].filter(Boolean).join(" · ") || null,
        href: broker ? `/dashboard/broker/leads/${c.id}` : `/dashboard/clients/${c.id}`,
      }));
    },
    projects: async () => {
      const { data } = await supabase.from("projects").select("id, name, governorate").ilike("name", like).limit(LIMIT);
      return (data ?? []).map((p) => ({ id: p.id, title: p.name, sub: p.governorate, href: `/dashboard/projects/${p.id}` }));
    },
    units: async () => {
      const { data } = await supabase.from("units").select("id, unit_code, project, status").ilike("unit_code", like).limit(LIMIT);
      return (data ?? []).map((u) => ({ id: u.id, title: u.unit_code ?? "—", sub: [u.project, u.status].filter(Boolean).join(" · ") || null, href: `/dashboard/units/${u.id}` }));
    },
    reservations: async () => {
      const { data } = await supabase
        .from("reservations")
        .select("id, status, reservation_date, clients!inner(name), units(unit_code)")
        .ilike("clients.name", like)
        .order("created_at", { ascending: false })
        .limit(LIMIT);
      return ((data ?? []) as unknown as { id: string; status: string; reservation_date: string | null; clients: { name: string } | null; units: { unit_code: string | null } | null }[])
        .map((r) => ({ id: r.id, title: r.clients?.name ?? "—", sub: [r.units?.unit_code, r.status, r.reservation_date].filter(Boolean).join(" · ") || null, href: `/dashboard/reservations/${r.id}` }));
    },
    employees: async () => {
      const { data } = await supabase.from("employees").select("id, full_name, job_title").ilike("full_name", like).limit(LIMIT);
      return (data ?? []).map((e) => ({ id: e.id, title: e.full_name, sub: e.job_title, href: `/dashboard/hr/employees/${e.id}` }));
    },
    brokers: async () => {
      const { data } = await supabase.from("broker_companies").select("id, name, phone").ilike("name", like).limit(LIMIT);
      return (data ?? []).map((b) => ({ id: b.id, title: b.name, sub: b.phone, href: `/dashboard/brokers/${b.id}` }));
    },
    invoices: async () => {
      const { data } = await supabase.from("invoices").select("id, invoice_number, total_amount, issue_date").ilike("invoice_number", like).limit(LIMIT);
      return (data ?? []).map((i) => ({ id: i.id, title: i.invoice_number, sub: i.issue_date, href: `/dashboard/invoices/${i.id}` }));
    },
    tasks: async () => {
      const { data } = await supabase.from("tasks").select("id, title, status, due_date").ilike("title", like).order("created_at", { ascending: false }).limit(LIMIT);
      return (data ?? []).map((t) => ({ id: t.id, title: t.title, sub: [t.status, t.due_date].filter(Boolean).join(" · ") || null, href: `/dashboard/tasks/${t.id}/edit` }));
    },
  };

  const results = await Promise.all(
    groups.map(async (g) => {
      try {
        return [g, await run[g]()] as const;
      } catch (e) {
        console.error(`[search] ${g}:`, e instanceof Error ? e.message : e);
        return [g, [] as SearchHit[]] as const;
      }
    })
  );

  const out: Partial<Record<Group, SearchHit[]>> = {};
  for (const [g, hits] of results) if (hits.length) out[g] = hits;
  return NextResponse.json({ groups: out });
}
