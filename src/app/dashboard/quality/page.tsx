import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";

// ضبط الجودة — الصفحة الرئيسية. المراجعات نفسها (الطابور، «مراجعاتي»، صفحة الحالة) تأتي مع sql/233؛
// هنا الآن: الفريق وعضويتي فيه، ورابط الإدارة للمدير العام.
export default async function QualityHome() {
  const supabase = await createClient();
  const admin = await isAdmin();
  const { data: me } = await supabase.rpc("my_employee_id");
  const [{ data: teams }, { data: mine }, { data: types }] = await Promise.all([
    supabase.from("review_teams").select("id, name_ar, status").is("archived_at", null),
    me
      ? supabase.from("review_team_members").select("team_id, member_role, status, max_open_reviews")
          .eq("employee_id", me as string).in("status", ["active", "suspended"])
      : Promise.resolve({ data: [] as { team_id: string; member_role: string; status: string; max_open_reviews: number }[] }),
    supabase.from("review_types").select("code, name_ar, is_active").order("sort_order"),
  ]);
  const ROLE: Record<string, string> = { leader: "قائد الفريق", reviewer: "مراجع", member: "عضو" };
  const STATUS: Record<string, string> = { draft: "مسودة — لم يُفعَّل بعد", active: "فعّال", suspended: "موقوف" };
  const membership = (mine ?? []) as { team_id: string; member_role: string; status: string; max_open_reviews: number }[];

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between border-b bg-white px-6 py-4 shadow-sm">
        <h1 className="text-xl font-bold text-brand-700">ضبط الجودة</h1>
        {admin && (
          <Link href="/dashboard/quality/team" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white">
            إدارة الفريق
          </Link>
        )}
      </header>
      <section className="grid gap-4 p-6 md:grid-cols-2">
        {((teams ?? []) as { id: string; name_ar: string; status: string }[]).map((t) => {
          const m = membership.find((x) => x.team_id === t.id);
          return (
            <div key={t.id} className="rounded-2xl border bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-800">{t.name_ar}</h2>
              <p className="mt-1 text-sm text-gray-500">{STATUS[t.status] ?? t.status}</p>
              {m ? (
                <p className="mt-3 text-sm">دورك: <span className="font-semibold">{ROLE[m.member_role]}</span>
                  {m.status === "suspended" ? " (موقوف مؤقتاً)" : ""} · حتى {m.max_open_reviews} حالة مفتوحة</p>
              ) : (
                !admin && <p className="mt-3 text-sm text-gray-400">لست عضواً في هذا الفريق.</p>
              )}
            </div>
          );
        })}
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-800">أنواع المراجعة</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {((types ?? []) as { code: string; name_ar: string; is_active: boolean }[]).map((t) => (
              <li key={t.code} className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${t.is_active ? "bg-green-500" : "bg-gray-300"}`} />
                {t.name_ar}{!t.is_active && <span className="text-xs text-gray-400">(لاحقاً)</span>}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-gray-500">
            مراجعات العملاء (الطابور، «مراجعاتي»، وصفحة الحالة) تُفعَّل في المرحلة التالية بعد اكتمال محرّك المراجعات.
          </p>
        </div>
      </section>
    </main>
  );
}
