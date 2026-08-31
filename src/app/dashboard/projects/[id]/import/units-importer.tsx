"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ProjectNode, UNIT_STATUS_LIST, UnitTypeRow } from "@/lib/types";

// ============================================================
// رفع الوحدات من CSV.
//
// المبدأ: **الملف يتبع المستخدم، لا العكس.**
//
//  1. الأعمدة تُقرأ بعناوينها لا بترتيبها. فليرتّبها كما شاء،
//     وليحذف ما لا يعرفه، وليُبقِ أعمدةً زائدة لا تخصّنا.
//  2. **رقم الوحدة وحده إلزامي.** كل ما عداه اختياري، وله قيمة
//     افتراضية تُملأ مرة واحدة لكل الملف بدل تكرارها في كل سطر.
//  3. **يُعرض قبل أن يُحفظ.** الرفع الجماعي خطأ فيه جماعي، فيرى
//     المستخدم كل صف وحالته قبل أن يلمس النظام القاعدة.
//  4. الصفوف السليمة تمرّ؛ صفٌّ خاطئ يُعرض سببه ويُستثنى وحده.
// ============================================================

type Field =
  | "code" | "type" | "location" | "status"
  | "loc1" | "loc2" | "loc3"
  | "space_m2" | "land_area_m2" | "built_area_m2"
  | "rooms" | "bathrooms" | "floors_count" | "parking_spaces"
  | "price" | "payment_plan" | "notes"
  | "view" | "balcony" | "garden_area" | "roof" | "model" | "frontage"
  | "direction" | "layout" | "barcode" | "label" | "building_type";

// مرادفات العنوان — عربية وإنجليزية، لأن الملف قد يأتي من مطوّر
// أو من إكسل مكتب المبيعات، ولا ينبغي أن يُطلب من أحدهما التنازل.
//
// loc1/loc2/loc3 مستويات الهيكل حين تأتي **أعمدةً منفصلة**: عمود
// للمبنى وآخر للطابق. تُركَّب في مسار واحد «B1 / G.FLOOR»، فملفّ
// المطوّر يُرفع كما هو بلا دمج أعمدة يدوياً.
const ALIASES: Record<Field, string[]> = {
  code: [
    "رقم الوحدة", "الرقم", "رقم", "كود", "الكود",
    "unit", "unit code", "unit no", "code", "no",
    "flat number", "flat no", "flat", "apartment", "apartment no", "apt",
  ],
  type: ["النوع", "نوع الوحدة", "type", "unit type"],
  location: ["الموقع", "المسار", "location", "path"],
  loc1: [
    "البرج", "المبنى", "المرحلة", "البلوك", "المجمع",
    "building", "building name", "tower", "block", "phase", "cluster", "zone",
  ],
  loc2: ["الطابق", "floor", "floor c", "level"],
  loc3: ["القسم", "الجناح", "wing", "section"],
  status: ["الحالة", "status"],
  space_m2: ["المساحة", "مساحة الوحدة", "المساحة م2", "المساحة الصافية", "area", "net area", "space", "size"],
  land_area_m2: ["مساحة الأرض", "الأرض", "land", "land area", "plot"],
  built_area_m2: [
    "مساحة البناء", "البناء", "المساحة الإجمالية", "المساحة الاجماليه",
    "built", "built area", "bua", "gross area", "cross area", "total area",
  ],
  rooms: ["الغرف", "عدد الغرف", "غرف النوم", "rooms", "bedrooms", "beds"],
  bathrooms: ["الحمامات", "الحمّامات", "عدد الحمامات", "bathrooms", "baths"],
  floors_count: ["عدد الطوابق", "الطوابق", "floors"],
  parking_spaces: ["المواقف", "مواقف", "عدد المواقف", "الكراج", "parking"],
  price: ["السعر", "price"],
  payment_plan: ["خطة الدفع", "الدفع", "payment plan", "plan"],
  notes: ["ملاحظات", "ملاحظة", "notes", "note", "remarks"],
  view: ["الإطلالة", "الاطلالة", "view"],
  balcony: ["شرفة", "الشرفة", "بلكونة", "balcony"],
  garden_area: ["الحديقة", "مساحة الحديقة", "garden"],
  roof: ["السطح", "التراس", "roof", "terrace"],
  model: ["الموديل", "النموذج", "model"],
  frontage: ["الواجهة", "frontage"],
  direction: ["الاتجاه", "الجهة", "direction", "orientation", "facing"],
  layout: ["التصميم", "التوزيع", "layout", "unit type c", "flat type"],
  barcode: ["الباركود", "barcode", "barcode c", "reference", "ref"],
  label: ["الاسم", "التسمية", "name", "full name", "title"],
  building_type: ["نوع المبنى", "building type"],
};

