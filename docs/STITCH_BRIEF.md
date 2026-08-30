# Tilal ERP — Product & Design Brief (for Google Stitch)

> Paste sections 1–6 into Stitch as project context / design-system input, then
> use the per-screen prompts in section 7 to generate individual screens.

---

## 1. What the product is

**Tilal ERP** is an internal web application for **Tilal Real Estate Marketing**,
a real-estate marketing company in Iraq. One system runs the whole company:
sales pipeline (CRM), real-estate inventory (projects / units / reservations),
invoicing, double-entry accounting, HR (employees, attendance, leaves, payroll),
office-supplies inventory, internal chat and tasks, and a **broker network**
where external brokerage companies bring leads into Tilal's projects and earn
commissions.

- **Language:** Arabic, **right-to-left (RTL)** everywhere. English is a
  secondary language (the app ships an ar/en dictionary), so every layout must
  mirror cleanly in both directions.
- **Currency:** Iraqi Dinar (IQD, "د.ع"), large numbers with thousand
  separators (e.g. 385,900,000).
- **Timezone:** Asia/Baghdad. Dates as `YYYY-MM-DD` or Arabic short dates.
- **Users:** ~10–60 internal staff plus external broker-company accounts.
- **Devices:** desktop-first (staff work on laptops), but managers and sales
  agents open it on phones constantly — mobile must be first-class.
- **Tech (context only):** Next.js 14 App Router + Tailwind CSS + Supabase.
  Icons are **Google Material Symbols (Outlined)**.

**Tone:** calm, executive, trustworthy. Not a playful startup dashboard. Dense
but breathable. It should feel like a serious business system a company owner is
happy to open in front of a client.

---

## 2. Design system

### Colors — "Emerald Executive"

| Role | Hex | Use |
|---|---|---|
| Primary (deep emerald) | `#064E3B` | Sidebar active state, primary buttons, headings, KPI accents |
| Primary darker | `#053A2C` | Button hover, active nav |
| Accent emerald | `#10B981` | Focus rings, links, positive trends, charts |
| Tertiary mint | `#D1FAE5` | Soft backgrounds, badges, selected rows, chart fills |
| Mint lightest | `#ECFDF5` | Card tints, row hover |
| Secondary dark gray | `#1F2937` / `#374151` | Body text, secondary buttons |
| Neutral background | `#F9FAFB` | Page background |
| Surface | `#FFFFFF` | Cards, tables, modals |
| Border | `#E5E7EB` | Hairlines, dividers, input borders |

**Semantic badge pairs** (soft background + strong text):
- **Green** — available, approved, completed, paid
- **Amber** — reserved, pending, due soon, installments
- **Red** — overdue, rejected, deduction, low stock, expired deadline
- **Blue** — informational, mortgage, in progress
- **Gray** — cancelled, neutral, empty

### Typography
- Arabic UI font: a clean modern Arabic sans (Cairo / IBM Plex Sans Arabic /
  Noto Sans Arabic).
- Numbers, emails and phone numbers render **LTR inside RTL text**.
- Scale: page title 20–24px bold · section title 16–18px bold · body 14px ·
  meta/labels 12px gray-500 · tables 13–14px.

### Signature components
- **Glass card** — `rgba(255,255,255,.7)` + `backdrop-filter: blur(20px)`,
  1px semi-white border, **16px radius**, shadow `0 10px 25px -5px rgba(0,0,0,.05)`.
  Used for KPI tiles and dashboard panels over a subtle mint gradient.
- **Solid card** — white, 12–16px radius, 1px `#E5E7EB` border, very soft shadow.
- **Pill badge** — fully rounded, 12px, semi-bold, soft color pair.
- **Data table** — white card, gray-50 sticky header, hairline dividers, row
  hover `#F9FAFB`, horizontal scroll on mobile. Never a raw HTML-table look.
- **Stat tile** — small Arabic label, big number, Material icon in a tinted
  circle, optional trend chip.
- **Side-accent card** — 4px colored border on the **inline-start** edge to
  signal status (red = late task, amber = due follow-up).
- **Buttons** — primary: solid `#064E3B`, white text, 10px radius; secondary:
  white + gray border; danger: red-600 text on red-50.
- **Empty state** — centered Material icon in a mint circle, one Arabic
  sentence, one primary action button.

### Layout rules
- **Desktop:** fixed sidebar on the **right** (RTL), 240–260px, emerald active
  pill; content on the left with a slim top bar (page title, search,
  notifications bell with count, user avatar + role chip, language switcher).
