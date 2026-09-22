import { getClientAssignments, getClientStageHistory } from "@/lib/crm";

// ============================================================
// التاريخ الذي لم يكن موجوداً — الملكية والمراحل (sql/071 · 072).
//
// قبل 071 كان تغيير المالك يستبدل نصّاً بلا أثر: «من كان يملك هذا
// الليد قبل شهر؟» بلا جواب. وقبل 072 كانت المرحلة عموداً واحداً
// يُكتب فوقه. الآن كلاهما سجلّ يُكتب بمحفّز لا من الواجهة — فما
// يُعرض هنا لا يمكن تزويره من الشاشة.
//
// مدمجان في تسلسل واحد مرتّب زمنياً: القارئ يريد «ماذا حدث لهذا
// الملف؟» لا جدولين منفصلين يقارن بينهما بعينه.
// ============================================================
type Row = { at: string; kind: "owner" | "stage"; text: string; by: string | null; note: string | null };

export default async function CrmHistory({ clientId }: { clientId: string }) {
  const [assignments, stages] = await Promise.all([
    getClientAssignments(clientId),
    getClientStageHistory(clientId),
  ]);

  const rows: Row[] = [
    ...assignments.map<Row>((a) => ({
      at: a.at,
      kind: "owner",
      text: a.from_owner_name
        ? `الملكية: ${a.from_owner_name} ← ${a.to_owner_name ?? "بلا مالك"}`
        : `أُسند إلى ${a.to_owner_name ?? "بلا مالك"}`,
      by: a.assigned_by_name,
      note: [a.method, a.reason].filter(Boolean).join(" · ") || null,
    })),
    ...stages.map<Row>((s) => ({
      at: s.at,
      kind: "stage",
      text: s.from_stage ? `الفرصة: ${s.from_stage} ← ${s.to_stage ?? "—"}` : `فُتحت الفرصة في «${s.to_stage ?? "—"}»`,
      by: s.changed_by_name,
      note: [
        s.days_in_from !== null ? `بعد ${Math.round(Number(s.days_in_from))} يوماً` : null,
        s.note,
      ]
        .filter(Boolean)
        .join(" · ") || null,
    })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));

  if (rows.length === 0) return null;

  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <p className="text-xs font-medium text-gray-500">تاريخ الملكية والمراحل</p>
      <ul className="mt-2 space-y-2">
        {rows.slice(0, 30).map((r, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <span
              className={`material-symbols-outlined mt-0.5 text-[16px] ${
                r.kind === "owner" ? "text-indigo-500" : "text-amber-500"
              }`}
            >
              {r.kind === "owner" ? "person" : "flag"}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-gray-800">{r.text}</p>
              <p className="text-xs text-gray-400">
                <span dir="ltr">{r.at.slice(0, 16).replace("T", " ")}</span>
                {r.by && ` · ${r.by}`}
                {r.note && ` · ${r.note}`}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
