"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Reservation, Unit, formatPrice } from "@/lib/types";

// ============================================================
// حجز وحدة من ملفّ العميل.
//
// كان الحجز يبدأ من الوحدة: يفتح الموظف المخزون، يبحث عن الوحدة،
// ثم يختار العميل من قائمة طويلة. والعمل يجري بالعكس — الموظف
// جالس مع عميله فيحتاج أن يحجز له من مكانه.
//
// الوحدات المتاحة وحدها تُعرض، لأن ما لا يجوز حجزه لا معنى
// لعرضه. والقاعدة تفرض القاعدة نفسها بمحفّز (sql/044)، فالإخفاء
// راحةٌ لا حماية.
// ============================================================
export default function ReserveUnit({
  clientId,
  clientName,
  existing,
}: {
  clientId: string;
  clientName: string;
  existing: Reservation[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(false);
  const [project, setProject] = useState("");
  const [q, setQ] = useState("");
  const [unitId, setUnitId] = useState("");

  const [amount, setAmount] = useState("");
  const [expiry, setExpiry] = useState("");
  const [notes, setNotes] = useState("");

  // الوحدات المتاحة فقط — وبنطاق المستخدم كما تحدّده سياسات القاعدة
  useEffect(() => {
    if (!open || units.length > 0) return;
    setLoading(true);
    supabase
      .from("units")
      .select("*")
      .eq("status", "متاحة")
      .order("project")
      .order("node_path", { nullsFirst: false })
      .order("unit_code")
      .limit(2000)
      .then(({ data }) => {
        setUnits((data ?? []) as Unit[]);
        setLoading(false);
      });
  }, [open, units.length, supabase]);

  // مهلة افتراضية أسبوعان — رقم يُعدَّل لا يُفرض
  useEffect(() => {
    if (!open || expiry) return;
    const d = new Date();
    d.setDate(d.getDate() + 14);
    setExpiry(d.toLocaleDateString("en-CA", { timeZone: "Asia/Baghdad" }));
  }, [open, expiry]);

  const projects = useMemo(
    () => Array.from(new Set(units.map((u) => u.project).filter(Boolean))).sort(),
    [units],
  );

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return units
      .filter((u) => (project ? u.project === project : true))
      .filter((u) =>
        needle
          ? [u.unit_code, u.node_path, u.unit_type, u.project]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
              .includes(needle)
          : true,
      )
      .slice(0, 200);
  }, [units, project, q]);

  const picked = units.find((u) => u.id === unitId) ?? null;

  async function reserve() {
    setErr(null);
    if (!unitId) {
      setErr("اختر الوحدة أولاً.");
      return;
    }

    setBusy(true);
    const { error } = await supabase.from("reservations").insert({
      client_id: clientId,
      unit_id: unitId,
      amount: amount ? Number(amount) : null,
      expiry_date: expiry || null,
      notes: notes.trim() || null,
      status: "حجز",
    });
    setBusy(false);

    if (error) {
      setErr(error.message);
      return;
    }

    setOpen(false);
    setUnitId("");
    setAmount("");
    setNotes("");
    setUnits([]);           // تغيّرت الحالة، تُجلب من جديد عند الفتح
    router.refresh();
  }

  const input =
    "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

  const active = existing.filter((r) => r.status !== "ملغى");

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          <span className="material-symbols-outlined text-[18px]">
            add_home_work
          </span>
          حجز وحدة
        </button>

        {/* ما حُجز له سابقاً — طريقٌ للوحدة لا مجرّد خبر */}
        {active.map((r) => (
          <Link
            key={r.id}
            href={`/dashboard/units/${r.unit_id}`}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition hover:opacity-80 ${
              r.status === "بيع مكتمل"
                ? "bg-green-100 text-green-700"
                : "bg-amber-100 text-amber-700"
            }`}
          >
            {r.status === "بيع مكتمل" ? "اشترى" : "محجوزة له"}:{" "}
            {r.units?.unit_code ?? "وحدة"}
          </Link>
        ))}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => !busy && setOpen(false)}
          />
          <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="mb-1 text-lg font-bold text-brand-700">
              حجز وحدة لـ {clientName}
            </h3>
            <p className="mb-4 text-sm text-gray-500">
              تُعرض الوحدات المتاحة وحدها.
            </p>

            <div className="mb-3 flex flex-wrap items-center gap-2">
              <select
                value={project}
                onChange={(e) => setProject(e.target.value)}
                className={input + " w-auto flex-1"}
              >
                <option value="">كل المشاريع</option>
                {projects.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="بحث برقم الوحدة أو الطابق…"
                className={input + " flex-1"}
              />
            </div>

            <div className="mb-4 min-h-[120px] flex-1 overflow-y-auto rounded-xl border border-gray-200">
              {loading ? (
                <p className="p-6 text-center text-sm text-gray-400">
                  جارٍ تحميل الوحدات…
                </p>
              ) : shown.length === 0 ? (
                <p className="p-6 text-center text-sm text-gray-400">
                  {units.length === 0
                    ? "لا توجد وحدات متاحة في نطاقك."
                    : "لا وحدة تطابق البحث."}
                </p>
              ) : (
                shown.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => setUnitId(u.id)}
                    className={`flex w-full items-center gap-3 border-b border-gray-100 px-4 py-3 text-start last:border-0 transition ${
                      unitId === u.id ? "bg-brand-50" : "hover:bg-gray-50"
                    }`}
                  >
                    <span
                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                        unitId === u.id ? "bg-brand-600" : "bg-green-500"
                      }`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold text-gray-800">
                        {u.unit_code || "بلا رقم"}
                        <span className="ms-2 text-xs font-normal text-gray-500">
                          {u.unit_type}
                          {u.space_m2 ? ` · ${u.space_m2} م²` : ""}
                          {u.rooms ? ` · ${u.rooms} غرف` : ""}
                        </span>
                      </span>
                      <span className="block truncate text-[11px] text-gray-400">
                        {u.node_path || u.project}
                      </span>
                    </span>
                    <span
                      className="shrink-0 text-sm font-semibold text-brand-700"
                      dir="ltr"
                    >
                      {u.price !== null ? formatPrice(u.price) : "—"}
                    </span>
                  </button>
                ))
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  مبلغ الحجز (د.ع)
                </label>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  type="number"
                  min={0}
                  dir="ltr"
                  className={input}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  تنتهي المهلة في
                </label>
                <input
                  value={expiry}
                  onChange={(e) => setExpiry(e.target.value)}
                  type="date"
                  className={input}
                />
              </div>
            </div>

            <div className="mt-3">
              <label className="mb-1 block text-xs font-medium text-gray-600">
                ملاحظات
              </label>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className={input}
              />
            </div>

            {picked && (
              <p className="mt-3 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
                ستُحجز <b className="text-gray-800">{picked.unit_code}</b> في{" "}
                {picked.node_path || picked.project} لـ{" "}
                <b className="text-gray-800">{clientName}</b>، وتصير حالتها
                «محجوزة» فلا يحجزها غيرك.
              </p>
            )}

            {err && (
              <p className="mt-3 rounded-lg bg-red-50 p-2 text-xs text-red-700">
                {err}
              </p>
            )}

            <div className="mt-4 flex items-center gap-2">
              <button
                onClick={reserve}
                disabled={busy || !unitId}
                className="flex-1 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
              >
                {busy ? "جارٍ الحجز…" : "تأكيد الحجز"}
              </button>
              <button
                onClick={() => setOpen(false)}
                disabled={busy}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
