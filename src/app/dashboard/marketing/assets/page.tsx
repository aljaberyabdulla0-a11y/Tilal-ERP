import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireMktRead } from "@/lib/marketing-guard";
import { canWriteMarketing } from "@/lib/auth";
import { baghdadDate } from "@/lib/time";
import { getCampaignsLite, getMktProjects } from "@/lib/marketing";
import { ASSET_TYPES } from "@/lib/marketing-style";
import { Badge, Card, PageHead } from "@/components/marketing/ui";
import { SimpleTable } from "@/components/marketing/table";
import { FieldSelect } from "@/components/marketing/actions";
import { AssetDownload, AssetUploader, AttachToContent } from "./uploader";

// ============================================================
// مكتبة الأصول — صور المشروع، المخطّطات، الهوية، البروشورات، تصاميم
// السوشيال، العقود. بحث بالعنوان والوسم والمجلّد، وتنبيه لما انتهت
// حقوق استخدامه.
// ============================================================
function size(n: number | null) {
  if (!n) return "—";
  return n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`;
}

export default async function AssetsPage({ searchParams }: { searchParams: Record<string, string> }) {
  await requireMktRead();
  const sp = searchParams;
  const supabase = await createClient();
  let q = supabase.from("mkt_assets").select("*").order("created_at", { ascending: false }).limit(300);
  if (sp.archived !== "1") q = q.neq("status", "مؤرشف");
  if (sp.type) q = q.eq("asset_type", sp.type);
  if (sp.project) q = q.eq("project_id", sp.project);
  if (sp.folder) q = q.eq("folder", sp.folder);
  if (sp.tag) q = q.contains("tags", [sp.tag]);
  if (sp.q) q = q.or(`title.ilike.%${sp.q.replace(/[%,()]/g, "")}%,file_name.ilike.%${sp.q.replace(/[%,()]/g, "")}%`);
  const [{ data }, write, projects, campaigns, { data: activities }, { data: folders }] = await Promise.all([
    q, canWriteMarketing(), getMktProjects(), getCampaignsLite(),
    supabase.from("mkt_activities").select("id, title").order("created_at", { ascending: false }).limit(100),
    supabase.from("mkt_assets").select("folder").not("folder", "is", null).limit(1000),
  ]);
  const today = baghdadDate();
  const folderList = Array.from(new Set((folders ?? []).map((f) => f.folder as string))).sort();
  const pName = new Map(projects.map((p) => [p.id, p.name]));
  const sel = "mt-1 rounded border border-gray-300 bg-white px-2 py-1.5";
  const opt = (rows: { id: string; name: string }[]) => rows.map((r) => ({ id: r.id, name: r.name }));

  return (
    <>
      <PageHead title="مكتبة الأصول" sub="الدلو خاصّ والتنزيل برابط موقَّع ينتهي بدقيقة. النسخة الجديدة لا تمحو القديمة — تؤرشفها."
        actions={sp.content ? <Link href={`/dashboard/marketing/content/${sp.content}`} className="text-sm text-brand-600">← العودة إلى المحتوى</Link> : undefined} />
      {write && <AssetUploader types={ASSET_TYPES} projects={opt(projects)} campaigns={opt(campaigns)}
        activities={(activities ?? []).map((a) => ({ id: a.id, name: a.title }))} />}

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-3 text-sm">
        {sp.content && <input type="hidden" name="content" value={sp.content} />}
        <label><span className="text-xs text-gray-500">بحث</span><input name="q" defaultValue={sp.q ?? ""} className={sel} /></label>
        <label><span className="text-xs text-gray-500">النوع</span><select name="type" defaultValue={sp.type ?? ""} className={sel}><option value="">الكل</option>{ASSET_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
        <label><span className="text-xs text-gray-500">المشروع</span><select name="project" defaultValue={sp.project ?? ""} className={sel}><option value="">الكل</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label><span className="text-xs text-gray-500">المجلّد</span><select name="folder" defaultValue={sp.folder ?? ""} className={sel}><option value="">الكل</option>{folderList.map((f) => <option key={f}>{f}</option>)}</select></label>
        <label><span className="text-xs text-gray-500">وسم</span><input name="tag" defaultValue={sp.tag ?? ""} className={sel} /></label>
        <label className="flex items-center gap-1 pb-2 text-xs"><input type="checkbox" name="archived" value="1" defaultChecked={sp.archived === "1"} />مع المؤرشف</label>
        <button className="rounded-lg bg-brand-600 px-4 py-1.5 font-semibold text-white">ابحث</button>
      </form>

      <Card>
        <SimpleTable empty="لا أصول."
          head={["الأصل", "النوع", "المشروع", "المجلّد / الوسوم", "الحجم", "الحقوق", "الحالة", ""]}
          rows={(data ?? []).map((a) => {
            const expired = a.expires_on && a.expires_on < today;
            return [
              <span key="t"><b className="font-medium">{a.title}</b><span className="block text-xs text-gray-400">{a.file_name} · ن{a.version}</span></span>,
              a.asset_type, pName.get(a.project_id ?? "") ?? "—",
              <span key="f" className="text-xs">{a.folder ?? ""}{a.tags?.length ? <span className="block text-gray-500">{a.tags.map((t: string) => `#${t}`).join(" ")}</span> : null}</span>,
              size(a.size_bytes),
              <span key="r" className={`text-xs ${expired ? "text-red-600" : ""}`}>{a.usage_rights ?? "—"}{a.expires_on ? ` · حتى ${a.expires_on}` : ""}{expired ? " (انتهت)" : ""}</span>,
              write ? <FieldSelect key="s" table="mkt_assets" id={a.id} column="status" value={a.status} options={["مسودة", "معتمد", "مؤرشف"]} /> : <Badge key="s">{a.status}</Badge>,
              <span key="x" className="flex flex-col gap-0.5">
                <AssetDownload path={a.storage_path} />
                {write && a.status !== "مؤرشف" && <AssetUploader types={ASSET_TYPES} projects={[]} campaigns={[]} activities={[]} parent={a} />}
                {sp.content && write && <AttachToContent contentId={sp.content} assetId={a.id} />}
              </span>,
            ];
          })} />
      </Card>
    </>
  );
}
