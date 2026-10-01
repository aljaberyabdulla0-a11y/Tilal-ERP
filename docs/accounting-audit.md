# تدقيق المحاسبة — قسم المالية

> تدقيق 2026-10-01: المستودع (`sql/`، `src/`) مقابل القاعدة الحيّة (`tilal-crm`).
> المرجع التفصيلي للبنية (الشاشات، الجداول، خريطة الترحيل، الصلاحيات) في [ACCOUNTING_ARCHITECTURE.md](ACCOUNTING_ARCHITECTURE.md).
> هذه الوثيقة: ما وُجد، وما الخطأ فيه، وما تغيّر في `sql/107`–`115`.
> الأرقام: [accounting-baseline.md](accounting-baseline.md) · المشاكل في البيانات: [accounting-corrections.md](accounting-corrections.md) · القرارات: [accounting-decisions.md](accounting-decisions.md) · ما بقي: [accounting-roadmap.md](accounting-roadmap.md).

---

## ١. البنية الحالية

نظام قيد مزدوج قائم وسليم البنية، وليس ناقصاً. الدفتر (`journal_entries` + `journal_lines`) مصدر كل رقم مالي. والقيود الآلية تكتبها محفّزات ودوالّ `security definer` في القاعدة، والمتصفّح لا يكتب منها شيئاً. والنموذج المحاسبي «تلال وسيط» مطبَّق منذ 056: إيراد الصفقة عمولة فقط (1250/4200 ثم 1100/1250).

```
العمليات (CRM، حجوزات، كشوف، مخزون، وسطاء، حركات)
        ↓ محفّزات + دوالّ security definer (repost_x / post_x)
دفتر القيود — journal_entries (source, source_id*, reference, arm) + journal_lines
        ↓ account_balances* · money_overview* · account_ledger* · accounting_health*
التقارير — ميزان، دخل، ميزانية، ملخّص، ربحية، أعمار ذمم، صحّة*، مطابقة رواتب*
                                                        (* جديد في 108–114)
```

## ٢. بنية القاعدة

- **الدفتر:** `accounts` (35 + 5110 = 36، شجرة مسطّحة)، `journal_entries`، `journal_lines` (`one_sided`)، `accounting_periods`.
- **المصادر** (كلٌّ يحمل عمود قيده): `cash_moves`، `commissions`، `reservations` (استحقاق/تحصيل/عكس*)، `payrolls`، `payroll_payments`، `employee_advances`، `external_debts`، `debt_repayments`، `inventory_moves`، `broker_payments`.
- **وثائق بلا قيد:** `developer_invoices`، `sale_commissions`، `invoices`/`payments` (متابعة المشتري — 056)، `broker_commissions` (بلا استحقاق — فجوة)، `partner_settlements`.
- **مفاتيح خارجية مهمّة:** كل `*_entry_id` → `journal_entries` **on delete set null**. فحذف القيد يُيتّم مصدره، وحذف المصدر يُيتّم القيد إن لم يكن له محفّز حذف. و`sale_commissions` و`developer_invoices` → `reservations` **cascade**. هذا ما أنتج حادثة الوحدة 75.
- **أعمدة جديدة:** `journal_entries.source_id`، `journal_entries.reversal_of`، `reservations.commission_reversal_entry_id`، `payroll_payments.partner_id`.

## ٣. مسار المحاسبة

| الحدث | القيد | الدالّة |
|---|---|---|
| حركة صرف/قبض | المصروف/الإيراد ↔ 1100/1200 (أو 2500 من جيب شريك) | `post_cash_move_to_ledger` |
| تأكيد المقدمة | 1250 / 4200 + عمولة الموظف 5500 / 2300 | `confirm_down_payment` |
| تحصيل عمولة تلال | 1100 / 1250 (يشترط فاتورة مطوّر سارية) | `collect_company_commission` |
| فسخ البيع | 4200 / 1250، وعمولة الموظف تُحذف أو تُستردّ | `reverse_sale` (113) |
| اعتماد الكشف | 5100 / 2300 (+1360، 2310، 2320) | `approve_payroll` → `repost_payroll` |
| دفع الكشف | 2300 / النقد — **أو 2500 من جيب شريك*** | `repost_payroll_payment` (110) |
| سلفة، دين، مخزون، وسيط | 1360، 1350، 5350، 5510 ↔ النقد | كما في الوثيقة المرجعية §٦ |
| قيد يدوي | حرّ، متوازن، حسابات نشطة | `post_manual_entry`* (111) |

## ٤. مصادر القيود

