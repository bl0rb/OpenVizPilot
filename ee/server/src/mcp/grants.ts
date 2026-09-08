import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { ToolCall } from '@openvizpilot/shared';

export class McpGrants {
  constructor(private readonly secret: string) {}

  private digest(call: ToolCall, principal: string): string {
    return createHash('sha256').update(JSON.stringify([principal, call.id, call.function.name, call.function.arguments])).digest('base64url');
  }

  issue(call: ToolCall, principal: string, now = Date.now()): string {
    const payload = Buffer.from(JSON.stringify({ expires: now + 120_000, digest: this.digest(call, principal) })).toString('base64url');
    return `${payload}.${createHmac('sha256', this.secret).update(payload).digest('base64url')}`;
  }

  verify(ticket: string, call: ToolCall, principal: string, now = Date.now()): boolean {
    try {
      const [payload, signature, extra] = ticket.split('.');
      if (!payload || !signature || extra !== undefined) return false;
      const expected = createHmac('sha256', this.secret).update(payload).digest();
      const received = Buffer.from(signature, 'base64url');
      if (received.length !== expected.length || !timingSafeEqual(received, expected)) return false;
      const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { expires: number; digest: string };
      return parsed.expires > now && parsed.expires <= now + 120_000 && parsed.digest === this.digest(call, principal);
    } catch {
      return false;
    }
  }
}