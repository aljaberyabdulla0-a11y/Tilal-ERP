"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export type CatalogRow = {
  id: string; code: string; name_ar: string; name_en: string | null; description: string | null;
  owner_department_id: string | null; beneficiary_department_id: string | null; responsibility_type: string;
  default_priority: string; default_workload_pct: number; sla_hours: number | null; max_assignees: number | null;
  requires_lead: boolean; is_active: boolean; is_seed: boolean;
};
export type ModuleRow = { code: string; name_ar: string };
type Perm = { responsibility_id: string; module: string; actions: string[]; scope: string };

const TYPES: Record<string, string> = {
  monitoring: "مراقبة", review: "مراجعة", follow_up: "متابعة", coordination: "تنسيق", audit: "تدقيق", other: "أخرى",
};
const ACTIONS: Record<string, string> = { read: "قراءة", create: "إنشاء", update: "تعديل", approve: "اعتماد", export: "تصدير" };
const SCOPES: Record<string, string> = { own: "نفسه", team: "فريقه", department: "قسمه", all: "الكل" };
const EMPTY = { id: "", code: "", name_ar: "", description: "", owner_department_id: "", beneficiary_department_id: "",
  responsibility_type: "monitoring", default_workload_pct: "0", sla_hours: "", max_assignees: "", requires_lead: true };

