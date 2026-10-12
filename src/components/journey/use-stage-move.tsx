"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import ClientLostFlow from "@/components/lost-sale/client-lost-flow";
import ReactivateDialog from "@/components/lost-sale/reactivate-dialog";
import {
  currentJourneyId,
  moveClientStage,
  stageMoveIntent,
  type StageRule,
} from "@/lib/crm-journey";

// ============================================================
// نقل مرحلة العميل من أي مكان (القائمة، الملف، الكانبان) — باب واحد.
//
// القرار في القاعدة (crm_move_client_stage + الحارس). هنا نعرف مسبقاً
// أيّ نافذة يحتاجها النقل فلا يرى الموظف رفضاً كان يمكن تجنّبه:
//   الخسارة ← نموذج التحليل · الخاسر ← إعادة التنشيط · الإغلاق غير
//   التجاري والعودة منه ← سبب · «حجز» ← من تبويب العقار.
// وإن رفضت القاعدة بتلميح (hint) فتحنا نافذته بدل عرض الخطأ.
// ============================================================

type Pending =
  | { kind: "reason"; clientId: string; to: string; title: string }
  | { kind: "lost"; clientId: string }
  | { kind: "reactivate"; clientId: string; journeyId: string }
  | { kind: "info"; clientId: string; text: string; link?: { href: string; label: string } };

export function useStageMove({
  stages,
  isAdmin = false,
  onMoved,
}: {
  stages: StageRule[];
  isAdmin?: boolean;
  // بعد كل نقل ناجح (أو إغلاق بنموذج): المرحلة الجديدة للبطاقة كما قرأتها القاعدة
  onMoved: (clientId: string, clientStage: string | null) => void;
}) {
  const supabase = createClient();
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);

  const find = (name: string | null | undefined) => stages.find((s) => s.name === name);

  async function refreshStage(clientId: string) {
    const { data } = await supabase.from("clients").select("stage").eq("id", clientId).maybeSingle();
    onMoved(clientId, (data as { stage?: string } | null)?.stage ?? null);
  }

  async function openFromHint(clientId: string, to: string, hint: string | null, message: string) {
    if (hint === "close_opportunity_lost") return setPending({ kind: "lost", clientId });
    if (hint === "reactivate_lost_opportunity") {
      const j = await currentJourneyId(supabase, clientId);
      if (j) return setPending({ kind: "reactivate", clientId, journeyId: j });
    }
    if (hint === "stage_reason") {
      return setPending({ kind: "reason", clientId, to, title: `سبب النقل إلى «${to}»` });
    }
    if (hint === "reserve_unit") {
      return setPending({
        kind: "info", clientId, text: message,
        link: { href: `/dashboard/clients/${clientId}?tab=property`, label: "احجز من تبويب العقار" },
      });
    }
    if (hint === "start_journey") {
      return setPending({
        kind: "info", clientId, text: message,
        link: { href: `/dashboard/clients/${clientId}?tab=journey#new-journey`, label: "مسار شراء إضافي" },
      });
    }
    setError(message);
  }

  async function send(clientId: string, to: string, reason?: string) {
    setError(null);
    const r = await moveClientStage(supabase, clientId, to, reason);
    if (!r.ok) {
      await openFromHint(clientId, to, r.hint, r.message);
      return false;
    }
    onMoved(clientId, r.clientStage ?? to);
    return true;
  }

  // يُستدعى عند اختيار مرحلة: يرسل أو يفتح النافذة المناسبة
  async function request(clientId: string, fromName: string | null | undefined, to: string) {
    const target = find(to) ?? { name: to };
    const intent = stageMoveIntent(find(fromName ?? "ليد"), target, { isAdmin });
    switch (intent) {
      case "none":
        return;
      case "lost_form":
        setPending({ kind: "lost", clientId });
        return;
      case "reactivate": {
        const j = await currentJourneyId(supabase, clientId);
        if (j) setPending({ kind: "reactivate", clientId, journeyId: j });
        else setError("تعذّر العثور على مسار العميل — حدّث الصفحة.");
        return;
      }
      case "reservation":
        await openFromHint(clientId, to, "reserve_unit",
          `«${to}» يدخلها العميل بتسجيل الحجز نفسه، لا بنقل البطاقة.`);
        return;
      case "won_locked":
        await openFromHint(clientId, to, "start_journey",
          "العميل اشترى — لشراءٍ جديد افتح «مسار شراء إضافي». وتصحيح «بيع» سُجّل خطأً للمدير.");
        return;
      case "reason":
        setPending({
          kind: "reason", clientId, to,
          title: target.requiresReason ? `سبب النقل إلى «${to}»` : `سبب إعادة فتح المسار إلى «${to}»`,
        });
        return;
      default:
        await send(clientId, to);
    }
  }

  const close = () => setPending(null);

  let dialogs: ReactNode = null;
  if (pending?.kind === "lost") {
    dialogs = (
      <ClientLostFlow
        clientId={pending.clientId}
        onClose={close}
        onDone={() => { const id = pending.clientId; close(); refreshStage(id); }}
        onNoOpportunity={() => {
          setPending({ kind: "info", clientId: pending.clientId, text: "لا مسار مفتوحاً لهذا العميل ليُغلق خسارةً." });
        }}
      />
    );
  } else if (pending?.kind === "reactivate") {
    dialogs = (
      <ReactivateDialog
        opportunityId={pending.journeyId}
        onClose={close}
        onDone={() => { const id = pending.clientId; close(); refreshStage(id); }}
      />
    );
  } else if (pending?.kind === "reason") {
    dialogs = (
      <ReasonDialog
        title={pending.title}
        onClose={close}
        onSubmit={async (reason) => {
          const ok = await send(pending.clientId, pending.to, reason);
          if (ok) close();
          return ok;
        }}
      />
    );
  } else if (pending?.kind === "info") {
    dialogs = <InfoDialog text={pending.text} link={pending.link} onClose={close} />;
  }

  return { request, dialogs, error, clearError: () => setError(null) };
}

function ReasonDialog({
  title,
  onClose,
  onSubmit,
}: {
  title: string;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<boolean>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = reason.trim().length >= 5;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 text-start shadow-xl">
        <h2 className="text-lg font-bold text-gray-800">{title}</h2>
        <p className="mt-1 text-xs text-gray-500">
          السبب يُحفظ في سجلّ المراحل ويظهر في التقارير — اكتبه بحيث يُفهم بعد شهر.
        </p>
        <textarea
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
          placeholder="مثال: خمس محاولات اتصال خلال أسبوعين بلا ردّ"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700">
            إلغاء
          </button>
          <button
            type="button"
            disabled={!ready || busy}
            onClick={async () => { setBusy(true); await onSubmit(reason.trim()); setBusy(false); }}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "يحفظ…" : "انقل"}
          </button>
        </div>
      </div>
    </div>
  );
}

function InfoDialog({
  text,
  link,
  onClose,
}: {
  text: string;
  link?: { href: string; label: string };
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 text-start shadow-xl">
        <p className="text-sm text-gray-700">{text}</p>
        <div className="mt-4 flex justify-end gap-2">
          {link && (
            <Link href={link.href} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white">
              {link.label}
            </Link>
          )}
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700">
            حسناً
          </button>
        </div>
      </div>
    </div>
  );
}
