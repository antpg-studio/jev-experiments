import { Workbook } from "../engine/workbook.ts";
import { generateLeads, generateReviews, LEAD_INTENTS, REVIEW_TOPICS } from "./generate.ts";

export const ROWS = 400;
export const COLS = 26;
export const REVIEW_COUNT = 300;
export const LEAD_COUNT = 150;

export const REVIEW_FORMULAS = {
  sentiment: '=RATE($C2,"Overall sentiment of this product review","very negative|negative|neutral|positive|very positive")',
  topic: '=PICK($C2,"What is the main topic of this review?","shipping|quality|price|support|other")',
  defect: '=JUDGE($C2,"Does the review report a defect, damage or malfunction of the product itself?")',
  recommend: '=JUDGE($C2,"Would this reviewer recommend the product to others?")',
};

export const LEAD_FORMULAS = {
  intent: `=PICK($D2,"This is an inbound message to a B2B software company. What does the sender want?","${LEAD_INTENTS.join("|")}")`,
  buying: '=RATE($D2,"How strong is the sender\'s intent to purchase our product?","no interest or unrelated|curious, just exploring|actively evaluating|ready to buy now")',
  hot: '=IF(F2>2,"HOT","")',
};

const set = (wb: Workbook, sheet: string, cell: string, raw: string) => {
  const m = /^([A-Z]+)(\d+)$/.exec(cell)!;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  wb.setCell(sheet, Number(m[2]) - 1, col - 1, raw);
};

