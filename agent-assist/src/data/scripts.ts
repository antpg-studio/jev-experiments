import type { CustomerProfile } from "../lib/questions.ts";

export interface ScriptedMessage {
  text: string;
  /** Milliseconds after the previous customer message in the same chat (or after start for the first). */
  delayMs: number;
}

export interface ChatScript {
  id: string;
  label: string;
  customer: CustomerProfile;
  messages: ScriptedMessage[];
}

/**
 * Eight concurrent chats. Delays are staggered so that, when all eight are played together,
 * ~40 customer messages arrive over roughly 40 seconds with several landing within the same second.
 */
export const SCRIPTS: ChatScript[] = [
  {
    id: "c1",
    label: "Billing dispute",
    customer: { name: "Marisol Ibarra", plan: "pro", tenure_months: 14, prior_tickets: 2 },
    messages: [
      { text: "Hi, I was charged twice this month — two $49 charges on the 3rd and again on the 4th.", delayMs: 800 },
      { text: "I only have one workspace, so there's no reason for a second charge. I've got the bank statement in front of me.", delayMs: 7000 },
      { text: "This is the second time this has happened, honestly. Last time it took two weeks to sort out.", delayMs: 8000 },
      { text: "I'd like the duplicate refunded to my card please, not as account credit.", delayMs: 8500 },
      { text: "How long will the refund take to show up?", delayMs: 8000 },
    ],
  },
  {
    id: "c2",
    label: "Locked account",
    customer: { name: "Devraj Nair", plan: "starter", tenure_months: 3, prior_tickets: 0 },
    messages: [
      { text: "I can't log in — it says my account is locked after too many attempts.", delayMs: 2200 },
      { text: "I tried the reset password link but it had expired by the time I opened it.", delayMs: 7500 },
      { text: "Also my 2FA is on my old phone which I don't have anymore.", delayMs: 8000 },
      { text: "Got the new link and I'm in now, thanks.", delayMs: 9000 },
      { text: "Can I add a backup email so this doesn't happen again?", delayMs: 7000 },
    ],
  },
  {
    id: "c3",
    label: "Churn threat",
    customer: { name: "Tobias Reinholt", plan: "business", tenure_months: 26, prior_tickets: 6 },
    messages: [
      { text: "Your API has been down three times this month. We are losing customers over this.", delayMs: 3600 },
      { text: "I've opened SIX tickets this year and every single time I get the same copy-paste apology.", delayMs: 7000 },
      { text: "If I don't hear from someone who can actually make decisions, I'm moving my whole team to a competitor on Friday.", delayMs: 7500 },
      { text: "I want a manager. Not a macro.", delayMs: 6500 },
      { text: "Fine. What is the SLA credit for this month then?", delayMs: 9000 },
    ],
  },
  {
    id: "c4",
    label: "Feature question",
    customer: { name: "Priya Venkatesan", plan: "free", tenure_months: 1, prior_tickets: 0 },
    messages: [
      { text: "Hey! Does the free plan support exporting boards to CSV?", delayMs: 5000 },
      { text: "Cool — and can I schedule the export to run weekly?", delayMs: 8000 },
      { text: "Is that on the roadmap or would I need Pro for it?", delayMs: 7000 },
      { text: "Got it, thanks! One more: is there a Zapier integration?", delayMs: 8500 },
      { text: "Perfect, that's all I needed 🙂", delayMs: 8000 },
    ],
  },
  {
    id: "c5",
    label: "GDPR deletion",
    customer: { name: "Anneliese Vogt", plan: "starter", tenure_months: 9, prior_tickets: 1 },
    messages: [
      { text: "Hello. Under GDPR Article 17 I am requesting the erasure of all personal data you hold about me.", delayMs: 6400 },
      { text: "Before deletion I also want a copy of the data you hold, under Article 15.", delayMs: 7500 },
      { text: "What is the legal timeline for you to complete this?", delayMs: 8000 },
      { text: "Please confirm in writing when it is done.", delayMs: 7500 },
      { text: "Thank you.", delayMs: 8500 },
    ],
  },
  {
    id: "c6",
    label: "Shipping delay",
    customer: { name: "Marcus Oyelaran", plan: "pro", tenure_months: 5, prior_tickets: 1 },
    messages: [
      { text: "My hardware key order #48213 was due Monday and the tracking hasn't moved since Thursday.", delayMs: 7800 },
      { text: "The carrier site just says 'in transit'. No other details.", delayMs: 7000 },
      { text: "I need it before I fly out on Saturday — is there anything you can do?", delayMs: 8000 },
      { text: "Can you just ship a replacement overnight?", delayMs: 8500 },
      { text: "Okay. If the first one shows up I'll send it back.", delayMs: 7000 },
    ],
  },
  {
    id: "c7",
    label: "Bug report + logs",
    customer: { name: "Chen Weiling", plan: "business", tenure_months: 18, prior_tickets: 3 },
    messages: [
      {
        text: "Webhook deliveries are failing with 502 since your 3.4.1 deploy. Log line: 2026-09-17T09:12:03Z POST /hooks/order.created -> 502 upstream timeout (retry 3/3)",
        delayMs: 9200,
      },
      { text: "All retries fail with the same upstream timeout. Our endpoint returns 200 in 40 ms when I curl it directly.", delayMs: 7500 },
      { text: "It's roughly 30% of deliveries. Started 09:05 UTC.", delayMs: 7000 },
      { text: "Can you replay the failed deliveries once it's fixed?", delayMs: 8000 },
      { text: "Thanks — please link the incident page when you have one.", delayMs: 7500 },
    ],
  },
  {
    id: "c8",
    label: "Confused user",
    customer: { name: "Harold Pemberton", plan: "free", tenure_months: 2, prior_tickets: 2 },
    messages: [
      { text: "Hello, my grandson set this up for me and now the screen is all different, I can't find my photos.", delayMs: 10600 },
      { text: "There's a little picture of a house at the top, is that it?", delayMs: 7500 },
      { text: "I clicked it and now it asks me to sign in again but I don't know the password, my grandson has it.", delayMs: 8000 },
      { text: "I'm sorry to be a bother, I'm not very good with these things.", delayMs: 7000 },
      { text: "Oh, I found it! Thank you dear, you've been very patient.", delayMs: 8500 },
    ],
  },
];

export function totalMessages(scripts: ChatScript[] = SCRIPTS): number {
  return scripts.reduce((n, s) => n + s.messages.length, 0);
}
