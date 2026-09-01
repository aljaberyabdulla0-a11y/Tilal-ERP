import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getMyEmployee } from "@/lib/hr";
import { canEditUnit } from "@/lib/projects";
import {
  getProject,
  getProjectHeldReservations,
  getProjectNodes,
  getProjectUnits,
  getUnitTypes,
} from "@/lib/estate";
import {
  buildNodeTree,
  formatPrice,
  ownsReservation,
  salePending,
  summarizeUnits,
} from "@/lib/types";
import InventoryBrowser from "./inventory-browser";
import ProjectDeals from "./project-deals";

// ============================================================
// مخزون المشروع — الشاشة التي تُدار منها الوحدات.
//
// تُجلب العقد والوحدات مرة واحدة ثم يُبنى كل شيء في الذاكرة:
// الشجرة والعدادات والتصفية. مشروع بألف وحدة استعلامان لا ألف.
//
// نفس الشاشة تخدم ثلاثة، وتختلف بقدر ما يملك كلٌّ منهم:
//   الإدارة (المدير ومشرف المشروع): الهيكل والرفع والوحدة الجديدة،
//       وقيمة المخزون، والبتّ في طلبات البيع.
//   الموظف: المخزون وحده — يتصفّح، ويحجز من صفحة الوحدة، ويطلب
//       تحويل حجزه إلى بيع. لا أزرار إدارة ولا أرقام مالية
//       (قيمة المخزون وقيمة المبيعات أرقامُ الشركة لا أرقامُه).
// ============================================================
export default async function ProjectInventoryPage({
  params,
}: {
  params: { id: string };
}) {
  const project = await getProject(params.id);
  if (!project) notFound();

  const [nodes, units, unitTypes, admin] = await Promise.all([
    getProjectNodes(params.id),
    getProjectUnits(params.id),
    getUnitTypes(),
    isAdmin(),
  ]);

  const canManage = await canEditUnit(project.id, admin);
  const tree = buildNodeTree(nodes);
  const s = summarizeUnits(units);

  // الحجوزات القائمة: للإدارة ما ينتظر قرارها، وللموظف صفقاته هو
  const [held, user, myEmployee] = await Promise.all([
    getProjectHeldReservations(project.id),
    getCurrentUser(),
    getMyEmployee(),
  ]);

  const deals = canManage
    ? held.filter((r) => salePending(r))
    : held.filter((r) => ownsReservation(r, user?.id, myEmployee?.id));

  const tile = "glass-card border-s-4 p-5 transition hover:shadow-md";

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/projects"
            className="text-sm text-gray-500 hover:text-brand-700"
          >
            ← المشاريع
          </Link>
          <div>
            <h1 className="text-xl font-bold text-brand-700">{project.name}</h1>
            <p className="text-sm text-gray-500">
              {[project.governorate, project.area].filter(Boolean).join(" — ") ||
                "مخزون المشروع"}
            </p>
          </div>
        </div>

        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/dashboard/projects/${project.id}/structure`}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
            >
              الهيكل
            </Link>
            <Link
              href={`/dashboard/projects/${project.id}/import`}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
            >
              رفع جماعي
            </Link>
            <Link
              href={`/dashboard/projects/${project.id}/units/new`}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
            >
              + وحدة جديدة
            </Link>
          </div>
        )}
      </header>

      <section className="space-y-5 p-6">
        {/* لوحة المخزون — كل بطاقة رابط يصفّي القائمة بحالتها */}
        <div
          className={`grid grid-cols-2 gap-4 ${
            canManage ? "lg:grid-cols-5" : "lg:grid-cols-4"
          }`}
        >
          <div className={tile + " border-s-brand-500"}>
            <span className="text-sm text-gray-500">إجمالي الوحدات</span>
            <p className="mt-1 text-2xl font-bold text-gray-800">{s.total}</p>
            {canManage && (
              <p className="mt-1 text-[11px] text-gray-400" dir="ltr">
                {formatPrice(s.value)} د.ع
              </p>
            )}
          </div>
          <a href="#units" className={tile + " border-s-green-500"}>
            <span className="text-sm text-gray-500">متاحة</span>
            <p className="mt-1 text-2xl font-bold text-green-700">{s.available}</p>
          </a>
          <a href="#units" className={tile + " border-s-amber-500"}>
            <span className="text-sm text-gray-500">محجوزة</span>
            <p className="mt-1 text-2xl font-bold text-amber-700">{s.reserved}</p>
          </a>
          <a href="#units" className={tile + " border-s-red-500"}>
            <span className="text-sm text-gray-500">مباعة</span>
            <p className="mt-1 text-2xl font-bold text-red-700">{s.sold}</p>
            {canManage && (
              <p className="mt-1 text-[11px] text-gray-400" dir="ltr">
                {formatPrice(s.soldValue)} د.ع
              </p>
            )}
          </a>
          {canManage && (
            <a href="#units" className={tile + " border-s-gray-400"}>
              <span className="text-sm text-gray-500">موقوفة</span>
              <p className="mt-1 text-2xl font-bold text-gray-600">{s.blocked}</p>
            </a>
          )}
        </div>

        {/* صفقات هذه الشاشة: طلبات تنتظر الإدارة، أو حجوزات الموظف */}
        <ProjectDeals
          deals={deals}
          canManage={canManage}
          userId={user?.id ?? null}
          employeeId={myEmployee?.id ?? null}
        />

        {nodes.length === 0 && units.length === 0 && (
          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm text-gray-700">
            <b className="text-blue-800">ابدأ بالهيكل.</b> حدّد أولاً كيف يُقسَّم
            المشروع — أبراج وطوابق، أو مراحل — ثم أضف الوحدات داخل كل مستوى.
            المشروع بلا هيكل يقبل الوحدات أيضاً، لكنها تظهر في قائمة واحدة طويلة.{" "}
            {canManage && (
              <Link
                href={`/dashboard/projects/${project.id}/structure`}
                className="font-semibold underline"
              >
                حدّد الهيكل الآن
              </Link>
            )}
          </div>
        )}

        {/* الموظف يحجز من صفحة الوحدة — سطرٌ يدلّه على الطريق */}
        {!canManage && units.length > 0 && (
          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-gray-700">
            <b className="text-blue-800">كيف تحجز؟</b> افتح الوحدة المتاحة من
            القائمة أدناه ثم اضغط <b>«حجز الوحدة»</b> واختر عميلك. وحين يتمّ
            الاتفاق اضغط <b>«طلب تحويلها إلى بيع»</b> — ويصل الطلب للإدارة
            لتُمضيه.
          </div>
        )}

        <div id="units">
          <InventoryBrowser
            tree={tree}
            nodes={nodes}
            units={units}
            unitTypes={unitTypes}
            projectId={project.id}
            canManage={canManage}
          />
        </div>
      </section>
    </main>
  );
}
