import type { Kind } from "../lib/types.ts";

export const KIND_LABEL: Record<Kind, string> = {
  action_item: "Action",
  decision: "Decision",
  open_question: "Question",
  risk: "Risk",
  status_update: "Update",
  chit_chat: "Chat",
};

const SPEAKER_CLASSES = ["s0", "s1", "s2", "s3", "s4", "s5"];
export function speakerClass(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return SPEAKER_CLASSES[h % SPEAKER_CLASSES.length];
}

