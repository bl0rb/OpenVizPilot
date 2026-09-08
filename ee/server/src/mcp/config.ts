import { mcpEndpointSchema } from './schema';

export interface McpServerConfig {
  id: string;
  url: string;
  tools: string[];
  tokenEnv?: string;
  token?: string;
}

export function resolveMcpServer(server: Omit<McpServerConfig, 'token'>, env: NodeJS.ProcessEnv = process.env): McpServerConfig {
  mcpEndpointSchema.parse({ id: server.id, url: server.url, ...(server.tokenEnv ? { tokenEnv: server.tokenEnv } : {}) });
  const token = server.tokenEnv ? env[server.tokenEnv]?.trim() : undefined;
  if (server.tokenEnv && !token) throw new Error('MCP credential unavailable');
  return { ...server, ...(token ? { token } : {}) };
}