`reference` / `source`: MOVE/cash_moves · COMM/commissions · COMMDUE/reservations · COMMIN/sale_commissions · COMMREV/reservations · PAYROLL/payrolls · PAYRUN/payroll_payments · ADVANCE/employee_advances · DEBT/external_debts · DEBTPAY/debt_repayments · STOCK/inventory_moves · BRKPAY/broker_payments · **MANUAL**، **REV** (يدوي، source فارغ — 111).

`source_id` منذ 108 = معرّف الصفّ في الجدول المسمّى في `source`. يُختم بمحفّز على كل جدول مصدر حين يُكتب فيه عمود القيد. حالتان خاصّتان: COMMIN يُختم بمعرّف سجلّ `sale_commissions` مع أن المرجع محفوظ على الحجز، وCOMMREV يُختم بمعرّف الحجز.

## ٥. الدوالّ الفعّالة

**الترحيل:** `post_cash_move_to_ledger`، `repost_commission`، `confirm_down_payment`، `collect_company_commission`، `reverse_sale`، `repost_payroll`، `repost_payroll_payment`، `disburse_advance`، `post_debt_to_ledger`، `post_debt_repayment_to_ledger`، `repost_inventory_purchase`، `repost_broker_payment`.
**الكشوف:** `build_payroll`، `build_all_payrolls`، `add/update/remove_payroll_line`، `approve_payroll`، `approve_all_payrolls`، `reopen_payroll`، `lock_payroll`، `delete_payroll`، `month_close_overview`.
**الفترات:** `close_period`، `reopen_period`، `archive_period`، `periods_overview`، `is_period_locked`.
**التقارير:** `project_profitability`، `commission_receivable_aging`، `employee_cost`، `bank_reconciliation`، `suggest_bank_match`، `target_progress`.
**جديد (107–115):** `post_manual_entry`، `reverse_journal_entry`، `account_balances`، `money_overview`، `account_ledger`، `payroll_reconciliation`، `fin_name_skeleton`، `sale_reversal_preview`، `accounting_health`، `stamp_journal_source`، `guard_auto_journal_entry/line`، `check_journal_balance`، `check_journal_has_lines`، `guard_cash_move`، `guard_payroll_payment`، `guard_posted_reservation_delete`، `tests.run_accounting`.

## ٦. الدوالّ المتقاعدة (مُبقاة، بلا محفّز)

| الدالّة | منذ | الحالة |
|---|---|---|
| `repost_reservation_deposit`، `post_reservation_deposit` | 056 | العربون للمطوّر — لا تُستدعى |
| `repost_payment`، `post_payment_ledger` | 056 | دفعات المشتري متابعة فقط |
| `settle_invoice_commission` | 056 | تعود فوراً |
| `post_payroll_to_ledger` | 051 | الترحيل عند الاعتماد لا الإنشاء |
| `company_settings.commission_rate`، `invoice_items` | 048/056 | إرث |

الإزالة بعد فحص التبعيات: [accounting-roadmap.md — المرحلة R](accounting-roadmap.md).

## ٧. المحفّزات الفعّالة (المالية)

`cash_moves`: ترحيل، سحب، **guard_cash_move***، ختم* · `commissions`: ترحيل، سحب، تدقيق، ختم* · `payrolls`: حرّاس الأرقام والحذف، تدقيق، ختم* · `payroll_lines`: حارس، مجاميع، تدقيق · `payroll_payments`: ترحيل، سحب، **guard_payroll_payment***، ختم* · `reservations`: تجميد السعر، عمولة البيع، فاتورة البيع، وسيط، **منع حذف المُرحَّل***، ختم ×3* · `sale_commissions`: إلغاء فاتورة المطوّر عند الفسخ · `journal_entries`: قفل الفترة، تدقيق، **حارس القيد الآلي***، **له سطور*** · `journal_lines`: قفل الفترة، **حارس***، **التوازن*** · `external_debts`/`debt_repayments`/`inventory_moves`/`broker_payments`/`employee_advances`: ترحيل/سحب، ختم*.

## ٨. RLS والصلاحيات

`is_admin()` المدير · `can_manage_finance()` المدير أو المحاسب — يُرحّل ويدفع · `can_manage_hr()` المدير أو الموارد البشرية — يُحضّر · `can_see_payroll()` الثلاثة.
الدفتر والحسابات والحركات والدفعات: سياسة ALL للمدير وأخرى للمحاسب (068). الحجوزات: الحذف للمدير.
**كل دالّة جديدة:** `revoke … from public, anon` و`grant … to authenticated`، والدور يُفحص داخلها. مُختبَر في 115 بموظف ومشرف ومحاسب وموارد بشرية ومدير. ولا مستخدم «محاسب» أو «موارد بشرية» في البيانات اليوم.