export function buildWorkbook(): Workbook {
  const wb = new Workbook();

  // ---------------------------------------------------------------- Reviews
  const reviews = wb.addSheet("Reviews", ROWS, COLS);
  reviews.colWidths.set(0, 70);
  reviews.colWidths.set(1, 190);
  reviews.colWidths.set(2, 460);
  reviews.colWidths.set(3, 110);
  reviews.colWidths.set(4, 100);
  reviews.colWidths.set(5, 90);
  reviews.colWidths.set(6, 110);
  reviews.colWidths.set(7, 30);
  reviews.colWidths.set(8, 210);
  reviews.colWidths.set(9, 80);
  reviews.colWidths.set(10, 80);

  ["ID", "Product", "Review", "Sentiment 0-4", "Topic", "Defect?", "Recommend?"].forEach((h, c) =>
    wb.setCell("Reviews", 0, c, h),
  );
  generateReviews(REVIEW_COUNT).forEach((r, i) => {
    const row = i + 1;
    wb.setCell("Reviews", row, 0, r.id);
    wb.setCell("Reviews", row, 1, r.product);
    wb.setCell("Reviews", row, 2, r.text);
  });
  const last = REVIEW_COUNT + 1;
  for (let row = 1; row <= REVIEW_COUNT; row++) {
    const n = row + 1;
    wb.setCell("Reviews", row, 3, REVIEW_FORMULAS.sentiment.replace("$C2", `$C${n}`));
    wb.setCell("Reviews", row, 4, REVIEW_FORMULAS.topic.replace("$C2", `$C${n}`));
    wb.setCell("Reviews", row, 5, REVIEW_FORMULAS.defect.replace("$C2", `$C${n}`));
    wb.setCell("Reviews", row, 6, REVIEW_FORMULAS.recommend.replace("$C2", `$C${n}`));
  }

  set(wb, "Reviews", "I1", "Summary (live)");
  set(wb, "Reviews", "J1", "Value");
  set(wb, "Reviews", "K1", "Share");
  set(wb, "Reviews", "I2", "Reviews judged");
  set(wb, "Reviews", "J2", `=COUNT(D2:D${last})`);
  set(wb, "Reviews", "I3", "Average sentiment (0-4)");
  set(wb, "Reviews", "J3", `=ROUND(AVERAGE(D2:D${last}),2)`);
  set(wb, "Reviews", "I4", "Negative reviews (< 1.5)");
  set(wb, "Reviews", "J4", `=COUNTIF(D2:D${last},"<1.5")`);
  set(wb, "Reviews", "K4", "=IF(J2>0,J4/J2,0)");
  set(wb, "Reviews", "I5", "Positive reviews (>= 2.5)");
  set(wb, "Reviews", "J5", `=COUNTIF(D2:D${last},">=2.5")`);
  set(wb, "Reviews", "K5", "=IF(J2>0,J5/J2,0)");
  set(wb, "Reviews", "I6", "Mention a defect (> 50%)");
  set(wb, "Reviews", "J6", `=COUNTIF(F2:F${last},">0.5")`);
  set(wb, "Reviews", "K6", "=IF(J2>0,J6/J2,0)");
  set(wb, "Reviews", "I7", "Would recommend (> 50%)");
  set(wb, "Reviews", "J7", `=COUNTIF(G2:G${last},">0.5")`);
  set(wb, "Reviews", "K7", "=IF(J2>0,J7/J2,0)");
  set(wb, "Reviews", "I8", "Defect AND negative");
  set(wb, "Reviews", "J8", `=SUMIF(F2:F${last},">0.5",L2:L${last})`);
  for (let row = 1; row <= REVIEW_COUNT; row++) {
    wb.setCell("Reviews", row, 11, `=IF(AND(F${row + 1}>0.5,D${row + 1}<1.5),1,0)`);
  }
  reviews.colWidths.set(11, 60);
  wb.setCell("Reviews", 0, 11, "flag");

  set(wb, "Reviews", "I10", "Topic");
  set(wb, "Reviews", "J10", "Count");
  set(wb, "Reviews", "K10", "Share");
  REVIEW_TOPICS.forEach((t, i) => {
    const r = 11 + i;
    set(wb, "Reviews", `I${r}`, t);
    set(wb, "Reviews", `J${r}`, `=COUNTIF(E2:E${last},"${t}")`);
    set(wb, "Reviews", `K${r}`, `=IF(J$2>0,J${r}/J$2,0)`);
  });

  set(wb, "Reviews", "I18", "Try it:");
  set(wb, "Reviews", "I19", "1. Click D2, change the rubric text in the formula bar, press Enter.");
  set(wb, "Reviews", "I20", "2. Press Ctrl+Shift+D (Fill column) — 300 rows re-judge in seconds.");
  set(wb, "Reviews", "I21", "3. Watch the summary block and the status bar update live.");

  // ------------------------------------------------------------------ Leads
  const leads = wb.addSheet("Leads", ROWS, COLS);
  leads.colWidths.set(0, 70);
  leads.colWidths.set(1, 170);
  leads.colWidths.set(2, 90);
  leads.colWidths.set(3, 520);
  leads.colWidths.set(4, 120);
  leads.colWidths.set(5, 120);
  leads.colWidths.set(6, 60);
  leads.colWidths.set(7, 30);
  leads.colWidths.set(8, 190);
  leads.colWidths.set(9, 80);

  ["ID", "Company", "Channel", "Message", "Intent", "Buying intent 0-3", "Hot?"].forEach((h, c) =>
    wb.setCell("Leads", 0, c, h),
  );
  generateLeads(LEAD_COUNT).forEach((l, i) => {
    const row = i + 1;
    wb.setCell("Leads", row, 0, l.id);
    wb.setCell("Leads", row, 1, l.company);
    wb.setCell("Leads", row, 2, l.channel);
    wb.setCell("Leads", row, 3, l.text);
  });
  const lastLead = LEAD_COUNT + 1;
  for (let row = 1; row <= LEAD_COUNT; row++) {
    const n = row + 1;
    wb.setCell("Leads", row, 4, LEAD_FORMULAS.intent.replace("$D2", `$D${n}`));
    wb.setCell("Leads", row, 5, LEAD_FORMULAS.buying.replace("$D2", `$D${n}`));
    wb.setCell("Leads", row, 6, LEAD_FORMULAS.hot.replace("F2", `F${n}`));
  }
  set(wb, "Leads", "I1", "Summary (live)");
  set(wb, "Leads", "J1", "Value");
  set(wb, "Leads", "I2", "Leads judged");
  set(wb, "Leads", "J2", `=COUNT(F2:F${lastLead})`);
  set(wb, "Leads", "I3", "HOT leads");
  set(wb, "Leads", "J3", `=COUNTIF(G2:G${lastLead},"HOT")`);
  set(wb, "Leads", "I4", "Average buying intent");
  set(wb, "Leads", "J4", `=ROUND(AVERAGE(F2:F${lastLead}),2)`);
  set(wb, "Leads", "I6", "Intent");
  set(wb, "Leads", "J6", "Count");
  LEAD_INTENTS.forEach((t, i) => {
    const r = 7 + i;
    set(wb, "Leads", `I${r}`, t);
    set(wb, "Leads", `J${r}`, `=COUNTIF(E2:E${lastLead},"${t}")`);
  });
  set(wb, "Leads", "I14", "Try it: edit G2 to =IF(F2>=2,\"HOT\",\"\") then Ctrl+Shift+D — free, no Jev calls.");

  return wb;
}
