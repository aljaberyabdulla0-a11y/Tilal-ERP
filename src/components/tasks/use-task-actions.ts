"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyTaskError } from "@/lib/tasks";

// ============================================================
// أفعال المهام من المتصفح — كلها عبر دوال task_* (191/192) لا الكتابة
// المباشرة: القاعدة تفحص الصلاحية والإصدار والتبعية والموافقة.
//
// • busy يمنع الإرسال المزدوج (نقرتان سريعتان = طلب واحد).
// • الخطأ يُعرض بالعربية، والأصل يُسجَّل في الكونسول للتشخيص.
// • بعد النجاح: router.refresh() يعيد رسم الصفحة من الخادم.
// ============================================================
export type TaskRpcResult = { result?: string; status?: string; version?: number; approver?: string; id?: string };

export function useTaskActions() {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef(false);

  const call = useCallback(
    async <T = TaskRpcResult>(fn: string, args: Record<string, unknown>, opts: { refresh?: boolean } = {}): Promise<T | null> => {
      if (inflight.current) return null;
      inflight.current = true;
      setBusy(true);
      setError(null);
      const { data, error } = await supabase.rpc(fn, args);
      inflight.current = false;
      setBusy(false);
      if (error) {
        console.error(fn, error);
        setError(friendlyTaskError(error));
        return null;
      }
      if (opts.refresh !== false) router.refresh();
      return (data ?? {}) as T;
    },
    [router, supabase],
  );

  return {
    busy,
    error,
    setError,
    call,
    setStatus: (id: string, status: string, reason?: string | null, version?: number) =>
      call("task_set_status", { p_id: id, p_status: status, p_reason: reason ?? null, p_version: version ?? null }),
    setStep: (id: string, step: string, version?: number) =>
      call("task_set_step", { p_id: id, p_step: step, p_version: version ?? null }),
    reassign: (id: string, user: string, note?: string) =>
      call("task_reassign", { p_id: id, p_user: user, p_note: note ?? null }),
    decide: (id: string, approve: boolean, reason?: string) =>
      call("task_decide_approval", { p_id: id, p_approve: approve, p_reason: reason ?? null }),
    save: (payload: Record<string, unknown>) => call<{ id: string; version: number; status: string }>("task_save", { p: payload }),
    archive: (id: string, on = true) => call("task_archive", { p_id: id, p_on: on }),
    duplicate: (id: string) => call<string>("task_duplicate", { p_id: id }, { refresh: false }),
    watch: (id: string, on: boolean) => call("task_watch", { p_task: id, p_on: on }),
    comment: (id: string, body: string, mentions: string[] = []) =>
      call<string>("task_comment_add", { p_task: id, p_body: body, p_mentions: mentions }),
    bulk: (ids: string[], action: string, value: Record<string, unknown> = {}) =>
      call<{ succeeded: number; failed: number; first_error: string | null }[]>(
        "task_bulk_update", { p_ids: ids, p_action: action, p_value: value }),
  };
}
