import type { Channel } from "./types";

/**
 * Channels the guard knows about. `name` and `audience` are what Jev sees in the request state;
 * the Slack-specific fields only drive the sidebar and header.
 */
export const CHANNELS: Channel[] = [
  {
    id: "acme",
    name: "#customer-acme",
    label: "#customer-acme (shared external)",
    audience: "external_customer",
    description: "Slack Connect channel shared with Acme Corp, a paying customer.",
    kind: "channel",
    shared: true,
    members: 14,
    topic: "Shared with Acme Corp · SSO rollout + webhook migration",
  },
  {
    id: "eng",
    name: "#eng-internal",
    label: "#eng-internal",
    audience: "internal",
    description: "Private engineering channel. Only employees.",
    kind: "channel",
    private: true,
    members: 42,
    topic: "On-call: @priya · deploys freeze Fri 4pm",
  },
  {
    id: "dm",
    name: "DM: Jordan Lee (Acme, customer)",
    label: "Jordan Lee (customer)",
    audience: "external_customer",
    description: "One-to-one conversation with a customer who opened a support ticket.",
    kind: "dm",
    members: 2,
    topic: "",
  },
  {
    id: "community",
    name: "#public-community",
    label: "#public-community",
    audience: "public",
    description: "Public community Slack; anyone on the internet can join and read.",
    kind: "channel",
    members: 3812,
    topic: "Community help · be kind · no support tickets here",
  },
];

/** Extra sidebar entries that exist for realism; typing in them is judged as an internal audience. */
export const DECOR_CHANNELS: Channel[] = [
  {
    id: "general",
    name: "#general",
    label: "#general",
    audience: "internal",
    description: "Company-wide announcements.",
    kind: "channel",
    members: 212,
    topic: "Company-wide · announcements only",
  },
  {
    id: "random",
    name: "#random",
    label: "#random",
    audience: "internal",
    description: "Watercooler.",
    kind: "channel",
    members: 198,
    topic: "",
  },
  {
    id: "support-escalations",
    name: "#support-escalations",
    label: "#support-escalations",
    audience: "internal",
    description: "Internal support escalations.",
    kind: "channel",
    private: true,
    members: 23,
    topic: "SEV tickets only",
  },
];

export const ALL_CHANNELS: Channel[] = [...CHANNELS, ...DECOR_CHANNELS];

export const AUDIENCE_LABEL: Record<Channel["audience"], string> = {
  external_customer: "external customer",
  internal: "internal only",
  public: "public",
};