## ٩. الحسابات

36 حساباً. 4100 و2400 **غير نشطين** منذ 109 (مجمَّدان منذ 056، صفر سطور). 5110 «أجور يومية ومستقلون» جديد. وغير مستعمل: 1300، 1400، 1500، 2100، 2200، 3100، 3200 — باقية. الشجرة مسطّحة بلا `parent_id`.

## ١٠. المسارات المالية الجارية

- ٤٥ حركة نقدية؛ ٢٠ من ٢١ حركة رواتب دفعها الشريك من جيبه (2500).
- ٥ صفقات مؤكَّدة بلا تحصيل (9,307,500 على المطوّرين)، و٥ فواتير مطوّر سارية لم تُرسَل.
- ٤ كشوف معتمدة بلا دفعة، وكشف مسوّدة.
- لا سلف، ولا عمولات وسطاء، ولا كشف بنك، ولا فترة مقفلة.

## ١١. التقارير

| التقرير | المصدر بعد 112 | الفترة |
|---|---|---|
| الملخّص المالي، بوابة المالية | `money_overview` | الشهر بتوقيت بغداد، آخر ٦ أشهر |
| ميزان المراجعة | `account_balances(from, to)` | من/إلى، افتتاحي وختامي |
| قائمة الدخل | `account_balances(from, to)` | من/إلى |
| الميزانية العمومية | `account_balances(null, to)` | حتى تاريخ (بلا إقفال سنوي) |
| كشف الحساب* | `account_ledger` | من/إلى، رصيد جارٍ، ترقيم ٥٠٠ |
| صحّة المحاسبة* | `accounting_health` | لحظي |
| مطابقة الرواتب* | `payroll_reconciliation` | من/إلى |
| ربحية المشاريع، أعمار الذمم | جداول تشغيلية (066) | كما كانت |

## ١٢. المشاكل الموجودة

| # | المشكلة | الأثر | الحالة |
|---|---|---|---|
| P1 | حذف الحجز المؤكَّد يُيتّم قيد الإيراد وعمولة الموظف (الوحدة 75) | إيراد +1,929,500، مصروف +150,000 | **منع:** 108، 113. **تصحيح البيانات:** ينتظر المالك |
| P2 | المستودع ≠ القاعدة: ٨ دوالّ (الكشف، السلف) لم تُحفظ نصوصها | إعادة البناء من `sql/` تُنتج كشفاً بلا أقساط وضريبة | **حُلّ:** 107 |
| P3 | `089` موجود في القاعدة (`089_import_history`) ولا ملف له؛ ورقم `029` مكرّر؛ و068 لا يظهر في سجلّ هجرات القاعدة | تتبّع الهجرات | موثَّق — [roadmap](accounting-roadmap.md) |
| P4 | زرّ «حذف» يحذف أي قيد آلي | مصدر يبدو مُرحَّلاً وهو ليس كذلك | **حُلّ:** 108 + صفحة القيد |
| P5 | القيد اليدوي على طلبين، والتوازن في المتصفّح فقط | قيد بلا سطور أو غير متوازن | **حُلّ:** 108، 111 |
| P6 | تصنيفات وقوالب تكتب على 4100/4200/5100/5500/2400 | إيراد ليس لتلال، تكرار مصروف | **حُلّ:** 109 + types.ts |
| P7 | لا دفع للكشف من جيب شريك | الرواتب تُسجَّل حركات 5100 | **حُلّ:** 110 |
| P8 | التقارير تجلب كل السطور (حدّ ١٠٠٠ صفّ) وبلا فترة، و«الشهر» بتوقيت الخادم | أرقام ناقصة بصمت بعد ١٠٠٠ سطر | **حُلّ:** 112 + الصفحات |
| P9 | `post_cash_move_to_ledger` تحفظ الحركة بلا قيد إن غاب الحساب | مصدر بلا قيد بصمت | **حُلّ:** 109 يرفض الحساب الغائب |
| P10 | `cash_moves` و`payroll_payments` تقبلان تعديل المبلغ ولا محفّز يعيد الترحيل | الحركة ≠ قيدها | **حُلّ:** 109، 110 |
| P11 | لا حدّ على دفعات الكشف (تتجاوز الصافي، أو تُدفع المسوّدة) | 2300 سالب | **حُلّ:** 110 |
| P12 | `reverse_sale` لا تحفظ قيد العكس، ولا واجهة لها | العكس بلا تتبّع، والحذف بديلاً | **حُلّ:** 113 |
| P13 | استحقاق الكشف بتاريخ إنشائه لا شهره | رواتب آب في أيلول | ينتظر قرار المالك — [corrections §٥](accounting-corrections.md) |
| P14 | بوابة المالية تعدّ الصفقات المفسوخة غير محصّلة | رقم أعلى | **حُلّ:** `finance/page.tsx` |
| P15 | عكس عمولة موظف دخلت كشفاً معتمداً = «استقطاع» يُنقص 5100 لا 5500 | تصنيف المصروف | موثَّق — roadmap |
| P16 | `invoices` بلا `journal_entry_id` (الوثيقة المرجعية قالت العكس) | توثيق | صُحّح هنا |