- **Mobile:** sidebar becomes a right-side slide-in drawer; tables collapse into
  stacked cards; primary action becomes a floating button.
- Use **CSS logical properties** (`start`/`end`, `margin-inline-start`) so the
  same layout mirrors for English.
- 24px page padding, 16–20px gaps between cards.

---

## 3. Roles — six of them, each sees a different app

Permission separation is the core of this product. Sidebar and home dashboard
change completely per role.

| Role (Arabic) | Key | What they get |
|---|---|---|
| **مدير** (Manager/Admin) | `admin` | Everything: CRM, units, reservations, invoices, full accounting, HR + payroll, projects, inventory, brokers, settings, all users |
| **مشرف** (Supervisor) | `supervisor` | Scoped to their project: team leads, activities, attendance, leave approvals, units, reservations. **No** accounting, **no** payroll |
| **مدير المتابعة** (Follow-up Manager) | `followup_manager` | Daily operations: full office **inventory** (items, purchases, issues, suppliers, reports), **employee follow-up** (data, attendance, leaves, notes), **call/communication follow-up** and open requests, tasks, and **applying salary deductions**. Explicitly blocked from invoices, accounting, payroll, leave approval |
| **مدير العلاقات (RM)** | `relationship_manager` | Watches the **broker companies under his umbrella** inside his project: their leads, their 30-day deadlines, their commissions. Read-oriented — cannot assign or pay |
| **شركة وسيطة** (Broker — external) | `broker` | A separate mini-app: only **their own** leads in the assigned project(s), add/edit leads, the countdown to the 30-day deadline, and their commissions and payments. No internal Tilal data, no chat |
| **موظف** (Employee / sales agent) | `employee` | Their own clients only, their tasks, chat, their attendance / leaves / salary slip |

### The broker rule that drives the UI
A broker company adds a lead → it is stamped with the company, the project and a
**deadline = +30 days (non-renewable)**. If the deal is not closed in time the
lead **automatically returns to Tilal** for redistribution, and the transfer is
logged. Commission = **a per-company percentage of the unit price**, paid in
instalments and tracked as paid / partially paid / unpaid. So the countdown chip
and the commission status chip are the two most important visual elements of the
whole broker module.

---

## 4. Domain vocabulary (use these exact Arabic strings in the UI)

- **Pipeline stages:** ليد · اتصال · زيارة · مناقشة العرض · بيع · فشل البيع
  (last two are "closed").
- **Lead sources:** سوشيل ميديا · صديق أو معارف · مرّ من المنطقة · مكتب عقاري
- **Payment methods:** أقساط · كاش · نص كاش · قرض عقاري
- **Unit status:** متاحة (green) · محجوزة (amber) · مباعة (red)
- **Reservation status:** حجز (amber) · بيع مكتمل (green) · ملغى (gray)
- **Task status:** جديدة · قيد التنفيذ · منجزة · ملغاة —
  **priority:** عاجلة · متوسطة · عادية
- **Leave types:** سنوية · مرضية · طارئة · بدون راتب —
  **status:** معلقة · موافق عليها · مرفوضة
- **Deduction reasons:** تأخير · غياب · خروج مبكر · …
- **Inventory categories:** مطبوعات ومواد تسويقية · مياه شرب · مواد تنظيف ·
  معطرات · مناديل · مستلزمات مكتبية · أخرى

---

## 5. Screen inventory (~49 screens)

### A. Public
1. **Login** — centered card on an emerald gradient, logo, email + password with
   show/hide, "forgot password", tagline "تلال للتسويق العقاري — نظام الإدارة".
2. **Forgot password** / 3. **Reset password** — same card shell.

### B. Home dashboards (one per role, same shell)
4. **Manager** — greeting + date; KPI tiles (leads this month, sales, monthly
   revenue, collections, open tasks); **sales funnel** across the pipeline
   stages; monthly-revenue bar chart; recent-activity feed; quick-access tiles.
5. **Supervisor** — team leads by stage, today's follow-ups, team attendance,
   pending leave requests.
6. **Follow-up Manager** — the operations board: *materials near empty* (red
   list), latest purchases, latest issues, **open requests**, **calls needing
   follow-up**, employee notes, **late / unclosed tasks**.
7. **RM** — companies under him, leads per company, deadlines expiring this
   week, commissions earned vs paid.
8. **Broker (external)** — my leads by stage, days remaining on each, leads
   returned to Tilal, commission total / paid / remaining.
