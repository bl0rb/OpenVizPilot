import { describe, expect, it } from 'vitest';
import { buildMarkdownExport } from '../src/ui/items';
import type { ChatItem } from '../src/ui/items';

describe('buildMarkdownExport', () => {
  it('builds a dated filename and uses the assistant text verbatim as content', () => {
    const item: Extract<ChatItem, { kind: 'assistant' }> = {
      kind: 'assistant',
      id: 1,
      text: '# Führungsbericht\n\n- Kernaussage 1',
      streaming: false,
    };
    const result = buildMarkdownExport(item, new Date('2026-09-19T12:00:00Z'));
    expect(result.filename).toBe('openvizpilot-2026-09-19.md');
    expect(result.content).toBe('# Führungsbericht\n\n- Kernaussage 1');
  });
});
