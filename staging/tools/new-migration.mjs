// يولّد ملف هجرة بإطار التسجيل (sql/templates/migration_frame.sql).
// الاستخدام: node staging/tools/new-migration.mjs <name> "<العنوان>" [ملف المحتوى] [مسار الناتج]
//   name مثل 227_ops_foundation (أرقام + حروف صغيرة + _ فقط). المسار الافتراضي sql/<name>.sql.
// يرفض الكتابة فوق ملف موجود، ويرفض رقماً مأخوذاً في sql/.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const [name, title = "", bodyFile, outArg] = process.argv.slice(2);
if (!name || !/^\d{3}[a-z]?_[a-z0-9_]+$/.test(name)) {
  console.error("usage: new-migration.mjs <NNN_name> \"<title>\" [body.sql] [out.sql]");
  process.exit(2);
}
const out = outArg ?? join(root, "sql", `${name}.sql`);
if (existsSync(out)) { console.error(`exists: ${out}`); process.exit(1); }
if (!outArg) {
  const num = name.slice(0, 3);
  const taken = readdirSync(join(root, "sql")).filter((f) => f.startsWith(num));
  if (taken.length) { console.error(`number ${num} already used: ${taken.join(", ")}`); process.exit(1); }
}
const frame = readFileSync(join(root, "sql", "templates", "migration_frame.sql"), "utf8").replace(/\r/g, "");
const body = bodyFile ? readFileSync(bodyFile, "utf8").replace(/\r/g, "").trim() : "-- (المحتوى هنا)";
if (/^\s*(begin|commit|rollback)\s*;/im.test(body)) {
  console.error("body must not contain its own begin/commit/rollback — the frame owns the transaction");
  process.exit(1);
}
const text = frame.replaceAll("__NAME__", name).replaceAll("__TITLE__", title).replace("__BODY__", () => body); // دالة: لا تفسير لـ $ في المحتوى
writeFileSync(out, text);
console.log(`written ${out}`);
