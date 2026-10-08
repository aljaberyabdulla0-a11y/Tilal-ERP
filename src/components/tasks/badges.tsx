import { TASK_PRIORITY_COLORS, TASK_STATUS_COLORS, dayLabel, shortTime, type TaskLabelChip } from "@/lib/types";
import { labelClasses } from "@/lib/tasks";

// ============================================================
// شارات المهمة — بلا حالة، تصلح للخادم والمتصفح.
// اللون للحالة فقط (الأولوية والحالة والوسم)، والنصّ يقول المعنى دائماً
// فلا يعتمد أحد على اللون وحده.
// ============================================================

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TASK_STATUS_COLORS[status] ?? "bg-gray-100 text-gray-600"}`}>
      {status}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TASK_PRIORITY_COLORS[priority] ?? "bg-gray-100 text-gray-600"}`}>
      {priority}
    </span>
  );
}

export function StepBadge({ name, color }: { name: string | null; color: string | null }) {
  if (!name) return null;
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${labelClasses(color)}`}>
      <span aria-hidden="true" className="material-symbols-outlined me-0.5 align-[-2px] text-[13px]">linear_scale</span>
      {name}
    </span>
  );
}

export function LabelChips({ labels }: { labels: TaskLabelChip[] | undefined }) {
  if (!labels?.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {labels.map((l) => (
        <span key={l.id} className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${labelClasses(l.color)}`}>
          #{l.name}
        </span>
      ))}
    </span>
  );
}

export function TypeIcon({ icon, name }: { icon: string | null | undefined; name: string | null | undefined }) {
  return (
    <span
      title={name ?? undefined}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700"
    >
      <span aria-hidden="true" className="material-symbols-outlined text-[17px]">{icon || "task_alt"}</span>
      <span className="sr-only">{name}</span>
    </span>
  );
}

export function DueLabel({
  date, time, todayISO, late,
}: { date: string | null; time?: string | null; todayISO: string; late?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 ${late ? "font-bold text-red-600" : ""}`}>
      <span aria-hidden="true" className="material-symbols-outlined text-[15px] text-gray-400">event</span>
      {dayLabel(date, todayISO)}
      {time ? ` · ${shortTime(time)}` : ""}
    </span>
  );
}

// شريط تقدّم صغير «٣ / ٥»
export function MiniProgress({ done, total }: { done: number; total: number }) {
  if (!total) return null;
  const pct = Math.round((100 * done) / total);
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-500" title={`${done} من ${total}`}>
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-gray-200">
        <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
      </span>
      <span dir="ltr" className="num-tabular">{done}/{total}</span>
    </span>
  );
}

export function FlagChip({ tone, icon, children }: { tone: "red" | "amber" | "purple" | "blue" | "gray"; icon: string; children: React.ReactNode }) {
  const tones = {
    red: "bg-red-50 text-red-700",
    amber: "bg-amber-50 text-amber-800",
    purple: "bg-purple-50 text-purple-700",
    blue: "bg-blue-50 text-blue-700",
    gray: "bg-gray-100 text-gray-600",
  };
  return (
    <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold ${tones[tone]}`}>
      <span aria-hidden="true" className="material-symbols-outlined text-[13px]">{icon}</span>
      {children}
    </span>
  );
}
