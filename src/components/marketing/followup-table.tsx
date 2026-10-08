import type { FollowupRow } from "@/lib/marketing";
import { fmt, fmtPct } from "@/lib/marketing-style";
import { SimpleTable } from "./table";

// Following up marketing leads per sales employee (mkt_lead_followup — 195).
// Staff names only: marketing doesn't see the client (092), it sees whether its leads reached anyone.
export default function FollowupTable({ rows }: { rows: FollowupRow[] }) {
  return (
    <SimpleTable
      empty="لا ليدات تسويقية في هذه المدة."
      head={["الموظف", "ليدات", "تمّ التواصل", "نسبة التواصل", "متروك (بلا اتصال)", "مؤهَّل", "حجز", "بيع"]}
      rows={rows.map((r) => [
        <span key="n" className={r.employee_id ? "" : "font-semibold text-red-700"}>{r.employee_name}</span>,
        fmt(r.leads),
        fmt(r.contacted),
        <span key="p" className={r.contact_rate != null && r.contact_rate < 70 ? "text-amber-700" : ""}>{fmtPct(r.contact_rate)}</span>,
        <span key="s" className={Number(r.stale) > 0 ? "font-semibold text-red-700" : "text-gray-400"}>{fmt(r.stale)}</span>,
        fmt(r.qualified),
        fmt(r.reserved),
        fmt(r.sold),
      ])}
    />
  );
}
