import Link from "next/link";
import { redirect } from "next/navigation";
import { getUserRole } from "@/lib/auth";
import { getLocale } from "@/lib/i18n/server";
import { tValue } from "@/lib/i18n/values";
import { getProjectsLite, getEmployeesLite, getSources, getCampaigns } from "@/lib/crm";
import { getLossLookups, getLostIntelligence, type DimRow, type LostIntelligence } from "@/lib/lost-sales";
import {
  lostDict, money, compactMoney, pct, bandLabel, milestoneLabel, insightText, INSIGHT_STYLE,
  PRICE_BANDS, type Lang, type LostDict,
} from "@/lib/lost-sales-i18n";
import CrmTabs from "../crm-tabs";

// ============================================================
// «لماذا نخسر المبيعات؟» — Lost Sales Intelligence.
//
// الشاشة تجيب بالترتيب عن أسئلة الإدارة:
//   كم؟        المؤشّرات: الفرص والرابحة والخاسرة وقيمها والقابلة للاسترجاع
//   ماذا نفهم؟ الرؤى التلقائية — من الأرقام نفسها لا من رأي
//   لماذا؟     الأسباب: الفئة، السبب الفرعي، مصدر المشكلة
//   أين؟       القمع والمشروع والموظف والمصدر والحملة والسعر والمساحة والمنافس
//   متى؟       الاتجاه الشهري
//   ماذا نفعل؟ القابلة للاسترجاع بمواعيدها
//
// كل رقم من crm_lost_intelligence (141) بصلاحية القارئ: الموظف يرى
// خسائره، والمشرف فريقه، والإدارة الكل. المُرشِّحات في العنوان فالرابط
// قابل للمشاركة.
// ============================================================

const FILTER_KEYS = ["from", "to", "project_id", "owner_id", "team_id", "source", "campaign_id",
                     "unit_size", "price_band", "category_id", "competitor_id"] as const;

export default async function LostSalesPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const role = await getUserRole();
  if (role === "broker" || role === "accountant") redirect("/dashboard");

  const lang = getLocale() as Lang;
  const t = lostDict(lang);

  const filters: Record<string, string> = {};
  for (const k of FILTER_KEYS) {
    const v = searchParams[k];
    if (v) filters[k] = v;
  }

  const [data, lookups, projects, employees, sources, campaigns] = await Promise.all([
    getLostIntelligence(filters),
    getLossLookups(),
    getProjectsLite(),
    getEmployeesLite(),
    getSources(),
    getCampaigns(),
  ]);

  const catName = (code: string | null | undefined) => {
    if (!code) return "—";
    if (code === "unanalysed") return t.kUnanalysed;
    const c = lookups.categories.find((x) => x.code === code);
    return c ? (lang === "en" ? c.name_en : c.name_ar) : code;
  };
  const srcName = (code: string) => {
    if (code === "unanalysed") return t.kUnanalysed;
    const s = lookups.sources.find((x) => x.code === code);
    return s ? (lang === "en" ? s.name_en : s.name_ar) : code;
  };
  const potName = (code: string) => {
    if (code === "unanalysed") return t.kUnanalysed;
    const s = lookups.potentials.find((x) => x.code === code);
    return s ? (lang === "en" ? s.name_en : s.name_ar) : code;
  };
  const recName = (code: string) => {
    const s = lookups.recovery.find((x) => x.code === code);
    return s ? (lang === "en" ? s.name_en : s.name_ar) : code;
  };

  return (
    <div>
      <CrmTabs active="lost" />

      <div className="space-y-6 p-4 sm:p-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-red-700">{t.execTitle}</p>
            <h1 className="text-xl font-bold text-brand-600">{t.pageTitle}</h1>
            <p className="mt-1 max-w-3xl text-sm text-gray-500">{t.pageSubtitle}</p>
          </div>
          {data && (
            <p className="text-xs text-gray-400" dir="ltr">
              {data.period.from ?? "…"} → {data.period.to ?? "…"}
            </p>
          )}
        </header>

        {/* ===== المُرشِّحات — نموذج GET: الرابط يحمل الحالة ===== */}
        <form method="get" className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            <DateField name="from" label={t.from} value={filters.from} />
            <DateField name="to" label={t.to} value={filters.to} />
            <Select name="project_id" label={t.project} value={filters.project_id} all={t.allProjects}
                    options={projects.map((p) => ({ value: p.id, label: p.name }))} />
            <Select name="owner_id" label={t.employee} value={filters.owner_id} all={t.allEmployees}
                    options={employees.map((e) => ({ value: e.id, label: e.full_name }))} />
            <Select name="team_id" label={t.team} value={filters.team_id} all={t.allTeams}
                    options={projects.map((p) => ({ value: p.id, label: p.name }))} />
            <Select name="source" label={t.source} value={filters.source} all={t.allSources}
                    options={sources.map((s) => ({ value: s.name, label: s.name }))} />
            <Select name="campaign_id" label={t.campaign} value={filters.campaign_id} all={t.allCampaigns}
                    options={campaigns.map((c) => ({ value: c.id, label: c.name }))} />
            <Select name="unit_size" label={t.unitSize} value={filters.unit_size} all={t.allSizes}
                    options={(data?.by_unit_size ?? []).filter((r) => r.key).map((r) => ({ value: r.key as string, label: `${r.key} m²` }))} />
            <Select name="price_band" label={t.priceBand} value={filters.price_band} all={t.allBands}
                    options={PRICE_BANDS.map((b) => ({ value: b, label: bandLabel(b, lang) }))} />
            <Select name="category_id" label={t.category} value={filters.category_id} all={t.allCategories}
                    options={[...lookups.categories.map((c) => ({ value: c.id, label: lang === "en" ? c.name_en : c.name_ar })),
                              { value: "none", label: t.kUnanalysed }]} />
            <Select name="competitor_id" label={t.competitor} value={filters.competitor_id} all={t.allCompetitors}
                    options={lookups.competitors.map((c) => ({ value: c.id, label: lang === "en" ? c.name_en || c.name : c.name }))} />
            <div className="flex items-end gap-2">
              <button type="submit" className="flex-1 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700">{t.apply}</button>
              <Link href="/dashboard/crm/lost" className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:border-brand-500">{t.reset}</Link>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-gray-400">{t.categoryFilterNote}</p>
        </form>

        {!data ? (
          <p className="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-10 text-center text-sm text-gray-400">{t.unavailable}</p>
        ) : (
          <Report data={data} t={t} lang={lang} catName={catName} srcName={srcName} potName={potName} recName={recName} />
        )}
      </div>
    </div>
  );
}

