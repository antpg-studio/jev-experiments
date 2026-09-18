import type { IncomingMessage, ServerResponse } from "node:http";

export function loadApiKey(envPath?: URL): string;
export function createJevHandler(
  apiKey: string,
): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
