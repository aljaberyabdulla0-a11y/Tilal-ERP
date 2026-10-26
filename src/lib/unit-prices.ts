// ============================================================
// تحديث أسعار وحدات مشروع من ملف اكسل — المنطق الصافي بلا قاعدة:
// كشف صفّ العناوين والأعمدة، ومفاتيح مطابقة الوحدة، والسعر الجديد.
//
// ملفّات التسعير لا قالب لها: جدول المطوّر كما هو (ورقة لكل برج،
// عنوان مدموج فوق العناوين، أعمدة دفعات لا تعنينا). فلا نشترط
// أسماء أعمدة بعينها — نكشف عمود السعر من عنوانه، وعمود الكود من
// أكثر عمودٍ تطابق قيمُه وحدات المشروع.
//
// والمطابقة آمنة: مفتاحٌ يدلّ على أكثر من وحدة يُهمَل، فلا يُكتب
// سعر وحدةٍ على أخرى.
// ============================================================

export type PriceUnit = {
  id: string;
  unit_code: string | null;
  node_path: string | null;
  space_m2: number | null;
  price: number | null;
  status: string;
  attrs: Record<string, unknown> | null;
};

export type SheetCells = { name: string; rows: string[][] };

export type PriceMode = "total" | "ppm";

export type PriceRow = {
  sheet: string;
  row: number; // رقم الصفّ في اكسل (من ١)
  code: string;
  unitId: string | null;
  unitLabel: string | null;
  status: string | null;
  oldPrice: number | null;
  dbArea: number | null;
  fileArea: number | null;
  total: number | null; // السعر الإجمالي كما في الملف
  ppm: number | null; // سعر المتر كما في الملف
  byTotal: number | null; // السعر الجديد إن اعتُمد الإجمالي
  byPpm: number | null; // السعر الجديد إن اعتُمد المتر × المساحة
  issue: "not_found" | "no_price" | "duplicate" | null;
  mismatch: boolean; // الإجمالي ≠ المساحة × سعر المتر
  areaDiff: boolean; // مساحة الملف ≠ مساحة النظام
};

export type SheetInfo = {
  name: string;
  used: boolean;
  headerRow: number | null;
  codeHeader: string | null;
  totalHeader: string | null;
  ppmHeader: string | null;
  areaHeader: string | null;
};

export type PricePreview = {
  sheets: SheetInfo[];
  rows: PriceRow[];
  missing: { id: string; label: string }[]; // وحدات المشروع الغائبة عن الملف
};

// ---------- التطبيع ----------

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

function latinDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (d) => {
    const i = ARABIC_DIGITS.indexOf(d);
    return String(i >= 0 ? i : PERSIAN_DIGITS.indexOf(d));
  });
}

// «A / 7.FLOOR 1» و«a7floor1» مفتاحٌ واحد: حروف وأرقام فقط
export function normKey(s: string | null | undefined): string {
  return latinDigits(String(s ?? ""))
    .toUpperCase()
    .replace(/[^A-Z0-9ء-ي]/g, "");
}