9. **Employee** — my follow-ups today, my tasks, check-in/check-out button, my
   recent clients.

### C. CRM & sales
10. **CRM hub** — tabs: Clients · Activities · Units · Reservations · Reports.
11. **Clients list** — search + filters (stage, source, project, agent, payment
    method), stage pills, next-follow-up date colored by urgency.
12. **Clients board (Kanban)** — columns are the pipeline stages, drag cards
    between them; card shows name, phone, budget, agent avatar, next follow-up.
13. **Client detail** — header with name/phone/stage; timeline of activities
    (calls, visits, notes), reservations, invoices, alternate contact.
14. **New / edit client** — long Arabic form: name, international phone
    (default Iraq +964, also +970), source, budget, payment method, project,
    unit interest, next follow-up.
15. **Activities log** — call/visit log: who, when, outcome, next step.
16. **Import clients** — CSV upload with column mapping and preview.
17. **CRM reports** — conversion by stage, by source, by agent.
18. **Projects** — project cards (name, unit count, sold %, supervisor, team).
19–21. **Units** list / detail / form — number, type, area, floor, price, status.
22–24. **Reservations** list / detail / form — client, unit, amount, status,
    payment schedule.

### D. Money
25–27. **Invoices** list / detail / new — lines, totals, paid vs remaining,
    print-friendly view.
28. **Accounting hub** — chart of accounts, journal entries (list / detail /
    new), cash & bank moves, partners, debts, advanced tools.
29–31. **Reports** — Trial balance · Income statement · Balance sheet: clean
    financial tables with totals rows, period selector, export/print.

### E. HR
32. **HR hub** — employees, attendance, leaves, payroll.
33–35. **Employees** list / detail / form — photo, title, department, salary,
    hire date, documents.
36. **Attendance** — daily grid + monthly sheet, check-in/out, late/absent
    chips, geo-fenced check-in from defined work locations.
37. **Leaves** — requests with type and status, approve/reject.
38. **Payroll** — monthly run: base + allowances − deductions = net; post to
    accounting.
39. **My space** — my profile, my leaves, my salary slip.
40. **Follow-up: employees** — the Follow-up Manager's employee monitor with a
    **deductions manager** (reason, amount, note; appears on the next payslip).

### F. Office inventory (المخزون)
41. **Inventory hub** — tabs: Items · Movements · Suppliers · Reports, with a
    prominent **low-stock alert banner**.
42. **Items list** — name, category, current vs minimum qty as a **progress bar
    that turns red under the minimum**, unit of measure, supplier.
43. **Item detail** — the story of the item:
    "ماء → تم شراء 100 كارتون → تم صرف 20 → المتبقي 80" as a running-balance
    movement timeline.
44. **New / edit item** · **record movement** (شراء / صرف) — quantity, date,
    supplier, price, note.
45. **Suppliers** — simple managed list.
46. **Inventory reports** — purchase value by period/category, consumption rate,
    items below minimum.

### G. Broker network
47. **Brokers hub (admin/RM)** — tabs: Companies · Leads · Commissions.
48. **Company list / detail** — name, contact, **commission rate %**, assigned
    projects, assigned RM, linked login accounts, earned / paid / remaining.
49. **New / edit company** + **company accounts** (link a login to the company).
50. **Broker leads (internal)** — every broker lead with company, project,
    stage, **deadline countdown chip** (green > 10 days · amber ≤ 10 · red ≤ 3 ·
    gray = returned), and a manual "run scan" action.
51. **Returned leads** — leads that expired after 30 days and returned to Tilal,
    with the transfer log.
52. **Commissions** — per closed deal: unit price × rate = commission; status
    paid / partial / unpaid; add payment.
53. **Broker's own leads** (external) — list, new-lead form, lead detail with a
    big **days-remaining ring**.
54. **Broker's own commissions** — earned / paid / remaining + payment history.

### H. Everything else
55. **Tasks** — list + new/edit; priority and status chips; overdue rows red.
56. **Chat** — internal messenger (conversation list + thread) plus a floating
    chat widget on every page.
57. **Notifications** — grouped feed, a Material icon per type, unread highlight.
58. **My team** (supervisor) — team members with their KPIs.
59. **Settings (admin)** — work hours, work locations (geo-fence map for
    attendance), users table with a role dropdown, and an explanation of each
    role.
60. **My account** — profile, password, language (AR/EN).

---

## 6. What to improve in the redesign

