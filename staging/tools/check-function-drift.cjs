// يقارن أجسام الدوال في ملفات sql/ (آخر تعريف يغلب بترتيب الأرقام) بالدوال الحيّة. قراءة فقط.
// الاستخدام: node staging/tools/check-function-drift.cjs <مجلد sql> [من] [إلى] > drift.sql
//   ثم الصق drift.sql في SQL Editor: يعرض الدوال «غائبة» أو «مختلفة» فقط.
// قيد معروف: الهجرات التي تعدّل دالة باستبدال نصّ داخل كتلة DO (مثل 158، 222) تظهر «مختلفة» وهي سليمة — تُراجع يدوياً.
const fs = require('fs'), crypto = require('crypto'), path = require('path');
const [dir, from = '000', to = '999'] = process.argv.slice(2);
if (!dir) { console.error('usage: check-function-drift.cjs <sql dir> [from] [to]'); process.exit(2); }
const files = fs.readdirSync(dir)
  .filter((f) => /^\d{3}/.test(f) && f.endsWith('.sql') && f.slice(0, 3) >= from && f.slice(0, 3) <= to)
  .sort((a, b) => a.slice(0, 3).localeCompare(b.slice(0, 3)) || a.localeCompare(b));
const out = {};
for (const f of files) {
  const s = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r/g, '');
  const re = /create\s+or\s+replace\s+function\s+public\.(\w+)\s*\(([\s\S]*?)\)\s*returns[\s\S]*?as\s+(\$[a-z_]*\$)([\s\S]*?)\3/gi;
  let m;
  while ((m = re.exec(s))) out[m[1]] = { h: crypto.createHash('md5').update(m[4]).digest('hex'), f };
}
const rows = Object.entries(out).map(([k, v]) => `('${k}','${v.h}','${v.f}')`);
if (!rows.length) { console.error('no functions found'); process.exit(1); }
process.stdout.write(`-- ${rows.length} functions from ${files.length} files (${from}..${to})
with e(n, h, f) as (values ${rows.join(',\n')})
select e.f, e.n, case when p.n is null then 'missing' else 'differs' end as status
  from e left join (select proname n, array_agg(md5(replace(prosrc, chr(13), ''))) hs
                      from pg_proc where pronamespace = 'public'::regnamespace group by 1) p on p.n = e.n
 where p.n is null or not (e.h = any (p.hs))
 order by e.f, e.n;
`);
