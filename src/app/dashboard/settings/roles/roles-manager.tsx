"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ROLE_LABELS } from "@/lib/types";
import {
  AppModule,
  BASE_ROLES,
  PERMISSION_ACTIONS,
  PERMISSION_SCOPES,
  Role,
  RolePermission,
} from "@/lib/org-types";

type Row = { actions: string[]; scope: string };
type RoleForm = {
  isNew: boolean;
  code: string;
  name_ar: string;
  name_en: string;
  base_role: string;
  description: string;
  clone_from: string;
};

// الأدوار ومصفوفتها. طبقتان:
//   المستوى الأمني (base_role) — ما تقرؤه سياسات RLS القائمة، ويُشتق منه profiles.role
//   المصفوفة — تُفرض الآن للوحدات «المُطبَّقة»، ولغيرها هي السياسة المستهدفة
export default function RolesManager({
  roles,
  modules,
  permissions,
  counts,
}: {
  roles: Role[];
  modules: AppModule[];
  permissions: RolePermission[];
  counts: Record<string, number>;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [selected, setSelected] = useState<string>(roles[0]?.code ?? "");
  const [form, setForm] = useState<RoleForm | null>(null);
  const [matrix, setMatrix] = useState<Record<string, Row>>(() => buildMatrix(roles[0]?.code ?? ""));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function buildMatrix(code: string): Record<string, Row> {
    const m: Record<string, Row> = {};
    modules.forEach((mod) => {
      const p = permissions.find((x) => x.role_code === code && x.module === mod.code);
      m[mod.code] = { actions: p?.actions ?? [], scope: p?.scope ?? "own" };
    });
    return m;
  }

  function pick(code: string) {
    if (dirty && !confirm("تغييرات المصفوفة لم تُحفظ. تجاهلها؟")) return;
    setSelected(code);
    setMatrix(buildMatrix(code));
    setDirty(false);
    setMsg(null);
    setForm(null);
  }

  const role = roles.find((r) => r.code === selected);
  const isAdminLevel = role?.base_role === "admin";

  function toggle(mod: string, action: string) {
    setMatrix((m) => {
      const row = m[mod];
      const has = row.actions.includes(action);
      return { ...m, [mod]: { ...row, actions: has ? row.actions.filter((a) => a !== action) : [...row.actions, action] } };
    });
    setDirty(true);
  }

  async function saveMatrix() {
    if (!role) return;
    setSaving(true);
    setMsg(null);
    const upserts = Object.entries(matrix)
      .filter(([, r]) => r.actions.length > 0)
      .map(([module, r]) => ({ role_code: role.code, module, actions: r.actions, scope: r.scope }));
    const empties = Object.entries(matrix)
      .filter(([, r]) => r.actions.length === 0)
      .map(([module]) => module);

    const up = upserts.length
      ? await supabase.from("role_permissions").upsert(upserts, { onConflict: "role_code,module" })
      : { error: null };
    const del = empties.length
      ? await supabase.from("role_permissions").delete().eq("role_code", role.code).in("module", empties)
      : { error: null };
    setSaving(false);
    const err = up.error ?? del.error;
    if (err) {
      setMsg({ ok: false, text: err.message });
      return;
    }
    setDirty(false);
    setMsg({ ok: true, text: "حُفظت المصفوفة ✓" });
    router.refresh();
  }

  async function saveRole(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setMsg(null);
    const payload = {
      name_ar: form.name_ar.trim(),
      name_en: form.name_en.trim() || null,
      description: form.description.trim() || null,
      base_role: form.base_role,
    };
    let error;
    if (form.isNew) {
      const code = form.code.trim().toLowerCase();
      ({ error } = await supabase.from("roles").insert({ ...payload, code }));
      if (!error && form.clone_from) {
        const rows = permissions
          .filter((p) => p.role_code === form.clone_from)
          .map((p) => ({ role_code: code, module: p.module, actions: p.actions, scope: p.scope }));
        if (rows.length) ({ error } = await supabase.from("role_permissions").insert(rows));
      }
      if (!error) {
        setSelected(code);
        setMatrix(buildMatrix(form.clone_from));
        setDirty(false);
      }
    } else {
      ({ error } = await supabase.from("roles").update(payload).eq("code", selected));
    }
    setSaving(false);
    if (error) {
      setMsg({ ok: false, text: error.message.includes("roles_pkey") ? "هذا الرمز مستخدم لدور آخر." : error.message });
      return;
    }
    setForm(null);
    setMsg({ ok: true, text: "حُفظ الدور ✓" });
    router.refresh();
  }

  async function setStatus(status: "نشط" | "مؤرشف") {
    if (!role) return;
    const { error } = await supabase.from("roles").update({ status }).eq("code", role.code);
    if (error) setMsg({ ok: false, text: error.message });
    else router.refresh();
  }

  const areas = Array.from(new Set(modules.map((m) => m.area)));
  const input =
    "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";
  const label = "mb-1 block text-xs font-medium text-gray-600";

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[18rem_1fr]">
      {/* قائمة الأدوار */}
      <aside className="space-y-3">
        <button
          onClick={() => {
            setForm({ isNew: true, code: "", name_ar: "", name_en: "", base_role: "employee", description: "", clone_from: "employee" });
            setMsg(null);
          }}
          className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          + دور جديد
        </button>
        <div className="divide-y rounded-2xl border bg-white shadow-sm">
          {roles.map((r) => (
            <button
              key={r.code}
              onClick={() => pick(r.code)}
              className={`block w-full px-4 py-2.5 text-start text-sm transition ${
                r.code === selected ? "bg-brand-50" : "hover:bg-gray-50"
              } ${r.status !== "نشط" ? "opacity-50" : ""}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-gray-800">{r.name_ar}</span>
                <span className="text-xs text-gray-400">{counts[r.code] ?? 0}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-gray-500">
                <span>مستوى: {ROLE_LABELS[r.base_role] ?? r.base_role}</span>
                {r.is_system && <span className="rounded bg-gray-100 px-1">نظامي</span>}
                {r.status !== "نشط" && <span className="rounded bg-gray-200 px-1">مؤرشف</span>}
              </div>
            </button>
          ))}
        </div>
      </aside>

      <div className="space-y-4">
        {msg && (
          <div className={`rounded-lg p-3 text-sm ${msg.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
            {msg.text}
          </div>
        )}

        {form && (
          <form onSubmit={saveRole} className="space-y-4 rounded-2xl border bg-white p-6 shadow-sm">
            <h3 className="font-semibold text-gray-800">{form.isNew ? "دور جديد" : "تعديل الدور"}</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {form.isNew && (
                <div>
                  <label className={label}>الرمز * (إنجليزي صغير و _)</label>
                  <input className={input} dir="ltr" required pattern="[a-z][a-z0-9_]{1,40}" value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value.toLowerCase() })} />
                </div>
              )}
              <div>
                <label className={label}>الاسم بالعربية *</label>
                <input className={input} required value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} />
              </div>
              <div>
                <label className={label}>الاسم بالإنجليزية</label>
                <input className={input} dir="ltr" value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} />
              </div>
              <div>
                <label className={label}>المستوى الأمني *</label>
                <select className={input} value={form.base_role} disabled={!form.isNew && role?.is_system}
                  onChange={(e) => setForm({ ...form, base_role: e.target.value })}>
                  {BASE_ROLES.map((b) => <option key={b} value={b}>{ROLE_LABELS[b] ?? b}</option>)}
                </select>
                <p className="mt-1 text-[11px] text-gray-500">
                  ما تراه شاشات النظام الحالية لصاحب الدور. تغييره يسري فوراً على كل من يحمل الدور.
                </p>
              </div>
              {form.isNew && (
                <div>
                  <label className={label}>انسخ المصفوفة من</label>
                  <select className={input} value={form.clone_from} onChange={(e) => setForm({ ...form, clone_from: e.target.value })}>
                    <option value="">— مصفوفة فارغة —</option>
                    {roles.map((r) => <option key={r.code} value={r.code}>{r.name_ar}</option>)}
                  </select>
                </div>
              )}
              <div className="sm:col-span-2">
                <label className={label}>الوصف</label>
                <input className={input} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
            </div>
            <div className="flex gap-2">
              <button disabled={saving} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
                {saving ? "جاري الحفظ..." : "حفظ"}
              </button>
              <button type="button" onClick={() => setForm(null)} className="rounded-lg border px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
                إلغاء
              </button>
            </div>
          </form>
        )}

        {role && !form && (
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-gray-800">{role.name_ar}</h3>
                <p className="text-xs text-gray-500">
                  <span dir="ltr" className="font-mono">{role.code}</span> · المستوى الأمني:{" "}
                  {ROLE_LABELS[role.base_role] ?? role.base_role} · {counts[role.code] ?? 0} حساب
                </p>
                {role.description && <p className="mt-1 text-sm text-gray-600">{role.description}</p>}
              </div>
              <div className="flex gap-2 text-sm">
                <button
                  onClick={() =>
                    setForm({
                      isNew: false, code: role.code, name_ar: role.name_ar, name_en: role.name_en ?? "",
                      base_role: role.base_role, description: role.description ?? "", clone_from: "",
                    })
                  }
                  className="rounded-lg border px-3 py-1.5 text-gray-600 hover:bg-gray-50"
                >
                  تعديل
                </button>
                {!role.is_system &&
                  (role.status === "نشط" ? (
                    <button onClick={() => setStatus("مؤرشف")} className="rounded-lg border px-3 py-1.5 text-gray-500 hover:text-red-600">أرشفة</button>
                  ) : (
                    <button onClick={() => setStatus("نشط")} className="rounded-lg border px-3 py-1.5 text-brand-700">استعادة</button>
                  ))}
              </div>
            </div>
          </div>
        )}

        {role && (
          <div className="rounded-2xl border bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3">
              <h3 className="font-semibold text-gray-800">مصفوفة الصلاحيات</h3>
              {isAdminLevel ? (
                <span className="text-xs text-gray-500">دور بمستوى «مدير»: يملك كل شيء أياً كانت المصفوفة.</span>
              ) : (
                <button onClick={saveMatrix} disabled={!dirty || saving}
                  className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-40">
                  {saving ? "جاري الحفظ..." : "حفظ المصفوفة"}
                </button>
              )}
            </div>
            <p className="border-b bg-amber-50 px-5 py-2 text-xs text-amber-800">
              الوحدات المعلَّمة «مُطبَّق» تُفرض صلاحياتها من هنا الآن. غيرها يحكمه المستوى الأمني حتى تُرحَّل
              وحدتها؛ ما تضعه لها هنا هو السياسة التي ستُطبَّق عند ترحيلها.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-xs">
                <thead className="border-b bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-3 py-2 text-start font-medium">الوحدة</th>
                    {PERMISSION_ACTIONS.map((a) => (
                      <th key={a.key} className="px-1 py-2 text-center font-medium">{a.label}</th>
                    ))}
                    <th className="px-3 py-2 text-start font-medium">النطاق</th>
                  </tr>
                </thead>
                <tbody>
                  {areas.map((area) => (
                    <AreaRows
                      key={area}
                      area={area}
                      modules={modules.filter((m) => m.area === area)}
                      matrix={matrix}
                      disabled={isAdminLevel}
                      onToggle={toggle}
                      onScope={(mod, scope) => {
                        setMatrix((m) => ({ ...m, [mod]: { ...m[mod], scope } }));
                        setDirty(true);
                      }}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AreaRows({
  area,
  modules,
  matrix,
  disabled,
  onToggle,
  onScope,
}: {
  area: string;
  modules: AppModule[];
  matrix: Record<string, Row>;
  disabled: boolean;
  onToggle: (mod: string, action: string) => void;
  onScope: (mod: string, scope: string) => void;
}) {
  return (
    <>
      <tr className="bg-gray-50/60">
        <td colSpan={PERMISSION_ACTIONS.length + 2} className="px-3 py-1.5 text-[11px] font-semibold text-gray-500">
          {area}
        </td>
      </tr>
      {modules.map((m) => {
        const row = matrix[m.code] ?? { actions: [], scope: "own" };
        return (
          <tr key={m.code} className="border-b last:border-0">
            <td className="px-3 py-1.5">
              <span className="text-sm text-gray-800">{m.name_ar}</span>
              {m.enforced ? (
                <span className="ms-2 rounded bg-green-100 px-1.5 py-0.5 text-[10px] text-green-700">مُطبَّق</span>
              ) : (
                <span className="ms-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">غير مُطبَّق بعد</span>
              )}
            </td>
            {PERMISSION_ACTIONS.map((a) => (
              <td key={a.key} className="px-1 py-1.5 text-center">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={disabled || row.actions.includes(a.key)}
                  onChange={() => onToggle(m.code, a.key)}
                  className="h-4 w-4 accent-brand-600"
                />
              </td>
            ))}
            <td className="px-3 py-1.5">
              <select
                disabled={disabled || row.actions.length === 0}
                value={disabled ? "all" : row.scope}
                onChange={(e) => onScope(m.code, e.target.value)}
                className="rounded border border-gray-300 px-1.5 py-1 text-xs disabled:opacity-40"
              >
                {PERMISSION_SCOPES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </td>
          </tr>
        );
      })}
    </>
  );
}