// «2,250,000» و«٢٢٥٠٠٠٠ د.ع» و«125.57م²» → أرقام
export function parseNum(s: string | null | undefined): number | null {
  const t = latinDigits(String(s ?? ""))
    .replace(/٫/g, ".")
    .replace(/[,،\s]/g, "")
    .replace(/[^0-9.\-]/g, "");
  if (!t || t === "." || t === "-") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// ---------- مفاتيح الوحدة ----------

const LEVEL_WORDS =
  /(FLOOR|TOWER|BUILDING|BLOCK|BLDG|LEVEL|الطابق|طابق|البرج|برج|المبنى|مبنى|العمارة|عمارة|البناية|بناية|بلوك)/g;

// «7.FLOOR» → 7 · «الطابق 03» → 3 · «برج A» → A
function levelToken(segment: string): string {
  const t = normKey(segment).replace(LEVEL_WORDS, "");
  return /^\d+$/.test(t) ? String(Number(t)) : t;
}

export function unitLabel(u: PriceUnit): string {
  return [u.node_path, u.unit_code].filter(Boolean).join(" / ") || u.id.slice(0, 8);
}

// كل كتابةٍ معقولة لكود الوحدة في جداول المطوّرين:
//   الباركود والوسم المحفوظان عند الرفع (A.7.FLOOR.1)
//   الموقع + الرقم (A / 7.FLOOR / 1)
//   المختصر: رمز كل مستوى + الرقم بخانتين (A701، A1001، A111)
//   الرقم وحده (يُهمَل تلقائياً إن تكرّر بين المباني)
export function unitKeys(u: PriceUnit): string[] {
  const keys = new Set<string>();
  const add = (s: unknown) => {
    const k = normKey(typeof s === "string" || typeof s === "number" ? String(s) : "");
    if (k) keys.add(k);
  };

  add(u.attrs?.barcode);
  add(u.attrs?.label);
  add(u.unit_code);

  const code = (u.unit_code ?? "").trim();
  if (u.node_path && code) {
    add(`${u.node_path}${code}`);
    const prefix = u.node_path.split("/").map(levelToken).join("");
    const num = latinDigits(code);
    // بلا صيغة «بلا صفر» (A71): تصطدم بين الطابق ١ وحدة ١١ والطابق ١١ وحدة ١
    if (/^\d+$/.test(num)) {
      add(prefix + String(Number(num)).padStart(2, "0"));
    } else {
      add(prefix + num);
    }
  }
  return Array.from(keys);
}

// مفتاح → وحدة. ما دلّ على وحدتين صار null (ملتبس) فلا يُطابَق
export function buildIndex(units: PriceUnit[]): Map<string, string | null> {
  const index = new Map<string, string | null>();
  for (const u of units) {
    for (const k of unitKeys(u)) {
      const had = index.get(k);
      if (had === undefined) index.set(k, u.id);
      else if (had !== u.id) index.set(k, null);
    }
  }
  return index;
}

// ---------- الأعمدة ----------

const RX_PRICE = /(سعر|السعر|price|ثمن)/i;
const RX_PPM = /(المتر|للمتر|متر|per\s*m|\/\s*m|m2|m²|sqm)/i;
const RX_TOTAL = /(إجمالي|اجمالي|الكلي|total)/i;
const RX_AREA = /(مساحة|المساحة|area|space)/i;

type Columns = { total: number | null; ppm: number | null; area: number | null };

function detectColumns(header: string[]): Columns {
  let total: number | null = null;
  let totalStrong = false;
  let ppm: number | null = null;
  let area: number | null = null;

  header.forEach((raw, i) => {
    const h = raw.trim();
    if (!h) return;
    if (RX_PRICE.test(h)) {
      if (RX_PPM.test(h)) {
        if (ppm === null) ppm = i;
      } else if (RX_TOTAL.test(h)) {
        if (!totalStrong) {
          total = i;
          totalStrong = true;
        }
      } else if (total === null) {
        total = i;
      }
    } else if (RX_AREA.test(h) && area === null) {
      area = i;
    }
  });
  return { total, ppm, area };
}

// صفّ العناوين: أوّل صفّ (من أوّل ١٥) فيه عمود سعر وثلاث قيم مختلفة
// على الأقل — العنوان المدموج فوقه قيمةٌ واحدة مكرّرة فلا يُحسب.
function findHeader(rows: string[][]): number | null {
  const limit = Math.min(rows.length, 15);
  for (let r = 0; r < limit; r++) {
    const cells = rows[r].map((c) => c.trim()).filter(Boolean);
    if (new Set(cells).size < 3) continue;
    const cols = detectColumns(rows[r]);
    if (cols.total !== null || cols.ppm !== null) return r;
  }
  return null;
}

// ---------- المعاينة ----------

const round = (n: number) => Math.round(n);

export function buildPricePreview(sheets: SheetCells[], units: PriceUnit[]): PricePreview {
  const index = buildIndex(units);
  const byId = new Map(units.map((u) => [u.id, u]));
  const infos: SheetInfo[] = [];
  const rows: PriceRow[] = [];
  const seen = new Set<string>();

  for (const sheet of sheets) {
    const info: SheetInfo = {
      name: sheet.name,
      used: false,
      headerRow: null,
      codeHeader: null,
      totalHeader: null,
      ppmHeader: null,
      areaHeader: null,
    };
    infos.push(info);

    const h = findHeader(sheet.rows);
    if (h === null) continue;
    const header = sheet.rows[h];
    const cols = detectColumns(header);
    const data = sheet.rows.slice(h + 1);

    // عمود الكود: أكثر عمودٍ تطابق قيمُه وحدات المشروع
    const width = Math.max(header.length, ...data.map((r) => r.length));
    let codeCol = -1;
    let best = 0;
    for (let c = 0; c < width; c++) {
      if (c === cols.total || c === cols.ppm || c === cols.area) continue;
      let hits = 0;
      for (const r of data) {
        const k = normKey(r[c]);
        if (k && index.get(k)) hits++;
      }
      if (hits > best) {
        best = hits;
        codeCol = c;
      }
    }
    if (codeCol < 0) continue;

    info.used = true;
    info.headerRow = h + 1;
    info.codeHeader = header[codeCol]?.trim() || `العمود ${codeCol + 1}`;
    info.totalHeader = cols.total !== null ? header[cols.total].trim() : null;
    info.ppmHeader = cols.ppm !== null ? header[cols.ppm].trim() : null;
    info.areaHeader = cols.area !== null ? header[cols.area].trim() : null;

    data.forEach((r, i) => {
      const code = (r[codeCol] ?? "").trim();
      const total = cols.total !== null ? parseNum(r[cols.total]) : null;
      const ppm = cols.ppm !== null ? parseNum(r[cols.ppm]) : null;
      if (!code && total === null && ppm === null) return; // صفّ فارغ أو تذييل

      const fileArea = cols.area !== null ? parseNum(r[cols.area]) : null;
      const id = code ? index.get(normKey(code)) ?? null : null;
      const u = id ? byId.get(id) ?? null : null;
      const dbArea = u?.space_m2 != null ? Number(u.space_m2) : null;

      const byTotal = total !== null && total > 0 ? round(total) : null;
      const byPpm = ppm !== null && ppm > 0 && dbArea ? round(ppm * dbArea) : null;

      let issue: PriceRow["issue"] = null;
      if (!u) issue = "not_found";
      else if (byTotal === null && byPpm === null) issue = "no_price";
      else if (seen.has(u.id)) issue = "duplicate";
      if (u && issue !== "not_found") seen.add(u.id);

      rows.push({
        sheet: sheet.name,
        row: h + 2 + i,
        code,
        unitId: u?.id ?? null,
        unitLabel: u ? unitLabel(u) : null,
        status: u?.status ?? null,
        oldPrice: u?.price != null ? Number(u.price) : null,
        dbArea,
        fileArea,
        total,
        ppm,
        byTotal,
        byPpm,
        issue,
        // كسور التقريب: المساحة بخانتين عشريّتين، فالفرق حتى نصف
        // جزءٍ من مئة من المتر لا يُعدّ خلافاً
        mismatch:
          byTotal !== null &&
          byPpm !== null &&
          Math.abs(byTotal - byPpm) > Math.max(1000, (ppm ?? 0) * 0.005),
        areaDiff: fileArea !== null && dbArea !== null && Math.abs(fileArea - dbArea) > 0.01,
      });
    });
  }

  const missing = units
    .filter((u) => !seen.has(u.id))
    .map((u) => ({ id: u.id, label: unitLabel(u) }));

  return { sheets: infos, rows, missing };
}

// السعر الذي سيُحفظ: الإجمالي كما في الملف، أو المساحة × سعر المتر.
// وإن غاب أحدهما أُخذ الآخر.
export function newPrice(r: PriceRow, mode: PriceMode): number | null {
  if (r.issue) return null;
  return mode === "ppm" ? r.byPpm ?? r.byTotal : r.byTotal ?? r.byPpm;
}

// ما سيتغيّر فعلاً — الصفوف المطابقة التي يختلف سعرها الجديد عن القائم
export function priceUpdates(rows: PriceRow[], mode: PriceMode): { id: string; price: number }[] {
  const out: { id: string; price: number }[] = [];
  for (const r of rows) {
    const p = newPrice(r, mode);
    if (r.unitId && p !== null && p !== r.oldPrice) out.push({ id: r.unitId, price: p });
  }
  return out;
}
