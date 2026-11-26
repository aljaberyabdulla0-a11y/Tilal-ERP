// يستخرج من schema_managed_tables.sql ما أضافه Tilal فوق جداول Supabase المُدارة فقط:
// triggers على auth.users، وسياسات storage/realtime وتفعيل RLS عليها.
// لا يُعيد إنشاء الجداول المُدارة نفسها (موجودة في كل مشروع Supabase جديد).
// الاستخدام: node staging/tools/extract-managed.mjs [مجلد المخرجات]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] ?? join(here, "..", "output");
const src = readFileSync(join(outDir, "schema_managed_tables.sql"), "utf8").replace(/\r/g, "");

// pg_dump يفصل الجمل بـ ";\n" ولا يستعمل $$ في هذه الجداول
const statements = src
  .split(/;\n/)
  .map((s) => s.replace(/^(--[^\n]*\n|\s)+/g, "").trim())
  .filter(Boolean);

const keep = statements.filter((s) =>
  /^CREATE (?:CONSTRAINT )?TRIGGER [\s\S]+ ON auth\.users /i.test(s) ||
  /^CREATE POLICY [\s\S]+ ON (storage\.(objects|buckets)|realtime\.messages)\b/i.test(s) ||
  /^ALTER TABLE (?:ONLY )?(storage\.(objects|buckets)|realtime\.messages) ENABLE ROW LEVEL SECURITY$/i.test(s),
);

const guard = `do $g$ begin if coalesce((select name from staging_meta.environment limit 1), '') <> 'staging' then raise exception 'STOP: not a staging database'; end if; end $g$;`;
const body = keep.map((s) => {
  // سياسة/trigger قد تكون موجودة مسبقاً في المشروع الجديد: أسقطها أولاً لتكون الاستعادة قابلة للتكرار
  const pol = s.match(/^CREATE POLICY ("[^"]+"|\S+) ON (\S+)/i);
  if (pol) return `DROP POLICY IF EXISTS ${pol[1]} ON ${pol[2]};\n${s};`;
  const trg = s.match(/^CREATE (?:CONSTRAINT )?TRIGGER (\S+) [\s\S]+ ON (auth\.users) /i);
  if (trg) return `DROP TRIGGER IF EXISTS ${trg[1]} ON ${trg[2]};\n${s};`;
  return `${s};`;
});

writeFileSync(join(outDir, "managed_restore.sql"), [guard, "begin;", ...body, "commit;", ""].join("\n"));
const n = (re) => keep.filter((s) => re.test(s)).length;
console.log(`managed_restore.sql: ${n(/TRIGGER/i)} trigger · ${n(/POLICY/i)} سياسة · ${n(/ENABLE ROW LEVEL/i)} RLS`);
