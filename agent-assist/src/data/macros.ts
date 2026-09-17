import type { MacroSummary } from "../lib/questions.ts";

export interface Macro extends MacroSummary {
  /** Reply template; `{name}` is replaced with the customer's first name. */
  body: string;
}

export const MACROS: Macro[] = [
  {
    id: "duplicate_charge_refund",
    title: "Duplicate charge — refund",
    summary:
      "Apologize for a duplicate or incorrect charge and confirm the extra amount will be refunded to the original payment method within 5–10 business days.",
    body: "I'm sorry about the duplicate charge, {name} — that's on us. I've issued a refund for the extra payment to your original payment method; it typically appears within 5–10 business days depending on your bank. I'll send you a confirmation with the reference number in a moment.",
  },
  {
    id: "account_unlock_reset",
    title: "Account locked — reset link",
    summary:
      "Unlock a locked account and send a fresh password-reset link; explain the link expires in 30 minutes.",
    body: "Thanks for letting me know, {name}. I've unlocked your account and sent a fresh password-reset link to the email on file — it's valid for 30 minutes, so please use it right away. Let me know once you're back in.",
  },
  {
    id: "two_factor_recovery",
    title: "2FA recovery — verify identity",
    summary:
      "Customer lost their 2FA device; explain the identity-verification steps needed before 2FA can be reset.",
    body: "No problem, {name} — we can recover access without the old phone. For security I need to verify your identity first: please reply with the last four digits of the card on file and the approximate date of your last invoice. Once verified I'll disable the old authenticator so you can enrol a new one.",
  },
  {
    id: "escalate_to_supervisor",
    title: "Escalate to supervisor",
    summary:
      "Customer demands a manager or is at serious risk of leaving; acknowledge the severity, escalate to a supervisor and commit to a callback within one hour.",
    body: "I hear you, {name}, and I'm not going to send you another template. I'm escalating this to my supervisor right now with the full history of your tickets; you'll get a personal call within the next hour from someone who can make decisions about your account.",
  },
  {
    id: "sla_credit",
    title: "SLA credit for outage",
    summary:
      "Customer asks about compensation for downtime; explain how SLA credits are calculated and that finance applies them to the next invoice.",
    body: "You're entitled to an SLA credit for this month's downtime, {name}. Credits are calculated from the incident timeline (10% of the monthly fee per breached hour, capped at 50%) and applied to your next invoice. I've opened the credit request and will confirm the exact amount by email today.",
  },
  {
    id: "feature_availability_by_plan",
    title: "Feature availability by plan",
    summary:
      "Answer whether a feature exists and which plan includes it, and link to the plan comparison page.",
    body: "Good question, {name}! That feature is available, but it depends on your plan — I've linked the plan comparison page so you can see exactly what's included at each level. Happy to walk you through the difference if it helps.",
  },
  {
    id: "feature_request_logged",
    title: "Not available — request logged",
    summary:
      "The requested capability does not exist yet; log a feature request and explain that the roadmap is public.",
    body: "That's not something we support today, {name}, but I've logged it as a feature request with your account attached so the product team can see the demand. You can follow progress on our public roadmap.",
  },
  {
    id: "privacy_data_request",
    title: "GDPR/CCPA data request",
    summary:
      "Acknowledge a data access or erasure request, explain identity verification, commit to the 30-day statutory timeline and written confirmation.",
    body: "Thank you, {name}. I've registered your data request with our privacy team. We'll verify your identity by email first, then complete the request within the 30-day statutory period, and you'll receive written confirmation when it's done.",
  },
  {
    id: "shipping_tracking_update",
    title: "Shipping — tracking check",
    summary:
      "Physical order is late; apologize, open a trace with the carrier and promise an update within 24 hours.",
    body: "I'm sorry your order is running late, {name}. I've opened a trace with the carrier on your tracking number; they usually respond within 24 hours and I'll update you as soon as I hear back.",
  },
  {
    id: "shipping_replacement",
    title: "Shipping — send replacement",
    summary:
      "Customer needs the item urgently or it is lost; ship a replacement with expedited delivery and provide return instructions for the original.",
    body: "Let's not make you wait on the carrier, {name}. I've arranged a replacement with overnight delivery — you'll get a new tracking number shortly. If the original turns up, you can send it back with the prepaid label I'll include.",
  },
  {
    id: "bug_acknowledged_engineering",
    title: "Bug — forwarded to engineering",
    summary:
      "Customer reports a bug with technical details; thank them for the logs, confirm it has been reproduced or filed with engineering and share how they will be updated.",
    body: "Thanks for the detailed logs, {name} — that helps a lot. I've filed this with engineering with your timestamps attached and flagged it as a regression. I'll keep you posted on this thread and link the incident page as soon as one is up.",
  },
  {
    id: "guided_walkthrough",
    title: "Patient step-by-step walkthrough",
    summary:
      "Customer is confused by the interface; give a reassuring, plain-language, one-step-at-a-time walkthrough.",
    body: "You're not a bother at all, {name} — happy to help. Let's go one step at a time: look at the very top of the screen for the small picture of a house. Tap it once, and tell me what you see next.",
  },
];

export const MACRO_SUMMARIES: MacroSummary[] = MACROS.map(({ id, title, summary }) => ({ id, title, summary }));

export function macroById(id: string): Macro | undefined {
  return MACROS.find((m) => m.id === id);
}

export function fillMacro(macro: Macro, customerName: string): string {
  return macro.body.replaceAll("{name}", customerName.split(" ")[0] ?? customerName);
}
