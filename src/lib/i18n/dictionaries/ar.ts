// ============================================================
// القاموس العربي — النصّ الأصلي للنظام.
// هذا الملف هو **المرجع**: أي مفتاح يُضاف هنا يجب أن يُضاف في en.ts
// وإلا رفض TypeScript البناء (النوع Dictionary مشتقّ من هذا الملف).
// ============================================================

const ar = {
  common: {
    appName: "تلال ERP",
    save: "حفظ",
    saving: "جارٍ الحفظ...",
    cancel: "إلغاء",
    delete: "حذف",
    edit: "تعديل",
    add: "إضافة",
    close: "إغلاق",
    search: "بحث",
    loading: "جارٍ التحميل...",
    none: "—",
    back: "رجوع",
    backToDashboard: "← لوحة التحكم",
    details: "التفاصيل",
    date: "التاريخ",
    amount: "المبلغ",
    total: "الإجمالي",
    status: "الحالة",
    notes: "ملاحظات",
    name: "الاسم",
    phone: "الهاتف",
    show: "عرض",
    all: "الكل",
    of: "من",
    day: "يوم",
    days: "يوم",
    minute: "دقيقة",
    minutes: "دقيقة",
    dinar: "دينار",
    required: "مطلوب",
    optional: "اختياري",
    noData: "لا توجد بيانات بعد.",
    errorPrefix: "حدث خطأ: ",
  },

  nav: {
    dashboard: "لوحة التحكم",
    tasks: "المهام",
    chat: "المحادثات",
    crm: "CRM",
    invoices: "الفواتير",
    accounting: "المحاسبة",
    hr: "HR",
    attendance: "الدوام",
    settings: "الإعدادات",
    logout: "تسجيل الخروج",
    menu: "القائمة",
    tagline: "نظام إدارة الموارد",
    roleAdmin: "مدير",
    roleSupervisor: "مشرف",
    roleFollowup: "مدير المتابعة",
    roleRm: "مدير علاقات",
    roleBroker: "شركة وسيطة",
    roleEmployee: "موظف",
    language: "اللغة",
    myTeam: "فريقي",
    projects: "المشاريع",
    account: "إعداداتي",
    inventory: "المخزون",
    employees: "الموظفون",
    contacts: "الاتصالات",
    brokers: "الوساطة",
    ourLeads: "ليداتنا",
    ourCommissions: "استحقاقاتنا",
  },

  auth: {
    signIn: "تسجيل الدخول",
    signingIn: "جارٍ الدخول...",
    email: "البريد الإلكتروني",
    password: "كلمة المرور",
    forgotPassword: "نسيت كلمة المرور؟",
    resetPassword: "إعادة تعيين كلمة المرور",
    newPassword: "كلمة المرور الجديدة",
    confirmPassword: "تأكيد كلمة المرور",
    sendResetLink: "أرسل رابط الاستعادة",
    backToLogin: "← رجوع لتسجيل الدخول",
    welcome: "نظام إدارة شركة تلال للتسويق العقاري",
    subtitle: "نظام إدارة التسويق العقاري",
    show: "إظهار",
    hide: "إخفاء",
    rights: "تلال العقارية — جميع الحقوق محفوظة",
    invalidCredentials: "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
    passwordsMismatch: "كلمتا المرور غير متطابقتين.",
    resetLinkSent: "أرسلنا رابط الاستعادة إلى بريدك. افتحه من نفس الجهاز.",
    passwordChanged: "تم تغيير كلمة المرور. جارٍ تحويلك...",
  },

  home: {
    greeting: "أهلاً بك",
    quickAccess: "وصول سريع",
    myFollowUps: "متابعات عملائي",
    myTasksToday: "مهامي اليوم",
    recentActivity: "آخر النشاطات",
    monthlyRevenue: "الإيرادات الشهرية",
    salesFunnel: "مسار المبيعات",
    noActivity: "لا توجد نشاطات بعد.",
  },
};
// ملاحظة: لا نستعمل `as const` عمداً — لو فعلنا لصار نوع كل مفتاح هو
// النصّ العربي نفسه، فما استطاع en.ts أن يضع مكانه نصّاً إنجليزياً.

export default ar;

// شكل القاموس — كل لغة أخرى ملزَمة بمطابقته حرفاً بحرف
export type Dictionary = typeof ar;
