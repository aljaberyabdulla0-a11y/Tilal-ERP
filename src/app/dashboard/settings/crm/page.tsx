import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { getSettings, getStages, getSources, getLostReasons, getScoreRules } from "@/lib/crm";
import SettingsEditor from "./settings-editor";
import StagesEditor from "./stages-editor";
import ListEditor from "./list-editor";
import ScoreRulesEditor from "./score-rules-editor";

// ============================================================
// إعدادات الـCRM — الأرقام التي كانت في الكود (sql/070).
//
// ٧ و٢١ يوماً للصمت، ١٤ للإهمال، ٢٤ ساعة للتصعيد… كانت ثوابت في
// types.ts لا يغيّرها إلا مطوّر. الآن صفوفٌ في crm_settings يقرأها
// كل مستهلك من نقطة واحدة (crm_setting_num) فلا ينتشر رقم سحري
// ثانية — والمدير يضبطها من هنا بحدود تمنع إدخالاً كارثياً.
//
// المراحل لا يُعاد تسميتها من هنا: الاسم هو نفسه المخزَّن في
// clients.stage، وإعادة التسمية تتطلب تحديث الصفوف معه. يُضبط منها
// الاحتمال والمهلة والفعالية فقط.
// ============================================================
export default async function CrmSettingsPage() {
  if (!(await isAdmin())) redirect("/dashboard");

  const [settings, stages, sources, reasons, rules] = await Promise.all([
    getSettings(),
    getStages(),
    getSources(),
    getLostReasons(),
    getScoreRules(),
  ]);

  const unavailable = settings.length === 0 && stages.length === 0;

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link href="/dashboard/settings" className="text-sm text-gray-500 hover:text-brand-700">
          ← الإعدادات
        </Link>
        <h1 className="text-xl font-bold text-brand-700">إعدادات الـCRM</h1>
      </header>

      {unavailable ? (
        <p className="m-6 rounded-lg border border-dashed border-gray-300 bg-white px-4 py-8 text-center text-sm text-gray-400">
          جداول الإعدادات غير متاحة — شغّل الهجرة ٠٧٠ أولاً.
        </p>
      ) : (
        <section className="space-y-10 p-6">
          <div>
            <h2 className="text-lg font-bold text-gray-800">القواعد الرقمية</h2>
            <p className="mb-4 text-sm text-gray-500">
              كل رقم هنا يقرأه النظام لحظة الحاجة — تغييره يسري على الفحص التالي بلا نشر. وصف كل قاعدة يقول ماذا يحدث لو غيّرتها.
            </p>
            <SettingsEditor settings={settings} />
          </div>

          <div>
            <h2 className="text-lg font-bold text-gray-800">مراحل خطّ المبيعات</h2>
            <p className="mb-4 text-sm text-gray-500">
              الاحتمال يُرجّح الأنابيب، والمهلة تُنبّه حين تطول الإقامة في المرحلة، و«يلزم تواصل» يمنع الانتقال إليها بلا نشاط مسجَّل.
              الأسماء ثابتة عمداً — هي نفسها المخزَّنة على العملاء.
            </p>
            <StagesEditor stages={stages} />
          </div>

          <div className="grid gap-8 lg:grid-cols-2">
            <div>
              <h2 className="text-lg font-bold text-gray-800">مصادر العملاء</h2>
              <p className="mb-4 text-sm text-gray-500">
                ما يظهر في نموذج العميل وقائمة الاستيراد. تعطيل مصدر يخفيه من القوائم ولا يمسّ العملاء المسجَّلين عليه.
              </p>
              <ListEditor
                table="crm_sources"
                rows={sources}
                categories={["تسويق رقمي", "إحالة", "مباشر", "فعالية", "آخر"]}
              />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-800">أسباب الخسارة</h2>
              <p className="mb-4 text-sm text-gray-500">
                «فشل البيع» بلا سبب رقمٌ لا يُفيد. السبب الذي «يتطلّب توضيحاً» يُلزم الموظف بسطر يشرحه.
              </p>
              <ListEditor
                table="crm_lost_reasons"
                rows={reasons}
                categories={["سعر", "منتج", "منافسة", "عميل", "تمويل", "توقيت", "آخر"]}
                withNote
              />
            </div>
          </div>

          <div>
            <h2 className="text-lg font-bold text-gray-800">قواعد تقييم الليد</h2>
            <p className="mb-4 text-sm text-gray-500">
              الدرجة مجموع هذه النقاط، وتُعرض للموظف بأسبابها. غيّر النقاط ثم انتظر التحديث الليلي (٦ صباحاً) أو أعد الحساب من التقارير.
            </p>
            <ScoreRulesEditor rules={rules} />
          </div>
        </section>
      )}
    </main>
  );
}
