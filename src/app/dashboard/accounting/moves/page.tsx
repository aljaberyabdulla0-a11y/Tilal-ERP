import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { ARMS, ARM_COLORS, CashMove, Partner, formatPrice } from "@/lib/types";
import AccTabs from "../acc-tabs";
import DeleteMoveButton from "./delete-move-button";

// قائمة كل الحركات المالية (صرف/قبض) مع فلاتر بسيطة
export default async function MovesPage({
  searchParams,
}: {
  searchParams: { dir?: string; arm?: string; q?: string };
}) {
  if (!(await isAdmin())) redirect("/dashboard");

  const supabase = await createClient();

  let query = supabase
    .from("cash_moves")
    .select("*")
    .order("move_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (searchParams.dir === "صرف" || searchParams.dir === "قبض") {
    query = query.eq("direction", searchParams.dir);
  }
  if (searchParams.arm) query = query.eq("arm", searchParams.arm);
  if (searchParams.q) query = query.ilike("description", `%${searchParams.q}%`);

  const [{ data: mData }, { data: pData }] = await Promise.all([
    query,
    supabase.from("partners").select("*"),
  ]);

  const moves = (mData ?? []) as CashMove[];
  const partners = (pData ?? []) as Partner[];
  const partnerName = (id: string | null) =>
    id ? partners.find((p) => p.id === id)?.name ?? "شريك" : null;

  const totalIn = moves
    .filter((m) => m.direction === "قبض")
    .reduce((s, m) => s + Number(m.amount), 0);
  const totalOut = moves
    .filter((m) => m.direction === "صرف")
    .reduce((s, m) => s + Number(m.amount), 0);

  // روابط الفلترة تحافظ على بقية الفلاتر
  const linkWith = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { ...searchParams, ...patch };
    Object.entries(merged).forEach(([k, v]) => {
      if (v) params.set(k, v);
    });
    const qs = params.toString();
    return `/dashboard/accounting/moves${qs ? "?" + qs : ""}`;
  };

  const chip = (active: boolean) =>
    `rounded-lg border px-3 py-1.5 text-sm transition ${
      active
        ? "border-brand-500 bg-brand-50 font-semibold text-brand-700"
        : "border-gray-200 text-gray-600 hover:border-gray-300"
    }`;

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <h1 className="text-xl font-bold text-brand-700">الحركات المالية</h1>
        <div className="flex gap-2">
          <Link
            href="/dashboard/accounting/moves/new?dir=صرف"
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700"
          >
            − سجّل صرف
          </Link>
          <Link
            href="/dashboard/accounting/moves/new?dir=قبض"
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
          >
            + سجّل قبض
          </Link>
        </div>
      </header>

      <AccTabs active="moves" />

      <section className="space-y-5 p-6">
        {/* فلاتر */}
        <div className="glass-card space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-500">النوع:</span>
            <Link href={linkWith({ dir: undefined })} className={chip(!searchParams.dir)}>
              الكل
            </Link>
            <Link href={linkWith({ dir: "صرف" })} className={chip(searchParams.dir === "صرف")}>
              صرف
            </Link>
            <Link href={linkWith({ dir: "قبض" })} className={chip(searchParams.dir === "قبض")}>
              قبض
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-500">الذراع:</span>
            <Link href={linkWith({ arm: undefined })} className={chip(!searchParams.arm)}>
              الكل
            </Link>
            {ARMS.map((a) => (
              <Link key={a} href={linkWith({ arm: a })} className={chip(searchParams.arm === a)}>
                {a}
              </Link>
            ))}
          </div>
          <form className="flex gap-2">
            {searchParams.dir && <input type="hidden" name="dir" value={searchParams.dir} />}
            {searchParams.arm && <input type="hidden" name="arm" value={searchParams.arm} />}
            <input
              type="text"
              name="q"
              defaultValue={searchParams.q ?? ""}
              placeholder="ابحث في البيان..."
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            />
            <button className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
              بحث
            </button>
          </form>
        </div>

        {/* مجموع المعروض */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="glass-card p-4">
            <span className="text-sm text-gray-500">إجمالي المقبوض</span>
            <p className="mt-1 text-xl font-bold text-green-700" dir="ltr">
              {formatPrice(totalIn)}
            </p>
          </div>
          <div className="glass-card p-4">
            <span className="text-sm text-gray-500">إجمالي المصروف</span>
            <p className="mt-1 text-xl font-bold text-red-700" dir="ltr">
              {formatPrice(totalOut)}
            </p>
          </div>
          <div className="glass-card p-4">
            <span className="text-sm text-gray-500">الفرق</span>
            <p
              className={`mt-1 text-xl font-bold ${
                totalIn - totalOut >= 0 ? "text-green-700" : "text-red-700"
              }`}
              dir="ltr"
            >
              {formatPrice(totalIn - totalOut)}
            </p>
          </div>
        </div>

        {/* الجدول */}
        <div className="glass-card p-5">
          {moves.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-gray-400">لا توجد حركات مسجّلة بعد.</p>
              <Link
                href="/dashboard/accounting/moves/new?dir=صرف"
                className="mt-3 inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white"
              >
                سجّل أول حركة
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-right text-sm">
                <thead className="border-b text-gray-500">
                  <tr>
                    <th className="pb-2 font-medium">التاريخ</th>
                    <th className="pb-2 font-medium">البيان</th>
                    <th className="pb-2 font-medium">التصنيف</th>
                    <th className="pb-2 font-medium">الذراع</th>
                    <th className="pb-2 font-medium">من دفع</th>
                    <th className="pb-2 font-medium">المبلغ</th>
                    <th className="pb-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {moves.map((m) => {
                    const who = partnerName(m.partner_id);
                    const fromPocket =
                      m.direction === "صرف" && who && m.account_code !== "2500";
                    return (
                      <tr key={m.id} className="border-b last:border-0">
                        <td className="py-3 text-gray-600" dir="ltr">
                          {m.move_date}
                        </td>
                        <td className="py-3">
                          <span className="font-medium text-gray-800">{m.description}</span>
                          {m.notes && (
                            <span className="block text-xs text-gray-400">{m.notes}</span>
                          )}
                        </td>
                        <td className="py-3 text-gray-600">{m.category}</td>
                        <td className="py-3">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs ${
                              ARM_COLORS[m.arm] ?? "bg-gray-100 text-gray-600"
                            }`}
                          >
                            {m.arm}
                          </span>
                        </td>
                        <td className="py-3 text-gray-600">
                          {who ? (
                            <>
                              {who}
                              {fromPocket && (
                                <span className="block text-xs text-amber-600">من جيبه</span>
                              )}
                            </>
                          ) : (
                            <span className="text-gray-400">الشركة ({m.method})</span>
                          )}
                        </td>
                        <td
                          className={`py-3 font-bold ${
                            m.direction === "قبض" ? "text-green-700" : "text-red-700"
                          }`}
                          dir="ltr"
                        >
                          {m.direction === "قبض" ? "+" : "−"}
                          {formatPrice(Number(m.amount))}
                        </td>
                        <td className="py-3 text-left">
                          <DeleteMoveButton id={m.id} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="text-xs text-gray-400">
          كل حركة هنا تُرحَّل تلقائياً إلى دفتر القيود المحاسبي. لمعاينة القيود، افتح تبويب
          «المحاسبة المتقدمة».
        </p>
      </section>
    </main>
  );
}
