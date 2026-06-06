// Minimal JSON-RPC 2.0 over newline-delimited stdio. Zero dependencies.
// MCP's stdio transport is exactly this: one JSON object per line, logs to stderr.

/**
 * Build a message handler from a methods map.
 * methods[name](params) -> result | throws (Error; set .code for a JSON-RPC code).
 * Returns async (msg) -> responseObject | null (null for notifications).
 */
export function createDispatcher(methods) {
  return async function handle(msg) {
    const isNotification = msg && msg.method && msg.id === undefined;
    const fn = msg && methods[msg.method];

    if (isNotification) {
      if (fn) {
        try {
          await fn(msg.params || {});
        } catch {
          /* notifications get no response, even on error */
        }
      }
      return null;
    }

    if (!fn) {
      return { jsonrpc: "2.0", id: msg?.id ?? null, error: { code: -32601, message: `method not found: ${msg?.method}` } };
    }
    try {
      const result = await fn(msg.params || {});
      return { jsonrpc: "2.0", id: msg.id, result };
    } catch (e) {
      const code = Number.isInteger(e?.code) ? e.code : -32603;
      return { jsonrpc: "2.0", id: msg.id, error: { code, message: e?.message || String(e) } };
    }
  };
}

/** Wire a handler to stdio (or any streams). Responses are written as JSON + newline. */
export function startStdio(handle, { input = process.stdin, output = process.stdout } = {}) {
  let buf = "";
  input.setEncoding("utf8");
  input.on("data", async (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // ignore malformed lines
      }
      const res = await handle(msg);
      if (res) output.write(JSON.stringify(res) + "\n");
    }
  });
}
