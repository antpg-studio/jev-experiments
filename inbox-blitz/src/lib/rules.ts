import type { Category, Email, Judgment } from "./types";

/**
 * The "old way": a reasonable, hand-tuned keyword/regex classifier of the kind
 * most support inboxes actually run. It is deterministic and instantaneous, and
 * it is wrong in exactly the ways you would expect (sarcasm, negation, quoted
 * history, marketing copy that borrows urgent words).
 */
export interface RuleVerdict {
  category: Category;
  needsReply: boolean;
  urgency: number; // 0..3
  sentiment: number; // 0..3
  isPhishingOrScam: boolean;
  mentionsChurnOrCancel: boolean;
  asksForRefund: boolean;
}

const CATEGORY_RULES: Array<[Category, RegExp]> = [
  ["security", /\b(hacked|compromised|breach|vulnerab|2fa|two-factor|suspicious (login|sign-?in)|unusual activity|cve|malware|phish)/i],
  ["legal_privacy", /\b(gdpr|ccpa|subpoena|legal (team|counsel|notice)|attorney|lawyer|data (deletion|erasure|request)|delete (my|all my) data|dpa\b|terms of service|privacy)/i],
  ["billing", /\b(invoice|charge[ds]?|billing|payment|refund|receipt|subscription|pric(e|ing)|vat|credit card|overcharg)/i],
  ["bug", /\b(bug|broken|error|crash|not (working|loading|syncing)|doesn'?t work|500|502|503|timeout|down\b|fails?|blank (page|screen)|locked out|can'?t (log ?in|access))/i],
  ["sales_lead", /\b(quote|pricing for|demo|upgrade|enterprise plan|seats|procurement|contract|evaluat)/i],
  ["feature_request", /\b(feature request|would (love|be great)|any plans|roadmap|suggestion|please add|shortcut)/i],
  ["spam_marketing", /\b(unsubscribe|% off|coupon|flash sale|webinar|register (free|now)|limited (time|slots)|exclusive|seo|10x|book a (call|meeting)|our team of|newsletter|this week:)/i],
  ["internal", /\b(standup|1:1|offsite|payroll|expense report|all-hands|hr\b|laptop|rota|team,)/i],
];

export function classifyRules(email: Email): RuleVerdict {
  const text = `${email.subject}\n${email.body}`;
  const fromOurDomain = /@(updates\.|monitor\.)?northwind\.cloud$/i.test(email.fromEmail);

  let category: Category = fromOurDomain ? "internal" : "other";
  if (!fromOurDomain) {
    for (const [cat, re] of CATEGORY_RULES) {
      if (re.test(text)) {
        category = cat;
        break;
      }
    }
  }

  const urgentWords = (text.match(/\b(urgent|asap|immediately|right now|critical|emergency|p1|outage|down\b|today|deadline|now!)/gi) ?? []).length;
  const caps = (text.match(/\b[A-Z]{4,}\b/g) ?? []).length;
  const bangs = (text.match(/!/g) ?? []).length;
  let urgency = 0;
  if (/\bnot urgent\b|no rush|whenever you have a moment|not important|low priority/i.test(text)) urgency = 0;
  else if (urgentWords >= 2 || /\b(urgent|asap|emergency|p1|right now)\b/i.test(text)) urgency = 3;
  else if (urgentWords === 1 || /\btoday\b/i.test(text)) urgency = 2;
  else if (/\bthis week|by friday|soon\b/i.test(text)) urgency = 1;

  const angryWords = (text.match(/\b(unacceptable|ridiculous|furious|disgusted|terrible|worst|useless|incompetent|pathetic|joke|angry|frustrat|disappoint|not good enough)/gi) ?? []).length;
  const niceWords = (text.match(/\b(thanks?|thank you|great|love|wonderful|appreciate|awesome|fantastic|kudos)/gi) ?? []).length;
  let sentiment = 1;
  if (angryWords >= 2 || (angryWords >= 1 && (caps >= 2 || bangs >= 2))) sentiment = 3;
  else if (angryWords >= 1 || caps >= 3 || bangs >= 3) sentiment = 2;
  else if (niceWords >= 1) sentiment = 0;

  const isPhishingOrScam =
    /\b(verify your (account|mailbox|identity)|password|click (here|the link)|suspended|gift ?cards?|wire transfer|bank details|redelivery fee|sign in to (view|continue)|update your (billing|payment))/i.test(text) ||
    /(paypa1|amaz0n|micros0ft|netfIix|-secure|-verify|-alerts?)\./i.test(email.fromEmail);

  const mentionsChurnOrCancel = /\b(cancel|churn|switch(ing)? to|leaving|competitor|terminate|close (my|our) account)/i.test(text);
  const asksForRefund = /\brefund|money back|charge ?back|reimburse/i.test(text);

  const needsReply = !/\b(unsubscribe|no[- ]reply|automated message|do not reply|this week:)/i.test(text) && !/^(no-?reply|noreply|alerts|changelog|promo|hello|events|tracking|service)@/i.test(email.fromEmail) && category !== "spam_marketing";

  return { category, needsReply, urgency, sentiment, isPhishingOrScam, mentionsChurnOrCancel, asksForRefund };
}

export type Dimension = "category" | "needsReply" | "urgency" | "sentiment" | "isPhishingOrScam" | "mentionsChurnOrCancel" | "asksForRefund";
export const DIMENSIONS: Dimension[] = ["category", "needsReply", "urgency", "sentiment", "isPhishingOrScam", "mentionsChurnOrCancel", "asksForRefund"];

/** Which dimensions the rules disagree with Jev on. Score dimensions count as a disagreement when off by ≥ 1 level. */
export function disagreements(rule: RuleVerdict, j: Judgment): Dimension[] {
  const out: Dimension[] = [];
  if (rule.category !== j.category) out.push("category");
  if (rule.needsReply !== j.needsReply >= 0.5) out.push("needsReply");
  if (Math.abs(rule.urgency - j.urgency) >= 1) out.push("urgency");
  if (Math.abs(rule.sentiment - j.sentiment) >= 1) out.push("sentiment");
  if (rule.isPhishingOrScam !== j.isPhishingOrScam >= 0.5) out.push("isPhishingOrScam");
  if (rule.mentionsChurnOrCancel !== j.mentionsChurnOrCancel >= 0.5) out.push("mentionsChurnOrCancel");
  if (rule.asksForRefund !== j.asksForRefund >= 0.5) out.push("asksForRefund");
  return out;
}

export interface Agreement {
  compared: number;
  perDimension: Record<Dimension, number>; // fraction agreeing, 0..1
  overall: number; // fraction of (email, dimension) pairs agreeing
  fullyAgree: number; // emails where all 7 agree
}

export function agreement(pairs: Array<{ rule: RuleVerdict; judgment: Judgment }>): Agreement {
  const perDimension = Object.fromEntries(DIMENSIONS.map((d) => [d, 0])) as Record<Dimension, number>;
  let agreeCells = 0;
  let fullyAgree = 0;
  for (const { rule, judgment } of pairs) {
    const dis = disagreements(rule, judgment);
    if (dis.length === 0) fullyAgree++;
    for (const d of DIMENSIONS) {
      if (!dis.includes(d)) {
        perDimension[d]++;
        agreeCells++;
      }
    }
  }
  const n = pairs.length;
  for (const d of DIMENSIONS) perDimension[d] = n ? perDimension[d] / n : 0;
  return { compared: n, perDimension, overall: n ? agreeCells / (n * DIMENSIONS.length) : 0, fullyAgree };
}
