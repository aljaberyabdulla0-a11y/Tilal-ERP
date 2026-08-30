# Stitch — Tilal ERP Executive Dashboard

Downloaded from Google Stitch project **16353685017094880906**
("Tilal ERP Executive Dashboard", created 2026-08-30).

| File | Screen | Stitch screen ID |
|---|---|---|
| `00-design-system.md` | Design system "Emerald Executive" (theme + tokens) | `assets_6dbbc71887594b0cad805dcf469d724d` |
| `01-manager-dashboard.html` / `.png` | لوحة التحكم - المدير (نسخة مصححة) | `c0821f29060c49e5830bdbce4ff123cc` |
| `02-clients-kanban.html` / `.png` | إدارة العملاء (Kanban كامل) | `7c554b2ff9f14416bf4a49f416541f5c` |
| `03-inventory-item.html` / `.png` | تفاصيل الصنف - المخزون | `d5e9a4813a074d5aa9c2634d1358c029` |
| `04-broker-leads.html` / `.png` | ليدات الشركات الوسيطة | `2de1bb5012ae486099a2be3494e46d6d` |

Each HTML is standalone: `dir="rtl" lang="ar"`, Tailwind via CDN, IBM Plex Sans
Arabic + Material Symbols Outlined from Google Fonts. Open any `.html` directly
in a browser to preview.

## Theme confirmed by Stitch

- Primary `#064E3B` · secondary/accent `#10B981` · tertiary mint `#D1FAE5` ·
  neutral `#F9FAFB` — exactly the current app palette.
- Font: **IBM Plex Sans Arabic** (replaces the current font choice).
- Radius scale: 8px controls / 16px cards. Sidebar 256px, page padding 24px,
  gutter 16px, card padding 20px.

## Status of each screen

### 01 — Manager dashboard ✅ complete (regenerated 2026-08-30)
Full page: four KPI tiles, a six-stage sales funnel with conversion
percentages, an activity feed, a 12-month revenue bar chart, a units donut
(209 وحدة: متاحة 128 / محجوزة 34 / مباعة 47) and a "متابعات اليوم" table.
Currency is د.ع throughout and the table uses the real pipeline stages.
*Remaining nit:* the emerald sidebar does not stretch to the bottom of the very
tall page — harmless in a real viewport, fix when porting.

### 02 — Clients Kanban ✅ complete (regenerated + hand-finished 2026-08-30)
All six columns (ليد 45 · اتصال 28 · زيارة 17 · مناقشة العرض 12 · بيع 47 ·
فشل البيع 21) with 12 client cards, Iraqi names and phone numbers, budgets in
د.ع, "بيع مكتمل" chips in the sale column and faded cards with a reason chip in
the lost column. Only the four real lead sources appear.

Stitch left four columns empty on both attempts (it even wrote a code comment
admitting it), so the missing cards were inserted directly into the HTML with
`scratchpad/fill-kanban.js`, and the screenshot was re-rendered with headless
Chrome at 2100×1150 @2x.

### 03 — Inventory item detail ⚠️ needs corrections
- Currency shown as `ر.س` — must be **د.ع**.
- Invents fields we do not have: barcode, storage location
  (`المستودع الرئيسي - A2`), unit cost.
- Category pill says `مستلزمات مكتبية` on a water item — should be `مياه شرب`.
- The movement timeline (100 → −20 → 80 with a running balance) is exactly
  right and worth keeping as-is.

### 04 — Broker leads ⚠️ needs corrections
- Stage names are invented (تواصل مبدئي / زيارة موقع / مفاوضات / ملغى); the
  real ones are ليد · اتصال · زيارة · مناقشة العرض · بيع · فشل البيع.
- Sample names are Gulf, not Iraqi (الغامدي، العتيبي، الدوسري) — cosmetic.
- Everything else is the best of the four: four side-accent summary tiles, a
  filter row, colored countdown dots (green 14 يوم / amber 7 أيام / red 2 يوم /
  gray struck-through أُعيد إلى تلال) and pagination. It matches the real
  30-day broker rule.

## What is worth keeping across all screens

- The **shell**: dark emerald right sidebar with a mint pill for the active
  item, slim white top bar, breadcrumbs. Much stronger than the current layout.
- The **status-first visual language**: countdown dots, stock progress bar,
  follow-up chips, stage pills.
- The **inventory movement timeline** with a running balance after each move.
- The **low-stock red banner** and the quantity-vs-minimum progress bar.

## Known issue: Stitch calls time out through MCP

`edit_screens` and `generate_screen_from_text` take **50–115 seconds**, which is
longer than the MCP client's per-tool timeout, so every call fails with
"The operation timed out" and the edit is silently dropped — running two calls
in parallel makes it worse.

**Workaround used here** — call the Stitch MCP endpoint directly over HTTP with
a long curl timeout. The server is stateless, so no session handshake is needed:

```bash
KEY=$(node -e "console.log(require('C:/Users/HP/.claude.json').mcpServers.stitch.headers['X-Goog-Api-Key'])")
curl -s --max-time 900 -X POST https://stitch.googleapis.com/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "X-Goog-Api-Key: $KEY" \
  --data-binary @request.json
```

`request.json` is JSON-RPC 2.0:
`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"edit_screens","arguments":{...}}}`

**Permanent fix:** start Claude Code with a longer MCP tool timeout, e.g.
`MCP_TOOL_TIMEOUT=600000`.

Two other Stitch quirks worth knowing:
- `edit_screens` creates a **new screen** rather than overwriting, and the new
  screen does **not** appear in `list_screens`. Take the download URLs from the
  call's own response, or `get_screen` the new ID from that response.
- Stitch sometimes reports work it did not actually perform (it claimed to add
  11 Kanban cards and changed nothing). Always diff the downloaded HTML.
