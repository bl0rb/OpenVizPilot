import { z } from 'zod';
import { registeredDashboardKeySchema, toolCallSchema } from '@openvizpilot/shared';

const idSchema = z.string().regex(/^[a-z][a-z0-9-]{0,16}$/);
export const mcpEndpointSchema = z.object({
  id: idSchema,
  url: z.string().url().max(500).refine((value) => {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash && !url.search;
  }),
  tokenEnv: z.string().regex(/^OVP_MCP_[A-Z0-9_]+$/).max(100).optional(),
}).strict();

export const mcpServerSchema = mcpEndpointSchema.extend({
  name: z.string().trim().min(1).max(100),
  enabled: z.boolean(),
  tools: z.array(z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/)).min(1).max(10),
  siteIds: z.array(idSchema).max(50),
}).strict();

export const mcpSiteSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(100),
  dashboardKeys: z.array(registeredDashboardKeySchema).max(200),
  members: z.array(z.string().trim().min(1).max(200)).max(200),
}).strict();

export const mcpSettingsSchema = z.object({
  servers: z.array(mcpServerSchema).max(5),
  sites: z.array(mcpSiteSchema).max(50),
}).strict().superRefine((settings, context) => {
  const siteIds = new Set(settings.sites.map((site) => site.id));
  const dashboardKeys = settings.sites.flatMap((site) => site.dashboardKeys);
  if (siteIds.size !== settings.sites.length || new Set(settings.servers.map((server) => server.id)).size !== settings.servers.length || new Set(dashboardKeys).size !== dashboardKeys.length) {
    context.addIssue({ code: 'custom', message: 'Site-, Server- und Dashboard-Zuordnungen müssen eindeutig sein.' });
  }
  for (const server of settings.servers) {
    if (new Set(server.tools).size !== server.tools.length || server.siteIds.some((id) => !siteIds.has(id))) {
      context.addIssue({ code: 'custom', message: 'Ungültige Tool- oder Site-Freigabe.' });
    }
  }
});

export type McpSettings = z.infer<typeof mcpSettingsSchema>;
export type McpServer = z.infer<typeof mcpServerSchema>;
export interface McpSettingsState { settings: McpSettings; revision: number }
export const mcpSettingsUpdateSchema = z.object({ settings: mcpSettingsSchema, revision: z.number().int().nonnegative() }).strict();

export interface McpApproval { ticket: string; destination: string }
export const mcpExecutionSchema = z.object({
  call: toolCallSchema,
  dashboardKey: registeredDashboardKeySchema,
  ticket: z.string().min(1).max(1000),
  approved: z.literal(true),
}).strict();