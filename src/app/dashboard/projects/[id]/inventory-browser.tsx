"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  NODE_KIND_ICONS,
  NodeTree,
  ProjectNode,
  Unit,
  UNIT_STATUS_DOTS,
  UNIT_STATUS_LIST,
  UnitTypeRow,
  descendantsOf,
  filterUnits,
  formatPrice,
} from "@/lib/types";

// ============================================================
// متصفّح المخزون: شجرة الهيكل + قائمة الوحدات مصفّاة.
//
// كل شيء يعمل في المتصفح على بيانات جُلبت مرة واحدة، فالتصفية
// فورية بلا انتظار الشبكة — وهذا ما يجعل مشروعاً بألف وحدة
// قابلاً للتصفّح لا للانتظار.
//
// الوحدات تُعرض **مجمّعة بمسارها** لا في جدول واحد، لأن المطلوب
// أن يكون كل طابق معزولاً واضحاً بذاته.
// ============================================================

// ألوان المخطّط: في هذا العرض اللون هو المعلومة، فيملأ المربّع
// كاملاً بدل نقطة صغيرة — تُقرأ حالة أربعين وحدة بنظرة واحدة.
const UNIT_STATUS_PLAN: Record<string, string> = {
  "متاحة": "bg-green-100 text-green-800 hover:bg-green-200",
  "محجوزة": "bg-amber-100 text-amber-800 hover:bg-amber-200",
  "مباعة": "bg-red-100 text-red-800 hover:bg-red-200",
  "موقوفة": "bg-gray-200 text-gray-600 hover:bg-gray-300",
};

// ترتيب طبيعي: «الطابق 10» بعد «الطابق 2» لا قبله
const collator = new Intl.Collator("ar", { numeric: true, sensitivity: "base" });

// عدّاد حالات مجموعة واحدة — يظهر بجانب اسم الطابق
function tally(units: Unit[]) {
  const t = { متاحة: 0, محجوزة: 0, مباعة: 0, موقوفة: 0 } as Record<string, number>;
  for (const u of units) if (u.status in t) t[u.status]++;
  return t;
}