The current UI is functional but plain: mostly white cards, gray borders, and
dense tables. Priorities for the new design:

1. **A stronger shell.** A real sidebar identity (emerald, with grouped nav
   sections and role chip), a proper top bar, and breadcrumbs on deep pages.
2. **Dashboards that read at a glance** — hierarchy between the one number that
   matters and the supporting ones; charts with the mint/emerald palette.
3. **Better tables** — sticky headers, aligned numeric columns, clear
   filter/search bars, bulk actions, obvious row-click affordance, and a real
   mobile card fallback.
4. **Status is the story** — countdown chips, stock progress bars, commission
   status, pipeline stage: these should be instantly readable, color-coded and
   consistent across every module.
5. **Forms that don't intimidate** — long Arabic forms split into titled
   sections in two columns on desktop, one column on mobile, with inline
   validation and a sticky save bar.
6. **Real RTL craft** — correct mirroring, Arabic numerals alignment, no
   left-over LTR spacing, icons flipped where directional.
7. **Print-ready** financial and payroll views.

---

## 7. Ready-to-paste Stitch prompts

Prefix every prompt with:
`Arabic RTL web app, "Emerald Executive" design system: primary #064E3B, accent #10B981, mint #D1FAE5, background #F9FAFB, white cards with 16px radius and soft shadows, Material Symbols Outlined icons, Cairo Arabic font.`

**Shell**
> Design the app shell for an Arabic RTL real-estate ERP: a fixed 256px sidebar on the right with the "تلال" logo, grouped navigation (لوحة التحكم، المهام، المحادثات، إدارة العملاء، الفواتير، المحاسبة، الموارد البشرية، المخزون، الوساطة، المشاريع، الإعدادات) using Material Symbols icons and an emerald active pill; a top bar with the page title, a search field, a notifications bell with a red count badge, a language switcher (AR/EN), and a user avatar with a role chip "مدير". Content area on a #F9FAFB background.

**Manager dashboard**
> Arabic RTL executive dashboard for a real-estate company. Top row: four glassmorphism KPI tiles (ليدات هذا الشهر، مبيعات الشهر، الإيراد الشهري، التحصيلات) each with a mint icon circle and a green trend chip. Below, a two-thirds/one-third split: a sales funnel chart across the stages ليد، اتصال، زيارة، مناقشة العرض، بيع, and a recent-activity feed with avatars. Bottom: a monthly revenue bar chart in emerald and a table of today's follow-ups.

**Clients Kanban**
> Arabic RTL Kanban board with six columns: ليد، اتصال، زيارة، مناقشة العرض، بيع، فشل البيع. Each column has a colored header with a count. Cards show client name, phone in LTR, budget in IQD, a small agent avatar, a source pill and a next-follow-up date chip that turns amber when due today and red when overdue. Include a top filter bar and a "عميل جديد" primary button.

**Inventory item detail**
> Arabic RTL page for a stock item "مياه شرب". Header card with the item name, category pill, supplier, and a large current-quantity number with a progress bar comparing it to the minimum quantity (red when below). Then a vertical movement timeline showing purchases in green and issues in amber with a running balance on each row: تم شراء 100 كارتون، تم صرف 20، المتبقي 80. A red low-stock alert banner at the top.

**Broker leads (internal)**
> Arabic RTL table page listing brokerage-company leads. Columns: العميل، الشركة الوسيطة، المشروع، المرحلة، تاريخ الإسناد، المهلة المتبقية. The deadline column uses a countdown chip: green above 10 days, amber at 10 or fewer, red at 3 or fewer, gray for "أُعيد إلى تلال". Above the table: four summary tiles and filters by company and project, plus a secondary "تشغيل الفحص" button.

**Broker portal (external)**
> Arabic RTL portal for an external brokerage company with a minimal sidebar of only three items (لوحة التحكم، ليداتنا، عمولاتنا). Main area: cards for each lead showing the client name, stage, and a circular progress ring counting the days left out of 30 before the lead returns to Tilal. A summary strip on top: إجمالي العمولات، المدفوع، المتبقي.

**Payroll**
> Arabic RTL monthly payroll screen: month selector, summary tiles (عدد الموظفين، إجمالي الرواتب، الاستقطاعات، الصافي), and a table of employees with columns الراتب الأساسي، البدلات، الاستقطاعات، الصافي, deductions shown in red with a tooltip listing reasons. A sticky footer with totals and a primary "ترحيل إلى المحاسبة" button.
