"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/client";
import { fill } from "@/lib/dashboard/format";
import { VIEWS, type DashView } from "@/lib/dashboard/views";

// ============================================================
// تخصيص لوحات شخص — للمدير.
//
// الاختيار مرتّب: أول لوحة تُفتح افتراضياً، والبقية ألسنة. والحفظ عبر
// set_dashboard_views (184) — هي التي تتحقّق أن المستخدم مدير، وتُهمل
// القيم الغريبة، وتمنع لوحة الوسيط عن الموظف والعكس.
// ============================================================

export type Person = {
  user_id: string; name: string; email: string; role: string; role_name: string;
  position_title: string | null; status: string | null;
  auto_views: string[]; override_views: string[] | null; mismatch: boolean; position_role_name: string | null;
};

const INTERNAL: DashView[] = VIEWS.filter((v) => v !== "broker");

export default function PeopleEditor({ people }: { people: Person[] }) {
  const { t } = useI18n();
  const p = t.dash.people;
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? people.filter((x) => `${x.name} ${x.email} ${x.position_title ?? ""}`.toLowerCase().includes(n)) : people;
  }, [people, q]);

  return (
    <div>
      <label className="relative mb-3 block sm:max-w-xs">
        <span className="sr-only">{t.dash.table.search}</span>
        <span aria-hidden="true" className="material-symbols-outlined pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-[18px] text-ink-muted">search</span>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t.dash.table.search}
          className="dash-focus h-9 w-full rounded-lg border border-line bg-surface pe-3 ps-9 text-sm"
        />
      </label>
      <ul className="space-y-3">
        {shown.map((person) => <PersonRow key={person.user_id} person={person} />)}
      </ul>
    </div>
  );
}

function PersonRow({ person }: { person: Person }) {
  const { t } = useI18n();
  const p = t.dash.people;
  const labels = t.dash.views;
  const router = useRouter();
  const broker = person.role === "broker";
  const auto = person.auto_views as DashView[];
  const initial = (person.override_views ?? person.auto_views) as DashView[];
  const [picked, setPicked] = useState<DashView[]>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const custom = person.override_views !== null;
  const dirty = picked.join(",") !== initial.join(",");

  function toggle(v: DashView) {
    setMsg(null);
    setPicked((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]));
  }

  async function save(views: DashView[] | null) {
    if (views && views.length === 0) {
      setMsg({ ok: false, text: p.pickOne });
      return;
    }
    setBusy(true);
    setMsg(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("set_dashboard_views", { p_user: person.user_id, p_views: views });
    setBusy(false);
    if (error) {
      setMsg({ ok: false, text: error.message });
      return;
    }
    if (!views) setPicked(auto);
    setMsg({ ok: true, text: p.saved });
    router.refresh();
  }

  const options = broker ? (["broker"] as DashView[]) : INTERNAL;

  return (
    <li className={`dash-card p-4 ${person.status && person.status !== "active" ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-ink"><bdi>{person.name}</bdi></p>
          <p className="text-xs text-ink-muted">
            <span>{person.role_name}</span>
            {person.position_title && <span> · {person.position_title}</span>}
            {person.status && person.status !== "active" && <span> · {p.inactive}</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${custom ? "bg-info-50 text-info-700 ring-info-100" : "bg-surface-sunken text-ink-secondary ring-line"}`}>
            {custom ? p.custom : p.auto}
          </span>
          {person.mismatch && (
            <span className="inline-flex items-center gap-1 rounded-full bg-warning-50 px-2 py-0.5 text-xs font-semibold text-warning-700 ring-1 ring-inset ring-warning-100">
              <span aria-hidden="true" className="material-symbols-outlined text-[14px]">manage_accounts</span>
              {fill(p.mismatch, { role: person.position_role_name ?? "—" })}
            </span>
          )}
        </div>
      </div>

      <fieldset className="mt-3">
        <legend className="mb-1.5 text-[11px] text-ink-muted">{p.views} — {p.first}</legend>
        <div className="flex flex-wrap gap-1.5">
          {options.map((v) => {
            const idx = picked.indexOf(v);
            const on = idx >= 0;
            return (
              <button
                key={v}
                type="button"
                role="checkbox"
                aria-checked={on}
                disabled={broker || busy}
                onClick={() => toggle(v)}
                className={`dash-focus inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
                  on ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-surface text-ink-secondary hover:border-line-strong"
                } ${auto.includes(v) && !on ? "border-dashed" : ""}`}
              >
                {on && <span className="rounded bg-white/20 px-1 text-[10px]">{idx + 1}</span>}
                {labels[v]}
              </button>
            );
          })}
        </div>
      </fieldset>

      {!broker && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!dirty || busy}
            onClick={() => save(picked)}
            className="dash-focus rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-brand-700 disabled:opacity-40"
          >
            {busy ? p.saving : p.save}
          </button>
          {custom && (
            <button
              type="button"
              disabled={busy}
              onClick={() => save(null)}
              className="dash-focus rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-secondary hover:bg-surface-subtle disabled:opacity-40"
            >
              {p.reset}
            </button>
          )}
          {msg && (
            <span role="status" className={`text-xs font-semibold ${msg.ok ? "text-success-700" : "text-danger-700"}`}>
              {msg.text}
            </span>
          )}
        </div>
      )}
    </li>
  );
}
