// ينشئ مستخدمي الاختبار في Auth الخاص بـ STAGING عبر Admin API. لا يعمل إلا من 4-create-test-users.ps1.
// البريد: <key>@staging.tilal.invalid (نطاق .invalid لا يُرسل إليه بريد أبداً). كلمات المرور عشوائية وتُحفظ محلياً فقط.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PROD_REF = "edgblrqkushnznhmuxln";
const here = dirname(fileURLToPath(import.meta.url));
const url = process.env.STAGING_URL ?? "";
const ref = process.env.STAGING_REF ?? "";
const key = process.env.STAGING_SERVICE_ROLE_KEY ?? "";

if (!url || !ref || !key) throw new Error("Run through staging/4-create-test-users.ps1");
if (url.includes(PROD_REF) || ref === PROD_REF) throw new Error("STOP: production ref");
if (url !== `https://${ref}.supabase.co`) throw new Error("STOP: URL does not match the staging ref");
// مفتاح service_role هو JWT يحمل ref المشروع — يجب أن يكون لـ staging
try {
  const payload = JSON.parse(Buffer.from(key.split(".")[1] ?? "", "base64url").toString("utf8"));
  if (payload.ref && payload.ref !== ref) throw new Error(`STOP: key belongs to project ${payload.ref}`);
  if (payload.ref === PROD_REF) throw new Error("STOP: production key");
} catch (e) {
  if (String(e.message).startsWith("STOP")) throw e; // المفاتيح الجديدة (sb_secret_) ليست JWT — يكفي فحص الرابط
}

const users = JSON.parse(readFileSync(join(here, "users.json"), "utf8"));
const outDir = join(here, "..", "output");
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

const result = [];
for (const u of users) {
  const email = `${u.key.replace(/_/g, "-")}@staging.tilal.invalid`;
  const password = randomBytes(15).toString("base64url");
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { staging_key: u.key } }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok) {
    result.push({ key: u.key, email, id: body.id, password });
    console.log(`✓ ${u.key}`);
  } else if (res.status === 422 || /already/i.test(JSON.stringify(body))) {
    console.log(`= ${u.key} موجود مسبقاً (لم تُغيَّر كلمة مروره)`);
    result.push({ key: u.key, email, id: null, password: null });
  } else {
    throw new Error(`${u.key}: ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
  }
}
const file = join(outDir, "test-users.json");
writeFileSync(file, JSON.stringify(result, null, 2));
console.log(`حُفظت البيانات في ${file} (خارج git). المستخدمون: ${result.length}`);