function Report({
  data, t, lang, catName, srcName, potName, recName,
}: {
  data: LostIntelligence; t: LostDict; lang: Lang;
  catName: (c: string | null | undefined) => string; srcName: (c: string) => string;
  potName: (c: string) => string; recName: (c: string) => string;
}) {
  const k = data.kpis;
  const maxMonthLost = Math.max(1, ...data.monthly.map((m) => Number(m.lost_value)));

  return (
    <>
      {/* ===== ١) كم ===== */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label={t.kTotal} value={money(k.total, lang)} sub={`${t.kOpen} ${money(k.open, lang)}`} />
        <Kpi label={t.kWon} value={money(k.won, lang)} sub={`${t.kWinRate} ${pct(k.win_rate)}`} tone="text-green-700" />
        <Kpi label={t.kLost} value={money(k.lost, lang)} sub={`${t.kLostRate} ${pct(k.lost_rate)}`} tone="text-red-700" />
        <Kpi label={t.kWonValue} value={compactMoney(k.won_value, lang)} sub={money(k.won_value, lang)} tone="text-green-700" />
        <Kpi label={t.kLostValue} value={compactMoney(k.lost_value, lang)}
             sub={Number(k.lost_value_estimated) > 0 ? `${t.valueEstimated}: ${compactMoney(k.lost_value_estimated, lang)}` : money(k.lost_value, lang)}
             tone="text-red-700" />
        <Kpi label={t.kRecoverable} value={compactMoney(k.recoverable_value, lang)}
             sub={`${money(k.recoverable_count, lang)} ${t.opportunities} · ${t.kRecovered} ${money(k.recovered_count, lang)}`}
             tone="text-emerald-700" />
      </section>
      {k.unanalysed > 0 && (
        <p className="-mt-3 text-xs text-amber-700">
          {t.kUnanalysed}: {k.unanalysed} · <Link href="?category_id=none" className="underline">{t.analyse}</Link>
        </p>
      )}

      {/* ===== ٢) الرؤى ===== */}
      <section>
        <h2 className="mb-2 flex items-center gap-1 font-bold text-gray-800">
          <span className="material-symbols-outlined text-[20px] text-brand-600">lightbulb</span>{t.insights}
        </h2>
        {data.insights.length === 0 ? (
          <p className="rounded-lg border border-gray-200 bg-white px-4 py-4 text-sm text-gray-400">{t.noInsights}</p>
        ) : (
          <ul className="grid gap-2 lg:grid-cols-2">
            {data.insights.map((ins, i) => (
              <li key={i} className={`rounded-lg border p-3 text-sm ${INSIGHT_STYLE[ins.level] ?? INSIGHT_STYLE.info}`}>
                {insightText(ins, lang, catName)}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ===== ٣) لماذا ===== */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Card title={t.topReasons}>
          {data.by_category.length === 0 ? <Empty t={t} /> : (
            <ul className="space-y-2.5">
              {data.by_category.slice(0, 10).map((r) => (
                <li key={r.code}>
                  <ShareBar label={catName(r.code)} share={Number(r.share ?? 0)}
                            right={`${r.n} · ${compactMoney(r.value, lang)}`}
                            hint={lang === "en" ? r.top_reason_en : r.top_reason_ar} muted={r.code === "unanalysed"} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={t.byReason}>
          {data.by_reason.length === 0 ? <Empty t={t} /> : (
            <Table head={[t.reason, t.category, t.count, t.share, t.value]}>
              {data.by_reason.map((r, i) => (
                <tr key={i}>
                  <Td strong>{lang === "en" ? r.name_en : r.name_ar}</Td>
                  <Td>{catName(r.code)}</Td>
                  <Td>{r.n}</Td>
                  <Td>{pct(r.share)}</Td>
                  <Td>{compactMoney(r.value, lang)}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <Card title={t.byLossSource}>
          {data.by_loss_source.length === 0 ? <Empty t={t} /> : (
            <ul className="space-y-2.5">
              {data.by_loss_source.map((r) => (
                <li key={r.code}>
                  <ShareBar label={srcName(r.code)} share={Number(r.share ?? 0)} right={`${r.n} · ${compactMoney(r.value, lang)}`} muted={r.code === "unanalysed"} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={t.byPotential}>
          {data.by_potential.length === 0 ? <Empty t={t} /> : (
            <Table head={[t.customerPotential, t.count, t.value]}>
              {data.by_potential.map((r) => (
                <tr key={r.code}><Td strong>{potName(r.code)}</Td><Td>{r.n}</Td><Td>{compactMoney(r.value, lang)}</Td></tr>
              ))}
            </Table>
          )}
          {data.by_recovery.length > 0 && (
            <div className="mt-4">
              <Table head={[t.recovery, t.count, t.value]}>
                {data.by_recovery.map((r) => (
                  <tr key={r.code}><Td strong>{r.code === "unanalysed" ? t.kUnanalysed : recName(r.code)}</Td><Td>{r.n}</Td><Td>{compactMoney(r.value, lang)}</Td></tr>
                ))}
              </Table>
            </div>
          )}
        </Card>
      </section>

      {/* ===== ٤) أين ===== */}
      <nav className="sticky top-0 z-10 -mx-4 flex gap-1 overflow-x-auto border-y bg-white/95 px-4 py-2 text-sm backdrop-blur sm:-mx-6 sm:px-6">
        {[["stage", t.byStage], ["project", t.byProject], ["employee", t.byEmployee], ["source", t.bySource],
          ["campaign", t.byCampaign], ["band", t.byPriceBand], ["size", t.byUnitSize], ["competitor", t.byCompetitor],
          ["monthly", t.monthly], ["recoverable", t.recoverableList]].map(([id, label]) => (
          <a key={id} href={`#${id}`} className="whitespace-nowrap rounded-full px-3 py-1 text-gray-600 hover:bg-brand-50 hover:text-brand-700">{label}</a>
        ))}
      </nav>

      <section id="stage" className="grid scroll-mt-14 gap-4 lg:grid-cols-2">
        <Card title={t.byStage}>
          {data.by_stage.length === 0 ? <Empty t={t} /> : (
            <ul className="space-y-2.5">
              {data.by_stage.map((r) => (
                <li key={r.stage}>
                  <ShareBar label={r.stage === "—" ? t.unknown : tValue(r.stage, lang)} share={Number(r.share ?? 0)}
                            right={`${r.n} · ${compactMoney(r.value, lang)}`} hint={r.main_category ? catName(r.main_category) : null} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={t.byMilestone}>
          {data.by_milestone.length === 0 ? <Empty t={t} /> : (
            <ul className="space-y-2.5">
              {data.by_milestone.sort((a, b) => b.n - a.n).map((r) => (
                <li key={r.code}>
                  <ShareBar label={milestoneLabel(r.code, lang)} share={Number(r.share ?? 0)} right={`${r.n} · ${compactMoney(r.value, lang)}`} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <DimSection id="project" title={t.byProject} rows={data.by_project} t={t} lang={lang} catName={catName}
                  first={t.project} label={(r) => r.label ?? t.noProject} />

      <DimSection id="employee" title={t.byEmployee} note={t.ratioNote} rows={data.by_employee} t={t} lang={lang} catName={catName}
                  first={t.employee} label={(r) => r.label ?? t.noOwner} withRecovery />

      <DimSection id="source" title={t.bySource} rows={data.by_source} t={t} lang={lang} catName={catName}
                  first={t.source} label={(r) => r.key ?? t.unknown} withLeads />

      <DimSection id="campaign" title={t.byCampaign} rows={data.by_campaign} t={t} lang={lang} catName={catName}
                  first={t.campaign} label={(r) => r.label ?? r.key ?? "—"} withLeads withQuality />

      <DimSection id="band" title={t.byPriceBand} rows={[...data.by_price_band].sort((a, b) => PRICE_BANDS.indexOf(a.key as never) - PRICE_BANDS.indexOf(b.key as never))}
                  t={t} lang={lang} catName={catName} first={t.priceBand} label={(r) => bandLabel(r.key, lang)} />

      <DimSection id="size" title={t.byUnitSize} rows={data.by_unit_size} t={t} lang={lang} catName={catName}
                  first={t.unitSize} label={(r) => (r.key ? `${r.key} m²` : t.unknown)} />

      <section id="competitor" className="scroll-mt-14">
        <Card title={t.byCompetitor}>
          {data.by_competitor.length === 0 ? <Empty t={t} /> : (
            <Table head={[t.competitor, t.kLost, t.kLostValue, t.mainReason, t.priceDiffM2, t.priceDiff, t.competitorPlan, t.projectsLost]}>
              {data.by_competitor.map((r) => (
                <tr key={r.key}>
                  <Td strong>{r.name}</Td>
                  <Td>{r.n}</Td>
                  <Td>{compactMoney(r.value, lang)}</Td>
                  <Td>{lang === "en" ? r.main_reason_en : r.main_reason_ar}</Td>
                  <Td>{r.avg_m2_diff !== null ? `${Number(r.avg_m2_diff) > 0 ? "+" : ""}${money(r.avg_m2_diff, lang)}` : "—"}</Td>
                  <Td>{r.avg_price_diff !== null ? `${Number(r.avg_price_diff) > 0 ? "+" : ""}${compactMoney(r.avg_price_diff, lang)}` : "—"}</Td>
                  <Td>{r.payment_plans ?? "—"}</Td>
                  <Td>{r.projects ?? "—"}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </section>

      {/* ===== ٥) متى ===== */}
      <section id="monthly" className="scroll-mt-14">
        <Card title={t.monthly} sub={`${data.period.trend_from} → ${data.period.trend_to}`}>
          {data.monthly.length === 0 ? <Empty t={t} /> : (
            <Table head={[t.month, t.kWon, t.kLost, t.kLostRate, t.kWonValue, t.kLostValue, t.mainReason, t.topProject, t.topCompetitor]}>
              {data.monthly.map((m) => (
                <tr key={m.m}>
                  <Td strong><span dir="ltr">{m.m.slice(0, 7)}</span></Td>
                  <Td>{m.won}</Td>
                  <Td>{m.lost}</Td>
                  <Td>{pct(m.lost_rate)}</Td>
                  <Td>{compactMoney(m.won_value, lang)}</Td>
                  <Td>
                    {/* سلسلة واحدة على محور واحد: القيمة الخاسرة نسبةً لأكبر شهر */}
                    <div className="flex min-w-[8rem] items-center gap-2" title={money(m.lost_value, lang)}>
                      <div className="h-2 flex-1 rounded-full bg-gray-100">
                        <div className="h-2 rounded-full bg-red-500" style={{ width: `${(100 * Number(m.lost_value)) / maxMonthLost}%` }} />
                      </div>
                      <span className="whitespace-nowrap text-gray-700">{compactMoney(m.lost_value, lang)}</span>
                    </div>
                  </Td>
                  <Td>{m.top_category ? catName(m.top_category) : "—"}</Td>
                  <Td>{m.top_project ?? "—"}</Td>
                  <Td>{m.top_competitor ?? "—"}</Td>
                </tr>
              ))}
            </Table>
          )}
          <ReasonTrend data={data} catName={catName} t={t} />
        </Card>
      </section>

      {/* ===== ٦) ماذا نفعل ===== */}
      <section id="recoverable" className="scroll-mt-14">
        <Card title={t.recoverableList}>
          {data.recoverable.length === 0 ? <Empty t={t} /> : (
            <Table head={[t.customer, t.project, t.value, t.category, t.recovery, t.employee, t.lastContact, t.recontactDate, t.daysSinceLost]}>
              {data.recoverable.map((r) => (
                <tr key={r.loss_id}>
                  <Td strong>
                    <Link href={`/dashboard/crm/opportunities/${r.opportunity_id}?tab=lost`} className="text-brand-600 hover:underline">{r.client_name}</Link>
                  </Td>
                  <Td>{r.project_name ?? "—"}</Td>
                  <Td>{compactMoney(r.value, lang)}</Td>
                  <Td>{catName(r.cat_code)}{(r.rsn_ar || r.rsn_en) && <span className="block text-[11px] text-gray-400">{lang === "en" ? r.rsn_en : r.rsn_ar}</span>}</Td>
                  <Td>{recName(r.recovery_potential)}</Td>
                  <Td>{r.owner_name ?? "—"}</Td>
                  <Td><span dir="ltr">{r.last_activity_at?.slice(0, 10) ?? "—"}</span></Td>
                  <Td>
                    <span dir="ltr" className={r.recontact_date && r.recontact_date < new Date().toISOString().slice(0, 10) ? "font-semibold text-red-700" : ""}>
                      {r.recontact_date ?? "—"}
                    </span>
                  </Td>
                  <Td>{r.days_since_lost} {t.days}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </section>
    </>
  );
}

// ===== المكوّنات =====

function DimSection({
  id, title, note, rows, t, lang, catName, first, label, withLeads, withQuality, withRecovery,
}: {
  id: string; title: string; note?: string; rows: DimRow[]; t: LostDict; lang: Lang;
  catName: (c: string | null | undefined) => string; first: string; label: (r: DimRow) => string;
  withLeads?: boolean; withQuality?: boolean; withRecovery?: boolean;
}) {
  const head = [
    first,
    ...(withLeads ? [t.leads, t.qualified] : []),
    t.opportunities, t.kWon, t.kLost, t.conversion, t.kLostRate, t.kWonValue, t.kLostValue, t.mainReason,
    ...(withRecovery ? [t.recoverable, t.recoveryRate] : [t.recoverable]),
    ...(withQuality ? [t.priceLost, t.oppPerLead] : []),
  ];
  return (
    <section id={id} className="scroll-mt-14">
      <Card title={title} sub={note}>
        {rows.length === 0 ? <Empty t={t} /> : (
          <Table head={head}>
            {rows.map((r, i) => {
              const lowQuality = withQuality && (r.leads ?? 0) >= 10 && r.qualified_rate !== null && r.qualified_rate !== undefined && Number(r.qualified_rate) < 20;
              return (
                <tr key={`${r.key}-${i}`}>
                  <Td strong>{label(r)}{lowQuality && <span className="ms-1 rounded bg-amber-100 px-1.5 text-[10px] text-amber-800">{t.qualityLow}</span>}</Td>
                  {withLeads && <><Td>{r.leads ?? 0}</Td><Td>{r.qualified ?? 0}</Td></>}
                  <Td>{r.total}</Td>
                  <Td>{r.won}</Td>
                  <Td>{r.lost}</Td>
                  <Td>{pct(r.win_rate)}</Td>
                  <Td><RateCell v={r.lost_rate} /></Td>
                  <Td>{compactMoney(r.won_value, lang)}</Td>
                  <Td>{compactMoney(r.lost_value, lang)}</Td>
                  <Td>{r.main_category ? catName(r.main_category) : "—"}</Td>
                  <Td>{r.recoverable}{Number(r.recoverable_value) > 0 && <span className="block text-[11px] text-gray-400">{compactMoney(r.recoverable_value, lang)}</span>}</Td>
                  {withRecovery && <Td>{pct(r.recovery_rate)}</Td>}
                  {withQuality && <><Td>{r.price_lost}</Td><Td>{r.opp_per_lead ?? "—"}</Td></>}
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </section>
  );
}

function ReasonTrend({ data, catName, t }: { data: LostIntelligence; catName: (c: string) => string; t: LostDict }) {
  const months = Array.from(new Set(data.reason_trend.map((r) => r.m))).sort().slice(-6);
  if (months.length < 2) return null;
  const codes = Array.from(new Set(data.reason_trend.filter((r) => months.includes(r.m)).map((r) => r.code)));
  const cell = (m: string, c: string) => data.reason_trend.find((r) => r.m === m && r.code === c)?.n ?? 0;
  return (
    <div className="mt-5">
      <p className="mb-2 text-xs font-semibold text-gray-600">{t.reasonTrend}</p>
      <Table head={[t.category, ...months.map((m) => m.slice(0, 7))]}>
        {codes.map((c) => (
          <tr key={c}>
            <Td strong>{catName(c)}</Td>
            {months.map((m) => <Td key={m}>{cell(m, c) || "·"}</Td>)}
          </tr>
        ))}
      </Table>
    </div>
  );
}

function RateCell({ v }: { v: number | null }) {
  if (v === null || v === undefined) return <>—</>;
  const n = Number(v);
  return <span className={n >= 70 ? "font-semibold text-red-700" : n >= 50 ? "text-amber-700" : "text-gray-700"}>{n}%</span>;
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className={`text-2xl font-bold ${tone ?? "text-gray-800"}`}>{value}</p>
      <p className="text-sm text-gray-600">{label}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <h3 className="font-bold text-gray-800">{title}</h3>
      {sub && <p className="mb-3 text-xs text-gray-400">{sub}</p>}
      <div className={sub ? "" : "mt-3"}>{children}</div>
    </div>
  );
}

// شريط حصّة: سلسلة واحدة بلون واحد، والقيمة نصّاً بجانبه لا لوناً وحده
function ShareBar({ label, share, right, hint, muted }: { label: string; share: number; right: string; hint?: string | null; muted?: boolean }) {
  return (
    <div title={`${label}: ${share}% — ${right}`}>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
        <span className={`font-medium ${muted ? "text-gray-400" : "text-gray-800"}`}>{label}</span>
        <span className="whitespace-nowrap text-xs text-gray-600"><b className="text-gray-800">{share}%</b> · {right}</span>
      </div>
      <div className="h-2 rounded-full bg-gray-100">
        <div className={`h-2 rounded-full ${muted ? "bg-gray-300" : "bg-red-500"}`} style={{ width: `${Math.min(100, Math.max(share, 0.5))}%` }} />
      </div>
      {hint && <p className="mt-0.5 text-[11px] text-gray-400">{hint}</p>}
    </div>
  );
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className="w-full min-w-max text-start text-sm">
        <thead className="text-xs text-gray-500">
          <tr className="border-b">
            {head.map((h, i) => <th key={i} className="whitespace-nowrap px-3 py-2 text-start font-medium">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">{children}</tbody>
      </table>
    </div>
  );
}

function Td({ children, strong }: { children: React.ReactNode; strong?: boolean }) {
  return <td className={`px-3 py-2 ${strong ? "font-medium text-gray-800" : "text-gray-600"}`}>{children}</td>;
}

function Empty({ t }: { t: LostDict }) {
  return <p className="py-4 text-center text-sm text-gray-400">{t.empty}</p>;
}

function DateField({ name, label, value }: { name: string; label: string; value?: string }) {
  return (
    <label className="block text-xs text-gray-500">
      {label}
      <input type="date" name={name} defaultValue={value} dir="ltr"
             className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-800" />
    </label>
  );
}

function Select({ name, label, value, all, options }: { name: string; label: string; value?: string; all: string; options: { value: string; label: string }[] }) {
  return (
    <label className="block text-xs text-gray-500">
      {label}
      <select name={name} defaultValue={value ?? ""} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800">
        <option value="">{all}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
