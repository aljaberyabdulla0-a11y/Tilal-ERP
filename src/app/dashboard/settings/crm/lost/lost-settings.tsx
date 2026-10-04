"use client";

import LookupEditor, { type FieldSpec } from "./lookup-editor";
import type { LossLookups } from "@/lib/lost-sales";

// ============================================================
// إعدادات تحليل الخسارة — كل القوائم التي يختار منها الموظف.
//
// الفئات تحمل أسبابها الفرعية (افتح الفئة لتراها)، والمنافسون يحملون
// مشاريعهم بأسعارها. ومستويات الاسترجاع هي «قواعد الاسترجاع»: هل تدخل
// القيمة القابلة للاسترجاع، وهل يُقترح موعد إعادة تواصل وبعد كم يوماً.
// ============================================================
export default function LostSettings({ lk }: { lk: LossLookups }) {
  const sourceOptions = lk.sources.map((s) => ({ value: s.code, label: s.name_ar }));

  const catFields: FieldSpec[] = [
    { key: "code", label: "الرمز", type: "text", width: "w-32", required: true, readOnlyAfterCreate: true },
    { key: "name_ar", label: "الاسم", type: "text", required: true },
    { key: "name_en", label: "English", type: "text", required: true },
    { key: "default_source", label: "المصدر المقترح", type: "select", options: sourceOptions },
    { key: "requires_competitor", label: "يتطلّب منافساً", type: "bool" },
    { key: "is_active", label: "فعّال", type: "bool" },
  ];
  const reasonFields: FieldSpec[] = [
    { key: "name", label: "السبب", type: "text", width: "w-64", required: true },
    { key: "name_en", label: "English", type: "text", width: "w-56" },
    { key: "requires_note", label: "يتطلّب شرحاً", type: "bool" },
    { key: "is_other", label: "«أخرى»", type: "bool" },
    { key: "is_active", label: "فعّال", type: "bool" },
  ];
  const simple = (extra: FieldSpec[] = []): FieldSpec[] => [
    { key: "code", label: "الرمز", type: "text", width: "w-28", required: true, readOnlyAfterCreate: true },
    { key: "name_ar", label: "الاسم", type: "text", required: true },
    { key: "name_en", label: "English", type: "text", required: true },
    ...extra,
    { key: "is_active", label: "فعّال", type: "bool" },
  ];

  return (
    <div className="space-y-10">
      <Block title="فئات الخسارة وأسبابها الفرعية" hint="افتح الفئة لإدارة أسبابها. «أخرى» تُلزم الموظف بشرح مفصّل، والفئة التي «تتطلّب منافساً» تفتح قسم المنافس إلزامياً.">
        <LookupEditor
          table="crm_loss_categories"
          pk="id"
          rows={lk.categories}
          fields={catFields}
          addLabel="أضف فئة"
          renderBelow={(cat) => (
            <LookupEditor
              table="crm_lost_reasons"
              pk="id"
              rows={lk.reasons.filter((r) => r.category_id === cat.id)}
              fields={reasonFields}
              fixed={{ category_id: cat.id }}
              addLabel="أضف سبباً"
            />
          )}
        />
        {lk.reasons.some((r) => !r.category_id) && (
          <p className="mt-2 text-xs text-amber-700">
            أسباب بلا فئة (من قبل 140): {lk.reasons.filter((r) => !r.category_id).map((r) => r.name).join("، ")}
          </p>
        )}
      </Block>

      <div className="grid gap-8 xl:grid-cols-2">
        <Block title="مصادر فقدان البيع" hint="من أين جاءت المشكلة — يفصل «من يُصلح» عن «ماذا حدث» في التقارير.">
          <LookupEditor table="crm_loss_sources" pk="code" rows={lk.sources} fields={simple()} addLabel="أضف مصدراً" />
        </Block>
        <Block title="جودة العميل" hint="«غير مؤهّل» يفصل الليد الذي لم يكن فرصة حقيقية عن فرصة عالية الجودة خسرناها.">
          <LookupEditor table="crm_customer_potentials" pk="code" rows={lk.potentials}
                        fields={simple([{ key: "is_qualified", label: "مؤهّل", type: "bool" }])} addLabel="أضف مستوى" />
        </Block>
      </div>

      <Block title="قواعد الاسترجاع" hint="لكل مستوى: هل يدخل «القيمة القابلة للاسترجاع»، وهل يقبل موعد إعادة تواصل، وهل يُقترح افتراضياً وبعد كم يوماً. الموعد يُنشئ مهمة للمالك.">
        <LookupEditor table="crm_recovery_levels" pk="code" rows={lk.recovery}
                      fields={simple([
                        { key: "is_recoverable", label: "قابل للاسترجاع", type: "bool" },
                        { key: "allows_recontact", label: "يقبل موعداً", type: "bool" },
                        { key: "recontact_required", label: "موعد افتراضي", type: "bool" },
                        { key: "recontact_days", label: "بعد (يوم)", type: "number", width: "w-20" },
                      ])}
                      addLabel="أضف مستوى" />
      </Block>

      <Block title="المنافسون ومشاريعهم" hint="نفس قائمة المنافسين في قسم التسويق. سعر المتر لكل مشروع يملأ نموذج الخسارة تلقائياً ويُقارن بسعرنا في تقرير المنافسين.">
        <LookupEditor
          table="mkt_competitors"
          pk="id"
          rows={lk.competitors}
          hasSortOrder={false}
          fields={[
            { key: "name", label: "المنافس", type: "text", required: true },
            { key: "name_en", label: "English", type: "text" },
            { key: "price_position", label: "تموضع السعر", type: "text" },
            { key: "is_active", label: "فعّال", type: "bool" },
          ]}
          addLabel="أضف منافساً"
          renderBelow={(comp) => (
            <LookupEditor
              table="mkt_competitor_projects"
              pk="id"
              rows={lk.competitorProjects.filter((p) => p.competitor_id === comp.id)}
              hasSortOrder={false}
              fixed={{ competitor_id: comp.id }}
              fields={[
                { key: "name", label: "المشروع", type: "text", required: true },
                { key: "location", label: "الموقع", type: "text" },
                { key: "price_per_m2", label: "سعر المتر", type: "number", width: "w-32" },
                { key: "payment_plan", label: "خطة الدفع", type: "text" },
                { key: "is_active", label: "فعّال", type: "bool" },
              ]}
              addLabel="أضف مشروعاً"
            />
          )}
        />
      </Block>
    </div>
  );
}

function Block({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-lg font-bold text-gray-800">{title}</h2>
      <p className="mb-4 text-sm text-gray-500">{hint}</p>
      {children}
    </div>
  );
}
