const fs = require("fs");
const FILE = "c:/Users/HP/OneDrive/Desktop/Tilal-ERP/docs/stitch/02-clients-kanban.html";
let h = fs.readFileSync(FILE, "utf8");

const SRC = {
  "سوشيل ميديا": "bg-[#E0E7FF] text-[#3730A3]",
  "صديق أو معارف": "bg-[#E0E7FF] text-[#3730A3]",
  "مرّ من المنطقة": "bg-[#D1FAE5] text-[#065F46]",
  "مكتب عقاري": "bg-[#FEF3C7] text-[#92400E]",
};

function chip(kind, text) {
  if (kind === "today")
    return '<div class="flex items-center gap-1 text-[#F59E0B] font-label-sm text-label-sm bg-[#FEF3C7] px-2 py-0.5 rounded-full"><span class="material-symbols-outlined text-[14px]">warning</span>' + text + "</div>";
  if (kind === "late")
    return '<div class="flex items-center gap-1 text-[#EF4444] font-label-sm text-label-sm bg-[#FEE2E2] px-2 py-0.5 rounded-full"><span class="material-symbols-outlined text-[14px]">error</span>' + text + "</div>";
  if (kind === "done")
    return '<div class="flex items-center gap-1 text-[#059669] font-label-sm text-label-sm bg-[#D1FAE5] px-2 py-0.5 rounded-full"><span class="material-symbols-outlined text-[14px]">check_circle</span>' + text + "</div>";
  if (kind === "reason")
    return '<span class="bg-surface-variant text-on-surface-variant px-2 py-0.5 rounded-full text-[10px] font-bold">' + text + "</span>";
  return '<div class="flex items-center gap-1 text-on-surface-variant font-label-sm text-label-sm"><span class="material-symbols-outlined text-[14px]">calendar_today</span>' + text + "</div>";
}

function card(o) {
  const extra = o.faded ? " grayscale-[30%] opacity-80" : "";
  return `<div class="bg-surface rounded-[12px] p-4 shadow-sm border border-outline-variant/50 hover:shadow-md transition-shadow cursor-grab group${extra}">
<div class="flex justify-between items-start mb-3">
<div>
<h4 class="font-headline-sm text-[16px] font-bold text-on-surface group-hover:text-primary transition-colors">${o.name}</h4>
<p class="font-body-md text-label-md text-on-surface-variant flex items-center gap-1 mt-1" dir="ltr">
<span class="material-symbols-outlined text-[14px]">call</span>
${o.phone}
</p>
</div>
<button class="text-on-surface-variant hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity">
<span class="material-symbols-outlined text-[20px]">more_vert</span>
</button>
</div>
<div class="flex items-center gap-2 mb-4 text-[#064E3B]">
<span class="material-symbols-outlined text-[18px]">payments</span>
<span class="font-label-md text-label-md font-bold">${o.amount} د.ع</span>
</div>
<div class="flex items-center justify-between border-t border-outline-variant/30 pt-3">
<div class="flex items-center gap-2">
<div class="w-6 h-6 rounded-full overflow-hidden border border-outline-variant">
<div class="w-full h-full bg-primary-container text-on-primary-container flex items-center justify-center text-[10px] font-bold">${o.name.trim()[0]}</div>
</div>
<span class="${SRC[o.source]} px-2 py-0.5 rounded text-[10px] font-bold">${o.source}</span>
</div>
${chip(o.chip, o.chipText)}
</div>
</div>
`;
}

// 1) fix the two invalid source pills
const before = h;
h = h.replace(">موقع الكتروني<", ">مكتب عقاري<").replace(">توصية<", ">صديق أو معارف<");
if (h === before) throw new Error("source pills not found");

// 2) column «زيارة» — replace the placeholder comment with three cards
const visitMarker = /<!-- Add dummy cards here[^>]*-->/;
if (!visitMarker.test(h)) throw new Error("visit column marker not found");
h = h.replace(
  visitMarker,
  card({ name: "زينب الحسناوي", phone: "+964 782 334 1122", amount: "420,000,000", source: "سوشيل ميديا", chip: "today", chipText: "اليوم" }) +
    card({ name: "حيدر الساعدي", phone: "+964 770 556 7788", amount: "275,000,000", source: "مكتب عقاري", chip: "date", chipText: "14 سبتمبر" }) +
    card({ name: "نور الكناني", phone: "+964 751 220 3344", amount: "610,000,000", source: "صديق أو معارف", chip: "late", chipText: "متأخر" })
);

// 3) column «مناقشة العرض» — the one remaining empty card container
const emptyCol = '<div class="p-3 flex-1 overflow-y-auto space-y-3 scrollbar-hide">\n</div>';
if (h.split(emptyCol).length - 1 !== 1) throw new Error("expected exactly one empty column, found " + (h.split(emptyCol).length - 1));
h = h.replace(
  emptyCol,
  '<div class="p-3 flex-1 overflow-y-auto space-y-3 scrollbar-hide">\n' +
    card({ name: "علي الجبوري", phone: "+964 780 990 1234", amount: "850,000,000", source: "مكتب عقاري", chip: "today", chipText: "اليوم" }) +
    card({ name: "هدى العبيدي", phone: "+964 772 665 4433", amount: "390,000,000", source: "سوشيل ميديا", chip: "date", chipText: "16 سبتمبر" }) +
    "</div>"
);

// 4) one more card in «اتصال», «بيع» and «فشل البيع»
function prepend(marker, html) {
  if (!h.includes(marker)) throw new Error("marker not found: " + marker);
  h = h.replace(marker, html + marker);
}
prepend("<!-- Card 3 -->", card({ name: "مصطفى الربيعي", phone: "+964 771 445 8890", amount: "180,000,000", source: "مرّ من المنطقة", chip: "date", chipText: "12 سبتمبر" }));
prepend("<!-- Sale Card -->", card({ name: "كرار الموسوي", phone: "+964 790 112 5566", amount: "1,050,000,000", source: "مرّ من المنطقة", chip: "done", chipText: "بيع مكتمل" }));
prepend("<!-- Lost Card -->", card({ name: "ياسر العزاوي", phone: "+964 773 808 2211", amount: "300,000,000", source: "صديق أو معارف", chip: "reason", chipText: "السعر", faded: true }));

fs.writeFileSync(FILE, h);
console.log("written, bytes:", h.length);
