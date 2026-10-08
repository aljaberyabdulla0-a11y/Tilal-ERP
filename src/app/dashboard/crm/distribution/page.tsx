import Link from "next/link";
import { redirect } from "next/navigation";
import { getUserRole } from "@/lib/auth";
import {
  getOwnerLoad,
  getDistributionAlerts,
  getUnworkedLeads,
  getAssignmentRules,
  getEmployeesLite,
  getProjectsLite,
  getSources,
  SEVERITY_STYLE,
  type DistributionAlert,
} from "@/lib/crm";
import CrmTabs from "../crm-tabs";
import RedistributePanel from "./redistribute-panel";
import RulesPanel from "./rules-panel";
import { createClient } from "@/lib/supabase/server";

// ============================================================
// «مركز توزيع الليدات»
//
// الشاشة التي تفصل ثلاثة أشياء كان النظام يخلطها في رقم واحد:
//
//     حجم المُسنَد    كم ليداً أُعطي؟        ليس أداءً
//     تركّز الإسناد   هل أُغرِق بها دفعة؟    خلل توزيع
//     العمل عليها     ماذا فعل بما أُعطي؟    هذا وحده الأداء
//
// وسبب وجودها حادثة حقيقية في البيانات: ٦٢ عميلاً «مهملاً»، كلهم
// صامتون منذ خمسين يوماً، كلهم في مرحلة واحدة، كلهم باسم موظفة
// واحدة. وجدول «أداء الفريق» كان يعرض ذلك في عمود «بلا تواصل» —
// أي أنه يقول للإدارة إن الموظفة مقصّرة، والحقيقة أن دفعة مستوردة
// أُسنِدت جملةً ولم تُوزَّع.
//
// ولذلك ترتيب الأقسام هنا مقصود:
//     ١) التنبيهات أولاً — ما الذي يحتاج تدخّلاً؟
//     ٢) ثم جدول الحِمل — ما أُعطي قبل ما أُنجز.
//     ٣) ثم إعادة التوزيع — الفعل نفسه.
// لا يُعرض رقم أداء قبل أن يُعرض حجم ما أُسنِد.
// ============================================================
// ============================================================
// من التنبيه إلى الحلّ
//
// تنبيهٌ يُقرأ ثم يُنسى لا يُصلح شيئاً. فكل تنبيه يحمل أزراره: زرٌّ
// يُريك الليدات نفسها، وزرٌّ يفتح إعادة التوزيع مملوءةً بصاحبها.
// والحالة في العنوان (?owner=…&act=…) لا في ذاكرة المتصفّح — فالرابط
// يُنسخ ويُرسل، و«رجوع» يعيدك إلى ما كنت فيه.
//
//     act=unworked    اعرض ليداته التي لم يُشتغَل عليها
//     act=move        افتح إعادة التوزيع: غير المُشتغَل فقط
//     act=handover    افتح إعادة التوزيع: كل المفتوح (تسليم عهدة)
// ============================================================
type FocusAct = "unworked" | "move" | "handover";
const ACTS: FocusAct[] = ["unworked", "move", "handover"];

type AlertAction = { label: string; href: string; primary?: boolean };

function alertActions(a: DistributionAlert, canMove: boolean, isAdminRole: boolean): AlertAction[] {
  const o = a.subject_id;
  const focus = (act: FocusAct, hash: string) =>
    `/dashboard/crm/distribution?owner=${o}&act=${act}#${hash}`;
  const clients = (extra = "") => `/dashboard/clients?owner=${o}${extra}`;

  switch (a.code) {
    case "unworked_batch":
      if (!o) return [];
      return [
        { label: "اعرض الليدات وتاريخ إسنادها", href: focus("unworked", "unworked"), primary: true },
        ...(canMove ? [{ label: "أعد توزيعها", href: focus("move", "redistribute") }] : []),
        { label: "في قائمة العملاء", href: clients("&contact=never") },
      ];
    case "over_capacity":
    case "owner_concentration":
      if (!o) return [];
      return [
        ...(canMove
          ? [{ label: "وزّع الفائض", href: focus("move", "redistribute"), primary: true }]
          : []),
        { label: "ليداته بلا تواصل", href: focus("unworked", "unworked") },
        { label: "كل عملائه", href: clients() },
      ];
    case "inactive_owner":
      if (!o) return [];
      return [
        // الإجازة والعهدة في HR — والملفّ للإدارة وحدها هنا
        ...(isAdminRole
          ? [{ label: "ملفّه في الموارد البشرية", href: `/dashboard/hr/employees/${o}`, primary: true }]
          : []),
        { label: "عملاؤه", href: clients() },
        ...(canMove ? [{ label: "تسليم عهدته", href: focus("handover", "redistribute") }] : []),
      ];
    case "ownerless_leads":
      return [
        { label: "اعرض الليدات بلا مالك", href: "/dashboard/clients?owner=none", primary: true },
        ...(canMove ? [{ label: "وزّعها بالقواعد", href: "/dashboard/crm/distribution#rules" }] : []),
      ];
    default:
      return [];
  }
}

