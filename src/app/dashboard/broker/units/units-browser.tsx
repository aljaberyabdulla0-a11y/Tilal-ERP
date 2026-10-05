"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  BrokerUnit,
  BrokerUnitAvailability,
  Client,
  NODE_KIND_ICONS,
  NodeTree,
  ProjectNode,
  buildNodeTree,
  descendantsOf,
  formatPrice,
  isValidPhone,
} from "@/lib/types";
import PhoneInput from "@/components/phone-input";

type Lead = Pick<Client, "id" | "name" | "phone" | "project_id">;

// ============================================================
// تصفّح الوحدات وطلب الحجز.
//
// العرض نفس متصفّح مخزوننا (projects/[id]/inventory-browser):
// شجرة الهيكل جانباً، والوحدات مجمّعة بطوابقها بترتيب الهيكل،
// وبطاقات أو مخطّط. الفرق أن حالات الوسيط أربع من broker_units()
// والضغط على وحدة متاحة يفتح طلب الحجز لا صفحة الوحدة.
//
// الطلب يذهب إلى broker_request_reservation (sql/117) التي تتحقّق من
// كل شيء: الوحدة مكشوفة لكم ومتاحة، ولا طلب مفتوح عليها، والعميل من
// ليداتكم. والعميل الجديد يُنشأ ليداً لشركتكم مع الطلب نفسه.
// ============================================================

const STATUSES: BrokerUnitAvailability[] = ["متاحة", "محجوزة", "طلبكم قيد المتابعة", "عليها طلب"];

const STATUS_DOTS: Record<string, string> = {
  "متاحة": "bg-green-500",
  "محجوزة": "bg-amber-500",
  "طلبكم قيد المتابعة": "bg-blue-500",
  "عليها طلب": "bg-gray-400",
};

// ألوان المخطّط: اللون يملأ المربّع لأنه هو المعلومة
const STATUS_PLAN: Record<string, string> = {
  "متاحة": "bg-green-100 text-green-800 hover:bg-green-200",
  "محجوزة": "bg-amber-100 text-amber-800 hover:bg-amber-200",
  "طلبكم قيد المتابعة": "bg-blue-100 text-blue-800 hover:bg-blue-200",
  "عليها طلب": "bg-gray-200 text-gray-600 hover:bg-gray-300",
};

const STATUS_CHIPS: Record<string, string> = {
  "متاحة": "bg-green-100 text-green-700",
  "محجوزة": "bg-amber-100 text-amber-700",
  "طلبكم قيد المتابعة": "bg-blue-100 text-blue-700",
  "عليها طلب": "bg-gray-200 text-gray-600",
};

// اسم قصير لحصيلة الطابق — «٢ طلبكم قيد المتابعة» أطول من السطر
const STATUS_SHORT: Record<string, string> = {
  "متاحة": "متاحة",
  "محجوزة": "محجوزة",
  "طلبكم قيد المتابعة": "بطلبكم",
  "عليها طلب": "عليها طلب",
};

// ترتيب طبيعي: «الطابق 10» بعد «الطابق 2» لا قبله
const collator = new Intl.Collator("ar", { numeric: true, sensitivity: "base" });

type Group = { key: string; title: string; path: string; units: BrokerUnit[] };

