import type { IncomingMessage } from "node:http";
export function readJevBody(req: IncomingMessage): Promise<string>;
export function forwardToJev(body: string, apiKey: string | undefined): Promise<{ status: number; body: string }>;