const FIELD_LABELS: Record<Field, string> = {
  code: "رقم الوحدة", type: "النوع", location: "الموقع", status: "الحالة",
  loc1: "المبنى / البرج", loc2: "الطابق", loc3: "القسم",
  space_m2: "المساحة", land_area_m2: "مساحة الأرض",
  built_area_m2: "المساحة الإجمالية",
  rooms: "الغرف", bathrooms: "الحمّامات", floors_count: "عدد الطوابق",
  parking_spaces: "المواقف", price: "السعر", payment_plan: "خطة الدفع",
  notes: "ملاحظات", view: "الإطلالة", balcony: "شرفة", garden_area: "الحديقة",
  roof: "السطح", model: "الموديل", frontage: "الواجهة",
  direction: "الاتجاه", layout: "التصميم", barcode: "الباركود",
  label: "الاسم الكامل", building_type: "نوع المبنى",
};

const JSON_FIELDS: Field[] = [
  "view", "balcony", "garden_area", "roof", "model", "frontage",
  "direction", "layout", "barcode", "label", "building_type",
];

// «2+1» = غرفتان وصالة. تُقرأ منها الغرف حين لا يوجد عمود غرف.
const LAYOUT_RE = /^\s*\d+\s*\+\s*\d+\s*$/;
const DIRECTION_RE = /^\s*(n|s|e|w|ne|nw|se|sw|شمال|جنوب|شرق|غرب)\s*$/i;

