import { describe, expect, it } from "vitest";
import { daysInStage, needsAction, stageKind, stageMoveIntent, type StageRule } from "./crm-journey";
import { CLOSED_STAGES, NONCOMMERCIAL_STAGES, isClosedStage } from "./types";

// مرآة crm_stages بعد 201 — الأنواع والأعلام كما في البذرة
const S: Record<string, StageRule> = {
  lead: { name: "ليد", type: "open" },
  contact: { name: "اتصال", type: "open" },
  offer: { name: "مناقشة العرض", type: "open" },
  reserved: { name: "حجز", type: "open", manual: false },
  won: { name: "بيع", type: "won" },
  lost: { name: "فشل البيع", type: "lost", lost: true },
  unqualified: { name: "غير مؤهّل", type: "closed", requiresReason: true },
  unreachable: { name: "تعذّر الوصول", type: "closed", requiresReason: true },
};

describe("stageMoveIntent — مرآة الحارس guard_opportunity_stage والباب crm_move_client_stage", () => {
  it("نفس المرحلة لا شيء", () => {
    expect(stageMoveIntent(S.contact, S.contact)).toBe("none");
  });
  it("التقدّم بين المفتوحة مباشر", () => {
    expect(stageMoveIntent(S.lead, S.contact)).toBe("direct");
    expect(stageMoveIntent(S.offer, S.contact)).toBe("direct");
  });
  it("الخسارة بالنموذج وحده — من أي مرحلة", () => {
    expect(stageMoveIntent(S.contact, S.lost)).toBe("lost_form");
    expect(stageMoveIntent(S.won, S.lost)).toBe("lost_form");
  });
  it("الخاسر يُعاد تنشيطه لا يُنقل", () => {
    expect(stageMoveIntent(S.lost, S.contact)).toBe("reactivate");
    expect(stageMoveIntent(S.lost, S.unqualified)).toBe("reactivate");
  });
  it("«حجز» لا يُختار يدوياً", () => {
    expect(stageMoveIntent(S.offer, S.reserved)).toBe("reservation");
  });
  it("الإغلاق غير التجاري بسبب، والعودة منه بسبب", () => {
    expect(stageMoveIntent(S.contact, S.unreachable)).toBe("reason");
    expect(stageMoveIntent(S.unqualified, S.contact)).toBe("reason");
  });
  it("لا عدم ردّ يصير خسارة: «تعذّر الوصول» ليس lost", () => {
    expect(stageKind(S.unreachable)).toBe("closed");
    expect(stageMoveIntent(S.contact, S.unreachable)).not.toBe("lost_form");
  });
  it("من «بيع»: الموظف يُوجَّه لمسار إضافي، والمدير يصحّح بسبب", () => {
    expect(stageMoveIntent(S.won, S.offer)).toBe("won_locked");
    expect(stageMoveIntent(S.won, S.offer, { isAdmin: true })).toBe("reason");
  });
  it("بلا نوع صريح: الأعلام القديمة تكفي (قبل 201)", () => {
    expect(stageKind({ name: "فشل البيع", lost: true, closed: true })).toBe("lost");
    expect(stageKind({ name: "بيع", closed: true })).toBe("won");
    expect(stageKind({ name: "اتصال" })).toBe("open");
  });
});

describe("المراحل المغلقة — مرآة is_open_stage", () => {
  it("الختامية غير التجارية مغلقة فلا متابعة إلزامية", () => {
    for (const s of NONCOMMERCIAL_STAGES) expect(isClosedStage(s)).toBe(true);
    expect((CLOSED_STAGES as readonly string[]).includes("حجز")).toBe(false);
    expect(isClosedStage("حجز")).toBe(false);
  });
});

describe("عمر المرحلة وشارة «يحتاج إجراء»", () => {
  const now = new Date("2026-10-12T09:00:00Z");
  it("يحسب الأيام منذ دخول المرحلة", () => {
    expect(daysInStage("2026-10-02T09:00:00Z", now)).toBe(10);
    expect(daysInStage(null, now)).toBeNull();
    expect(daysInStage("bad", now)).toBeNull();
  });
  it("المغلق لا يحتاج إجراء، والمفتوح بلا تواصل أولاً", () => {
    expect(needsAction({ follow_up_date: null, last_contact_at: null }, false, "2026-10-12")).toBeNull();
    expect(needsAction({ follow_up_date: "2026-10-20", last_contact_at: null }, true, "2026-10-12")).toBe("never_contacted");
    expect(needsAction({ follow_up_date: null, last_contact_at: "2026-10-01" }, true, "2026-10-12")).toBe("no_date");
    expect(needsAction({ follow_up_date: "2026-10-11", last_contact_at: "2026-10-01" }, true, "2026-10-12")).toBe("overdue");
    expect(needsAction({ follow_up_date: "2026-10-12", last_contact_at: "2026-10-01" }, true, "2026-10-12")).toBeNull();
  });
});

describe("قائمة PostgREST للمغلقة — كل استعلام «المفتوح» يستثني الأربع", () => {
  it("تشمل الختامية غير التجارية", async () => {
    const { CLOSED_STAGES_PG_LIST } = await import("./types");
    expect(CLOSED_STAGES_PG_LIST).toBe('("بيع","فشل البيع","غير مؤهّل","تعذّر الوصول")');
  });
});
