import { redirect } from "next/navigation";

// شرائح 117 صارت «خطط العمولة» (sql/129) — الرابط القديم يبقى صالحاً
export default function BrokerTiersPage() {
  redirect("/dashboard/brokers/plans");
}
