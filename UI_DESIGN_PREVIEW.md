# Tilal ERP — UI design preview

A working, isolated prototype of a redesigned application shell and executive
dashboard. It lives at **`/design-preview`** and changes nothing in the
production interface.

## Visual direction

| Decision | Choice | Why |
|---|---|---|
| Brand green | `#2E5A40`, sampled from `public/logo.png` | The live UI uses Tailwind emerald `#064E3B`, which is cooler and bluer than Tilal's printed identity. |
| Sidebar | Deep forest `#173123` | Darker sibling of the logo green; mint `#A6DEC0` is used only for the active item. |
| Surfaces | Cool paper `#F4F5F2`, white panels, `#E1E4DF` hairlines | Calm and neutral; panels are bordered, not shadowed. Shadows are reserved for floating layers. |
| Text | Graphite `#1C2320` / `#525C56` / `#68726C` | All pairs pass WCAG AA (4.5:1 or better). |
| Type | IBM Plex Sans Arabic only (already shipped via `next/font`) | One family for Arabic and English. One hero figure (sales, 40px), then 26px, 20px and 15px tiers. |
| Chart colors | Series `#2B8058`, second series `#D9A23F` (ochre), previous period grey | Run through the dataviz colour-blindness validator: protan ΔE 17, normal ΔE 25.8, all checks pass. |
| Signature | **Skyline** sales chart | Sales columns stand like the towers in the Tilal logo; the previous period is a grey cap tick, not a second bar. The active nav item uses the same "tower" bar. |

What changed relative to the current dashboard:

- The 14 KPIs are **one instrument panel** with three tiers divided by hairlines, not 14 separate cards.
- Filters are **one toolbar**: period on the first row, project/team/source on the second, with removable chips for active filters and a reset button.
- The sidebar is **grouped** (Daily work / Management), with expandable CRM, Finance and HR groups. It collapses to icons on desktop (the choice is remembered per browser) and becomes a drawer on mobile.
- Quick actions are one primary action, one secondary action, and a menu for the rest.
- Every section has loading, empty and error states.

## Routes and access

| Route | Content |
|---|---|
| `/design-preview` | Executive dashboard |
| `/design-preview/system` | Design-system reference: tokens and every component, rendered live |

Access is unchanged and stricter than needed:

- The existing middleware blocks anyone who isn't signed in. No middleware edit was made. Verified against `next start`: both routes redirect to `/login` with a 307.
- `layout.tsx` redirects inactive accounts and non-admins to `/dashboard`. The preview shows the admin navigation, so it is admin-only.
- The page is marked `noindex`.

## Files

**Modified (1)**

- `tailwind.config.ts`: added a namespaced `tp-*` colour set and the `tp-overlay` shadow. The values are CSS variables defined only inside `.tp-root`, so no existing screen can pick them up.

**Created**

```
UI_DESIGN_PREVIEW.md
src/app/design-preview/
  layout.tsx                 auth/admin gate, scoped root, metadata
  page.tsx                   dashboard route
  system/page.tsx            design-system route
  preview.css                tokens + motion, every selector scoped under .tp-root
  _lib/copy.ts               preview-only strings (ar/en), separate from production dictionaries
  _lib/nav.ts                admin navigation model (same items/routes/order as dashboard/layout.tsx)
  _lib/mock-data.ts          ALL mock data, seeded and deterministic
  _components/ui.tsx         Button, IconButton, Tooltip, Badge, Segmented, Tabs, Field, Select,
                             Popover, Menu, Dialog, Toast, Skeleton, Empty/Error states,
                             Pagination, Panel, SectionHeader, DeltaChip
  _components/charts.tsx     Skyline, MiniSkyline, PairedColumns, BarList, Funnel, Meter
  _components/shell.tsx      sidebar, header, preview ribbon, Ctrl+K palette,
                             notifications, user menu, new-lead dialog
  _components/dashboard.tsx  executive dashboard
  _components/system-sheet.tsx
```

**Reused from production, unchanged:** `useI18n` and the `t.nav` / `t.dash`
dictionaries (all KPI names, definitions and section titles), `format.ts`
(IQD formatting, Baghdad dates, Arabic bidi isolation), `compareValues`
(the good/bad verdict on a change), `rankProjects`, the language cookie
mechanism, `LogoutButton`, `public/logo-white.png` (the tower mark is a CSS
crop of the real logo, not a new asset), and Material Symbols.

## What uses mock data

Everything numeric. The data comes from `_lib/mock-data.ts`, which is
deterministic per filter and date. The preview reads nothing from Supabase
except the session identity in `layout.tsx`, and writes nothing.

A ribbon on every page says the figures are sample data, and each section
carries a "تجريبي / Sample" badge.

