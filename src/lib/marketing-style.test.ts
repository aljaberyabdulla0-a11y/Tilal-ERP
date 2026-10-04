import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACTIVITY_KINDS, ACTIVITY_STATUSES, ASSET_TYPES, CAMPAIGN_MODES, CAMPAIGN_STATUSES, CAMPAIGN_TYPES,
  CONTENT_STATUSES, CONTENT_TYPES, DEAL_STAGES, EXPENSE_CATEGORIES, EXPENSE_STATUSES, METRIC_LABELS,
  MKT_ROLES, PLAN_KINDS, PURCHASE_STATUSES, TASK_STATUSES, fmt, fmtPct, statusClass, trackingUrl,
} from "./marketing-style";

// ============================================================
// المرايا مع القاعدة — كل قائمة في الواجهة تطابق قيد CHECK في SQL.
// اختلافهما صامت: خيارٌ لا يقبله القيد = «فشل الحفظ» بلا تفسير.
// الاختبار يقرأ ملفّات الهجرات نفسها لا نسخةً منها.
// ============================================================
const sql = ["121_marketing_core.sql", "122_marketing_finance.sql", "126_marketing_automation.sql"]
  .map((f) => readFileSync(resolve(__dirname, "../../sql", f), "utf8"))
  .join("\n");

/** القيم بين أقواس أول «<anchor> … in (…)» بعد المرساة */
function checkList(anchor: string): string[] {
  const at = sql.indexOf(anchor);
  if (at < 0) throw new Error(`لم يُعثر على ${anchor}`);
  const open = sql.indexOf(" in (", at);
  let depth = 0, end = open + 4;
  for (; end < sql.length; end++) {
    if (sql[end] === "(") depth++;
    if (sql[end] === ")" && --depth === 0) break;
  }
  return Array.from(sql.slice(open + 4, end).matchAll(/'([^']+)'/g)).map((m) => m[1]);
}

describe("مرايا القوائم مع قيود 121–126", () => {
  const cases: [string, readonly string[], string][] = [
    ["حالات الحملة", CAMPAIGN_STATUSES, "crm_campaigns_status_chk"],
    ["أنواع الحملة", CAMPAIGN_TYPES, "crm_campaigns_type_chk"],
    ["رقمي/ميداني", CAMPAIGN_MODES, "crm_campaigns_mode_chk"],
    ["أنواع المحتوى", CONTENT_TYPES, "content_type   text not null check"],
    ["حالات المحتوى", CONTENT_STATUSES, "status         text not null default 'فكرة'"],
    ["أنواع النشاط", ACTIVITY_KINDS, "default ('act-'"],
    ["حالات النشاط", ACTIVITY_STATUSES, "status            text not null default 'مخطط'"],
    ["مراحل المؤثر", DEAL_STAGES, "stage              text not null default 'بحث'"],
    ["تصنيفات المصروف", EXPENSE_CATEGORIES, "category           text not null check"],
    ["حالات المصروف", EXPENSE_STATUSES, "status             text not null default 'مسودة' check"],
    ["أنواع الخطط", PLAN_KINDS, "kind              text not null check"],
    ["الأدوار الوظيفية", MKT_ROLES, "mkt_role    text not null check"],
    ["أنواع الأصول", ASSET_TYPES, "asset_type        text not null check"],
    ["حالات المهمّة", TASK_STATUSES, "check (status in ('للتنفيذ'"],
    ["حالات طلب الشراء", PURCHASE_STATUSES, "status            text not null default 'مسودة' check (status in (\n                      'مسودة', 'بانتظار الموافقة', 'معتمد', 'تم الشراء'"],
  ];
  for (const [name, list, anchor] of cases) {
    it(name, () => {
      expect([...list].sort()).toEqual(checkList(anchor).sort());
    });
  }
  it("مقاييس الأهداف = قيد metric_code", () => {
    expect(Object.keys(METRIC_LABELS).sort()).toEqual(checkList("metric_code  text check").sort());
  });
});

describe("التنسيق", () => {
  it("الفراغ «—» لا صفر — الصفر يُقرأ مجّاناً", () => {
    expect(fmt(null)).toBe("—");
    expect(fmt(undefined)).toBe("—");
    expect(fmt(0)).toBe("0");
    expect(fmt(1234567)).toBe("1,234,567");
    expect(fmtPct(null)).toBe("—");
    expect(fmtPct(12.345)).toBe("12.3%");
  });
  it("لون الحالة بمعناها", () => {
    expect(statusClass("بانتظار الموافقة")).toContain("amber");
    expect(statusClass("مرفوض")).toContain("red");
    expect(statusClass("غير معروفة")).toContain("slate");
  });
  it("رابط التتبّع و QR", () => {
    expect(trackingUrl("https://erp.tilal.iq/", "a1b2c3d")).toBe("https://erp.tilal.iq/r/a1b2c3d");
    expect(trackingUrl("https://erp.tilal.iq", "a1b2c3d", true)).toBe("https://erp.tilal.iq/r/a1b2c3d?q=1");
  });
});
