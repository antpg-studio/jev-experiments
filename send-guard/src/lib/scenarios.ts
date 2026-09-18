export interface Scenario {
  title: string;
  channelId: string;
  draft: string;
  expect: "send" | "warn" | "block";
}

/** Replayed character-by-character by the "Replay scenarios" button. All data is invented. */
export const SCENARIOS: Scenario[] = [
  {
    title: "Pasted a live API key",
    channelId: "eng",
    draft:
      "hey can someone check why the webhook is 500ing? use this to repro: sk-live-4f9a2c7e1b8d6a3f0c5e9b2d7a1f4c8e",
    expect: "block",
  },
  {
    title: "Guaranteed ship date to a customer",
    channelId: "acme",
    draft: "Thanks for flagging! The SSO fix is already in review — we'll ship it by Friday, guaranteed, and you'll get a $2,000 credit for the trouble.",
    expect: "warn",
  },
  {
    title: "Polite refusal",
    channelId: "dm",
    draft:
      "I completely understand the frustration. Unfortunately we can't extend the trial a second time, but I'm happy to walk you through the Starter plan so you keep your data. Would Tuesday or Wednesday work for a quick call?",
    expect: "send",
  },
  {
    title: "Hostile reply",
    channelId: "dm",
    draft: "Honestly this is the third time you've asked. Read the docs. It's not our problem that your team can't follow a two-step setup guide.",
    expect: "block",
  },
  {
    title: "Internal pricing leak in the external channel",
    channelId: "acme",
    draft:
      "Quick heads up: our cost per seat is about $4 so there's plenty of margin — we're also killing the Team tier in Q3 and moving everyone to Enterprise pricing before the announcement.",
    expect: "block",
  },
  {
    title: "Benign status update",
    channelId: "community",
    draft: "Good news — v2.3 is out! Release notes are on the blog, and the migration guide covers the new webhook signatures. Ping me here if anything looks off.",
    expect: "send",
  },
];
