"use client";

import { useState } from "react";
import { fmtMetric, type MetricUnit } from "@/lib/report-engine";

// ============================================================
// الاتجاه يوماً بيوم (§25) — رسمٌ صغير لكل مقياس، لا خطوط متعدّدة
// على محور واحد: «مكالمات» بالمئات و«فوز» بالآحاد على محورٍ واحد
// تُسطِّح الثاني إلى صفر، ومحوران يكذبان. فكل مقياس رسمه بمقياسه.
//
// سلسلة واحدة في كل رسم ← لا مفتاح ألوان (العنوان يسمّيها).
// خطّ ٢px بلون العلامة، وغسلٌ خفيف تحته، والقيمة الأخيرة مكتوبة.
// الخطّ العمودي يتبع المؤشّر ويقفز إلى أقرب يوم، والتلميح يعرض القيمة
// — وكذلك بلوحة المفاتيح (السهمان). و«جدول» يعرض كل الأرقام بلا تحويم.
// ============================================================

type Point = { key: string; label: string; value: number | null };
type Series = { code: string; name: string; unit: MetricUnit; points: Point[] };

const W = 320;
const H = 96;
const PAD = { top: 10, right: 8, bottom: 18, left: 8 };
const INK = "#064e3b";     // brand-600 — ≥ ٧:١ على الأبيض
const WASH = "#10b981";    // brand-500 بشفافية ١٠٪ — غسلٌ لا علامة

export default function TrendCharts({ series, grain, print }: { series: Series[]; grain: string; print?: boolean }) {
  const [table, setTable] = useState(false);
  if (series.length === 0 || series[0].points.length === 0) {
    return <p className="py-6 text-center text-sm text-gray-400">لا بيانات في هذا المدى.</p>;
  }
  return (
    <div>
      {!print && (
        <div className="mb-2 flex justify-end">
          <button type="button" onClick={() => setTable((t) => !t)} className="text-xs text-brand-700 hover:underline">
            {table ? "عرض الرسوم" : "عرض كجدول"}
          </button>
        </div>
      )}
      {table ? <TrendTable series={series} /> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {series.map((s) => <SmallMultiple key={s.code} s={s} grain={grain} />)}
        </div>
      )}
    </div>
  );
}

function SmallMultiple({ s, grain }: { s: Series; grain: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const pts = s.points;
  const vals = pts.map((p) => p.value ?? 0);
  const max = Math.max(1, ...vals);
  const n = pts.length;
  const x = (i: number) => PAD.left + (n === 1 ? (W - PAD.left - PAD.right) / 2 : (i / (n - 1)) * (W - PAD.left - PAD.right));
  const y = (v: number) => PAD.top + (1 - v / max) * (H - PAD.top - PAD.bottom);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value ?? 0).toFixed(1)}`).join(" ");
  const area = `${path} L${x(n - 1).toFixed(1)},${H - PAD.bottom} L${x(0).toFixed(1)},${H - PAD.bottom} Z`;
  const last = pts[n - 1];
  const total = s.unit === "count" || s.unit === "money" ? vals.reduce((a, b) => a + b, 0) : null;

  // الرسم من اليمين (الأقدم) إلى اليسار؟ لا: المحور الزمني يقرأ من اليسار إلى اليمين
  // حتى في العربية (كما في كل تقويم مطبوع) — فالرسم dir="ltr".
  const pick = (clientX: number, rect: DOMRect) => {
    const px = ((clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - PAD.left) / (W - PAD.left - PAD.right)) * (n - 1));
    setHover(Math.min(n - 1, Math.max(0, i)));
  };

  const hp = hover !== null ? pts[hover] : null;

  return (
    <figure className="rounded-lg border border-gray-100 p-3">
      <figcaption className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-gray-800">{s.name}</span>
        {total !== null && <span className="text-xs tabular-nums text-gray-500">المجموع {fmtMetric(total, s.unit)}</span>}
      </figcaption>
      <div className="relative mt-1" dir="ltr">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-24 w-full touch-none outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
          role="img"
          aria-label={`${s.name}: ${pts.map((p) => `${p.label} ${p.value ?? 0}`).join("، ")}`}
          tabIndex={0}
          onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerLeave={() => setHover(null)}
          onFocus={() => setHover(n - 1)}
          onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? n - 1) - 1));
            if (e.key === "ArrowRight") setHover((h) => Math.min(n - 1, (h ?? n - 1) + 1));
          }}
        >
          {/* الخطّ الأساس — شعرة رمادية */}
          <line x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} stroke="#e5e7eb" strokeWidth={1} />
          <path d={area} fill={WASH} opacity={0.1} />
          <path d={path} fill="none" stroke={INK} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {/* النقطة الأخيرة بحلقة من لون السطح */}
          <circle cx={x(n - 1)} cy={y(last.value ?? 0)} r={4} fill={INK} stroke="#fff" strokeWidth={2} />
          {/* تسميتا الطرفين على المحور */}
          <text x={PAD.left} y={H - 4} fontSize={9} fill="#6b7280">{pts[0].label}</text>
          <text x={W - PAD.right} y={H - 4} fontSize={9} fill="#6b7280" textAnchor="end">{last.label}</text>
          {hover !== null && (
            <>
              <line x1={x(hover)} x2={x(hover)} y1={PAD.top - 4} y2={H - PAD.bottom} stroke="#9ca3af" strokeWidth={1} />
              <circle cx={x(hover)} cy={y(pts[hover].value ?? 0)} r={4} fill={INK} stroke="#fff" strokeWidth={2} />
            </>
          )}
        </svg>
        {/* القيمة الأخيرة — تسمية واحدة لا رقم على كل نقطة */}
        {hover === null && (
          <span className="pointer-events-none absolute right-0 top-0 rounded bg-white/90 px-1 text-xs font-semibold tabular-nums text-gray-900">
            {fmtMetric(last.value, s.unit)}
          </span>
        )}
        {hp && (
          <div
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded border border-gray-200 bg-white px-2 py-1 text-xs shadow"
            style={{ left: `${(x(hover!) / W) * 100}%` }}
          >
            <b className="tabular-nums text-gray-900">{fmtMetric(hp.value, s.unit)}</b>
            <span className="ms-1 text-gray-500">{hp.label}</span>
          </div>
        )}
      </div>
      <span className="sr-only">{grain}</span>
    </figure>
  );
}

function TrendTable({ series }: { series: Series[] }) {
  const keys = series[0].points;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-right text-xs">
        <thead className="bg-gray-50 text-gray-500">
          <tr>
            <th className="px-2 py-1.5 font-medium">الفترة</th>
            {series.map((s) => <th key={s.code} className="px-2 py-1.5 font-medium">{s.name}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {keys.map((p, i) => (
            <tr key={p.key}>
              <td className="whitespace-nowrap px-2 py-1 text-gray-700">{p.label}</td>
              {series.map((s) => <td key={s.code} className="px-2 py-1 tabular-nums">{fmtMetric(s.points[i]?.value ?? null, s.unit)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
