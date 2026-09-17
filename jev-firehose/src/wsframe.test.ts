import { describe, expect, it } from "vitest";
import { decodeFrames, encodeTextFrame } from "../jevProxy.mjs";

function maskedClientFrame(str: string): Buffer {
  const payload = Buffer.from(str, "utf8");
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const len = payload.length;
  const header = len < 126 ? Buffer.from([0x81, 0x80 | len]) : Buffer.from([0x81, 0x80 | 126, len >> 8, len & 0xff]);
  const masked = Buffer.from(payload.map((b, i) => b ^ mask[i & 3]));
  return Buffer.concat([header, mask, masked]);
}

describe("websocket framing", () => {
  it("round-trips server text frames of every length class", () => {
    for (const n of [0, 5, 125, 126, 300, 70_000]) {
      const s = "x".repeat(n);
      const { frames, rest } = decodeFrames(encodeTextFrame(s));
      expect(rest.length).toBe(0);
      expect(frames).toHaveLength(1);
      expect(frames[0].opcode).toBe(1);
      expect(frames[0].payload.toString()).toBe(s);
    }
  });

  it("unmasks client frames, handles coalesced and partial frames", () => {
    const a = maskedClientFrame(JSON.stringify({ id: "m1", state: { text: "héllo" } }));
    const b = maskedClientFrame("y".repeat(200));
    const both = Buffer.concat([a, b]);
    const cut = both.subarray(0, a.length + 10);
    const first = decodeFrames(cut);
    expect(first.frames).toHaveLength(1);
    expect(JSON.parse(first.frames[0].payload.toString()).state.text).toBe("héllo");
    expect(first.rest.length).toBe(10);
    const second = decodeFrames(Buffer.concat([first.rest, both.subarray(cut.length)]));
    expect(second.frames).toHaveLength(1);
    expect(second.frames[0].payload.toString()).toBe("y".repeat(200));
    expect(second.rest.length).toBe(0);
  });
});
