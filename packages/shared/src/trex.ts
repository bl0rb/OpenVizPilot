/**
 * Erzeugt das .trex-Manifest für Tableau — Single Source of Truth für das
 * Build-Script (extension/scripts/make-trex.ts) UND den Admin-Download der
 * Middleware (GET /api/admin/trex). So kann ein Admin das Manifest mit der
 * korrekten HTTPS-URL direkt aus der Admin-UI herunterladen, ohne den
 * Quellcode auszuchecken.
 *
 * Tableau Server akzeptiert als source-location nur HTTPS; http://localhost
 * ist die dokumentierte Ausnahme für Tableau Desktop (Entwicklung).
 */

/** 70×70-PNG (Base64) aus extension/scripts/icon.png — dort per gen-icon.mjs regenerierbar. */
export const TREX_ICON_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEYAAABGCAYAAABxLuKEAAAA70lEQVR42u3cyRHCMBAEQOIgQ5IiVYiAQgbZe/VU+Sc93A8f0q5uN9mf++P5ynxBiMDqArIVqCvKXzjdUX7CmYJyCGcayhLOVJSvOGCgrONAAQMGzFkwQD7gwLgIJiJpYTIlBUzmhMFUCJgsMJUCBkxSmIoBA6Y4zOq83eNSw6zO3T0uNczq/N3jwIBpBuMZ463kOwYMGH/XYMBkhbHmC8a+kp1Ie9cJqx2ibqoNzLj6mKoo4TBjK6qqooTBjK/Bq4pyOYzixIMr/ONqfVugnAWjZF4vARgwcPRE6qTVe61b3/kOTgRxjoxTiIYiTMsbyuP71cDKOowAAAAASUVORK5CYII=';

// URL ist in beiden Ziel-Laufzeiten (Browser-Extension und Node-Server) ein
// Global; das Shared-Paket hat bewusst weder DOM- noch Node-Typen — daher
// diese minimale eigene Deklaration statt lib "dom".
interface ParsedUrl {
  protocol: string;
  hostname: string;
  username: string;
  password: string;
  search: string;
  hash: string;
  href: string;
}
declare const URL: new (input: string) => ParsedUrl;

export interface TrexUrlValidation {
  ok: boolean;
  /** Normalisierte URL (Pfad endet mit "/"), nur bei ok=true gesetzt. */
  url?: string;
  reason?: string;
}

const LOCAL_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]', '::1'];

/**
 * Validiert die Extension-URL für das Manifest: HTTPS (beliebiger Host) oder
 * http://localhost für die Entwicklung. Query/Fragment/Credentials sind
 * verboten — sie hätten im Manifest nichts zu suchen und könnten den
 * Ladepfad der Extension manipulieren.
 */
export function validateExtensionUrl(raw: string): TrexUrlValidation {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: false, reason: 'URL fehlt (erwartet: https://<host>/).' };
  let parsed: ParsedUrl;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'Keine gültige absolute URL (erwartet: https://<host>/).' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'URL darf keine Zugangsdaten enthalten.' };
  }
  if (parsed.search || parsed.hash) {
    return { ok: false, reason: 'URL darf keine Query-Parameter oder Fragmente enthalten.' };
  }
  const isLocal = LOCAL_HOSTNAMES.includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocal)) {
    return {
      ok: false,
      reason: 'Nur HTTPS-URLs sind erlaubt (http://localhost nur für die Entwicklung) — Tableau Server lehnt HTTP ab.',
    };
  }
  const normalized = parsed.href.endsWith('/') ? parsed.href : `${parsed.href}/`;
  return { ok: true, url: normalized };
}

function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export interface TrexOptions {
  /** Validierte Extension-URL (siehe validateExtensionUrl). */
  url: string;
  /** true = Dev-Manifest (eigene Extension-ID + "(Dev)"-Name). */
  dev?: boolean;
}

export function buildTrexManifest(options: TrexOptions): string {
  const dev = options.dev === true;
  const id = dev ? 'com.openvizpilot.extension.dev' : 'com.openvizpilot.extension';
  const name = dev ? 'OpenVizPilot (Dev)' : 'OpenVizPilot';
  const url = xmlEscape(options.url);
  // website MUSS laut Manifest-Schema https sein (auch im Dev-Manifest);
  // nur die source-location darf http://localhost verwenden.
  return `<?xml version="1.0" encoding="utf-8"?>
<manifest manifest-version="0.1" xmlns="http://www.tableau.com/xml/extension_manifest">
  <dashboard-extension id="${id}" extension-version="0.1.0">
    <default-locale>de_DE</default-locale>
    <name resource-id="name"/>
    <description>Chat mit dem geöffneten Tableau-Dashboard (OpenAI-kompatibler LLM-Endpunkt)</description>
    <author name="OpenVizPilot" email="mathiaswerk@icloud.com" organization="OpenVizPilot" website="https://github.com/bl0rb/OpenVizPilot"/>
    <min-api-version>1.10</min-api-version>
    <source-location>
      <url>${url}</url>
    </source-location>
    <icon>${TREX_ICON_BASE64}</icon>
  </dashboard-extension>
  <resources>
    <resource id="name">
      <text locale="de_DE">${name}</text>
      <text locale="en_US">${name}</text>
    </resource>
  </resources>
</manifest>
`;
}