/** توحيد العنوان قبل المطابقة: مسافات مكرّرة، تشكيل، ألف بأشكالها */
function norm(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[()²_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const LOOKUP = new Map<string, Field>();
for (const [field, names] of Object.entries(ALIASES)) {
  for (const n of names) LOOKUP.set(norm(n), field as Field);
}

/** مقسّم CSV يحترم علامات الاقتباس، فالملاحظة التي فيها فاصلة لا تُشقّ */
function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** إكسل العربي يحفظ بالفاصلة المنقوطة أحياناً، وأخرى بالتبويب */
function detectDelimiter(header: string): string {
  const counts: [string, number][] = [
    [",", (header.match(/,/g) ?? []).length],
    [";", (header.match(/;/g) ?? []).length],
    ["\t", (header.match(/\t/g) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

type Row = {
  line: number;
  values: Partial<Record<Field, string>>;
  nodeId: string | null;
  newPath: string | null;   // مستوى سيُنشأ إن وُوفق على ذلك
  error: string | null;
};

export default function UnitsImporter({
  projectId,
  nodes,
  structureKinds,
  unitTypes,
  existingCodes: existingCodeList,
  isAdmin,
}: {
  projectId: string;
  nodes: ProjectNode[];
  structureKinds: string[];
  unitTypes: UnitTypeRow[];
  existingCodes: string[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [rows, setRows] = useState<Row[]>([]);
  const [mapped, setMapped] = useState<Field[]>([]);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<string | null>(null);

  // القيم الافتراضية: تُملأ مرة لكل الملف بدل تكرارها في كل سطر
  const [defType, setDefType] = useState(unitTypes[0]?.name ?? "شقة");
  const [defLocation, setDefLocation] = useState("");
  const [defStatus, setDefStatus] = useState("متاحة");
  const [defPrice, setDefPrice] = useState("");
  const [autoCreate, setAutoCreate] = useState(true);

  const typeNames = useMemo(() => new Set(unitTypes.map((t) => t.name)), [unitTypes]);
  // التكرار يُكتشف قبل الرفع: الرقم الموجود في المشروع يُرفض صفّه
  // وحده بدل أن يفشل الطلب كله عند القاعدة.
  const existingCodes = useMemo(
    () => new Set(existingCodeList),
    [existingCodeList],
  );

  function resolveLocation(path: string): { nodeId: string | null; newPath: string | null; error: string | null } {
    if (!path) return { nodeId: null, newPath: null, error: null };

    const exact = nodes.find((n) => n.path === path);
    if (exact) return { nodeId: exact.id, newPath: null, error: null };

    const byName = nodes.filter((n) => n.name === path);
    if (byName.length === 1) return { nodeId: byName[0].id, newPath: null, error: null };
    if (byName.length > 1) {
      return { nodeId: null, newPath: null, error: `«${path}» يطابق أكثر من مستوى — اكتب المسار كاملاً` };
    }

    // غير موجود: يُنشأ لاحقاً إن وافق المستخدم
    return {
      nodeId: null,
      newPath: path,
      error: null,
    };
  }

  function parse(text: string) {
    const lines = text
      .replace(/^﻿/, "")            // BOM من إكسل
      .split(/\r?\n/)
      .filter((l) => l.trim() !== "");

    if (lines.length < 2) {
      setRows([]);
      setMapped([]);
      setResult("الملف فارغ أو فيه سطر العناوين فقط.");
      return;
    }

    const delim = detectDelimiter(lines[0]);
    const headers = splitLine(lines[0], delim);
    const body = lines.slice(1).map((l) => splitLine(l, delim));

    // العمود → الحقل، والعناوين المجهولة تُتجاهل بلا ضجيج
    const colField: (Field | null)[] = headers.map((h) => LOOKUP.get(norm(h)) ?? null);

    // ============================================================
    // العنوان يكذب أحياناً، فنسأل المحتوى.
    //
    // «Type_» في ملفات المطوّرين ليست نوع الوحدة بل تصميمها (2+1)،
    // و«Location_» ليست الموقع في المشروع بل اتجاه الشقة (SE).
    // لو صدّقنا العنوان لرُفض الملف كله بخطأ «نوع غير معروف».
    // فنفحص أول القيم: إن لم يطابق أيٌّ منها نوعاً معروفاً وبدت
    // أنماطاً معروفة، نُعيد تعيين العمود لما هو فعلاً.
    // ============================================================
    const sample = (idx: number) =>
      body
        .map((c) => (c[idx] ?? "").trim())
        .filter((v) => v !== "")
        .slice(0, 25);

    const looksLike = (vals: string[], re: RegExp) =>
      vals.length > 0 && vals.filter((v) => re.test(v)).length >= vals.length * 0.7;

    colField.forEach((f, idx) => {
      const vals = sample(idx);
      if (f === "type" && !vals.some((v) => typeNames.has(v)) && looksLike(vals, LAYOUT_RE)) {
        colField[idx] = "layout";
      } else if (f === "location" && looksLike(vals, DIRECTION_RE)) {
        colField[idx] = "direction";
      }
    });

    const found = colField.filter(Boolean) as Field[];
    const unknown = headers.filter((_, i) => colField[i] === null && headers[i] !== "");

    if (!found.includes("code")) {
      setRows([]);
      setMapped([]);
      setIgnored(unknown);
      setResult(
        "لم نجد عمود رقم الوحدة. سمِّ العمود «رقم الوحدة» أو «الكود» أو «رقم الشقة» أو «code».",
      );
      return;
    }

    // رقم الشقة يتكرّر بين المباني (01 في B1 و01 في B2)، فالتفرّد
    // يُقاس داخل الموقع لا في المشروع كله.
    const seen = new Set<string>();
    const parsed: Row[] = [];

    for (let i = 0; i < body.length; i++) {
      const cells = body[i];
      const values: Partial<Record<Field, string>> = {};
      colField.forEach((f, idx) => {
        if (f && cells[idx]) values[f] = cells[idx].trim();
      });

      // المسار: عمود جاهز، أو تركيب من أعمدة المستويات، أو الافتراضي
      const composed = [values.loc1, values.loc2, values.loc3]
        .filter((v) => v && v !== "")
        .join(" / ");
      const location = values.location ?? (composed || defLocation);

      // الغرف من التصميم حين لا يوجد عمود غرف: «3+1» ⇒ 3
      if (!values.rooms && values.layout && LAYOUT_RE.test(values.layout)) {
        values.rooms = values.layout.split("+")[0].trim();
      }

      const row: Row = {
        line: i + 2,
        values,
        nodeId: null,
        newPath: null,
        error: null,
      };
      const code = values.code ?? "";
      const type = values.type ?? defType;
      const status = values.status ?? defStatus;
      const dupKey = `${location} ${code}`;

      if (!code) row.error = "رقم الوحدة مفقود";
      else if (seen.has(dupKey)) row.error = "رقم مكرّر في نفس الموقع";
      else if (existingCodes.has(dupKey)) row.error = "رقم موجود في هذا الموقع";
      else if (type && !typeNames.has(type)) row.error = `نوع غير معروف: ${type}`;
      else if (status && !(UNIT_STATUS_LIST as readonly string[]).includes(status))
        row.error = `حالة غير معروفة: ${status}`;
      else {
        const r = resolveLocation(location);
        row.nodeId = r.nodeId;
        row.newPath = r.newPath;
        row.error = r.error;
      }

      // المسار المحسوب يُحفظ ليُعرض في المعاينة ويُستعمل عند الرفع
      values.location = location || undefined;

      if (!row.error) seen.add(dupKey);
      parsed.push(row);
    }

    setRows(parsed);
    setMapped(Array.from(new Set(found)));
    setIgnored(unknown);
    setResult(null);
  }

  /**
   * المستويات الناقصة التي سيُنشئها الرفع — **بترتيب ظهورها في
   * الملف** لا أبجدياً، فالطابق الأرضي يأتي أوّلاً في ملفّ المطوّر
   * بينما ترتيبه الأبجدي («G.FLOOR») يضعه بعد «5TH.FLOOR».
   */
  const missingPaths = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of rows) {
      if (!r.error && r.newPath && !seen.has(r.newPath)) {
        seen.add(r.newPath);
        out.push(r.newPath);
      }
    }
    return out;
  }, [rows]);

  /** ينشئ مستوى بمساره، ويعيد معرّفه — ينشئ الآباء الناقصين في طريقه */
  async function ensureNode(
    path: string,
    cache: Map<string, string>,
    orderCounter: Map<string, number>,
  ): Promise<string> {
    if (cache.has(path)) return cache.get(path) as string;

    const parts = path.split("/").map((p) => p.trim()).filter(Boolean);
    let parentId: string | null = null;
    let sofar = "";

    for (let depth = 0; depth < parts.length; depth++) {
      sofar = sofar ? `${sofar} / ${parts[depth]}` : parts[depth];
      if (cache.has(sofar)) {
        parentId = cache.get(sofar) as string;
        continue;
      }

      const existing = nodes.find((n) => n.path === sofar);
      if (existing) {
        cache.set(sofar, existing.id);
        parentId = existing.id;
        continue;
      }

      // النوع من قالب المشروع، وإلا تخمين معقول حسب العمق
      const kind =
        structureKinds[depth] ??
        (parts.length > 1 ? (depth === 0 ? "برج" : "طابق") : "مرحلة");

      // الترتيب يتبع ظهور المستوى في الملف: الطابق الأرضي أوّلاً
      // لأنه أوّل سطر عند المطوّر، لا لأن حرفه أسبق.
      const parentKey = parentId ?? "root";
      const order = (orderCounter.get(parentKey) ?? 0) + 1;
      orderCounter.set(parentKey, order);

      // النتيجة تُقرأ عبر متغيّر مُعنون: تفكيكها مباشرةً داخل دالة
      // تُبنى قيمتها من نفسها يجعل TypeScript يدور في حلقة استنتاج.
      const res = await supabase
        .from("project_nodes")
        .insert({
          project_id: projectId,
          parent_id: parentId,
          kind,
          name: parts[depth],
          sort_order: order,
        })
        .select("id")
        .single();

      const created = res.data as { id: string } | null;
      if (res.error || !created) {
        throw new Error(`تعذّر إنشاء «${sofar}»: ${res.error?.message ?? ""}`);
      }
      cache.set(sofar, created.id);
      parentId = created.id;
    }

    return parentId as string;
  }

  async function save() {
    const good = rows.filter((r) => !r.error);
    if (good.length === 0) return;

    setSaving(true);
    setResult(null);

    const cache = new Map<string, string>();
    const orderCounter = new Map<string, number>();

    // 1) المستويات الناقصة أولاً، فالوحدة لا تُوضع في مكان غير موجود
    if (autoCreate && missingPaths.length > 0) {
      setProgress(`إنشاء ${missingPaths.length} مستوى…`);
      try {
        for (const p of missingPaths) await ensureNode(p, cache, orderCounter);
      } catch (e) {
        setSaving(false);
        setProgress("");
        setResult(e instanceof Error ? e.message : "تعذّر إنشاء المستويات.");
        return;
      }
    }

    // 2) الوحدات
    const payload = good.map((r) => {
      const v = r.values;
      const num = (f: Field) => {
        const raw = v[f];
        if (!raw) return null;
        const n = Number(String(raw).replace(/,/g, ""));
        return Number.isFinite(n) ? n : null;
      };

      const attrs: Record<string, string> = {};
      for (const f of JSON_FIELDS) if (v[f]) attrs[f] = v[f] as string;

      const nodeId =
        r.nodeId ?? (r.newPath ? cache.get(r.newPath) ?? null : null);

      const row: Record<string, unknown> = {
        project_id: projectId,
        node_id: nodeId,
        unit_code: v.code,
        unit_type: v.type ?? defType,
        status: v.status ?? defStatus,
        space_m2: num("space_m2"),
        land_area_m2: num("land_area_m2"),
        built_area_m2: num("built_area_m2"),
        rooms: num("rooms"),
        bathrooms: num("bathrooms"),
        floors_count: num("floors_count"),
        parking_spaces: num("parking_spaces"),
        payment_plan: v.payment_plan ?? null,
        notes: v.notes ?? null,
        attrs,
      };

      // السعر للمدير وحده — والقاعدة ترفضه من غيره بمحفّز
      if (isAdmin) {
        row.price = num("price") ?? (defPrice ? Number(defPrice) : null);
      }
      return row;
    });

    // على دفعات: طلب واحد بألف صف يسقط على المهلة
    let done = 0;
    for (let i = 0; i < payload.length; i += 200) {
      const chunk = payload.slice(i, i + 200);
      setProgress(`رفع ${done + chunk.length} من ${payload.length}…`);
      const { error } = await supabase.from("units").insert(chunk);
      if (error) {
        setSaving(false);
        setProgress("");
        setResult(
          `توقّف بعد ${done} وحدة — ${error.message}. الوحدات المحفوظة قبل التوقّف باقية.`,
        );
        router.refresh();
        return;
      }
      done += chunk.length;
    }

    setSaving(false);
    setProgress("");
    setResult(`تم رفع ${done} وحدة ✓`);
    setRows([]);
    router.refresh();
  }

  const ok = rows.filter((r) => !r.error).length;
  const bad = rows.length - ok;
  const blockedByNodes = !autoCreate && missingPaths.length > 0;

  // نموذج بأعمدة منفصلة للمبنى والطابق — شكل ملفات المطوّرين
  const template =
    "Building_,Floor__c,Flat_Number_,Location_,Type_,Area_,Cross_Area,BarCode__c,Name\n" +
    "B1,G.FLOOR,01,SE,2+1,158,187,B1.G.FLOOR.1,B1-G.FLOOR-APT1-Type2+1-187M-SE\n" +
    "B1,G.FLOOR,02,SW,2+1,158,187,B1.G.FLOOR.2,B1-G.FLOOR-APT2-Type2+1-187M-SW\n" +
    "B1,1FS.FLOOR,11,SE,3+1,192,227,B1.1FS.FLOOR.11,B1-1FS.FLOOR-APT11-Type3+1-227M-SE\n" +
    "B1,1FS.FLOOR,12,SW,2+1,158,187,B1.1FS.FLOOR.12,B1-1FS.FLOOR-APT12-Type2+1-187M-SW";

  // نموذج عربي بمسار واحد جاهز
  const arabicTemplate =
    "رقم الوحدة,الموقع,النوع,المساحة,الغرف,الحمامات,السعر,ملاحظات\n" +
    "101,برج A / الطابق 01,شقة,120,3,2,250000000,\n" +
    "102,برج A / الطابق 01,شقة,95,2,1,190000000,زاوية\n" +
    "201,برج A / الطابق 02,شقة,120,3,2,255000000,";

  const minimalTemplate = "رقم الوحدة\n101\n102\n103\n104";

  const input =
    "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

  return (
    <div className="max-w-5xl space-y-5">
      {/* الشرح */}
      <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm text-gray-700">
        <b className="text-blue-800">عمود واحد يكفي.</b> الإلزامي هو{" "}
        <b>رقم الوحدة</b> فقط، وكل ما عداه اختياري — ما تتركه يأخذ القيمة
        الافتراضية التي تحدّدها أدناه.
        <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-gray-600">
          <li>
            <b>الترتيب حرّ.</b> نقرأ الأعمدة بعناوينها لا بمواضعها، والعمود الذي
            لا نعرفه نتجاهله بلا خطأ.
          </li>
          <li>
            <b>المبنى والطابق عمودان منفصلان — أو مسار واحد.</b> ملفّ المطوّر
            الذي فيه <span dir="ltr">Building_</span> و
            <span dir="ltr">Floor__c</span> يُرفع كما هو، ونركّب منهما «B1 /
            G.FLOOR». وإن كان عندك عمود «الموقع» بالمسار كاملاً فهو يكفي وحده.
          </li>
          <li>
            <b>نسأل المحتوى حين يكذب العنوان.</b> عمود اسمه{" "}
            <span dir="ltr">Type_</span> قيمته <span dir="ltr">2+1</span> ليس
            نوع وحدة بل تصميمها، و<span dir="ltr">Location_</span> قيمته{" "}
            <span dir="ltr">SE</span> ليست موقعاً بل اتجاهاً — نفهمها كذلك بلا
            أن تعدّل شيئاً. ونشتقّ عدد الغرف من «3+1».
          </li>
          <li>
            <b>الأسماء مرنة.</b> «رقم الوحدة» أو «رقم الشقة» أو{" "}
            <span dir="ltr">Flat_Number_</span>، و«الغرف» أو{" "}
            <span dir="ltr">bedrooms</span> — كلها تُقبل.
          </li>
          <li>
            <b>الفاصل.</b> فاصلة أو فاصلة منقوطة أو تبويب — نكتشفه وحدنا.
          </li>
          <li>
            <b>الأعمدة المفهومة:</b> {Object.values(FIELD_LABELS).join("، ")}.
          </li>
        </ul>

        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href={"data:text/csv;charset=utf-8,%EF%BB%BF" + encodeURIComponent(template)}
            download="نموذج-مبنى-وطابق.csv"
            className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-blue-800 shadow-sm hover:bg-blue-100"
          >
            نموذج بأعمدة المبنى والطابق
          </a>
          <a
            href={"data:text/csv;charset=utf-8,%EF%BB%BF" + encodeURIComponent(arabicTemplate)}
            download="نموذج-عربي.csv"
            className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-blue-800 shadow-sm hover:bg-blue-100"
          >
            نموذج عربي
          </a>
          <a
            href={"data:text/csv;charset=utf-8,%EF%BB%BF" + encodeURIComponent(minimalTemplate)}
            download="نموذج-مبسّط.csv"
            className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-blue-800 shadow-sm hover:bg-blue-100"
          >
            نموذج مبسّط (رقم الوحدة فقط)
          </a>
        </div>
      </div>

      {/* القيم الافتراضية */}
      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="mb-1 text-sm font-bold text-gray-700">
          القيم الافتراضية
        </h2>
        <p className="mb-4 text-xs text-gray-500">
          تُطبَّق على كل صف لا يحمل العمود أو يتركه فارغاً — فبرج كامل من نوع
          واحد لا يحتاج تكرار النوع في كل سطر.
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              النوع
            </label>
            <select
              value={defType}
              onChange={(e) => setDefType(e.target.value)}
              className={input}
            >
              {unitTypes.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              الموقع
            </label>
            <select
              value={defLocation}
              onChange={(e) => setDefLocation(e.target.value)}
              className={input}
            >
              <option value="">خارج الهيكل</option>
              {nodes.map((n) => (
                <option key={n.id} value={n.path}>
                  {n.path}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              الحالة
            </label>
            <select
              value={defStatus}
              onChange={(e) => setDefStatus(e.target.value)}
              className={input}
            >
              {UNIT_STATUS_LIST.filter((s) => s !== "محجوزة" && s !== "مباعة").map(
                (s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ),
              )}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              السعر {isAdmin ? "" : "(للمدير)"}
            </label>
            <input
              value={defPrice}
              onChange={(e) => setDefPrice(e.target.value)}
              type="number"
              min={0}
              dir="ltr"
              disabled={!isAdmin}
              placeholder="اختياري"
              className={input + (isAdmin ? "" : " bg-gray-100 text-gray-500")}
            />
          </div>
        </div>

        <label className="mt-4 flex items-start gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={autoCreate}
            onChange={(e) => setAutoCreate(e.target.checked)}
            className="mt-0.5 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
          />
          <span>
            أنشئ المستويات الناقصة تلقائياً
            <span className="block text-xs text-gray-500">
              الموقع «برج B / الطابق 03» غير الموجود يُنشأ بدل أن يُرفض — فلا
              تحتاج بناء الهيكل يدوياً قبل الرفع.
            </span>
          </span>
        </label>
      </div>

      {/* الملف */}
      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <label className="mb-1 block text-xs font-medium text-gray-600">
          ملف CSV
        </label>
        <input
          type="file"
          accept=".csv,text/csv,.txt"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setFileName(f.name);
            const reader = new FileReader();
            reader.onload = () => parse(String(reader.result ?? ""));
            reader.readAsText(f, "utf-8");
          }}
          className="w-full rounded-lg border border-gray-300 p-2 text-sm file:me-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-brand-700"
        />

        {fileName && mapped.length > 0 && (
          <div className="mt-3 space-y-1 text-xs">
            <p className="text-gray-600">
              {fileName} — {rows.length} صفّاً،{" "}
              <b className="text-green-700">{ok} صالح</b>
              {bad > 0 && <span className="text-red-600">، {bad} به خطأ</span>}
            </p>
            <p className="text-gray-500">
              قُرئت الأعمدة:{" "}
              {mapped.map((f) => FIELD_LABELS[f]).join("، ")}
            </p>
            {ignored.length > 0 && (
              <p className="text-gray-400">
                تُجوهلت أعمدة لا نعرفها: {ignored.join("، ")}
              </p>
            )}
          </div>
        )}
      </div>

      {/* المستويات التي ستُنشأ */}
      {missingPaths.length > 0 && (
        <div
          className={
            autoCreate
              ? "rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-gray-700"
              : "rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-gray-700"
          }
        >
          {autoCreate ? (
            <>
              <b className="text-amber-800">
                سيُنشأ {missingPaths.length} مستوى جديد:
              </b>{" "}
              {missingPaths.slice(0, 12).join("، ")}
              {missingPaths.length > 12 && ` … و${missingPaths.length - 12} غيرها`}
            </>
          ) : (
            <>
              <b className="text-red-800">مواقع غير موجودة في الهيكل:</b>{" "}
              {missingPaths.slice(0, 8).join("، ")} — فعّل «أنشئ المستويات الناقصة»
              أو أنشئها من صفحة الهيكل أولاً.
            </>
          )}
        </div>
      )}

      {/* المعاينة */}
      {rows.length > 0 && (
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full min-w-[760px] text-start text-sm">
              <thead className="sticky top-0 border-b bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">#</th>
                  <th className="px-3 py-2 text-start font-medium">رقم الوحدة</th>
                  <th className="px-3 py-2 text-start font-medium">النوع</th>
                  <th className="px-3 py-2 text-start font-medium">الموقع</th>
                  <th className="px-3 py-2 text-start font-medium">المساحة</th>
                  <th className="px-3 py-2 text-start font-medium">السعر</th>
                  <th className="px-3 py-2 text-start font-medium">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.line}
                    className={
                      r.error
                        ? "border-b bg-red-50 last:border-0"
                        : "border-b last:border-0"
                    }
                  >
                    <td className="px-3 py-2 text-gray-400">{r.line}</td>
                    <td className="px-3 py-2 font-medium text-gray-800">
                      {r.values.code || "—"}
                    </td>
                    <td className="px-3 py-2 text-gray-600">
                      {r.values.type ?? (
                        <span className="text-gray-400">{defType}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-600">
                      {r.values.location ?? (
                        <span className="text-gray-400">
                          {defLocation || "خارج الهيكل"}
                        </span>
                      )}
                      {r.newPath && autoCreate && (
                        <span className="ms-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">
                          جديد
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-600" dir="ltr">
                      {r.values.space_m2 || "—"}
                    </td>
                    <td className="px-3 py-2 text-gray-600" dir="ltr">
                      {r.values.price ?? (
                        <span className="text-gray-400">{defPrice || "—"}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {r.error ? (
                        <span className="text-xs font-medium text-red-700">
                          {r.error}
                        </span>
                      ) : (
                        <span className="text-xs font-medium text-green-700">
                          جاهز
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-gray-50 px-4 py-3">
            <p className="text-sm text-gray-600">
              سيُرفع <b className="text-green-700">{ok}</b> وحدة
              {bad > 0 && (
                <>
                  ، ويُستثنى <b className="text-red-700">{bad}</b> صفّاً به خطأ
                </>
              )}
              .
            </p>
            <button
              onClick={save}
              disabled={saving || ok === 0 || blockedByNodes}
              className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
            >
              {saving ? progress || "جارٍ الرفع…" : `رفع ${ok} وحدة`}
            </button>
          </div>
        </div>
      )}

      {result && (
        <p
          className={`rounded-lg p-3 text-sm ${
            result.includes("✓")
              ? "bg-green-50 text-green-700"
              : "bg-red-50 text-red-700"
          }`}
        >
          {result}
        </p>
      )}
    </div>
  );
}
