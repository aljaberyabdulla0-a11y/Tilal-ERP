"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  Attendance,
  CompanySettings,
  distanceMeters,
  formatDistance,
  formatTime,
} from "@/lib/types";

type GeoState =
  | { status: "idle" }
  | { status: "locating" }
  | { status: "ok"; lat: number; lng: number; distance: number | null }
  | { status: "error"; message: string };

// ============================================================
// تسجيل البصمة مع التحقّق من الموقع.
// المتصفح يعطينا الإحداثيات، ونعرض للموظف بعده عن مركز المبيعات،
// وقاعدة البيانات ترفض أي بصمة خارج النطاق (لا يمكن التحايل).
// ============================================================
export default function CheckInOut({
  employeeId,
  todayRecord,
  settings,
}: {
  employeeId: string;
  todayRecord: Attendance | null;
  settings: CompanySettings | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [geo, setGeo] = useState<GeoState>({ status: "idle" });
  const [error, setError] = useState<string | null>(null);

  // التاريخ المحلي (وليس UTC) حتى لا يختلف اليوم بعد منتصف الليل
  const today = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
  })();

  const geofenceOn =
    !!settings?.geofence_enabled &&
    settings.office_lat != null &&
    settings.office_lng != null;

  // جلب الموقع الحالي من المتصفح
  const locate = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setGeo({ status: "error", message: "متصفحك لا يدعم تحديد الموقع." });
      return;
    }
    setGeo({ status: "locating" });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        const distance =
          geofenceOn && settings
            ? distanceMeters(lat, lng, settings.office_lat!, settings.office_lng!)
            : null;
        setGeo({ status: "ok", lat, lng, distance });
      },
      (err) => {
        const messages: Record<number, string> = {
          1: "رفضت إعطاء الإذن بالموقع. افتح إعدادات المتصفح واسمح بالوصول للموقع لهذا الموقع، ثم أعد المحاولة.",
          2: "تعذّر تحديد موقعك. تأكد أن خدمة الموقع (GPS) مفعّلة في جهازك.",
          3: "استغرق تحديد الموقع وقتاً طويلاً. جرّب مرة ثانية.",
        };
        setGeo({
          status: "error",
          message: messages[err.code] ?? "تعذّر تحديد موقعك.",
        });
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }, [geofenceOn, settings]);

  // نحدّد الموقع تلقائياً عند فتح الصفحة
  useEffect(() => {
    locate();
  }, [locate]);

  const outOfRange =
    geofenceOn &&
    geo.status === "ok" &&
    geo.distance != null &&
    geo.distance > (settings?.geofence_radius_m ?? 1000);

  const canStamp = !geofenceOn || (geo.status === "ok" && !outOfRange);

  async function checkIn() {
    setError(null);
    if (geofenceOn && geo.status !== "ok") {
      setError("انتظر حتى يُحدَّد موقعك أولاً.");
      return;
    }
    setBusy(true);
    const coords = geo.status === "ok" ? { lat: geo.lat, lng: geo.lng } : null;
    const { error } = await supabase.from("attendance").insert({
      employee_id: employeeId,
      work_date: today,
      check_in: new Date().toISOString(),
      check_in_lat: coords?.lat ?? null,
      check_in_lng: coords?.lng ?? null,
      source: "بصمة ذاتية",
    });
    setBusy(false);
    if (error) {
      setError(translateError(error.message));
      return;
    }
    router.refresh();
  }

  async function checkOut() {
    setError(null);
    if (!todayRecord) return;
    if (geofenceOn && geo.status !== "ok") {
      setError("انتظر حتى يُحدَّد موقعك أولاً.");
      return;
    }
    setBusy(true);
    const coords = geo.status === "ok" ? { lat: geo.lat, lng: geo.lng } : null;
    const { error } = await supabase
      .from("attendance")
      .update({
        check_out: new Date().toISOString(),
        check_out_lat: coords?.lat ?? null,
        check_out_lng: coords?.lng ?? null,
      })
      .eq("id", todayRecord.id);
    setBusy(false);
    if (error) {
      setError(translateError(error.message));
      return;
    }
    router.refresh();
  }

  // ترجمة أخطاء القاعدة الشائعة إلى لغة مفهومة
  function translateError(msg: string): string {
    if (msg.includes("attendance_employee_day_uidx") || msg.includes("duplicate"))
      return "سجّلت حضورك اليوم مسبقاً.";
    if (msg.includes("row-level security") || msg.includes("policy"))
      return "حسابك غير مربوط بملف موظف، أو لا تملك صلاحية التسجيل. راجع المدير.";
    return msg;
  }

  const hasCheckIn = Boolean(todayRecord?.check_in);
  const hasCheckOut = Boolean(todayRecord?.check_out);

  return (
    <div className="rounded-2xl border bg-white p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-gray-800">👆 تسجيل البصمة</h3>
          <p className="text-sm text-gray-500">{new Date().toLocaleDateString("ar")}</p>
        </div>
        {geofenceOn && (
          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600">
            📍 مسموح ضمن {formatDistance(settings!.geofence_radius_m)} من{" "}
            {settings!.office_name}
          </span>
        )}
      </div>

      {/* حالة الموقع */}
      {geofenceOn && (
        <div className="mb-4">
          {geo.status === "locating" && (
            <div className="rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-600">
              جارٍ تحديد موقعك...
            </div>
          )}

          {geo.status === "error" && (
            <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
              {geo.message}
              <button
                onClick={locate}
                className="mr-2 font-semibold underline hover:text-red-900"
              >
                إعادة المحاولة
              </button>
            </div>
          )}

          {geo.status === "ok" && geo.distance != null && (
            <div
              className={`flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-3 text-sm ${
                outOfRange ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"
              }`}
            >
              <span>
                {outOfRange ? "✗ أنت خارج النطاق — " : "✓ أنت داخل النطاق — "}
                تبعد <b>{formatDistance(geo.distance)}</b> عن {settings!.office_name}
              </span>
              <button
                onClick={locate}
                className="text-xs underline hover:opacity-80"
              >
                تحديث الموقع
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4">
        {!hasCheckIn && (
          <button
            onClick={checkIn}
            disabled={busy || !canStamp}
            title={outOfRange ? "لا يمكن التسجيل خارج نطاق مركز المبيعات" : ""}
            className="rounded-lg bg-green-600 px-6 py-3 font-semibold text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "..." : "تسجيل حضور"}
          </button>
        )}

        {hasCheckIn && !hasCheckOut && (
          <button
            onClick={checkOut}
            disabled={busy || !canStamp}
            title={outOfRange ? "لا يمكن التسجيل خارج نطاق مركز المبيعات" : ""}
            className="rounded-lg bg-red-600 px-6 py-3 font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "..." : "تسجيل انصراف"}
          </button>
        )}

        <div className="text-sm text-gray-600">
          <div>
            الحضور:{" "}
            <b className="text-gray-800" dir="ltr">
              {formatTime(todayRecord?.check_in ?? null)}
            </b>
            {todayRecord?.check_in_distance_m != null && (
              <span className="mr-1 text-xs text-gray-400">
                (على بعد {formatDistance(todayRecord.check_in_distance_m)})
              </span>
            )}
          </div>
          <div>
            الانصراف:{" "}
            <b className="text-gray-800" dir="ltr">
              {formatTime(todayRecord?.check_out ?? null)}
            </b>
            {todayRecord?.check_out_distance_m != null && (
              <span className="mr-1 text-xs text-gray-400">
                (على بعد {formatDistance(todayRecord.check_out_distance_m)})
              </span>
            )}
          </div>
        </div>

        {hasCheckIn && hasCheckOut && (
          <span className="rounded-full bg-green-100 px-3 py-1 text-sm text-green-700">
            ✓ اكتمل تسجيل اليوم
          </span>
        )}
      </div>

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      {!geofenceOn && (
        <p className="mt-3 text-xs text-gray-400">
          تقييد البصمة بالموقع غير مفعّل. يمكن للمدير ضبط موقع مركز المبيعات من صفحة
          الإعدادات.
        </p>
      )}
    </div>
  );
}
