"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { CompanySettings, WorkLocation, formatDistance } from "@/lib/types";

type Draft = {
  id?: string;
  name: string;
  lat: string;
  lng: string;
  radius_m: string;
  is_active: boolean;
};

const emptyDraft: Draft = {
  name: "",
  lat: "",
  lng: "",
  radius_m: "1000",
  is_active: true,
};

// ============================================================
// مواقع العمل التي تُقبل البصمة منها.
// تقدر تضيف أكثر من موقع، والبصمة تُقبل إذا كان الموظف داخل نطاق
// **أي** موقع نشط. أسهل طريقة للإضافة: اذهب للموقع نفسه واضغط
// «استخدم موقعي الحالي».
// ============================================================
export default function WorkLocations({
  locations,
  settings,
}: {
  locations: WorkLocation[];
  settings: CompanySettings | null;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(settings?.geofence_enabled ?? true);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function useMyLocation() {
    setMsg(null);
    if (!("geolocation" in navigator)) {
      setMsg({ kind: "err", text: "متصفحك لا يدعم تحديد الموقع." });
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        set("lat", pos.coords.latitude.toFixed(6));
        set("lng", pos.coords.longitude.toFixed(6));
        setLocating(false);
        setMsg({
          kind: "ok",
          text: `تم أخذ موقعك الحالي (دقة ±${Math.round(pos.coords.accuracy)} متر).`,
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

  async function saveDraft() {
    setMsg(null);
    const lat = Number(draft.lat);
    const lng = Number(draft.lng);
    const radius = Number(draft.radius_m);

    if (!draft.name.trim()) {
      setMsg({ kind: "err", text: "اكتب اسم الموقع (مثال: معرض الكرادة)." });
      return;
    }
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      setMsg({ kind: "err", text: "خط العرض غير صحيح." });
      return;
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      setMsg({ kind: "err", text: "خط الطول غير صحيح." });
      return;
    }
    if (!Number.isFinite(radius) || radius < 20 || radius > 50000) {
      setMsg({ kind: "err", text: "النطاق بين 20 و 50000 متر." });
      return;
    }

    setSaving(true);
    const payload = {
      name: draft.name.trim(),
      lat,
      lng,
      radius_m: Math.round(radius),
      is_active: draft.is_active,
    };
    const { error } = draft.id
      ? await supabase.from("work_locations").update(payload).eq("id", draft.id)
      : await supabase.from("work_locations").insert(payload);
    setSaving(false);

    if (error) {
      setMsg({ kind: "err", text: "تعذّر الحفظ: " + error.message });
      return;
    }
    setDraft(emptyDraft);
    setMsg({ kind: "ok", text: "تم حفظ الموقع." });
    router.refresh();
  }

  async function toggleActive(loc: WorkLocation) {
    setBusyId(loc.id);
    await supabase
      .from("work_locations")
      .update({ is_active: !loc.is_active })
      .eq("id", loc.id);
    setBusyId(null);
    router.refresh();
  }

  async function remove(loc: WorkLocation) {
    if (!confirm(`حذف موقع «${loc.name}» نهائياً؟`)) return;
    setBusyId(loc.id);
    const { error } = await supabase.from("work_locations").delete().eq("id", loc.id);
    setBusyId(null);
    if (error) {
      setMsg({ kind: "err", text: "تعذّر الحذف: " + error.message });
      return;
    }
    router.refresh();
  }

  async function toggleGeofence() {
    const next = !enabled;
    setEnabled(next);
    const { error } = await supabase
      .from("company_settings")
      .update({ geofence_enabled: next, updated_at: new Date().toISOString() })
      .eq("id", 1);
    if (error) {
      setEnabled(!next);
      setMsg({ kind: "err", text: "تعذّر التغيير: " + error.message });
      return;
    }
    router.refresh();
  }

  const input =
    "w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";
  const label = "mb-1 block text-sm font-medium text-gray-700";
  const activeCount = locations.filter((l) => l.is_active).length;

  return (
    <div className="rounded-2xl border bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-gray-800">مواقع العمل والبصمة</h3>
          <p className="mt-1 text-sm text-gray-500">
            تقدر تضيف أكثر من موقع. البصمة تُقبل إذا كان الموظف داخل نطاق{" "}
            <b>أي موقع نشط</b>، والنظام يسجّل من أي موقع بصم.
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-gray-200 px-4 py-2">
          <input
            type="checkbox"
            checked={enabled}
            onChange={toggleGeofence}
            className="h-4 w-4 accent-brand-600"
          />
          <span className="text-sm font-medium text-gray-700">تقييد البصمة بالموقع</span>
        </label>
      </div>

      {!enabled && (
        <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          التقييد معطّل الآن — أي موظف يقدر يبصم من أي مكان.
        </p>
      )}

      {/* المواقع الحالية */}
      <div className="mt-5 space-y-3">
        {locations.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
            لا توجد مواقع بعد — أضف أول موقع من النموذج تحت.
          </p>
        ) : (
          locations.map((loc) => (
            <div
              key={loc.id}
              className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 ${
                loc.is_active ? "border-gray-200 bg-white" : "border-gray-200 bg-gray-50"
              }`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[20px] text-brand-600">
                    location_on
                  </span>
                  <span className="font-semibold text-gray-800">{loc.name}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      loc.is_active
                        ? "bg-green-100 text-green-700"
                        : "bg-gray-200 text-gray-500"
                    }`}
                  >
                    {loc.is_active ? "نشط" : "معطّل"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  نطاق {formatDistance(loc.radius_m)} ·{" "}
                  <span dir="ltr">
                    {loc.lat.toFixed(5)}, {loc.lng.toFixed(5)}
                  </span>
                </p>
              </div>

              <div className="flex items-center gap-2">
                <a
                  href={`https://www.google.com/maps?q=${loc.lat},${loc.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 transition hover:bg-gray-100"
                >
                  الخريطة
                </a>
                <button
                  onClick={() =>
                    setDraft({
                      id: loc.id,
                      name: loc.name,
                      lat: String(loc.lat),
                      lng: String(loc.lng),
                      radius_m: String(loc.radius_m),
                      is_active: loc.is_active,
                    })
                  }
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 transition hover:bg-gray-100"
                >
                  تعديل
                </button>
                <button
                  onClick={() => toggleActive(loc)}
                  disabled={busyId === loc.id}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 transition hover:bg-gray-100 disabled:opacity-50"
                >
                  {loc.is_active ? "تعطيل" : "تفعيل"}
                </button>
                <button
                  onClick={() => remove(loc)}
                  disabled={busyId === loc.id}
                  className="rounded-lg px-2 py-1.5 text-xs text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                >
                  حذف
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {enabled && locations.length > 0 && activeCount === 0 && (
        <p className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          التقييد مفعّل لكن ما في موقع نشط — البصمة راح تُقبل من أي مكان حتى تفعّل موقعاً.
        </p>
      )}

      {/* نموذج الإضافة/التعديل */}
      <div className="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-5">
        <h4 className="font-semibold text-gray-800">
          {draft.id ? "تعديل الموقع" : "إضافة موقع جديد"}
        </h4>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <label className={label}>اسم الموقع</label>
            <input
              type="text"
              value={draft.name}
              onChange={(e) => set("name", e.target.value)}
              className={input}
              placeholder="مثال: معرض الكرادة"
            />
          </div>
          <div>
            <label className={label}>خط العرض</label>
            <input
              type="text"
              dir="ltr"
              value={draft.lat}
              onChange={(e) => set("lat", e.target.value)}
              className={input + " text-start"}
              placeholder="33.312800"
            />
          </div>
          <div>
            <label className={label}>خط الطول</label>
            <input
              type="text"
              dir="ltr"
              value={draft.lng}
              onChange={(e) => set("lng", e.target.value)}
              className={input + " text-start"}
              placeholder="44.361500"
            />
          </div>
          <div>
            <label className={label}>النطاق المسموح (متر)</label>
            <input
              type="number"
              min={20}
              max={50000}
              dir="ltr"
              value={draft.radius_m}
              onChange={(e) => set("radius_m", e.target.value)}
              className={input + " text-start"}
            />
          </div>
          <div className="flex items-end">
            <label className="flex cursor-pointer items-center gap-2 pb-2.5">
              <input
                type="checkbox"
                checked={draft.is_active}
                onChange={(e) => set("is_active", e.target.checked)}
                className="h-4 w-4 accent-brand-600"
              />
              <span className="text-sm text-gray-700">موقع نشط</span>
            </label>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={useMyLocation}
            disabled={locating}
            className="rounded-lg border border-brand-300 bg-brand-50 px-4 py-2 text-sm font-medium text-brand-700 transition hover:bg-brand-100 disabled:opacity-50"
          >
            {locating ? "جاري تحديد الموقع..." : "📍 استخدم موقعي الحالي"}
          </button>
          <button
            onClick={saveDraft}
            disabled={saving}
            className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? "جاري الحفظ..." : draft.id ? "حفظ التعديل" : "إضافة الموقع"}
          </button>
          {draft.id && (
            <button
              onClick={() => setDraft(emptyDraft)}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-100"
            >
              إلغاء التعديل
            </button>
          )}
        </div>

        <p className="mt-3 text-xs text-gray-400">
          أسهل طريقة: روح للموقع نفسه، افتح هذي الصفحة من جوالك، واضغط «استخدم موقعي
          الحالي». تحديد الموقع يحتاج اتصالاً آمناً (HTTPS).
        </p>
      </div>

      {msg && (
        <p
          className={`mt-4 rounded-lg px-4 py-3 text-sm ${
            msg.kind === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
          }`}
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}