## ١٣. الميزات الناقصة

استحقاق عمولات الوسطاء (2350) · مراكز التكلفة ومشروع على القيد · قائمة التدفقات النقدية · الإقفال السنوي إلى 3200 · شجرة حسابات هرمية · واجهة مطابقة البنك · تقرير تكلفة الموظف · الموازنة والانحراف · سجلّ «اعتمد/رحّل/عكس» على كل قيد. التفصيل والترتيب في [accounting-roadmap.md](accounting-roadmap.md).

## ١٤. البنية المستهدفة

```
العمليات → محرّك القواعد (دوالّ القاعدة، قيدٌ لكل حدث مالي، source + source_id)
        → الدفتر (قيود متوازنة بالقاعدة، فترات مقفلة، لا حذف للآلي، عكس لا تعديل)
        → محرّك التقارير (تجميع في القاعدة بفترة: ميزان، دخل، ميزانية، تدفقات، ذمم، ربحية بمركز تكلفة)
        → الصحّة والمطابقة (الدفتر ↔ المصادر ↔ البنك)
        → لوحة الإدارة (كل رقم يُفتح: رقم ← حساب ← قيد ← مصدر ← مستخدم)
```
اكتمل منها حتى 115: الدفتر المحمي، والتجميع بفترة، والتتبّع حتى المصدر، والصحّة، ومطابقة الرواتب.

## ١٥. خطّة الهجرات

| الملف | المحتوى | يغيّر أرقاماً؟ | الاختبار |
|---|---|---|---|
| `107_accounting_live_alignment` | ٨ دوالّ بنصّها الحيّ | لا (مطابق حرفياً) | بصمة md5 = الحيّ |
| `108_journal_integrity` | source_id، حارس الآلي، التوازن المؤجَّل، منع حذف الحجز المُرحَّل | لا (يملأ source_id فقط) | 10 + 56 |
| `109_cash_move_category_guard` | 5110، 4100/2400 غير نشطين، حارس الحركة | لا | 115 |
| `110_payroll_reconciliation` | دفع من جيب شريك، حارس الدفعة، أداة المطابقة | لا | 115 + تشغيل على الحيّ |
| `111_manual_journal_rpc` | `post_manual_entry`، `reverse_journal_entry` | لا | 115 |
| `112_financial_aggregation` | `account_balances`، `money_overview`، `account_ledger` | لا | 115 + مطابقة الأرصدة |
| `113_sale_reversal` | عمود قيد العكس، `reverse_sale`، المعاينة | لا | 115 |
| `114_accounting_health` | `accounting_health` | لا | 115 + تشغيل على الحيّ |
| `115_accounting_tests` | `tests.run_accounting()` — ٥٦ اختباراً | لا (يُلغي أثره) | 56/56 ✓ |

**طريقة الاختبار:** كل الهجرات طُبِّقت على القاعدة الحيّة **داخل معاملة تُلغى** (`raise exception` في آخرها)، فلم يبقَ منها شيء. وفيها شُغّلت `tests.run_accounting()`: ٥٦ اختباراً، كلّها ok، في ١.٣ ثانية. **لم يُطبَّق شيء على القاعدة الحيّة بعد** — ينتظر موافقة المالك.

**ترتيب التطبيق:** 107 ← 115 بالترتيب، **مع نشر الواجهة في الوقت نفسه**. بعد 108 يرفض الدفتر الكتابة المباشرة من المتصفّح، فنموذج القيد اليدوي القديم يتوقّف إلى أن تُنشر نسخته الجديدة (RPC). وبعد 109 يُرفض تصنيف «رواتب وأجور» قبل أن يظهر خيار «دفعه شريك» في الكشف.