export default function UnitsBrowser({
  units,
  nodes,
  leads,
}: {
  units: BrokerUnit[];
  nodes: ProjectNode[];
  leads: Lead[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const projects = useMemo(
    () => Array.from(new Map(units.map((u) => [u.project_id, u.project_name])).entries()),
    [units]
  );
  const multi = projects.length > 1;
  const types = useMemo(() => Array.from(new Set(units.map((u) => u.unit_type))).sort(), [units]);

  // الشجرة لكل مشروع على حدة
  const trees = useMemo(() => {
    const map = new Map<string, NodeTree[]>();
    for (const [pid] of projects) map.set(pid, buildNodeTree(nodes.filter((n) => n.project_id === pid)));
    return map;
  }, [projects, nodes]);

  // broker_units() تعيد مسار الوحدة لا عقدتها؛ والمسار تكتبه القاعدة
  // من path العقدة نفسها (sql/044)، فالمطابقة به تامّة.
  const nodeOf = useMemo(() => {
    const byPath = new Map(nodes.map((n) => [`${n.project_id}|${n.path}`, n.id]));
    return new Map(
      units.map((u) => [u.id, u.node_path ? byPath.get(`${u.project_id}|${u.node_path}`) ?? "" : ""])
    );
  }, [units, nodes]);

  // عدد وحدات كل عقدة شاملاً ما تحتها
  const counts = useMemo(() => {
    const parent = new Map(nodes.map((n) => [n.id, n.parent_id]));
    const map = new Map<string, number>();
    for (const u of units) {
      let id: string | null | undefined = nodeOf.get(u.id) || null;
      while (id) {
        map.set(id, (map.get(id) ?? 0) + 1);
        id = parent.get(id);
      }
    }
    return map;
  }, [units, nodes, nodeOf]);

  const [project, setProject] = useState(multi ? "" : projects[0]?.[0] ?? "");
  const [nodeId, setNodeId] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [minRooms, setMinRooms] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [view, setView] = useState<"grid" | "plan">("grid");

  const [target, setTarget] = useState<BrokerUnit | null>(null);
  const [clientMode, setClientMode] = useState<"existing" | "new">(leads.length ? "existing" : "new");
  const [clientId, setClientId] = useState("");
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [note, setNote] = useState("");
  const [requestedPrice, setRequestedPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const inProject = useMemo(
    () => (project ? units.filter((u) => u.project_id === project) : units),
    [units, project]
  );

  // اختيار «برج A» يعني كل طوابقه، لا البرج وحده
  const scope = useMemo(() => (nodeId ? descendantsOf(nodes, nodeId) : undefined), [nodes, nodeId]);

  const shown = useMemo(() => {
    const text = q.trim().toLowerCase();
    return inProject.filter((u) => {
      if (scope && !scope.has(nodeOf.get(u.id) ?? "")) return false;
      if (status && u.availability !== status) return false;
      if (type && u.unit_type !== type) return false;
      if (minRooms && (u.rooms ?? 0) < Number(minRooms)) return false;
      if (maxPrice && (u.price ?? 0) > Number(maxPrice)) return false;
      if (text && ![u.unit_code, u.node_path].some((v) => (v ?? "").toLowerCase().includes(text))) return false;
      return true;
    });
  }, [inProject, scope, nodeOf, status, type, minRooms, maxPrice, q]);

  // التجميع بالطوابق بترتيب الهيكل نفسه (sort_order)، مشروعاً بعد مشروع
  const groups = useMemo(() => {
    const byNode = new Map<string, BrokerUnit[]>();
    for (const u of shown) {
      const key = `${u.project_id}|${nodeOf.get(u.id) ?? ""}`;
      const list = byNode.get(key);
      if (list) list.push(u);
      else byNode.set(key, [u]);
    }
    const byCode = (a: BrokerUnit, b: BrokerUnit) => collator.compare(a.unit_code ?? "", b.unit_code ?? "");

    const out: Group[] = [];
    for (const [pid, pname] of projects) {
      if (project && pid !== project) continue;
      const prefix = multi && !project ? pname : "";
      const walk = (list: NodeTree[]) => {
        for (const n of list) {
          const own = byNode.get(`${pid}|${n.id}`);
          if (own && own.length > 0) {
            const parentPath = n.path !== n.name ? n.path.slice(0, n.path.length - n.name.length - 3) : "";
            out.push({
              key: n.id,
              title: n.name,
              path: [prefix, parentPath].filter(Boolean).join(" · "),
              units: own.sort(byCode),
            });
          }
          walk(n.children);
        }
      };
      walk(trees.get(pid) ?? []);

      const loose = byNode.get(`${pid}|`);
      if (loose && loose.length > 0) {
        out.push({ key: `${pid}|`, title: "خارج الهيكل", path: prefix, units: loose.sort(byCode) });
      }
    }
    return out;
  }, [shown, nodeOf, projects, project, multi, trees]);

  const tally = (list: BrokerUnit[]) => {
    const t: Record<string, number> = {};
    for (const u of list) t[u.availability] = (t[u.availability] ?? 0) + 1;
    return t;
  };
  const totals = tally(inProject);

  const filtersOn = !!(q || status || type || nodeId || minRooms || maxPrice);

  function open(u: BrokerUnit) {
    setTarget(u);
    setError(null);
    setDone(null);
    setNote("");
    setRequestedPrice("");
    setNewName("");
    setNewPhone("");
    // ليدٌ في نفس المشروع أقرب للاختيار
    const sameProject = leads.find((l) => l.project_id === u.project_id);
    setClientId(sameProject?.id ?? "");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!target) return;
    setError(null);

    if (clientMode === "existing" && !clientId) {
      setError("اختر العميل.");
      return;
    }
    if (clientMode === "new") {
      if (!newName.trim()) {
        setError("اكتب اسم العميل.");
        return;
      }
      if (newPhone && !isValidPhone(newPhone)) {
        setError("رقم الهاتف غير مكتمل.");
        return;
      }
    }

    const price = requestedPrice.trim() ? Number(requestedPrice) : null;
    if (price !== null && (!Number.isFinite(price) || price <= 0)) {
      setError("السعر المطلوب يجب أن يكون أكبر من صفر.");
      return;
    }

    setBusy(true);
    const { error } = await supabase.rpc("broker_request_reservation", {
      p_unit: target.id,
      p_client: clientMode === "existing" ? clientId : null,
      p_new_name: clientMode === "new" ? newName.trim() : null,
      p_new_phone: clientMode === "new" ? newPhone.trim() || null : null,
      p_note: note.trim() || null,
      // يُرسل عند الكتابة وحدها (sql/128): الطلب بلا سعر يبقى بسعر الوحدة
      ...(price !== null ? { p_requested_price: price } : {}),
    });
    setBusy(false);

    if (error) {
      setError(error.message);
      return;
    }
    setDone(`رُفع طلب حجز الوحدة ${target.unit_code ?? ""} — يصلكم إشعار حين يتابعه مدير العلاقات.`);
    setTarget(null);
    router.refresh();
  }

  const inputCls =
    "rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";
  const facts = (u: BrokerUnit) =>
    [
      u.space_m2 ? `${u.space_m2} م²` : null,
      u.rooms ? `${u.rooms} غرف` : null,
      u.bathrooms ? `${u.bathrooms} حمّام` : null,
      u.floors_count ? `${u.floors_count} طوابق` : null,
      u.parking_spaces ? `${u.parking_spaces} موقف` : null,
    ].filter(Boolean);
  const tip = (u: BrokerUnit) =>
    `${u.unit_code ?? ""} · ${u.availability}${u.space_m2 ? ` · ${u.space_m2} م²` : ""}${
      u.price !== null ? ` · ${formatPrice(u.price)} د.ع` : ""
    }`;

  // الوحدة المتاحة تفتح الطلب، وما عليه طلبكم يقود إلى طلباتكم، والباقي للعرض
  function UnitTile({ u, className, children }: { u: BrokerUnit; className: string; children: React.ReactNode }) {
    if (u.availability === "متاحة")
      return (
        <button type="button" onClick={() => open(u)} title={tip(u)} className={className + " text-start"}>
          {children}
        </button>
      );
    if (u.my_request_id)
      return (
        <Link href="/dashboard/broker/requests" title={tip(u)} className={className}>
          {children}
        </Link>
      );
    return (
      <div title={tip(u)} className={className + " cursor-default"}>
        {children}
      </div>
    );
  }

  const rowCls = (active: boolean) =>
    active
      ? "flex w-full items-center gap-2 rounded-lg bg-brand-600 py-2 pe-3 text-start text-sm font-bold text-white"
      : "flex w-full items-center gap-2 rounded-lg py-2 pe-3 text-start text-sm text-gray-700 transition hover:bg-gray-100";
  const badgeCls = (active: boolean) =>
    active
      ? "rounded-full bg-white/20 px-2 py-0.5 text-[11px]"
      : "rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500";

  function NodeRow({ n, depth }: { n: NodeTree; depth: number }) {
    const active = nodeId === n.id;
    return (
      <div>
        <button
          onClick={() => setNodeId(active ? "" : n.id)}
          style={{ paddingInlineStart: 12 + depth * 16 }}
          className={rowCls(active)}
        >
          <span className="material-symbols-outlined text-[18px]">{NODE_KIND_ICONS[n.kind] ?? "folder"}</span>
          <span className="min-w-0 flex-1 truncate">{n.name}</span>
          <span className={badgeCls(active)}>{counts.get(n.id) ?? 0}</span>
        </button>
        {n.children.map((c) => (
          <NodeRow key={c.id} n={c} depth={depth + 1} />
        ))}
      </div>
    );
  }

  const tile = "glass-card border-s-4 p-5 text-start transition hover:shadow-md";

  return (
    <div className="space-y-5">
      {done && (
        <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {done}{" "}
          <Link href="/dashboard/broker/requests" className="font-semibold underline">
            طلباتنا
          </Link>
        </p>
      )}

      {/* لوحة المخزون — كل بطاقة تصفّي القائمة بحالتها */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <button onClick={() => setStatus("")} className={tile + " border-s-brand-500"}>
          <span className="text-sm text-gray-500">إجمالي الوحدات</span>
          <p className="mt-1 text-2xl font-bold text-gray-800">{inProject.length}</p>
        </button>
        <button onClick={() => setStatus("متاحة")} className={tile + " border-s-green-500"}>
          <span className="text-sm text-gray-500">متاحة</span>
          <p className="mt-1 text-2xl font-bold text-green-700">{totals["متاحة"] ?? 0}</p>
        </button>
        <button onClick={() => setStatus("محجوزة")} className={tile + " border-s-amber-500"}>
          <span className="text-sm text-gray-500">محجوزة</span>
          <p className="mt-1 text-2xl font-bold text-amber-700">{totals["محجوزة"] ?? 0}</p>
        </button>
        <button onClick={() => setStatus("طلبكم قيد المتابعة")} className={tile + " border-s-blue-500"}>
          <span className="text-sm text-gray-500">طلباتكم قيد المتابعة</span>
          <p className="mt-1 text-2xl font-bold text-blue-700">{totals["طلبكم قيد المتابعة"] ?? 0}</p>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[260px_1fr]">
        {/* شجرة الهيكل */}
        <aside className="h-fit rounded-2xl bg-white p-3 shadow-sm">
          <h3 className="mb-2 px-2 text-sm font-bold text-gray-700">الهيكل</h3>

          <button
            onClick={() => {
              setNodeId("");
              if (multi) setProject("");
            }}
            className={rowCls((multi ? !project : true) && !nodeId) + " mb-1 px-3"}
          >
            <span className="material-symbols-outlined text-[18px]">apps</span>
            <span className="flex-1">كل الوحدات</span>
            <span className={badgeCls((multi ? !project : true) && !nodeId)}>
              {multi ? units.length : inProject.length}
            </span>
          </button>

          {projects.map(([pid, pname]) => {
            const tree = trees.get(pid) ?? [];
            const selected = !multi || project === pid;
            return (
              <div key={pid}>
                {multi && (
                  <button
                    onClick={() => {
                      setProject(pid);
                      setNodeId("");
                    }}
                    className={rowCls(project === pid && !nodeId) + " px-3"}
                  >
                    <span className="material-symbols-outlined text-[18px]">location_city</span>
                    <span className="min-w-0 flex-1 truncate">{pname}</span>
                    <span className={badgeCls(project === pid && !nodeId)}>
                      {units.filter((u) => u.project_id === pid).length}
                    </span>
                  </button>
                )}
                {selected &&
                  (tree.length === 0 ? (
                    <p className="px-3 py-4 text-xs text-gray-400">
                      لا يوجد هيكل لهذا المشروع — كل الوحدات في قائمة واحدة.
                    </p>
                  ) : (
                    tree.map((n) => <NodeRow key={n.id} n={n} depth={multi ? 1 : 0} />)
                  ))}
              </div>
            );
          })}
        </aside>

        {/* المرشّحات + الوحدات */}
        <div className="min-w-0 space-y-4">
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="بحث برقم الوحدة أو الموقع…"
                className={inputCls + " min-w-[200px] flex-1"}
              />
              <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
                <option value="">كل الحالات</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              {types.length > 1 && (
                <select value={type} onChange={(e) => setType(e.target.value)} className={inputCls}>
                  <option value="">كل الأنواع</option>
                  {types.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              )}
              <input
                value={minRooms}
                onChange={(e) => setMinRooms(e.target.value)}
                type="number"
                min={0}
                placeholder="غرف ≥"
                className={inputCls + " w-24"}
              />
              <input
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
                type="number"
                min={0}
                placeholder="سعر ≤"
                className={inputCls + " w-32"}
                dir="ltr"
              />
              {filtersOn && (
                <button
                  onClick={() => {
                    setQ("");
                    setStatus("");
                    setType("");
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
                {shown.length} من {inProject.length} وحدة في {groups.length}{" "}
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
                    <span className="material-symbols-outlined text-[16px]">{icon}</span>
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
              <p className="text-gray-500">لا توجد وحدات تطابق هذه المرشّحات.</p>
            </div>
          ) : (
            groups.map((g) => {
              const t = tally(g.units);
              return (
                <div key={g.key} className="rounded-2xl bg-white p-4 shadow-sm">
                  {/* عنوان الطابق: اسمه بارزاً ومساره خافتاً فوقه */}
                  <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-100 pb-2">
                    <div className="min-w-0">
                      {g.path && <p className="truncate text-[11px] text-gray-400">{g.path}</p>}
                      <h3 className="text-base font-bold text-gray-800">{g.title}</h3>
                    </div>

                    <div className="ms-auto flex flex-wrap items-center gap-1.5">
                      {STATUSES.filter((s) => t[s]).map((s) => (
                        <span key={s} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_CHIPS[s]}`}>
                          {t[s]} {STATUS_SHORT[s]}
                        </span>
                      ))}
                      <span className="text-[11px] text-gray-400">من {g.units.length}</span>
                    </div>
                  </div>

                  {view === "plan" ? (
                    <div className="flex flex-wrap gap-1.5">
                      {g.units.map((u) => (
                        <UnitTile
                          key={u.id}
                          u={u}
                          className={`flex h-12 w-16 flex-col items-center justify-center rounded-lg text-xs font-bold transition hover:scale-105 hover:shadow-md ${
                            STATUS_PLAN[u.availability] ?? "bg-gray-100 text-gray-600"
                          }`}
                        >
                          <span className="truncate px-1">{u.unit_code || "—"}</span>
                          {u.space_m2 !== null && (
                            <span className="text-[10px] font-normal opacity-80">{u.space_m2} م²</span>
                          )}
                        </UnitTile>
                      ))}
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                      {g.units.map((u) => (
                        <UnitTile
                          key={u.id}
                          u={u}
                          className="group block rounded-xl border border-gray-200 p-3 transition hover:border-brand-400 hover:shadow-sm"
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                                STATUS_DOTS[u.availability] ?? "bg-gray-300"
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
                          <p className="mt-1 truncate text-xs font-semibold text-brand-700" dir="ltr">
                            {u.price !== null ? `${formatPrice(u.price)} د.ع` : "—"}
                          </p>
                        </UnitTile>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}

          {/* دليل الألوان — يظهر مع المخطّط حيث اللون هو المعلومة */}
          {groups.length > 0 && (
            <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-white px-4 py-3 text-xs text-gray-600 shadow-sm">
              {STATUSES.map((s) => (
                <span key={s} className="flex items-center gap-1.5">
                  {view === "plan" ? (
                    <span className={`h-4 w-6 rounded ${STATUS_PLAN[s]}`} />
                  ) : (
                    <span className={`h-2.5 w-2.5 rounded-full ${STATUS_DOTS[s]}`} />
                  )}
                  {s}
                </span>
              ))}
              <span className="text-gray-400">· اضغط وحدة متاحة لرفع طلب حجزها</span>
            </div>
          )}
        </div>
      </div>

      {/* نافذة الطلب */}
      {target && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          onClick={() => !busy && setTarget(null)}
        >
          <form
            onSubmit={submit}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-xl"
          >
            <div>
              <h2 className="text-lg font-bold text-gray-800">
                طلب حجز الوحدة {target.unit_code ?? ""}
              </h2>
              <p className="text-sm text-gray-500">
                {target.project_name}
                {target.node_path ? ` · ${target.node_path}` : ""} ·{" "}
                <span dir="ltr">{formatPrice(target.price)} د.ع</span>
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {[target.unit_type, ...facts(target)].join(" · ")}
              </p>
              {target.payment_plan && (
                <p className="mt-1 text-xs text-gray-500">خطة الدفع: {target.payment_plan}</p>
              )}
            </div>

            <div className="flex gap-2 rounded-lg bg-gray-100 p-1 text-sm">
              {leads.length > 0 && (
                <button
                  type="button"
                  onClick={() => setClientMode("existing")}
                  className={`flex-1 rounded-md py-1.5 ${clientMode === "existing" ? "bg-white font-semibold shadow-sm" : "text-gray-500"}`}
                >
                  عميل من ليداتنا
                </button>
              )}
              <button
                type="button"
                onClick={() => setClientMode("new")}
                className={`flex-1 rounded-md py-1.5 ${clientMode === "new" ? "bg-white font-semibold shadow-sm" : "text-gray-500"}`}
              >
                عميل جديد
              </button>
            </div>

            {clientMode === "existing" ? (
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className={inputCls + " w-full"}
              >
                <option value="">— اختر العميل —</option>
                {leads.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                    {l.phone ? ` — ${l.phone}` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <div className="space-y-2">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="اسم العميل"
                  className={inputCls + " w-full"}
                />
                <PhoneInput value={newPhone} onChange={setNewPhone} />
                <p className="text-xs text-gray-400">
                  يُضاف ليداً لشركتكم بمهلته المعتادة، ولا يعود لتلال ما دام طلبه
                  أو حجزه قائماً.
                </p>
              </div>
            )}

            <label className="block text-xs text-gray-600">
              السعر المطلوب (اختياري)
              <input
                type="number"
                min={0}
                value={requestedPrice}
                onChange={(e) => setRequestedPrice(e.target.value)}
                placeholder={target.price ? `سعر الوحدة ${formatPrice(Number(target.price))}` : "سعر الوحدة"}
                className={inputCls + " mt-1 w-full"}
                dir="ltr"
              />
              <span className="mt-1 block text-[11px] text-gray-400">
                اتركه فارغاً لسعر الوحدة. السعر الأدنى طلب خصم يقرّره مشرف المشروع.
              </span>
            </label>

            <textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="ملاحظة لمدير العلاقات (طريقة الدفع، موعد الزيارة...)"
              className={inputCls + " w-full"}
            />

            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={busy}
                className="flex-1 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {busy ? "جارٍ الإرسال..." : "إرسال الطلب"}
              </button>
              <button
                type="button"
                onClick={() => setTarget(null)}
                disabled={busy}
                className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-100"
              >
                إلغاء
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
