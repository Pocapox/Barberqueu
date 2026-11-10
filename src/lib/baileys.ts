import * as namespace from "@whiskeysockets/baileys";

// Baileys 6 is CommonJS. Native ESM cannot discover all re-exported symbols,
// while bundlers may already unwrap its namespace. Support both runtimes.
const runtimeNamespace = namespace as unknown as Record<string, unknown>;
const sdk = ("proto" in runtimeNamespace ? runtimeNamespace : runtimeNamespace.default) as typeof import("@whiskeysockets/baileys");
export const { BufferJSON, initAuthCreds, proto, makeWASocket, DisconnectReason, fetchLatestWaWebVersion, normalizeMessageContent } = sdk;