| Interaction | Behaviour |
|---|---|
| Period / project / team / source filters, grain (day/week/month), chart ↔ table | Recompute mock data locally, with a brief loading state |
| New lead | Real form validation; on save, a toast says **nothing was saved** |
| New reservation, the actions menu, attention CTAs | Toast: unavailable in the preview |
| Today's tasks checkboxes | Toggle locally; a toast says the change is not saved |
| Mark notifications read | Local only; a toast says so |
| Sidebar items other than Dashboard | Panel "this screen keeps its current design" with a link to the real screen |
| Data-state switch (ribbon) | Shows the Loaded / Loading / Empty / Error states on all sections |
| Language switch, sign out | **Real**: the same cookie mechanism and the same `LogoutButton` as production |

## Running and inspecting it

```bash
npm run dev
# sign in as an admin, then open:
http://localhost:3000/design-preview
http://localhost:3000/design-preview/system
```

Things to try:

- Ctrl+K opens the screen palette.
- Collapse the sidebar with the panel icon.
- Use the arrow keys on the sales chart.
- Switch ع/EN to flip RTL/LTR.
- Use the ribbon's data-state switch.
- Narrow the window below 768px.

## Verification performed

| Check | Result |
|---|---|
| `tsc --noEmit` | pass |
| `vitest run` | 18 files, 269 tests pass |
| `next build` | pass; `/dashboard` builds at the same size (11.7 kB) |
| `next lint` | **not run**: the repo has no ESLint config, and `next lint` would start an interactive setup |
| Playwright | none in the project |
| Auth (`next start`, anonymous) | `/design-preview`, `/design-preview/system` and `/dashboard` all redirect 307 to `/login` |
| Visual / interaction QA | 20 scenarios in headless Chrome over the DevTools protocol, at 1440 / 820 / 390px in Arabic and English: drawer, collapsed sidebar, dialog validation, mobile sheet, palette search, notifications, the four data states, filters and chips, keyboard chart tooltip, table sort and pagination, actions menu. Result: **0 console errors, 0 horizontal overflow, icons loaded** |

The visual QA ran the preview components in a harness outside Next, using the
same Tailwind config and CSS. It could not use the real route because no admin
session was available, and auth was not bypassed. Server-side rendering of the
real route was therefore verified by `next build` and the redirect check, not
by screenshots.

## Applying this to production later

1. **Tokens.** Move the `--tp-*` values into the existing `brand` / `ink` /
   `surface` / `line` keys in `tailwind.config.ts`, and drop the `tp` namespace.
2. **Shell.** Port `Sidebar`, `NavItem` and `Header` into
   `dashboard/app-shell.tsx`. Keep building `NavItem[]` per role in
   `dashboard/layout.tsx`; only add `group` and `children` fields. Do not build
   the menu from `_lib/nav.ts`, which is the admin menu only.
3. **Dashboard.** Keep the server components and data functions in `_sections/*`
   as they are. Swap only their presentation: `KpiGrid` becomes the band, and
   `TrendChart` becomes `Skyline`. Every label in the preview already comes
   from the production dictionaries.
4. **Charts.** Production charts are server components. `Skyline` and
   `PairedColumns` are client components because of keyboard and hover
   tooltips. Either accept the small client cost, or render the bars on the
   server and hydrate only the tooltip layer.
5. **Remove the preview.** Delete `src/app/design-preview/`, the `tp` keys in
   `tailwind.config.ts`, and this file.

## Left untouched

Database schema and migrations, Supabase configuration, PostgreSQL functions
and triggers, RLS policies, authentication and authorization logic
(`middleware.ts`, `lib/auth.ts`), API routes and server actions, financial,
commission, payroll, CRM and reservation logic, production data, every
existing route and component, `globals.css`, `package.json` (no new
dependencies), and the production i18n dictionaries.

## Where it is published (2026-10-27)

| Destination | Location | Status |
|---|---|---|
| Git | branch `feat/tilal-design-preview`, design commit `69789dc` (2026-10-27 15:08 +03:00), based on `9092aa9` (= `main` at that time) | Pushed and verified: the remote head matches the local head |
| GitHub | https://github.com/aljaberyabdulla0-a11y/Tilal-ERP/tree/feat/tilal-design-preview | Off-machine copy of the full source |
| Vercel (preview only) | project `tilal-erp`, team "Tilal". Stable branch URL: `https://tilal-erp-git-feat-tilal-design-preview-jannat-crm-s-projects.vercel.app/design-preview` | Built by the existing Git integration (`main` deploys to production; other branches deploy as previews). Production was not touched |
| Additional backup | none | No backup destination for source code is configured for this project. None was created |

**Access:** Vercel Authentication (team SSO) protects every preview. Behind it,
the app requires sign-in, and `/design-preview` is admin-only. Both layers
were left as they are.

**Recovery:**

```bash
git fetch origin
git switch feat/tilal-design-preview   # or: git checkout 69789dc
```

To redeploy, push to the branch. Vercel rebuilds the preview at the same
branch URL. Never merge this branch into `main` without a decision to ship:
`main` deploys to production.
