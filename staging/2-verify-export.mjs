// Tilal ERP — يفحص مخرجات 1-export-from-production.ps1 قبل أي استعادة على staging.
// يرفض: صفوف بيانات في ملفات البنية، إدراجاً في جدول خارج القائمة البيضاء، أسراراً، هواتف أو بريداً حقيقياً.
// الاستخدام: node staging/2-verify-export.mjs [مجلد المخرجات]
// مبني على C:\dev\Tilal-Next15-Upgrade\schema-dump\2-verify-dump.mjs (2026-11-07).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] ?? join(here, "output");
const PROD_REF = "edgblrqkushnznhmuxln";
const STRUCTURE = ["schema_public_tests.sql", "schema_managed_tables.sql"];
const REFERENCE = "reference_data.sql";
const INVENTORY = "inventory.json";

// يجب أن تطابق القائمة في sql/reference_data_export.sql حرفياً
const ALLOW = new Set(`app_modules roles role_permissions approval_workflows approval_steps branches departments
employment_types job_grades positions employment_status_transitions crm_stages crm_stage_transitions crm_sources
crm_activity_types crm_loss_sources crm_loss_categories crm_lost_reasons crm_recovery_levels crm_customer_potentials
crm_settings crm_sla_rules crm_score_rules crm_metrics crm_report_templates task_workspaces task_sources task_types
task_entity_types task_workflows task_workflow_steps task_templates task_template_items task_automation_rules
department_task_settings kpi_definitions performance_settings leave_types clearance_templates onboarding_templates
employee_document_types accounts expense_categories hr_account_map payroll_tax_brackets unit_types work_shifts
company_settings mkt_approval_rules mkt_automation_rules`.split(/\s+/).filter(Boolean));