export default function InventoryBrowser({
  tree,
  nodes,
  units,
  unitTypes,
  projectId,
  canManage,
}: {
  tree: NodeTree[];
  nodes: ProjectNode[];
  units: Unit[];
  unitTypes: UnitTypeRow[];
  projectId: string;
  canManage: boolean;
}) {
  const [nodeId, setNodeId] = useState<string>("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [unitType, setUnitType] = useState("");
  const [minRooms, setMinRooms] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  // «مخطّط» يعرض الوحدة مربّعاً صغيراً برقمها ولونها، فبرج بأربعين
  // طابقاً يُقرأ في شاشة واحدة بدل التمرير الطويل.
  const [view, setView] = useState<"grid" | "plan">("grid");

  // اختيار «برج A» يعني كل طوابقه، لا البرج وحده
  const scope = useMemo(
    () => (nodeId ? descendantsOf(nodes, nodeId) : undefined),
    [nodes, nodeId],
  );

  const shown = useMemo(
    () =>
      filterUnits(
        units,
        {
          q,
          status: status || undefined,
          unitType: unitType || undefined,
          nodeId: nodeId || undefined,
          minRooms: minRooms ? Number(minRooms) : undefined,
          maxPrice: maxPrice ? Number(maxPrice) : undefined,
        },
        scope,
      ),
    [units, q, status, unitType, nodeId, minRooms, maxPrice, scope],
  );

  // عدد وحدات كل عقدة شاملاً ما تحتها — يظهر بجانب اسمها في الشجرة
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of nodes) {
      const ids = descendantsOf(nodes, n.id);
      map.set(n.id, units.filter((u) => ids.has(u.node_id ?? "")).length);
    }
    return map;
  }, [nodes, units]);

  // ============================================================
  // التجميع بالطوابق (أو المراحل) — لا بجدول واحد طويل.
  //
  // الترتيب يتبع **الهيكل نفسه** لا حروف المسار: «الطابق 10» بعد
  // «الطابق 2» لا قبله، لأن الشجرة مرتّبة بـ sort_order.
  // ============================================================
  const groups = useMemo(() => {
    const byNode = new Map<string, Unit[]>();
    for (const u of shown) {
      const key = u.node_id ?? "";
      const list = byNode.get(key);
      if (list) list.push(u);
      else byNode.set(key, [u]);
    }

    const out: {
      key: string;
      title: string;
      path: string;
      depth: number;
      units: Unit[];
    }[] = [];

    const walk = (list: NodeTree[]) => {
      for (const n of list) {
        const own = byNode.get(n.id);
        if (own && own.length > 0) {
          own.sort((a, b) =>
            collator.compare(a.unit_code ?? "", b.unit_code ?? ""),
          );
          out.push({
            key: n.id,
            title: n.name,
            path: n.path,
            depth: n.depth,
            units: own,
          });
        }
        walk(n.children);
      }
    };
    walk(tree);

    const loose = byNode.get("");
    if (loose && loose.length > 0) {
      loose.sort((a, b) => collator.compare(a.unit_code ?? "", b.unit_code ?? ""));
      out.push({
        key: "",
        title: "خارج الهيكل",
        path: "",
        depth: 0,
        units: loose,
      });
    }
    return out;
  }, [shown, tree]);

  const filtersOn =
    q || status || unitType || nodeId || minRooms || maxPrice ? true : false;

  const input =
    "rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

  function NodeRow({ n, depth }: { n: NodeTree; depth: number }) {
    const active = nodeId === n.id;
    return (
      <div>
        <button
          onClick={() => setNodeId(active ? "" : n.id)}
          style={{ paddingInlineStart: 12 + depth * 16 }}
          className={
            active
              ? "flex w-full items-center gap-2 rounded-lg bg-brand-600 py-2 pe-3 text-start text-sm font-bold text-white"
              : "flex w-full items-center gap-2 rounded-lg py-2 pe-3 text-start text-sm text-gray-700 transition hover:bg-gray-100"
          }
        >
          <span className="material-symbols-outlined text-[18px]">
            {NODE_KIND_ICONS[n.kind] ?? "folder"}
          </span>
          <span className="min-w-0 flex-1 truncate">{n.name}</span>
          <span
            className={
              active
                ? "rounded-full bg-white/20 px-2 py-0.5 text-[11px]"
                : "rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500"
            }
          >
            {counts.get(n.id) ?? 0}
          </span>
        </button>
        {n.children.map((c) => (
          <NodeRow key={c.id} n={c} depth={depth + 1} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[260px_1fr]">
      {/* شجرة الهيكل */}
      <aside className="h-fit rounded-2xl bg-white p-3 shadow-sm">
        <div className="mb-2 flex items-center justify-between px-2">
          <h3 className="text-sm font-bold text-gray-700">الهيكل</h3>
          {canManage && (
            <Link
              href={`/dashboard/projects/${projectId}/structure`}
              className="text-xs text-brand-600 hover:underline"
            >
              تعديل
            </Link>
          )}
        </div>

        <button
          onClick={() => setNodeId("")}
          className={
            nodeId === ""
              ? "mb-1 flex w-full items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-start text-sm font-bold text-white"
              : "mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-sm text-gray-700 transition hover:bg-gray-100"
          }
        >
          <span className="material-symbols-outlined text-[18px]">apps</span>
          <span className="flex-1">كل الوحدات</span>
          <span
            className={
              nodeId === ""
                ? "rounded-full bg-white/20 px-2 py-0.5 text-[11px]"
                : "rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500"
            }
          >
            {units.length}
          </span>
        </button>

        {tree.length === 0 ? (
          <p className="px-3 py-4 text-xs text-gray-400">
            لا يوجد هيكل بعد — كل الوحدات في قائمة واحدة.
          </p>
        ) : (
          tree.map((n) => <NodeRow key={n.id} n={n} depth={0} />)
        )}
      </aside>

      {/* المرشّحات + الوحدات */}
      <div className="space-y-4">
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="بحث برقم الوحدة أو الموقع…"
              className={input + " min-w-[200px] flex-1"}
            />
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className={input}
            >
              <option value="">كل الحالات</option>
              {UNIT_STATUS_LIST.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              value={unitType}
              onChange={(e) => setUnitType(e.target.value)}
              className={input}
            >
              <option value="">كل الأنواع</option>
              {unitTypes.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
            <input
              value={minRooms}
              onChange={(e) => setMinRooms(e.target.value)}
              type="number"
              min={0}
              placeholder="غرف ≥"
              className={input + " w-24"}
            />
            <input
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              type="number"
              min={0}
              placeholder="سعر ≤"
              className={input + " w-32"}
              dir="ltr"
            />
            {filtersOn && (
              <button
                onClick={() => {
                  setQ("");
                  setStatus("");
                  setUnitType("");
                  setNodeId("");
                  setMinRooms("");
                  setMaxPrice("");
                }}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 transition hover:bg-gray-100"
              >
                مسح
              </button>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-gray-500">
              {shown.length} من {units.length} وحدة في {groups.length}{" "}
              {groups.length === 1 ? "مستوى" : "مستويات"}
            </p>

            <div className="flex items-center gap-1 rounded-lg border border-gray-200 p-0.5">
              {(
                [
                  ["grid", "بطاقات", "grid_view"],
                  ["plan", "مخطّط", "view_module"],
                ] as const
              ).map(([key, label, icon]) => (
                <button
                  key={key}
                  onClick={() => setView(key)}
                  className={
                    view === key
                      ? "flex items-center gap-1 rounded-md bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white"
                      : "flex items-center gap-1 rounded-md px-2.5 py-1 text-xs text-gray-600 transition hover:bg-gray-100"
                  }
                >
                  <span className="material-symbols-outlined text-[16px]">
                    {icon}
                  </span>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {groups.length === 0 ? (
          <div className="rounded-2xl bg-white p-10 text-center shadow-sm">
            <span className="material-symbols-outlined mb-2 inline-flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-3xl text-brand-600">
              domain_disabled
            </span>
            <p className="text-gray-500">
              {units.length === 0
                ? "لا توجد وحدات في هذا المشروع بعد."
                : "لا توجد وحدات تطابق هذه المرشّحات."}
            </p>
          </div>
        ) : (
          groups.map((g) => {
            const t = tally(g.units);
            return (
              <div key={g.key} className="rounded-2xl bg-white p-4 shadow-sm">
                {/* عنوان الطابق: اسمه بارزاً ومساره خافتاً فوقه */}
                <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-100 pb-2">
                  <div className="min-w-0">
                    {g.path && g.path !== g.title && (
                      <p className="truncate text-[11px] text-gray-400">
                        {g.path.slice(0, g.path.length - g.title.length - 3)}
                      </p>
                    )}
                    <h3 className="text-base font-bold text-gray-800">{g.title}</h3>
                  </div>

                  {/* حصيلة الطابق — كم متاح فيه وكم بيع */}
                  <div className="ms-auto flex flex-wrap items-center gap-1.5">
                    {t["متاحة"] > 0 && (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700">
                        {t["متاحة"]} متاحة
                      </span>
                    )}
                    {t["محجوزة"] > 0 && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                        {t["محجوزة"]} محجوزة
                      </span>
                    )}
                    {t["مباعة"] > 0 && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700">
                        {t["مباعة"]} مباعة
                      </span>
                    )}
                    {t["موقوفة"] > 0 && (
                      <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                        {t["موقوفة"]} موقوفة
                      </span>
                    )}
                    <span className="text-[11px] text-gray-400">
                      من {g.units.length}
                    </span>
                  </div>
                </div>

                {view === "plan" ? (
                  // مخطّط: مربّع لكل وحدة — الطابق كله في سطر أو سطرين
                  <div className="flex flex-wrap gap-1.5">
                    {g.units.map((u) => (
                      <Link
                        key={u.id}
                        href={`/dashboard/units/${u.id}`}
                        title={`${u.unit_code ?? ""} · ${u.status}${
                          u.space_m2 ? ` · ${u.space_m2} م²` : ""
                        }${u.price !== null ? ` · ${formatPrice(u.price)} د.ع` : ""}`}
                        className={`flex h-12 w-16 flex-col items-center justify-center rounded-lg text-xs font-bold transition hover:scale-105 hover:shadow-md ${
                          UNIT_STATUS_PLAN[u.status] ??
                          "bg-gray-100 text-gray-600"
                        }`}
                      >
                        <span className="truncate px-1">
                          {u.unit_code || "—"}
                        </span>
                        {u.space_m2 !== null && (
                          <span className="text-[10px] font-normal opacity-80">
                            {u.space_m2} م²
                          </span>
                        )}
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                    {g.units.map((u) => (
                      <Link
                        key={u.id}
                        href={`/dashboard/units/${u.id}`}
                        className="group rounded-xl border border-gray-200 p-3 transition hover:border-brand-400 hover:shadow-sm"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                              UNIT_STATUS_DOTS[u.status] ?? "bg-gray-300"
                            }`}
                          />
                          <span className="truncate font-bold text-gray-800 group-hover:text-brand-700">
                            {u.unit_code || "بلا رقم"}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-[11px] text-gray-500">
                          {u.unit_type}
                          {u.space_m2 ? ` · ${u.space_m2} م²` : ""}
                          {u.rooms ? ` · ${u.rooms} غرف` : ""}
                        </p>
                        <p
                          className="mt-1 truncate text-xs font-semibold text-brand-700"
                          dir="ltr"
                        >
                          {u.price !== null ? `${formatPrice(u.price)} د.ع` : "—"}
                        </p>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* دليل الألوان — يظهر مع المخطّط حيث اللون هو المعلومة */}
        {view === "plan" && groups.length > 0 && (
          <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-white px-4 py-3 text-xs text-gray-600 shadow-sm">
            {Object.entries(UNIT_STATUS_PLAN).map(([s, cls]) => (
              <span key={s} className="flex items-center gap-1.5">
                <span className={`h-4 w-6 rounded ${cls}`} />
                {s}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
