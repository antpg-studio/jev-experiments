/** Invented people and message history so each channel looks lived-in. No real data. */

export interface Person {
  id: string;
  name: string;
  initials: string;
  /** Avatar background colour. */
  color: string;
  external?: boolean;
  title?: string;
}

export interface Message {
  id: string;
  author: string;
  time: string;
  text: string;
  reactions?: Array<{ emoji: string; count: number }>;
}

export const ME: Person = { id: "me", name: "Sam Rivera", initials: "SR", color: "#4a154b", title: "Customer Engineering" };

export const PEOPLE: Record<string, Person> = {
  me: ME,
  priya: { id: "priya", name: "Priya Natarajan", initials: "PN", color: "#e0a33a", title: "Staff Engineer" },
  marcus: { id: "marcus", name: "Marcus Hale", initials: "MH", color: "#2d9cdb", title: "Support Lead" },
  jordan: { id: "jordan", name: "Jordan Lee", initials: "JL", color: "#0b8a6f", external: true, title: "Acme Corp · Platform" },
  wei: { id: "wei", name: "Wei Zhang", initials: "WZ", color: "#8e5cd9", external: true, title: "Acme Corp · IT" },
  dana: { id: "dana", name: "Dana Okafor", initials: "DO", color: "#e0567a", title: "Product" },
  ravi: { id: "ravi", name: "Ravi Menon", initials: "RM", color: "#5c7cfa" },
  lena: { id: "lena", name: "Lena Fischer", initials: "LF", color: "#f2761e", title: "Community" },
  tomas: { id: "tomas", name: "tomas_dev", initials: "TD", color: "#7c8b9a", external: true },
};

export const SEED: Record<string, Message[]> = {
  acme: [
    { id: "a1", author: "wei", time: "9:12 AM", text: "Morning! We flipped SSO on for the pilot group (30 users) last night. So far so good." },
    { id: "a2", author: "priya", time: "9:15 AM", text: "Great to hear. Keep an eye on the audit log for `saml_assertion_expired` — that's the one thing we saw in staging.", reactions: [{ emoji: "👀", count: 2 }] },
    { id: "a3", author: "jordan", time: "9:41 AM", text: "One issue: two users get bounced back to the login page after the IdP redirect. Both are on the new group. Screens attached in the ticket (#4821)." },
    { id: "a4", author: "me", time: "9:44 AM", text: "Thanks Jordan — looking now. Can you confirm whether those two have the `department` attribute set in Okta?" },
    { id: "a5", author: "jordan", time: "9:52 AM", text: "Checked — they don't. Everyone else does. Is that the cause?", reactions: [{ emoji: "🙏", count: 1 }] },
  ],
  eng: [
    { id: "e1", author: "priya", time: "8:03 AM", text: "Deploy freeze starts Friday 4pm. Anything for 2.3.1 needs to be in review by Thursday noon." },
    { id: "e2", author: "ravi", time: "8:20 AM", text: "webhook-relay is at 3% 5xx since the 02:00 deploy. Rolling back to 2.3.0 while I look.", reactions: [{ emoji: "🔥", count: 3 }, { emoji: "👍", count: 4 }] },
    { id: "e3", author: "dana", time: "8:31 AM", text: "Acme is asking about the missing `department` attribute mapping in the SSO flow — is that on us or on them?" },
    { id: "e4", author: "priya", time: "8:34 AM", text: "On us. We require it but never documented it. PR up in 20 min to make it optional." },
    { id: "e5", author: "ravi", time: "8:58 AM", text: "Rollback done. 5xx back to 0.1%. Root cause looks like the new signature verification rejecting v1 payloads." },
  ],
  dm: [
    { id: "d1", author: "jordan", time: "Yesterday 4:48 PM", text: "Hey Sam — our trial ends tomorrow and finance hasn't approved the PO yet. Any chance of another extension?" },
    { id: "d2", author: "me", time: "Yesterday 5:02 PM", text: "Hi Jordan, let me check what's possible on our side and get back to you first thing." },
    { id: "d3", author: "jordan", time: "8:15 AM", text: "Morning! Any news? The team is a bit nervous about losing the workspace data." },
    { id: "d4", author: "jordan", time: "8:16 AM", text: "Also the two-step setup guide is still confusing to our IT folks, honestly. Third time I've had to walk someone through it." },
  ],
  community: [
    { id: "c1", author: "tomas", time: "7:40 AM", text: "Is anyone else seeing `invalid signature` on webhooks since this morning? Nothing changed on my end." },
    { id: "c2", author: "lena", time: "7:55 AM", text: "Hi Tomas 👋 yes — we've heard from a few people. The team is looking at it; I'll post here as soon as I know more." },
    { id: "c3", author: "tomas", time: "8:02 AM", text: "Thanks! For now I've disabled verification, which I know is not great 😅", reactions: [{ emoji: "😅", count: 5 }] },
    { id: "c4", author: "lena", time: "8:30 AM", text: "Update: it was a change in the relay that rejected older payload versions. It's been rolled back — signatures should validate again." },
  ],
  general: [
    { id: "g1", author: "dana", time: "9:00 AM", text: "Reminder: all-hands is at 11 today. Agenda in the calendar invite." },
    { id: "g2", author: "marcus", time: "9:05 AM", text: "Support is at 14 open tickets, down from 31 on Monday. Nice work everyone 🎉", reactions: [{ emoji: "🎉", count: 12 }] },
  ],
  random: [{ id: "r1", author: "ravi", time: "8:45 AM", text: "The office espresso machine now has a Grafana dashboard. This is where we are as a company." }],
  "support-escalations": [{ id: "s1", author: "marcus", time: "8:50 AM", text: "#4821 (Acme SSO bounce) is now a SEV-3. Priya owns the fix, Sam owns comms." }],
};
