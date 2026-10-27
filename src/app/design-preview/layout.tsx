import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser, getUserRole, isAccountActive } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import PreviewShell from "./_components/shell";
import "./preview.css";

// ============================================================
// /design-preview — معاينة التصميم الجديد، معزولة عن النظام القائم.
//
// الحماية كما هي، لا تُخفَّف:
//   • الـ middleware يمنع غير المسجّلين (المسار ليس من العامّة) — بلا تعديل.
//   • ومن انتهت خدمته يُعاد إلى /dashboard فيرى شاشة الإيقاف هناك.
//   • والمعاينة للمدير وحده: هي عرضٌ لقرار تصميم، وقائمتها قائمة المدير.
//     غيره يُعاد إلى لوحته.
//
// لا تقرأ المعاينة شيئاً من القاعدة سوى هذه الثلاثة (هوية الجلسة)،
// ولا تكتب شيئاً. كل الأرقام من _lib/mock-data.ts.
//
// الحذف: احذف هذا المجلّد، ومفتاح `tp` من tailwind.config.ts.
// ============================================================

export const metadata: Metadata = {
  title: "معاينة التصميم | Tilal ERP",
  robots: { index: false, follow: false },
};

export default async function DesignPreviewLayout({ children }: { children: React.ReactNode }) {
  const [user, role, active] = await Promise.all([getCurrentUser(), getUserRole(), isAccountActive()]);
  if (!user) redirect("/login");
  if (!active || role !== "admin") redirect("/dashboard");
  const t = getT();

  return (
    <div className="tp-root min-h-screen">
      <PreviewShell email={user.email ?? ""} roleLabel={t.nav.roleAdmin}>
        {children}
      </PreviewShell>
    </div>
  );
}