export default async function DistributionPage({
  searchParams,
}: {
  searchParams: { owner?: string; act?: string };
}) {
  const role = await getUserRole();
  // ⚠️ التوزيع فعلٌ لا تقرير: التسويق والمُطالِع خارجه عمداً
  if (role !== "admin" && role !== "followup_manager" && role !== "supervisor") {
    redirect("/dashboard");
  }

  const supabase = await createClient();
  const [load, alerts, unworked, rules, employees, projects, sources, ownerlessRes] =
    await Promise.all([
      getOwnerLoad(),
      getDistributionAlerts(),
      getUnworkedLeads(),
      getAssignmentRules(),
      getEmployeesLite(),
      getProjectsLite(),
      getSources(),
      // المفتوحة بلا مالك وحدها — المغلق لا يُوزَّع (sql/081)
      supabase
        .from("clients")
        .select("id", { count: "exact", head: true })
        .is("owner_id", null)
        .not("stage", "in", '("بيع","فشل البيع")'),
    ]);
  const ownerless = ownerlessRes.count ?? 0;

  const totalOpen = load.reduce((s, r) => s + Number(r.open_leads), 0);

  // إعادة التوزيع والقواعد من صلاحية الإدارة ومدير المتابعة وحدهما
  // (redistribute_leads وسياسة crm_assignment_rules) — المشرف يرى ولا ينقل
  const canMove = role === "admin" || role === "followup_manager";
  // معرّفٌ مُلفَّق أو لموظف خرج من الحِمل يُتجاهل بصمت
  const focusOwner = load.some((r) => r.owner_id === searchParams.owner)
    ? (searchParams.owner as string)
    : null;
  const focusAct =
    focusOwner && ACTS.includes(searchParams.act as FocusAct)
      ? (searchParams.act as FocusAct)
      : null;

  return (
    <div>
      <CrmTabs active="distribution" />

      <div className="space-y-6 p-6">
        <header>
          <h1 className="text-xl font-bold text-brand-600">مركز توزيع الليدات</h1>
          <p className="mt-1 text-sm text-gray-500">
            ما أُعطي لكل موظف قبل ما أنجزه — لأن الرقم الثاني لا يُقرأ بلا الأول.
          </p>
        </header>

        {/* ===== ١) التنبيهات ===== */}
        <section>
          <h2 className="mb-3 font-bold text-gray-800">ما يحتاج تدخّلاً</h2>
          {alerts.length === 0 ? (
            <p className="rounded-lg border border-gray-200 bg-white px-5 py-6 text-center text-sm text-gray-400">
              لا شذوذ في التوزيع.
            </p>
          ) : (
            <ul className="space-y-3">
              {alerts.map((a, i) => (
                <li
                  key={`${a.code}-${a.subject_id ?? i}`}
                  className={`rounded-lg border p-4 ${
                    SEVERITY_STYLE[a.severity] ?? SEVERITY_STYLE["منخفض"]
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-white/70 px-2 py-0.5 text-xs font-bold">
                      {a.severity}
                    </span>
                    <span className="font-bold">{a.title}</span>
                  </div>
                  <p className="mt-1 text-sm">{a.detail}</p>
                  {/* التوصية هي جوهر التنبيه: تنبيهٌ بلا مخرج يُقلق ولا يُصلح */}
                  <p className="mt-2 border-t border-current/20 pt-2 text-sm font-medium">
                    ↳ {a.recommendation}
                  </p>
                  <AlertActions actions={alertActions(a, canMove, role === "admin")} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ===== ٢) الحِمل ===== */}
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-bold text-gray-800">حِمل الموظفين</h2>
            <span className="text-xs text-gray-500">
              {totalOpen.toLocaleString("en-US")} ليداً مفتوحاً موزّعة على {load.length} موظفاً
            </span>
          </div>

          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-right text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-medium">الموظف</th>
                  {/* ما أُعطي */}
                  <th className="px-4 py-3 font-medium">الكل</th>
                  <th className="px-4 py-3 font-medium">مفتوح</th>
                  <th className="px-4 py-3 font-medium">حصّته</th>
                  {/* ما عُمل */}
                  <th className="px-4 py-3 font-medium text-amber-700">بلا تواصل قطّ</th>
                  <th className="px-4 py-3 font-medium text-amber-700">لم يُشتغَل</th>
                  <th className="px-4 py-3 font-medium text-red-700">مهمل</th>
                  <th className="px-4 py-3 font-medium text-red-700">متأخر</th>
                  {/* النتيجة */}
                  <th className="px-4 py-3 font-medium">بيع</th>
                  <th className="px-4 py-3 font-medium">آخر نشاط</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {load.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-8 text-center text-gray-400">
                      لا بيانات — تأكّد من تشغيل الهجرات ٠٧٠–٠٨٠.
                    </td>
                  </tr>
                ) : (
                  load.map((r) => {
                    const share =
                      totalOpen > 0 ? Math.round((Number(r.open_leads) * 100) / totalOpen) : 0;
                    return (
                      <tr key={r.owner_id} className={r.over_capacity ? "bg-red-50" : ""}>
                        <td className="px-4 py-3 font-medium text-gray-800">
                          {r.owner_name}
                          {r.over_capacity && (
                            <span className="ms-2 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">
                              تجاوز الطاقة
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-600">{r.total_leads}</td>
                        <td className="px-4 py-3 font-semibold text-gray-800">{r.open_leads}</td>
                        <td className="px-4 py-3">
                          {/* الحصّة تكشف التركّز بنظرة — الثلث فأكثر علامة خلل */}
                          <span className={share >= 33 ? "font-bold text-red-700" : "text-gray-500"}>
                            {share}%
                          </span>
                        </td>
                        <td className="px-4 py-3 text-amber-700">{r.never_contacted || "—"}</td>
                        <td className="px-4 py-3 text-amber-700">{r.unworked || "—"}</td>
                        <td className="px-4 py-3 text-red-700">{r.neglected || "—"}</td>
                        <td className="px-4 py-3 text-red-700">{r.overdue || "—"}</td>
                        <td className="px-4 py-3 font-semibold text-brand-600">
                          {r.won_leads || "—"}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">
                          {r.last_activity
                            ? new Date(r.last_activity).toLocaleDateString("en-CA", {
                                timeZone: "Asia/Baghdad",
                              })
                            : "لا يوجد"}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <p className="mt-2 text-xs text-gray-500">
            «لم يُشتغَل» = أُسنِد ومضت مهلة العمل بلا تواصل واحد. وهو مؤشّر توزيع قبل أن
            يكون مؤشّر أداء: دفعةٌ أُسنِدت جملةً تظهر هنا كاملةً في يوم واحد.
          </p>
        </section>

        {/* ===== ٣) الفعل ===== */}
        {/* المفتاح يعيد بناء اللوحة حين يتغيّر التركيز: حالتها الأولى تُقرأ مرّة */}
        <RedistributePanel
          key={`${focusOwner ?? ""}-${focusAct ?? ""}`}
          owners={load}
          unworked={unworked}
          focusOwner={focusOwner}
          focusAct={focusAct}
          canMove={canMove}
        />

        {/* ===== ٤) القواعد — التوزيع قبل أن يحتاج إعادة توزيع =====
            إعادة التوزيع علاج، والقاعدة وقاية: ليدٌ يُسنَد بالأقلّ حِملاً
            لا يصنع تركّزاً يُعالَج لاحقاً. للإدارة ومدير المتابعة وحدهما
            (القاعدة تفرض ذلك في سياسة crm_assignment_rules). */}
        {canMove && (
          <div id="rules" className="scroll-mt-4">
            <RulesPanel
              rules={rules}
              employees={employees}
              projects={projects}
              sources={sources}
              ownerless={ownerless}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function AlertActions({ actions }: { actions: AlertAction[] }) {
  if (actions.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {actions.map((x) => (
        <Link
          key={x.href}
          href={x.href}
          className={
            x.primary
              ? "rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700"
              : "rounded-lg border border-current/30 bg-white/70 px-3 py-1.5 text-xs font-semibold transition hover:bg-white"
          }
        >
          {x.label} ←
        </Link>
      ))}
    </div>
  );
}
