import { getI18n } from "@/lib/i18n/server";
import { getActivity } from "@/lib/dashboard/data";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { Card } from "@/components/dashboard/ui";
import { ErrorState } from "@/components/dashboard/states";

// سجلّ النشاط الموحّد (182) — يستبدل «آخر 5 حجوزات» (M5).
// RLS تقرّر ما يراه كل دور: المدير الكل، والموظف ما يخصّه.
export default async function ActivitySection({
  projectId, limit = 12, title = true,
}: { projectId: string | null; limit?: number; title?: boolean }) {
  const { t } = getI18n();
  const rows = await getActivity(limit, projectId);
  return (
    <Card className="h-full">
      {title && (
        <div className="mb-2">
          <h2 className="text-sm font-bold text-ink">{t.dash.sections.activity}</h2>
          <p className="text-[11px] text-ink-muted">{t.dash.sections.activityHint}</p>
        </div>
      )}
      {rows.ok ? <ActivityFeed rows={rows.data} /> : <ErrorState compact detail={rows.error} />}
    </Card>
  );
}
