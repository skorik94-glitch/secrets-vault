// MCP method wiring on top of the JSON-RPC dispatcher. Tools-only server.

import { createDispatcher } from "./jsonrpc.mjs";

const DEFAULT_PROTOCOL = "2024-11-05";

/**
 * @param {{ serverInfo: {name:string, version:string},
 *           tools: Array<{name, description, inputSchema, handler}> }} cfg
 * @returns the dispatcher (async handle(msg)) plus the methods map.
 */
export function createMcpServer({ serverInfo, tools }) {
  const toolMap = new Map(tools.map((t) => [t.name, t]));

  const methods = {
    initialize: async (params) => ({
      protocolVersion: params?.protocolVersion || DEFAULT_PROTOCOL,
      capabilities: { tools: { listChanged: false } },
      serverInfo,
    }),
    "notifications/initialized": async () => {},
    ping: async () => ({}),
    "tools/list": async () => ({
      tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    }),
    "tools/call": async (params) => {
      const tool = toolMap.get(params?.name);
      if (!tool) {
        const e = new Error(`unknown tool: ${params?.name}`);
        e.code = -32602;
        throw e;
      }
      try {
        const out = await tool.handler(params.arguments || {});
        const text = typeof out === "string" ? out : JSON.stringify(out, null, 2);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        // Tool-level errors are reported in-band so the model can react.
        return { content: [{ type: "text", text: `error: ${err.message}` }], isError: true };
      }
    },
  };

  return { handle: createDispatcher(methods), methods };
}
