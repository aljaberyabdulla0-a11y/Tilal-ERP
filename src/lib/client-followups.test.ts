import { describe, it, expect, vi } from "vitest";

// buildFollowUps تعيش بجانب دالة تقرأ من Supabase عبر next/headers —
// نعزل الاستيراد كي يُختبر التقسيم الخالص وحده.
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));

import { buildFollowUps } from "./client-followups";
import type { Client } from "./types";

function client(p: Partial<Client>): Client {
  return {
    id: p.id ?? Math.random().toString(36).slice(2),
    created_at: "2026-09-01T00:00:00Z",
    created_by: null,
    name: p.name ?? "عميل",
    phone: null,
    governorate: null,
    area: null,
    purchase_purpose: null,
    alt_contact_name: null,
    alt_contact_phone: null,
    alt_contact_relation: null,
    source: null,
    payment_method: null,
    sales_employee: null,
    entry_date: null,
    notes: null,
    stage: "اتصال",
    ...p,
  };
}

describe("buildFollowUps — اليوم مقابل متأخر مقابل متوقّف", () => {
  const today = "2026-09-22";

  it("يقسم المستحقّ إلى اليوم ومتأخر ويتجاهل القادم", () => {
    const { overdue, dueToday } = buildFollowUps(
      [
        client({ name: "أ", follow_up_date: "2026-09-22" }),
        client({ name: "ب", follow_up_date: "2026-09-20" }),
        client({ name: "ج", follow_up_date: "2026-09-25" }),
      ],
      today
    );
    expect(dueToday.map((r) => r.client.name)).toEqual(["أ"]);
    expect(overdue.map((r) => r.client.name)).toEqual(["ب"]);
    expect(overdue[0].daysLate).toBe(2);
  });

  it("الملفّ المغلق (بيع/فشل) لا متابعة له ولو كان له موعد", () => {
    const { overdue, dueToday } = buildFollowUps(
      [
        client({ stage: "بيع", follow_up_date: "2026-09-10" }),
        client({ stage: "فشل البيع", follow_up_date: "2026-09-22" }),
      ],
      today
    );
    expect(overdue).toEqual([]);
    expect(dueToday).toEqual([]);
  });

  it("«متوقّف» = فات الموعد ولا تواصل بعده", () => {
    const { overdue } = buildFollowUps(
      [
        client({ name: "صامت", follow_up_date: "2026-09-15", last_contact_at: "2026-09-10T09:00:00Z" }),
        client({ name: "تواصل", follow_up_date: "2026-09-15", last_contact_at: "2026-09-18T09:00:00Z" }),
        client({ name: "بلا تواصل", follow_up_date: "2026-09-15", last_contact_at: null }),
      ],
      today
    );
    const byName = Object.fromEntries(overdue.map((r) => [r.client.name, r.stalled]));
    expect(byName["صامت"]).toBe(true);
    expect(byName["تواصل"]).toBe(false);
    expect(byName["بلا تواصل"]).toBe(true);
  });

  it("المتأخر مرتّب بالأكثر تأخّراً أولاً", () => {
    const { overdue } = buildFollowUps(
      [
        client({ name: "٣", follow_up_date: "2026-09-19" }),
        client({ name: "١٠", follow_up_date: "2026-09-12" }),
        client({ name: "١", follow_up_date: "2026-09-21" }),
      ],
      today
    );
    expect(overdue.map((r) => r.daysLate)).toEqual([10, 3, 1]);
  });
});
