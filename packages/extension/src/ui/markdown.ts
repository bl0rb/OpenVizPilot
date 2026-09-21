import DOMPurify from 'dompurify';
import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: true });

/**
 * Ohne echtes DOM (z. B. beim Import in Node-Unit-Tests ohne jsdom) liefert
 * das dompurify-Modul nur einen uninitialisierten Factory-Export ohne
 * addHook/sanitize — die Registrierung deshalb lazy beim ersten tatsächlichen
 * Rendern (im Browser ist dort immer ein window vorhanden), nicht beim
 * Modul-Laden.
 */
let sourceLinkHookRegistered = false;

/**
 * W7 Punkt 8: „## Quellen"-Links im Untersuchen-Fazit (Workbook · View · Link)
 * sollen wie gewöhnliche Links nutzbar sein — aber nie den Chat-Tab ersetzen
 * und nie window.opener an die verlinkte Seite durchreichen.
 */
function ensureSourceLinkHook(): void {
  if (sourceLinkHookRegistered || typeof DOMPurify.addHook !== 'function') return;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.hasAttribute('href')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
  sourceLinkHookRegistered = true;
}

/**
 * LLM-Output ist untrusted (kann Fragmente aus Dashboard-Zellwerten enthalten)
 * — deshalb immer durch DOMPurify. Zusätzlich werden alle Tags verboten, die
 * beim Rendern selbstständig externe Ressourcen laden könnten (img, video, …):
 * ein Markdown-Bild mit Angreifer-URL wäre sonst ein Beacon, der RLS-geschützte
 * Zellwerte per Query-String exfiltriert. Links bleiben erlaubt (kein Auto-Load),
 * aber nur mit https-Ziel (Quellen-Links zeigen auf Tableau Server) — das
 * schließt javascript:/data:-hrefs aus, ohne den <a>-Tag selbst zu verbieten.
 */
export function renderMarkdown(text: string): string {
  ensureSourceLinkHook();
  const html = marked.parse(text, { async: false });
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ALLOWED_URI_REGEXP: /^https:\/\//i,
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
