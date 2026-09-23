"use client";

import { useState, type ReactNode } from "react";

// ============================================================
// تبويبات ملف العميل ٣٦٠ (§34).
//
// الملفّ صار عشر لوحات في عمودين: الإجراء التالي، والدرجة، والصحّة،
// والتأهيل، والفرص، والاهتمامات، والوحدات المطابقة، والمستندات،
// والحجوزات، والبيانات، والتسلسل، وتاريخ الملكية. وقراءته صارت
// تمريراً لا نظراً.
//
// والتبويب ليس تنظيماً بصرياً فقط: هو **إخفاءٌ مقصود**. الموظف يفتح
// الملفّ ليفعل شيئاً واحداً — يتصل، أو يسجّل، أو يبحث عن مستند.
// فيرى ما يخصّ ذلك ولا يتصفّح ما لا يخصّه.
//
// ⚠️ التبويب الأول «نظرة» يحمل ما يُقرأ في كل مرة: الإجراء التالي،
//    والدرجة، والبيانات، وآخر التواصل. فمن فتح ولم يختر تبويباً رأى
//    ما يحتاجه غالباً.
//
// والحالة في المتصفّح لا في الرابط عمداً: تبويبٌ في الرابط يجعل
// كل مشاركة لملفّ عميل تحمل تبويب من شاركه — وهو ليس اختيار من
// يستقبله. (والرابط ذو المرساة #units يعمل: نفتح تبويبه عند الوصول.)
// ============================================================
export type ClientTab = {
  key: string;
  label: string;
  icon: string;
  badge?: number;
  content: ReactNode;
};

export default function ClientTabs({
  tabs,
  initial,
}: {
  tabs: ClientTab[];
  initial?: string;
}) {
  const first = tabs[0]?.key ?? "";
  const [active, setActive] = useState(
    initial && tabs.some((t) => t.key === initial) ? initial : first
  );

  const current = tabs.find((t) => t.key === active) ?? tabs[0];

  return (
    <div>
      <div className="border-b bg-white">
        <nav className="flex gap-1 overflow-x-auto px-2" aria-label="أقسام ملفّ العميل">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setActive(t.key)}
              aria-current={t.key === active ? "page" : undefined}
              className={
                t.key === active
                  ? "-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 border-brand-600 px-3 py-2.5 text-sm font-semibold text-brand-600"
                  : "flex items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-sm text-gray-500 transition hover:text-brand-600"
              }
            >
              <span className="material-symbols-outlined text-[18px]">{t.icon}</span>
              {t.label}
              {t.badge !== undefined && t.badge > 0 && (
                <span
                  className={`rounded-full px-1.5 text-[11px] ${
                    t.key === active ? "bg-brand-100 text-brand-700" : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      <div className="p-6">{current?.content}</div>
    </div>
  );
}
