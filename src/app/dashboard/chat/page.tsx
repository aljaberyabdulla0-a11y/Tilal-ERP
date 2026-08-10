// شاشة «لم تُختَر محادثة بعد» — تملأ العمود الأيسر على سطح المكتب.
// على الجوّال لا تظهر إطلاقاً (القائمة تأخذ الشاشة كاملة).
export default function ChatEmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
      <span className="flex h-20 w-20 items-center justify-center rounded-full bg-brand-50">
        <span className="material-symbols-outlined text-[40px] text-brand-600">
          forum
        </span>
      </span>
      <h2 className="text-xl font-bold text-brand-900">اختر محادثة</h2>
      <p className="max-w-sm text-sm text-gray-500">
        اختر زميلاً من القائمة لتبدأ، أو اضغط ✎ في أعلى القائمة لفتح محادثة
        جديدة أو مجموعة.
      </p>
    </div>
  );
}
