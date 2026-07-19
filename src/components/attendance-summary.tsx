// ملخص الحضور
// القاعدة: الفترة من تاريخ المباشرة حتى تاريخ إضافة الموظف للنظام تُحتسب
// دواماً كاملاً (حاضر كل الأيام)، وبعدها يُحتسب الحضور من تسجيل البصمة الفعلي.
export default function AttendanceSummary({
  hireDate,
  registeredAt,
  recordedDays,
}: {
  hireDate: string | null;
  registeredAt: string;
  recordedDays: number;
}) {
  let preSystemDays = 0;
  if (hireDate) {
    const hire = new Date(hireDate).getTime();
    const reg = new Date(registeredAt).getTime();
    preSystemDays = Math.max(0, Math.round((reg - hire) / 86400000));
  }
  const total = preSystemDays + recordedDays;
  const regDate = new Date(registeredAt).toLocaleDateString("ar");

  const Stat = ({
    label,
    value,
    hint,
    strong,
  }: {
    label: string;
    value: number;
    hint?: string;
    strong?: boolean;
  }) => (
    <div className={`rounded-xl p-4 ${strong ? "bg-brand-50" : "bg-gray-50"}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${strong ? "text-brand-700" : "text-gray-800"}`}>
        {value} <span className="text-sm font-normal text-gray-400">يوم</span>
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-gray-400">{hint}</p>}
    </div>
  );

  return (
    <div className="glass-card p-6">
      <h3 className="mb-4 text-lg font-bold text-brand-900">ملخص الحضور</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat
          label="أيام دوام كامل (قبل النظام)"
          value={preSystemDays}
          hint={hireDate ? `من ${hireDate} حتى ${regDate}` : "لا يوجد تاريخ مباشرة"}
        />
        <Stat label="أيام مسجّلة بالبصمة" value={recordedDays} hint={`منذ ${regDate}`} />
        <Stat label="إجمالي أيام الحضور" value={total} strong />
      </div>
      <p className="mt-3 text-xs text-gray-400">
        الفترة من تاريخ المباشرة حتى إضافة الموظف للنظام تُحتسب دواماً كاملاً، وبعدها من تسجيل البصمة.
      </p>
    </div>
  );
}
