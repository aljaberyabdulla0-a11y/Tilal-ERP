"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  BROKER_UNIT_AVAILABILITY_COLORS,
  BrokerUnit,
  Client,
  formatPrice,
  isValidPhone,
} from "@/lib/types";
import PhoneInput from "@/components/phone-input";

type Lead = Pick<Client, "id" | "name" | "phone" | "project_id">;

// ============================================================
// تصفّح الوحدات وطلب الحجز.
//
// الطلب يذهب إلى broker_request_reservation (sql/117) التي تتحقّق من
// كل شيء: الوحدة مكشوفة لكم ومتاحة، ولا طلب مفتوح عليها، والعميل من
// ليداتكم. والعميل الجديد يُنشأ ليداً لشركتكم مع الطلب نفسه.
// ============================================================
export default function UnitsBrowser({ units, leads }: { units: BrokerUnit[]; leads: Lead[] }) {
  const router = useRouter();
  const supabase = createClient();

  const projects = useMemo(
    () => Array.from(new Map(units.map((u) => [u.project_id, u.project_name])).entries()),
    [units]
  );
  const types = useMemo(() => Array.from(new Set(units.map((u) => u.unit_type))).sort(), [units]);

  const [project, setProject] = useState(projects.length === 1 ? projects[0][0] : "");
  const [type, setType] = useState("");
  const [onlyAvailable, setOnlyAvailable] = useState(true);
  const [query, setQuery] = useState("");
  const [maxPrice, setMaxPrice] = useState("");

  const [target, setTarget] = useState<BrokerUnit | null>(null);
  const [clientMode, setClientMode] = useState<"existing" | "new">(leads.length ? "existing" : "new");
  const [clientId, setClientId] = useState("");
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const shown = units.filter((u) => {
    if (project && u.project_id !== project) return false;
    if (type && u.unit_type !== type) return false;
    if (onlyAvailable && u.availability !== "متاحة") return false;
    if (maxPrice && (u.price ?? 0) > Number(maxPrice)) return false;
    const q = query.trim().toLowerCase();
    if (q && ![u.unit_code, u.node_path].some((v) => (v ?? "").toLowerCase().includes(q))) return false;
    return true;
  });

  function open(u: BrokerUnit) {
    setTarget(u);
    setError(null);
    setDone(null);
    setNote("");
    setNewName("");
    setNewPhone("");
    // ليدٌ في نفس المشروع أقرب للاختيار
    const sameProject = leads.find((l) => l.project_id === u.project_id);
    setClientId(sameProject?.id ?? "");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!target) return;
    setError(null);

    if (clientMode === "existing" && !clientId) {
      setError("اختر العميل.");
      return;
    }
    if (clientMode === "new") {
      if (!newName.trim()) {
        setError("اكتب اسم العميل.");
        return;
      }
      if (newPhone && !isValidPhone(newPhone)) {
        setError("رقم الهاتف غير مكتمل.");
        return;
      }
    }

    setBusy(true);
    const { error } = await supabase.rpc("broker_request_reservation", {
      p_unit: target.id,
      p_client: clientMode === "existing" ? clientId : null,
      p_new_name: clientMode === "new" ? newName.trim() : null,
      p_new_phone: clientMode === "new" ? newPhone.trim() || null : null,
      p_note: note.trim() || null,
    });
    setBusy(false);

    if (error) {
      setError(error.message);
      return;
    }
    setDone(`رُفع طلب حجز الوحدة ${target.unit_code ?? ""} — يصلكم إشعار حين يتابعه مدير العلاقات.`);
    setTarget(null);
    router.refresh();
  }

  const inputCls =
    "rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";
  const facts = (u: BrokerUnit) =>
    [
      u.space_m2 ? `${u.space_m2} م²` : null,
      u.rooms ? `${u.rooms} غرف` : null,
      u.bathrooms ? `${u.bathrooms} حمّام` : null,
      u.floors_count ? `${u.floors_count} طوابق` : null,
      u.parking_spaces ? `${u.parking_spaces} موقف` : null,
    ].filter(Boolean);

  return (
    <div className="space-y-4">
      {done && (
        <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {done}{" "}
          <Link href="/dashboard/broker/requests" className="font-semibold underline">
            طلباتنا
          </Link>
        </p>
      )}

      {/* المرشّحات */}
      <div className="glass-card flex flex-wrap items-end gap-3 p-4">
        {projects.length > 1 && (
          <select value={project} onChange={(e) => setProject(e.target.value)} className={inputCls}>
            <option value="">كل المشاريع</option>
            {projects.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        )}
        {types.length > 1 && (
          <select value={type} onChange={(e) => setType(e.target.value)} className={inputCls}>
            <option value="">كل الأنواع</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        )}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="رقم الوحدة أو الموقع"
          className={inputCls + " w-44"}
        />
        <input
          type="number"
          value={maxPrice}
          onChange={(e) => setMaxPrice(e.target.value)}
          placeholder="أعلى سعر"
          className={inputCls + " w-36"}
          dir="ltr"
        />
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={onlyAvailable}
            onChange={(e) => setOnlyAvailable(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300"
          />
          المتاح للطلب فقط
        </label>
        <span className="ms-auto text-sm text-gray-500">{shown.length} وحدة</span>
      </div>

      {/* الوحدات */}
      {shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500">
          لا وحدات تطابق البحث.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((u) => (
            <div key={u.id} className="glass-card flex flex-col p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-bold text-gray-800">الوحدة {u.unit_code ?? "—"}</h3>
                  <p className="text-xs text-gray-500">
                    {u.project_name}
                    {u.node_path ? ` · ${u.node_path}` : ""}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                    BROKER_UNIT_AVAILABILITY_COLORS[u.availability] ?? ""
                  }`}
                >
                  {u.availability}
                </span>
              </div>
              <p className="mt-2 text-sm text-gray-600">
                {u.unit_type}
                {facts(u).length > 0 && ` · ${facts(u).join(" · ")}`}
              </p>
              <p className="mt-2 text-lg font-bold text-brand-800" dir="ltr">
                {formatPrice(u.price)}
              </p>
              {u.payment_plan && (
                <p className="mt-1 text-xs text-gray-500">خطة الدفع: {u.payment_plan}</p>
              )}
              <div className="mt-auto pt-3">
                {u.availability === "متاحة" ? (
                  <button
                    onClick={() => open(u)}
                    className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
                  >
                    طلب حجز
                  </button>
                ) : u.my_request_id ? (
                  <Link
                    href="/dashboard/broker/requests"
                    className="block text-center text-sm font-semibold text-blue-700 hover:underline"
                  >
                    طلبكم قيد المتابعة ←
                  </Link>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* نافذة الطلب */}
      {target && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          onClick={() => !busy && setTarget(null)}
        >
          <form
            onSubmit={submit}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-xl"
          >
            <div>
              <h2 className="text-lg font-bold text-gray-800">
                طلب حجز الوحدة {target.unit_code ?? ""}
              </h2>
              <p className="text-sm text-gray-500">
                {target.project_name} · <span dir="ltr">{formatPrice(target.price)}</span>
              </p>
            </div>

            <div className="flex gap-2 rounded-lg bg-gray-100 p-1 text-sm">
              {leads.length > 0 && (
                <button
                  type="button"
                  onClick={() => setClientMode("existing")}
                  className={`flex-1 rounded-md py-1.5 ${clientMode === "existing" ? "bg-white font-semibold shadow-sm" : "text-gray-500"}`}
                >
                  عميل من ليداتنا
                </button>
              )}
              <button
                type="button"
                onClick={() => setClientMode("new")}
                className={`flex-1 rounded-md py-1.5 ${clientMode === "new" ? "bg-white font-semibold shadow-sm" : "text-gray-500"}`}
              >
                عميل جديد
              </button>
            </div>

            {clientMode === "existing" ? (
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className={inputCls + " w-full"}
              >
                <option value="">— اختر العميل —</option>
                {leads.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                    {l.phone ? ` — ${l.phone}` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <div className="space-y-2">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="اسم العميل"
                  className={inputCls + " w-full"}
                />
                <PhoneInput value={newPhone} onChange={setNewPhone} />
                <p className="text-xs text-gray-400">
                  يُضاف ليداً لشركتكم بمهلته المعتادة، ولا يعود لتلال ما دام طلبه
                  أو حجزه قائماً.
                </p>
              </div>
            )}

            <textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="ملاحظة لمدير العلاقات (طريقة الدفع، موعد الزيارة...)"
              className={inputCls + " w-full"}
            />

            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={busy}
                className="flex-1 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {busy ? "جارٍ الإرسال..." : "إرسال الطلب"}
              </button>
              <button
                type="button"
                onClick={() => setTarget(null)}
                disabled={busy}
                className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-100"
              >
                إلغاء
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
