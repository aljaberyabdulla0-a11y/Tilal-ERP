"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { TASK_PRIORITIES, TASK_STATUSES, type AssignablePerson, type TaskDepartment, type TaskLabel, type TaskSourceDef, type TaskTypeDef } from "@/lib/types";
import { countActiveFilters, parseTaskFilters, taskFiltersToParams } from "@/lib/task-filters";

export type SavedTaskView = { id: string; name: string; view: string; filters: Record<string, string> };

// ============================================================
// شريط المرشّحات — كل مرشّح في العنوان (يُحفظ ويُرسل كرابط).
// البحث ينتظر ٤٠٠ مللي ثانية بعد آخر حرف، والبحث نفسه في الخادم
// (task_list) فلا تُحمَّل آلاف المهام إلى المتصفح.
// ============================================================
export default function TaskFilterBar({
  departments,
  types,
  sources,
  labels,
  people,
  projects,
  savedViews,
  hide = [],
}: {
  departments: TaskDepartment[];
  types: TaskTypeDef[];
  sources: TaskSourceDef[];
  labels: TaskLabel[];
  people: AssignablePerson[];
  projects: { id: string; name: string }[];
  savedViews: SavedTaskView[];
  hide?: ("dept" | "assignee" | "type" | "source" | "project")[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const supabase = createClient();

  const current = useMemo(() => {
    const o: Record<string, string> = {};
    sp.forEach((v, k) => (o[k] = v));
    return o;
  }, [sp]);
  const filters = useMemo(() => parseTaskFilters(current), [current]);
  const [q, setQ] = useState(filters.q ?? "");
  const [open, setOpen] = useState(false);
  const [viewName, setViewName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function push(over: Record<string, string | null>) {
    const next = new URLSearchParams(current);
    for (const [k, v] of Object.entries(over)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    next.delete("page");
    const s = next.toString();
    router.push(s ? `${pathname}?${s}` : pathname);
  }

  // البحث بتأخير
  useEffect(() => {
    if ((filters.q ?? "") === q) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => push({ q: q.trim() || null }), 400);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  function toggleIn(key: "status" | "priority", value: string) {
    const cur = new Set((current[key] ?? "").split(",").filter(Boolean));
    if (cur.has(value)) cur.delete(value);
    else cur.add(value);
    push({ [key]: Array.from(cur).join(",") || null });
  }

  async function saveView() {
    const name = viewName.trim();
    if (!name) return setMsg("اكتب اسماً للعرض.");
    const params = taskFiltersToParams(filters);
    const { error } = await supabase.from("task_saved_views").insert({
      name, view: current.view === "board" || current.view === "calendar" ? current.view : "list", filters: { ...params, view: current.view ?? "list" },
    });
    if (error) {
      console.error(error);
      return setMsg(error.code === "23505" ? "لديك عرض بهذا الاسم." : "تعذّر الحفظ.");
    }
    setViewName("");
    setMsg("حُفظ العرض ✓");
    router.refresh();
  }

  async function deleteView(id: string) {
    await supabase.from("task_saved_views").delete().eq("id", id);
    router.refresh();
  }

  const active = countActiveFilters(filters);
  const sel = "rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-sm focus:border-brand-500 focus:outline-none";
  const typeGroups = useMemo(() => types.filter((t) => t.is_active), [types]);

  return (
    <section className="dash-card mb-4 p-3" aria-label="تصفية المهام">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-[2_1_220px]">
          <span aria-hidden="true" className="material-symbols-outlined pointer-events-none absolute inset-y-0 start-2.5 my-auto h-5 text-[19px] text-gray-400">search</span>
          <label htmlFor="task-q" className="sr-only">بحث في المهام</label>
          <input id="task-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث بالعنوان، العميل، الموظف، المشروع، الحملة، أو رقم المهمة…"
            className={`w-full ps-9 ${sel}`} />
        </div>

        {!hide.includes("dept") && (
          <select value={filters.dept ?? ""} onChange={(e) => push({ dept: e.target.value || null })} className={`flex-[1_1_150px] ${sel}`} aria-label="القسم">
            <option value="">كل الأقسام</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.parent_id ? "— " : ""}{d.name_ar}</option>)}
          </select>
        )}

        {!hide.includes("assignee") && people.length > 1 && (
          <select value={filters.assignee ?? ""} onChange={(e) => push({ assignee: e.target.value || null })} className={`flex-[1_1_140px] ${sel}`} aria-label="المسؤول">
            <option value="">كل المسؤولين</option>
            <option value="me">أنا</option>
            {people.filter((p) => !p.is_me).map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
          </select>
        )}

        <select value={filters.sort ?? "smart"} onChange={(e) => push({ sort: e.target.value === "smart" ? null : e.target.value })}
          className={`flex-[0_1_140px] ${sel}`} aria-label="الترتيب">
          <option value="smart">الأهم أولاً</option>
          <option value="due">الأقرب موعداً</option>
          <option value="due_desc">الأبعد موعداً</option>
          <option value="priority">الأولوية</option>
          <option value="created">الأحدث إنشاءً</option>
          <option value="updated">آخر تحديث</option>
          <option value="title">العنوان</option>
        </select>

        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
          className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:border-brand-500">
          <span aria-hidden="true" className="material-symbols-outlined text-[18px]">tune</span>
          مرشّحات{active ? <span className="rounded-full bg-brand-600 px-1.5 text-[11px] text-white">{active}</span> : null}
        </button>

        {active > 0 && (
          <button type="button" onClick={() => router.push(current.view ? `${pathname}?view=${current.view}` : pathname)}
            className="text-sm text-gray-500 hover:text-red-600">تصفير</button>
        )}
      </div>

      {open && (
        <div className="mt-3 grid gap-3 border-t border-line pt-3 sm:grid-cols-2 lg:grid-cols-4">
          <fieldset>
            <legend className="mb-1 text-xs font-semibold text-gray-500">الحالة</legend>
            <div className="flex flex-wrap gap-1">
              {TASK_STATUSES.map((s) => (
                <button key={s} type="button" onClick={() => toggleIn("status", s)} aria-pressed={filters.status?.includes(s) ?? false}
                  className={`rounded-full border px-2.5 py-1 text-xs ${filters.status?.includes(s) ? "border-brand-600 bg-brand-50 text-brand-800" : "border-gray-300 text-gray-600"}`}>
                  {s}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1 text-xs font-semibold text-gray-500">الأولوية</legend>
            <div className="flex flex-wrap gap-1">
              {TASK_PRIORITIES.map((s) => (
                <button key={s} type="button" onClick={() => toggleIn("priority", s)} aria-pressed={filters.priority?.includes(s) ?? false}
                  className={`rounded-full border px-2.5 py-1 text-xs ${filters.priority?.includes(s) ? "border-brand-600 bg-brand-50 text-brand-800" : "border-gray-300 text-gray-600"}`}>
                  {s}
                </button>
              ))}
            </div>
          </fieldset>

          {!hide.includes("type") && (
            <label className="text-xs font-semibold text-gray-500">النوع
              <select value={filters.type?.[0] ?? ""} onChange={(e) => push({ type: e.target.value || null })} className={`mt-1 w-full ${sel}`}>
                <option value="">كل الأنواع</option>
                {typeGroups.map((t) => <option key={t.code} value={t.code}>{t.name_ar}</option>)}
              </select>
            </label>
          )}
          {!hide.includes("source") && (
            <label className="text-xs font-semibold text-gray-500">المصدر
              <select value={filters.source?.[0] ?? ""} onChange={(e) => push({ source: e.target.value || null })} className={`mt-1 w-full ${sel}`}>
                <option value="">كل المصادر</option>
                {sources.map((s) => <option key={s.code} value={s.code}>{s.name_ar}</option>)}
              </select>
            </label>
          )}
          {!hide.includes("project") && projects.length > 0 && (
            <label className="text-xs font-semibold text-gray-500">المشروع
              <select value={filters.project ?? ""} onChange={(e) => push({ project: e.target.value || null })} className={`mt-1 w-full ${sel}`}>
                <option value="">كل المشاريع</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          )}
          {labels.length > 0 && (
            <label className="text-xs font-semibold text-gray-500">الوسم
              <select value={filters.label ?? ""} onChange={(e) => push({ label: e.target.value || null })} className={`mt-1 w-full ${sel}`}>
                <option value="">كل الوسوم</option>
                {labels.map((l) => <option key={l.id} value={l.id}>#{l.name}</option>)}
              </select>
            </label>
          )}
          <label className="text-xs font-semibold text-gray-500">من تاريخ
            <input type="date" value={filters.from ?? ""} onChange={(e) => push({ from: e.target.value || null })} className={`mt-1 w-full ${sel}`} />
          </label>
          <label className="text-xs font-semibold text-gray-500">إلى تاريخ
            <input type="date" value={filters.to ?? ""} onChange={(e) => push({ to: e.target.value || null })} className={`mt-1 w-full ${sel}`} />
          </label>
          <label className="text-xs font-semibold text-gray-500">الحالة الخاصة
            <select value={filters.bucket ?? ""} onChange={(e) => push({ bucket: e.target.value || null })} className={`mt-1 w-full ${sel}`}>
              <option value="">الكل</option>
              <option value="late">متأخرة</option>
              <option value="today">اليوم</option>
              <option value="upcoming">قادمة</option>
              <option value="nodate">بدون موعد</option>
              <option value="waiting">بانتظار</option>
              <option value="due_soon">قريبة الموعد</option>
              <option value="pending_approval">بانتظار الموافقة</option>
              <option value="sla">تجاوزت SLA</option>
              <option value="done">مغلقة</option>
            </select>
          </label>
          <label className="text-xs font-semibold text-gray-500">النطاق
            <select value={filters.scope ?? ""} onChange={(e) => push({ scope: e.target.value || null })} className={`mt-1 w-full ${sel}`}>
              <option value="">كل ما أراه</option>
              <option value="mine">المسندة إليّ</option>
              <option value="created">التي طلبتُها من غيري</option>
              <option value="watching">التي أتابعها</option>
              <option value="approvals">بانتظار موافقتي</option>
              <option value="team">فريقي</option>
              <option value="department">أقسامي</option>
            </select>
          </label>
          <label className="flex items-center gap-2 self-end pb-2 text-xs text-gray-600">
            <input type="checkbox" checked={filters.archived === "include"} onChange={(e) => push({ archived: e.target.checked ? "include" : null })} />
            تضمين المؤرشفة
          </label>
          <label className="flex items-center gap-2 self-end pb-2 text-xs text-gray-600">
            <input type="checkbox" checked={!!filters.top} onChange={(e) => push({ top: e.target.checked ? "1" : null })} />
            الرئيسية فقط (بلا الفرعية)
          </label>
        </div>
      )}

      {/* العروض المحفوظة */}
      {(savedViews.length > 0 || active > 0) && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line pt-2 text-xs">
          <span className="text-gray-500">العروض:</span>
          {savedViews.map((v) => {
            const href = `${pathname}?${new URLSearchParams(v.filters).toString()}`;
            return (
              <span key={v.id} className="inline-flex items-center gap-0.5 rounded-full border border-gray-300 ps-2.5">
                <button type="button" onClick={() => router.push(href)} className="py-1 text-gray-700 hover:text-brand-700">{v.name}</button>
                <button type="button" onClick={() => deleteView(v.id)} aria-label={`حذف العرض ${v.name}`} className="px-1.5 text-gray-400 hover:text-red-600">×</button>
              </span>
            );
          })}
          {active > 0 && (
            <span className="inline-flex items-center gap-1">
              <input value={viewName} onChange={(e) => setViewName(e.target.value)} placeholder="اسم العرض" maxLength={60}
                className="w-32 rounded-full border border-gray-300 px-2.5 py-1" />
              <button type="button" onClick={saveView} className="rounded-full bg-brand-600 px-2.5 py-1 font-semibold text-white">احفظ العرض</button>
            </span>
          )}
          {msg && <span className="text-gray-500">{msg}</span>}
        </div>
      )}
    </section>
  );
}
