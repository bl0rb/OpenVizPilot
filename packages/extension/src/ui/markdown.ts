import DOMPurify from 'dompurify';
import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: true });

/**
 * LLM-Output ist untrusted (kann Fragmente aus Dashboard-Zellwerten enthalten)
 * — deshalb immer durch DOMPurify. Zusätzlich werden alle Tags verboten, die
 * beim Rendern selbstständig externe Ressourcen laden könnten (img, video, …):
 * ein Markdown-Bild mit Angreifer-URL wäre sonst ein Beacon, der RLS-geschützte
 * Zellwerte per Query-String exfiltriert. Links bleiben erlaubt (kein Auto-Load).
 */
export function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false });
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: [
      'img',
      'picture',
      'source',
      'video',
      'audio',
      'iframe',
      'object',
      'embed',
      'svg',
      'math',
      'form',
      'input',
      'button',
      'style',
    ],
    FORBID_ATTR: ['style', 'srcset', 'ping'],
  });
}
