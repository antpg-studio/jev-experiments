import type { Channel } from "./types";

export const CHANNELS: Channel[] = [
  {
    id: "acme",
    name: "#customer-acme",
    label: "#customer-acme (shared external)",
    audience: "external_customer",
    description: "Slack Connect channel shared with Acme Corp, a paying customer.",
  },
  {
    id: "eng",
    name: "#eng-internal",
    label: "#eng-internal",
    audience: "internal",
    description: "Private engineering channel. Only employees.",
  },
  {
    id: "dm",
    name: "DM: customer support conversation",
    label: "DM: customer support conversation",
    audience: "external_customer",
    description: "One-to-one Intercom conversation with a customer who opened a ticket.",
  },
  {
    id: "community",
    name: "#public-community",
    label: "#public-community",
    audience: "public",
    description: "Public community Slack; anyone on the internet can join and read.",
  },
];

export const AUDIENCE_LABEL: Record<Channel["audience"], string> = {
  external_customer: "external customer",
  internal: "internal only",
  public: "public",
};