// المكتبة: تفعيل/تعديل/إنشاء/أرشفة عبر responsibility_save و responsibility_archive،
// والصلاحيات عبر responsibility_set_permissions (المدير العام وحده — القاعدة ترفض غيره).
export default function ResponsibilitiesLibrary({
  catalog, departments, activeCounts, permissions, modules, isAdmin,
}: {
  catalog: CatalogRow[]; departments: { id: string; name_ar: string }[]; activeCounts: Record<string, number>;
  permissions: Perm[]; modules: ModuleRow[]; isAdmin: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [onlyActive, setOnlyActive] = useState(false);
  const [form, setForm] = useState<typeof EMPTY | null>(null);
  const [permFor, setPermFor] = useState<string | null>(null);
  const [permDraft, setPermDraft] = useState<Record<string, { actions: string[]; scope: string }>>({});

  const depName = (id: string | null) => departments.find((d) => d.id === id)?.name_ar ?? "—";
  const rows = useMemo(() => catalog.filter((c) =>
    (!onlyActive || c.is_active) && (!q || c.name_ar.includes(q) || (c.name_en ?? "").toLowerCase().includes(q.toLowerCase()))),
  [catalog, q, onlyActive]);
  const groups = useMemo(() => {
    const g: Record<string, CatalogRow[]> = {};
    rows.forEach((r) => (g[depName(r.owner_department_id)] ||= []).push(r));
    return Object.entries(g);
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  async function rpc(fn: string, args: Record<string, unknown>) {
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) {
      setErr(error.message);
      return false;
    }
    router.refresh();
    return true;
  }

  function openPerms(id: string) {
    const d: Record<string, { actions: string[]; scope: string }> = {};
    permissions.filter((p) => p.responsibility_id === id).forEach((p) => (d[p.module] = { actions: p.actions, scope: p.scope }));
    setPermDraft(d);
    setPermFor(id);
  }

  const input = "rounded border border-gray-300 px-2 py-1 text-sm";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border bg-white p-4 shadow-sm">
        <input className={`${input} flex-1`} placeholder="بحث في المسؤوليات" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="flex items-center gap-1 text-sm text-gray-600">
          <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} /> المفعّلة فقط
        </label>
        <button className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white" onClick={() => setForm({ ...EMPTY })}>
          مسؤولية جديدة
        </button>
      </div>
      <p className="text-xs text-gray-500">
        المسؤولية التشغيلية تُسند لموظف من أي قسم دون تغيير منصبه أو تبعيته الإدارية. التكليف من صفحة الموظف ←
        «الوظائف والمسؤوليات». المسؤولية المعطّلة لا يُكلَّف بها أحد.
      </p>
      {err && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{err}</p>}

      {form && (
        <div className="grid gap-2 rounded-2xl border bg-white p-4 shadow-sm sm:grid-cols-4">
          {!form.id && (
            <input className={input} dir="ltr" placeholder="code (a-z_)" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          )}
          <input className={`${input} sm:col-span-2`} placeholder="الاسم" value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} />
          <select className={input} value={form.responsibility_type} onChange={(e) => setForm({ ...form, responsibility_type: e.target.value })}>
            {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className={input} value={form.owner_department_id} onChange={(e) => setForm({ ...form, owner_department_id: e.target.value })}>
            <option value="">— القسم المالك —</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name_ar}</option>)}
          </select>
          <select className={input} value={form.beneficiary_department_id} onChange={(e) => setForm({ ...form, beneficiary_department_id: e.target.value })}>
            <option value="">— القسم المستفيد —</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name_ar}</option>)}
          </select>
          <label className="text-xs text-gray-600">نسبة الحمل الافتراضية
            <input className={`${input} mt-1 w-full`} type="number" min={0} max={100} value={form.default_workload_pct}
              onChange={(e) => setForm({ ...form, default_workload_pct: e.target.value })} />
          </label>
          <label className="text-xs text-gray-600">SLA (ساعات)
            <input className={`${input} mt-1 w-full`} type="number" min={1} value={form.sla_hours} onChange={(e) => setForm({ ...form, sla_hours: e.target.value })} />
          </label>
          <label className="text-xs text-gray-600">أقصى عدد للمكلَّفين
            <input className={`${input} mt-1 w-full`} type="number" min={1} value={form.max_assignees} onChange={(e) => setForm({ ...form, max_assignees: e.target.value })} />
          </label>
          <label className="flex items-center gap-1 text-xs text-gray-600">
            <input type="checkbox" checked={form.requires_lead} onChange={(e) => setForm({ ...form, requires_lead: e.target.checked })} /> مسؤول رئيسي واحد
          </label>
          <textarea className={`${input} sm:col-span-4`} rows={2} placeholder="الوصف" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <div className="flex gap-2 sm:col-span-4">
            <button disabled={busy || !form.name_ar || (!form.id && !form.code)} className="rounded bg-brand-600 px-4 py-1.5 text-sm text-white disabled:opacity-40"
              onClick={async () => {
                const ok = await rpc("responsibility_save", { p: {
                  ...(form.id ? { id: form.id } : { code: form.code.trim() }),
                  name_ar: form.name_ar.trim(), description: form.description, responsibility_type: form.responsibility_type,
                  owner_department_id: form.owner_department_id || "", beneficiary_department_id: form.beneficiary_department_id || "",
                  default_workload_pct: Number(form.default_workload_pct || 0),
                  sla_hours: form.sla_hours ? Number(form.sla_hours) : null,
                  max_assignees: form.max_assignees ? Number(form.max_assignees) : null,
                  requires_lead: form.requires_lead,
                } });
                if (ok) setForm(null);
              }}>حفظ</button>
            <button className="rounded border px-4 py-1.5 text-sm" onClick={() => setForm(null)}>إلغاء</button>
          </div>
        </div>
      )}

      {groups.map(([dept, list]) => (
        <div key={dept} className="rounded-2xl border bg-white p-4 shadow-sm">
          <h3 className="mb-2 font-semibold text-gray-800">{dept}</h3>
          <ul className="divide-y text-sm">
            {list.map((c) => {
              const n = activeCounts[c.id] ?? 0;
              const pcount = permissions.filter((p) => p.responsibility_id === c.id).length;
              return (
                <li key={c.id} className="py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${c.is_active ? "bg-green-500" : "bg-gray-300"}`} />
                    <span className="font-medium">{c.name_ar}</span>
                    {c.name_en && <span className="text-xs text-gray-400" dir="ltr">{c.name_en}</span>}
                    <span className="rounded bg-gray-100 px-1.5 text-xs">{TYPES[c.responsibility_type]}</span>
                    <span className="text-xs text-gray-500">لـ {depName(c.beneficiary_department_id)}</span>
                    <span className="text-xs text-gray-500">{n} مكلَّف</span>
                    {pcount > 0 && <span className="rounded bg-amber-50 px-1.5 text-[11px] text-amber-700">{pcount} صلاحية</span>}
                    <span className="ms-auto flex gap-3 text-xs">
                      <button disabled={busy} className="text-brand-700 hover:underline"
                        onClick={() => rpc("responsibility_save", { p: { id: c.id, is_active: !c.is_active, reason: c.is_active ? "تعطيل" : "تفعيل" } })}>
                        {c.is_active ? "تعطيل" : "تفعيل"}
                      </button>
                      <button className="text-brand-700 hover:underline" onClick={() => setForm({
                        id: c.id, code: c.code, name_ar: c.name_ar, description: c.description ?? "",
                        owner_department_id: c.owner_department_id ?? "", beneficiary_department_id: c.beneficiary_department_id ?? "",
                        responsibility_type: c.responsibility_type, default_workload_pct: String(c.default_workload_pct),
                        sla_hours: c.sla_hours ? String(c.sla_hours) : "", max_assignees: c.max_assignees ? String(c.max_assignees) : "",
                        requires_lead: c.requires_lead,
                      })}>تعديل</button>
                      {isAdmin && <button className="text-amber-700 hover:underline" onClick={() => openPerms(c.id)}>الصلاحيات</button>}
                      <button disabled={busy || n > 0} title={n > 0 ? "أنهِ التكليفات أولاً" : ""} className="text-red-600 hover:underline disabled:opacity-40"
                        onClick={() => {
                          const r = prompt("سبب الأرشفة:");
                          if (r && r.trim()) rpc("responsibility_archive", { p_id: c.id, p_reason: r.trim() });
                        }}>أرشفة</button>
                    </span>
                  </div>
                  {c.description && <p className="mt-1 text-xs text-gray-500">{c.description}</p>}

                  {permFor === c.id && (
                    <div className="mt-2 rounded bg-amber-50 p-3">
                      <p className="mb-2 text-xs text-amber-800">
                        ما يمنحه التكليف بهذه المسؤولية ما دام فعّالاً. لا تُمنح صلاحيات القسم كاملة — اختر الحدّ الأدنى.
                      </p>
                      <div className="space-y-1">
                        {modules.map((m) => {
                          const cur = permDraft[m.code];
                          return (
                            <div key={m.code} className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="w-40">{m.name_ar}</span>
                              {Object.entries(ACTIONS).map(([a, label]) => (
                                <label key={a} className="flex items-center gap-1">
                                  <input type="checkbox" checked={!!cur?.actions.includes(a)} onChange={(e) => {
                                    const acts = new Set(cur?.actions ?? []);
                                    if (e.target.checked) acts.add(a); else acts.delete(a);
                                    const next = { ...permDraft };
                                    if (acts.size) next[m.code] = { actions: Array.from(acts), scope: cur?.scope ?? "own" };
                                    else delete next[m.code];
                                    setPermDraft(next);
                                  }} /> {label}
                                </label>
                              ))}
                              {cur && (
                                <select className="rounded border px-1 text-xs" value={cur.scope}
                                  onChange={(e) => setPermDraft({ ...permDraft, [m.code]: { ...cur, scope: e.target.value } })}>
                                  {Object.entries(SCOPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                                </select>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <div className="mt-2 flex gap-2">
                        <button disabled={busy} className="rounded bg-amber-600 px-3 py-1 text-xs text-white" onClick={async () => {
                          const r = prompt("سبب تعديل الصلاحيات:");
                          if (!r || !r.trim()) return;
                          const ok = await rpc("responsibility_set_permissions", {
                            p_id: c.id, p_reason: r.trim(),
                            p_rows: Object.entries(permDraft).map(([module, v]) => ({ module, actions: v.actions, scope: v.scope })),
                          });
                          if (ok) setPermFor(null);
                        }}>حفظ الصلاحيات</button>
                        <button className="rounded border px-3 py-1 text-xs" onClick={() => setPermFor(null)}>إغلاق</button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