const fail = [];
const warn = [];
const count = (s, re) => (s.match(re) ?? []).length;
const SECRETS = [
  ["JWT", /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g],
  ["مفتاح Supabase سرّي", /\bsb_secret_[A-Za-z0-9_-]+|\bsbp_[A-Za-z0-9]{20,}/g],
  ["رابط اتصال بكلمة مرور", /postgres(?:ql)?:\/\/[^\s:]+:[^\s@]+@/g],
  ["مفتاح خاص", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ["مفتاح Meta/Facebook", /\bEAA[A-Za-z0-9]{40,}/g],
  ["مفتاح Anthropic", /\bsk-ant-[A-Za-z0-9_-]{20,}/g],
];
const read = (f) => readFileSync(join(outDir, f), "utf8").replace(/\r/g, "");

function scanCommon(f, s) {
  for (const [name, re] of SECRETS) {
    const n = count(s, re);
    if (n) fail.push(`${f}: ${n} × ${name}`);
  }
  const ref = count(s, new RegExp(PROD_REF, "g"));
  if (ref) warn.push(`${f}: ${ref} إشارة إلى رقم مشروع الإنتاج — راجعها (عناوين دوال/cron) قبل الاستعادة`);
  // أرقام عراقية حقيقية محتملة (أرقام الاختبار 07700000xxx و07701234xxx مستثناة)
  const phones = [...new Set(s.match(/\b07[3-9]\d{8}\b/g) ?? [])].filter((p) => !/^0770(0000|1234)/.test(p));
  if (phones.length) (f === REFERENCE ? fail : warn).push(`${f}: ${phones.length} رقم هاتف محتمل`);
  const emails = [...new Set(s.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [])]
    .filter((e) => !/(example|test|invalid|staging)/i.test(e));
  if (emails.length) (f === REFERENCE ? fail : warn).push(`${f}: ${emails.length} بريد محتمل`);
}

for (const f of [...STRUCTURE, REFERENCE, INVENTORY]) {
  if (!existsSync(join(outDir, f))) fail.push(`ملف ناقص: ${f}`);
}
if (fail.length) finish();

const totals = { tables: 0, functions: 0, triggers: 0, policies: 0, indexes: 0, rls: 0, defaultPrivs: 0 };
for (const f of STRUCTURE) {
  const s = read(f);
  const copy = count(s, /^COPY\s+\S+.*FROM stdin;$/gm);
  const insert = count(s, /^INSERT INTO /gm);
  if (copy || insert) fail.push(`${f}: ${copy} COPY / ${insert} INSERT — ملف بنية يحتوي بيانات`);
  scanCommon(f, s);
  if (count(s, /cron\.schedule\(/g)) warn.push(`${f}: استدعاءات cron.schedule داخل دوال — لا تُستدعى على staging`);
  totals.tables += count(s, /^CREATE TABLE (?:IF NOT EXISTS )?public\./gm);
  totals.functions += count(s, /^CREATE (?:OR REPLACE )?FUNCTION /gm);
  totals.triggers += count(s, /^CREATE (?:CONSTRAINT )?TRIGGER /gm);
  totals.policies += count(s, /^CREATE POLICY /gm);
  totals.indexes += count(s, /^CREATE (?:UNIQUE )?INDEX /gm);
  totals.rls += count(s, /ENABLE ROW LEVEL SECURITY;$/gm);
  totals.defaultPrivs += count(s, /^ALTER DEFAULT PRIVILEGES /gm);
}

// بيانات الإعداد: إدراج في جداول القائمة البيضاء فقط، وحارس staging في أوله
{
  const s = read(REFERENCE);
  scanCommon(REFERENCE, s);
  if (!/STOP: not a staging database/.test(s.slice(0, 2000))) fail.push(`${REFERENCE}: حارس staging غائب من أول الملف`);
  const targets = [...s.matchAll(/^insert into public\.("?)([a-z_]+)\1 /gm)].map((m) => m[2]);
  const outside = [...new Set(targets.filter((t) => !ALLOW.has(t)))];
  if (outside.length) fail.push(`${REFERENCE}: إدراج في جداول خارج القائمة: ${outside.join(" ")}`);
  if (targets.length !== ALLOW.size) warn.push(`${REFERENCE}: ${targets.length} جدولاً من ${ALLOW.size} في القائمة`);
  for (const bad of ["office_lat", "office_lng", "salary_min", "salary_max", "created_by", "updated_by", "manager_id", "phone"]) {
    if (new RegExp(`"${bad}"\\s*:`).test(s)) fail.push(`${REFERENCE}: الحقل ${bad} لم يُحذف`);
  }
  console.log(`بيانات الإعداد: ${targets.length} جدولاً`);
}

// المطابقة مع الجرد الحيّ
{
  const inv = JSON.parse(read(INVENTORY));
  const live = (inv.tables ?? []).map((t) => t.name.replace(/^public\./, ""));
  const all = STRUCTURE.map(read).join("\n");
  const missing = live.filter((t) => !new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?public\\.${t}\\b`).test(all));
  if (missing.length) fail.push(`جداول حيّة غائبة عن dump: ${missing.join(" ")}`);
  if (totals.policies < inv.policies) fail.push(`السياسات: ${totals.policies} في dump مقابل ${inv.policies} حيّة`);
  console.log(`الجداول الحيّة ${live.length} — الغائبة ${missing.length} · الامتدادات: ${(inv.extensions ?? []).join(", ")}`);
  console.log(`مهام cron في الإنتاج (لا تُنسخ): ${(inv.cron_job_names ?? []).length}`);
}
if (totals.policies === 0) fail.push("لا سياسات RLS في dump");
if (totals.defaultPrivs === 0) warn.push("لا ALTER DEFAULT PRIVILEGES — راجع إغلاق anon");
console.log("الجرد:", JSON.stringify(totals));
finish();

function finish() {
  warn.forEach((w) => console.log("تنبيه:", w));
  fail.forEach((x) => console.log("فشل:", x));
  console.log(fail.length ? "النتيجة: NOT READY" : warn.length ? "النتيجة: PASS WITH REVIEW" : "النتيجة: PASS");
  process.exit(fail.length ? 1 : 0);
}
