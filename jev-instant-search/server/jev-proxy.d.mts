import type { IncomingMessage, ServerResponse } from "node:http";

export function handleJev(req: IncomingMessage, res: ServerResponse): Promise<void>;
