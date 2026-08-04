"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { CompanySettings, formatDistance } from "@/lib/types";

// ============================================================
// ضبط موقع مركز المبيعات ونطاق البصمة المسموح.
// أسهل طريقة: اذهب إلى المركز افتح هذي الصفحة واضغط «استخدم موقعي الحالي».
// ============================================================
export default function OfficeLocation({
  settings,
}: {
  settings: CompanySettings | null;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [name, setName] = useState(settings?.office_name ?? "مركز المبيعات");
  const [lat, setLat] = useState(settings?.office_lat?.toString() ?? "");
  const [lng, setLng] = useState(settings?.office_lng?.toString() ?? "");
  const [radius, setRadius] = useState(String(settings?.geofence_radius_m ?? 1000));
  const [enabled, setEnabled] = useState(settings?.geofence_enabled ?? true);

  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function useMyLocation() {
    setMsg(null);
    if (!("geolocation" in navigator)) {
      setMsg({ kind: "err", text: "متصفحك لا يدعم تحديد الموقع." });
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
        setLocating(false);
        setMsg({
          kind: "ok",
          text: `تم أخذ موقعك الحالي (دقة ±${Math.round(pos.coords.accuracy)} متر). اضغط حفظ لتثبيته.`,
        });
      },
      (err) => {
        setLocating(false);
        setMsg({
          kind: "err",
          text:
            err.code === 1
              ? "رفضت إعطاء إذن الموقع. اسمح بالوصول للموقع من إعدادات المتصفح."
              : "تعذّر تحديد موقعك. تأكد أن خدمة الموقع مفعّلة.",
        });
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  async function save() {
    setMsg(null);
    const latN = Number(lat);
    const lngN = Number(lng);
    const radN = Number(radius);

    if (!lat || !lng || Number.isNaN(latN) || Number.isNaN(lngN)) {
      setMsg({ kind: "err", text: "حدّد موقع المركز أولاً." });
      return;
    }
    if (latN < -90 || latN > 90 || lngN < -180 || lngN > 180) {
      setMsg({ kind: "err", text: "الإحداثيات غير صحيحة." });
      return;
    }
    if (!radN || radN < 50) {
      setMsg({ kind: "err", text: "النطاق يجب أن يكون 50 متراً على الأقل." });
      return;
    }

    setSaving(true);
    const { error } = await supabase
      .from("company_settings")
      .update({
        office_name: name.trim() || "مركز المبيعات",
        office_lat: latN,
        office_lng: lngN,
        geofence_radius_m: Math.round(radN),
        geofence_enabled: enabled,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);
    setSaving(false);

    if (error) {
      setMsg({ kind: "err", text: "تعذّر الحفظ: " + error.message });
      return;
    }
    setMsg({ kind: "ok", text: "تم الحفظ ✓" });
    router.refresh();
  }

  const input =
    "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";
  const label = "mb-1.5 block text-sm font-medium text-gray-700";

  const mapUrl =
    lat && lng ? `https://www.google.com/maps?q=${lat},${lng}` : null;

  return (
    <div className="rounded-2xl border bg-white p-6 shadow-sm">
      <h3 className="text-lg font-bold text-gray-800">📍 موقع البصمة</h3>
      <p className="mt-1 text-sm text-gray-500">
        الموظف ما يقدر يسجّل حضوره إلا إذا كان داخل النطاق المحدّد حول مركز المبيعات.
        التحقّق يتم داخل قاعدة البيانات، فما ينفع التحايل عليه من الجوال.
      </p>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={label}>اسم الموقع</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={input}
            placeholder="مركز المبيعات"
          />
        </div>

        <div>
          <label className={label}>خط العرض (Latitude)</label>
          <input
            type="text"
            dir="ltr"
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            className={input + " text-left"}
            placeholder="33.312805"
          />
        </div>
        <div>
          <label className={label}>خط الطول (Longitude)</label>
          <input
            type="text"
            dir="ltr"
            value={lng}
            onChange={(e) => setLng(e.target.value)}
            className={input + " text-left"}
            placeholder="44.361488"
          />
        </div>

        <div>
          <label className={label}>النطاق المسموح (بالمتر)</label>
          <input
            type="number"
            min="50"
            step="50"
            dir="ltr"
            value={radius}
            onChange={(e) => setRadius(e.target.value)}
            className={input + " text-left"}
          />
          <p className="mt-1 text-xs text-gray-400">
            1000 متر = 1 كيلومتر
            {Number(radius) > 0 && ` (حالياً ${formatDistance(Number(radius))})`}
          </p>
        </div>

        <div className="flex items-end">
          <label className="flex cursor-pointer items-center gap-2 pb-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-4 w-4 accent-brand-600"
            />
            تفعيل تقييد البصمة بالموقع
          </label>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          onClick={useMyLocation}
          disabled={locating}
          className="rounded-lg border border-brand-500 px-4 py-2 text-sm font-semibold text-brand-700 transition hover:bg-brand-50 disabled:opacity-50"
        >
          {locating ? "جارٍ تحديد موقعك..." : "📍 استخدم موقعي الحالي"}
        </button>
        {mapUrl && (
          <a
            href={mapUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-50"
          >
            عرض على الخريطة
          </a>
        )}
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-brand-600 px-6 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? "جارٍ الحفظ..." : "حفظ"}
        </button>
      </div>

      {msg && (
        <p
          className={`mt-3 rounded-lg px-4 py-3 text-sm ${
            msg.kind === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
          }`}
        >
          {msg.text}
        </p>
      )}

      <div className="mt-4 rounded-xl bg-gray-50 p-4 text-xs leading-relaxed text-gray-500">
        <b className="text-gray-700">أسهل طريقة:</b> روح لمركز المبيعات، افتح هذي الصفحة من
        جوالك، اضغط «استخدم موقعي الحالي» ثم «حفظ». بديل: افتح Google Maps، اضغط مطوّلاً على
        موقع المركز، وانسخ الرقمين اللي يظهرون والصقهم بالحقلين أعلاه.
      </div>
    </div>
  );
}
