"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { BulkResult, EmployeeLite } from "@/lib/crm";
import type { StageLite } from "@/lib/crm-config";

// ============================================================
// الإجراءات الجماعية (§47).
//
// المبدأ الذي يحكم الشاشة: **الجماعي لا يعني بلا أثر فردي**. كل صفّ
// يمرّ في القاعدة بنفس الحارس والمحفّز الذي يمرّ به لو عُولج وحده،
// ويُكتب له سجلّه. فمئة إسناد = مئة صفّ في تاريخ الملكية، لا صفّ
// واحد يقول «إجراء جماعي».
//
// وما يُرفض يُعدّ ويُسمّى سببه ولا يُسقط الدفعة: رفض ثلاثة من مئة
// لا يمنع السبعة والتسعين. والنتيجة تُعرض بالعددين معاً — «نجح ٩٧،
// رُفض ٣» أصدق من «تمّ».
//
// ⚠️ ما لا يُفعل جماعةً: الإغلاق كخسارة. مئة صفقة بسبب واحد تُفسد
//    تحليل «لماذا نخسر» — وهو أنفع ما في التقارير. القاعدة نفسها
//    ترفضه (085)، والشاشة لا تعرضه أصلاً.
// ============================================================
type Action = "assign" | "stage" | "task";

export default function BulkActions({
  selected,
  onDone,
  employees,
  stages,
  canAssign,
}: {
  selected: string[];
  onDone: () => void;
  employees: EmployeeLite[];
  stages: StageLite[];
  canAssign: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [action, setAction] = useState<Action>(canAssign ? "assign" : "stage");
  const [owner, setOwner] = useState("");
  const [stage, setStage] = useState("");
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState("متوسطة");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const n = selected.length;
  if (n === 0) return null;

  // المراحل ذات الحقول المطلوبة (الخسارة) مستثناة — القاعدة ترفضها
  const bulkStages = stages.filter((s) => !s.closed || s.name === "بيع");

  function report(r: BulkResult | null) {
    if (!r) return setErr("لم تُرجِع القاعدة نتيجة.");
    const parts = [`نجح ${r.succeeded}`];
    if (r.failed > 0) parts.push(`رُفض ${r.failed}`);
    setMsg(parts.join(" · ") + (r.first_error ? ` — أول سبب: ${r.first_error}` : "."));
    onDone();
    router.refresh();
  }

  async function run() {
    setErr(null);
    setMsg(null);

    if (action === "assign" && !owner) return setErr("اختر الموظف المستلِم.");
    if (action === "assign" && !reason.trim())
      return setErr("اذكر سبب الإسناد — نقلٌ بلا سبب لا يُراجَع لاحقاً.");
    if (action === "stage" && !stage) return setErr("اختر المرحلة.");
    if (action === "task" && !title.trim()) return setErr("اكتب عنوان المهمّة.");

    const what =
      action === "assign"
        ? `إسناد ${n} عميلاً`
        : action === "stage"
          ? `نقل ${n} عميلاً إلى «${stage}»`
          : `إنشاء ${n} مهمّة`;
    if (!confirm(`${what}. كل صفّ يُعالَج على حدة ويُسجَّل. متابعة؟`)) return;

    setBusy(true);
    let data: unknown = null;
    let error: { message: string } | null = null;

    if (action === "assign") {
      ({ data, error } = await supabase.rpc("bulk_assign_clients", {
        p_client_ids: selected,
        p_owner_id: owner,
        p_reason: reason.trim(),
      }));
    } else if (action === "stage") {
      ({ data, error } = await supabase.rpc("bulk_set_stage", {
        p_client_ids: selected,
        p_stage: stage,
      }));
    } else {
      ({ data, error } = await supabase.rpc("bulk_create_tasks", {
        p_client_ids: selected,
        p_title: title.trim(),
        p_due_date: due || null,
        p_priority: priority,
      }));
    }

    setBusy(false);
    if (error) return setErr(error.message);
    report((Array.isArray(data) ? data[0] : data) as BulkResult | null);
  }

  return (
    <div className="mb-4 rounded-lg border border-brand-300 bg-brand-50 p-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-semibold text-brand-800">{n} صفّاً مختاراً</span>

        <select
          value={action}
          onChange={(e) => setAction(e.target.value as Action)}
          className="rounded border border-gray-300 bg-white px-2 py-1.5"
        >
          {canAssign && <option value="assign">إسناد إلى موظف</option>}
          <option value="stage">تغيير المرحلة</option>
          <option value="task">إنشاء مهمّة</option>
        </select>

        {action === "assign" && (
          <>
            <select value={owner} onChange={(e) => setOwner(e.target.value)} className="rounded border border-gray-300 bg-white px-2 py-1.5">
              <option value="">— المستلِم —</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="سبب الإسناد"
              className="w-48 rounded border border-gray-300 px-2 py-1.5"
            />
          </>
        )}

        {action === "stage" && (
          <select value={stage} onChange={(e) => setStage(e.target.value)} className="rounded border border-gray-300 bg-white px-2 py-1.5">
            <option value="">— المرحلة —</option>
            {bulkStages.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
        )}

        {action === "task" && (
          <>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="عنوان المهمّة" className="w-48 rounded border border-gray-300 px-2 py-1.5" />
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="rounded border border-gray-300 px-2 py-1.5" dir="ltr" />
            <select value={priority} onChange={(e) => setPriority(e.target.value)} className="rounded border border-gray-300 bg-white px-2 py-1.5">
              <option value="عاجلة">عاجلة</option>
              <option value="متوسطة">متوسطة</option>
              <option value="عادية">عادية</option>
            </select>
          </>
        )}

        <button
          type="button"
          disabled={busy}
          onClick={run}
          className="rounded bg-brand-600 px-4 py-1.5 font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {busy ? "ينفّذ…" : "نفّذ"}
        </button>
        <button type="button" onClick={onDone} className="text-gray-500 hover:text-gray-700">
          إلغاء الاختيار
        </button>
      </div>

      {action === "stage" && (
        <p className="mt-2 text-xs text-gray-600">
          «فشل البيع» غير متاح جماعةً: مئة صفقة بسبب واحد تُفسد تحليل الخسارة. تُغلق كلٌّ بسببها من شاشة الفرص.
        </p>
      )}
      {action === "task" && (
        <p className="mt-2 text-xs text-gray-600">المهمّة تذهب إلى مالك كل عميل لا إليك — من يعمل على الليد يتابعه.</p>
      )}
      {msg && <p className="mt-2 text-xs font-medium text-brand-800">{msg}</p>}
      {err && <p className="mt-2 text-xs text-red-700">{err}</p>}
    </div>
  );
}
