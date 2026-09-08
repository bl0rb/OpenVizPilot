import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import { Ajv } from 'ajv';
import type { ToolCall } from '@openvizpilot/shared';
import type { McpServerConfig } from './config';

const TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 262_144;
const MAX_RESULT_CHARS = 16_000;

export interface ExternalToolDefinition {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export class McpGateway {
  private active = 0;
  private windowStart = 0;
  private callsInWindow = 0;

  constructor(
    private readonly servers: McpServerConfig[],
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private toolName(server: McpServerConfig, tool: string): string {
    return `mcp__${server.id}__${tool}`;
  }

  destination(name: string): string | undefined {
    return this.servers.find((server) => server.tools.some((tool) => this.toolName(server, tool) === name))?.url;
  }

  private async withClient<Result>(
    server: McpServerConfig,
    signal: AbortSignal,
    run: (client: Client, signal: AbortSignal) => Promise<Result>,
  ): Promise<Result> {
    if (this.active >= 4) throw new Error('MCP busy');
    this.active += 1;
    const combined = AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]);
    const client = new Client({ name: 'openvizpilot', version: '0.1.0' }, { capabilities: {} });
    const endpoint = new URL(server.url).href;
    const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
      requestInit: { headers: server.token ? { authorization: `Bearer ${server.token}` } : {} },
      reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 },
      fetch: async (input, init) => {
        const target = input instanceof Request ? input.url : String(input);
        if (new URL(target).href !== endpoint) throw new Error('MCP destination denied');
        const response = await this.fetchImpl(input, { ...init, redirect: 'error', signal: combined });
        if (!response.body) return response;
        let bytes = 0;
        const limited = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            bytes += chunk.byteLength;
            if (bytes > MAX_RESPONSE_BYTES) throw new Error('MCP response too large');
            controller.enqueue(chunk);
          },
        }));
        return new Response(limited, { status: response.status, statusText: response.statusText, headers: response.headers });
      },
    });
    try {
      await client.connect(transport, { signal: combined, timeout: TIMEOUT_MS });
      return await run(client, combined);
    } finally {
      if (transport.sessionId) await transport.terminateSession().catch(() => undefined);
      await client.close().catch(() => undefined);
      this.active -= 1;
    }
  }

  private async discover(client: Client, server: McpServerConfig, signal: AbortSignal, approvedOnly = true) {
    const allowed = new Set(server.tools);
    const found = new Map<string, Awaited<ReturnType<Client['listTools']>>['tools'][number]>();
    let cursor: string | undefined;
    for (let page = 0; page < 5; page += 1) {
      const result = await client.listTools(cursor ? { cursor } : {}, { signal, timeout: TIMEOUT_MS });
      for (const tool of result.tools) {
        if ((!approvedOnly || allowed.has(tool.name)) && /^[a-zA-Z0-9_-]{1,40}$/.test(tool.name) && tool.annotations?.readOnlyHint === true && tool.annotations.destructiveHint !== true) {
          if (JSON.stringify(tool.inputSchema).length > 16_000) continue;
          found.set(tool.name, tool);
        }
      }
      cursor = result.nextCursor;
      if (!cursor) return found;
    }
    throw new Error('MCP tool catalogue too large');
  }

  async probe(signal: AbortSignal): Promise<Array<{ name: string; description: string }>> {
    const server = this.servers[0];
    if (!server) return [];
    const tools = await this.withClient(server, signal, (client, combined) => this.discover(client, server, combined, false));
    return [...tools.values()].map((tool) => ({ name: tool.name, description: tool.description?.slice(0, 1000) ?? '' }));
  }

  async definitions(signal: AbortSignal, serverIds = this.servers.map((server) => server.id)): Promise<ExternalToolDefinition[]> {
    const definitions: ExternalToolDefinition[] = [];
    for (const server of this.servers) {
      if (!serverIds.includes(server.id)) continue;
      try {
        const tools = await this.withClient(server, signal, (client, combined) => this.discover(client, server, combined));
        for (const tool of tools.values()) {
          definitions.push({
            type: 'function',
            function: {
              name: this.toolName(server, tool.name),
              description: `External read-only source (${server.id}); requires user approval. ${tool.description?.slice(0, 1000) ?? tool.name}`,
              parameters: tool.inputSchema,
            },
          });
        }
      } catch {
        if (signal.aborted) throw signal.reason;
      }
    }
    return definitions;
  }

  async execute(call: ToolCall, signal: AbortSignal): Promise<string> {
    const server = this.servers.find((candidate) => candidate.tools.some((tool) => this.toolName(candidate, tool) === call.function.name));
    if (!server) throw new Error('MCP tool denied');
    const toolName = server.tools.find((tool) => this.toolName(server, tool) === call.function.name)!;
    if (Date.now() - this.windowStart >= 60_000) {
      this.windowStart = Date.now();
      this.callsInWindow = 0;
    }
    if (this.callsInWindow >= 30) throw new Error('MCP rate limit');
    this.callsInWindow += 1;
    return this.withClient(server, signal, async (client, combined) => {
      const tools = await this.discover(client, server, combined);
      const tool = tools.get(toolName);
      if (!tool) throw new Error('MCP tool not read-only or unavailable');
      const args: unknown = JSON.parse(call.function.arguments || '{}');
      const validate = new Ajv({ strict: false, validateFormats: false }).compile(tool.inputSchema);
      if (!validate(args)) throw new Error('Invalid MCP arguments');
      const result = await client.callTool({ name: toolName, arguments: args as Record<string, unknown> }, undefined, { signal: combined, timeout: TIMEOUT_MS });
      if (result.isError) throw new Error('MCP execution failed');
      const content = Array.isArray(result.content) ? result.content : [];
      const text = content.filter((item) => item.type === 'text' && typeof item.text === 'string').map((item) => item.text).join('\n');
      const structured = result.structuredContent ? JSON.stringify(result.structuredContent) : '';
      const body = [text, structured].filter(Boolean).join('\n');
      return JSON.stringify({
        source: server.id,
        retrievedAt: new Date().toISOString(),
        content: body.slice(0, MAX_RESULT_CHARS),
        truncated: body.length > MAX_RESULT_CHARS,
      });
    });
  }
}