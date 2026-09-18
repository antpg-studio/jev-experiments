import type { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
export function handleJev(req: IncomingMessage, res: ServerResponse): Promise<void>;
export function attachJevSocket(httpServer: EventEmitter, path?: string): void;
export function encodeTextFrame(str: string): Buffer;
export function decodeFrames(buf: Buffer): { frames: { fin: boolean; opcode: number; payload: Buffer }[]; rest: Buffer };
