"use client";

import { useRouter } from "next/navigation";
import { ChatPerson } from "@/lib/types";

// فلتر المدير: مهام موظف معيّن أو الجميع
export default function EmployeeFilter({
  people,
  value,
}: {
  people: ChatPerson[];
  value: string;
}) {
  const router = useRouter();

  return (
    <select
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        router.push(v ? `/dashboard/tasks?emp=${v}` : "/dashboard/tasks");
      }}
      className="rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none"
    >
      <option value="">كل الموظفين</option>
      {people.map((p) => (
        <option key={p.user_id} value={p.user_id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}
