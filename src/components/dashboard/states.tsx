"use client";

import { Component, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/client";

// ============================================================
// حالات الأقسام على العميل: الخطأ وإعادة المحاولة وحدود الخطأ.
//
// كل قسم في اللوحة ملفوف بـ <SectionBoundary>: إن رمى مكوّنه (خطأ
// خادم أثناء البثّ، أو استثناء غير متوقّع) يُعرض «تعذّر تحميل هذا
// القسم» مكانه وحده، وتبقى بقية اللوحة. لا ملف error.tsx في المشروع،
// فبدون هذا الحدّ كان خطأ قسمٍ واحد يُسقط الصفحة كلها.
// ============================================================

export function RetryButton({ label }: { label?: string }) {
  const router = useRouter();
  const { t } = useI18n();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      onClick={() => start(() => router.refresh())}
      disabled={pending}
      className="dash-focus inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-bold text-ink-secondary transition hover:bg-surface-subtle disabled:opacity-60"
    >
      <span aria-hidden="true" className={`material-symbols-outlined text-[16px] ${pending ? "animate-spin" : ""}`}>
        refresh
      </span>
      {label ?? t.dash.common.retry}
    </button>
  );
}

export function ErrorState({ compact = false, detail }: { compact?: boolean; detail?: string }) {
  const { t } = useI18n();
  return (
    <div
      role="alert"
      className={`flex flex-col items-center justify-center rounded-card border border-dashed border-danger-100 bg-danger-50/40 text-center ${
        compact ? "px-4 py-5" : "px-6 py-8"
      }`}
    >
      <span aria-hidden="true" className="material-symbols-outlined mb-1 text-danger-600">
        cloud_off
      </span>
      <p className="text-sm font-bold text-ink">{t.dash.common.sectionError}</p>
      <p className="mb-3 mt-0.5 max-w-md text-xs text-ink-secondary">{t.dash.common.sectionErrorHint}</p>
      {detail && process.env.NODE_ENV !== "production" && (
        <p className="mb-3 max-w-md break-all text-[11px] text-ink-muted" dir="ltr">{detail}</p>
      )}
      <RetryButton />
    </div>
  );
}

type BoundaryState = { error: Error | null };

export class SectionBoundary extends Component<{ children: React.ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("[dashboard] section failed:", error.message);
  }

  render() {
    if (this.state.error) return <ErrorState detail={this.state.error.message} />;
    return this.props.children;
  }
}
