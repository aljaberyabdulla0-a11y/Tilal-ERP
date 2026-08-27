import Link from "next/link";
import { redirect } from "next/navigation";
import { isBroker } from "@/lib/auth";
import { getProjects } from "@/lib/projects";
import BrokerLeadForm from "../lead-form";

// إدخال ليد جديد — لحساب الشركة الوسيطة
export default async function NewBrokerLeadPage() {
  if (!(await isBroker())) redirect("/dashboard");

  // سياسات القاعدة تُرجع لهذا الحساب مشاريعه المسندة وحدها
  const projects = await getProjects();

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link
          href="/dashboard/broker/leads"
          className="text-sm text-gray-500 hover:text-brand-700"
        >
          ← ليداتنا
        </Link>
        <h1 className="text-xl font-bold text-brand-700">ليد جديد</h1>
      </header>

      <section className="p-6">
        {projects.length === 0 ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center text-amber-800">
            لم تُسنَد شركتكم لأي مشروع بعد، فلا يمكن إدخال ليدات. راجعوا إدارة
            تلال.
          </div>
        ) : (
          <BrokerLeadForm projects={projects} />
        )}
      </section>
    </main>
  );
}
