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
  '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';

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

/**
 * Version im Manifest — für Tableau sichtbar im Erweiterungsdialog. Bei einem
 * Release mitziehen, sonst zeigt der Admin-Dialog eine falsche Version an.
 */
export const EXTENSION_VERSION = '1.3.1';

export function buildTrexManifest(options: TrexOptions): string {
  const dev = options.dev === true;
  const id = dev ? 'com.openvizpilot.extension.dev' : 'com.openvizpilot.extension';
  const name = dev ? 'OpenVizPilot (Dev)' : 'OpenVizPilot';
  const url = xmlEscape(options.url);
  // website MUSS laut Manifest-Schema https sein (auch im Dev-Manifest);
  // nur die source-location darf http://localhost verwenden.
  return `<?xml version="1.0" encoding="utf-8"?>
<manifest manifest-version="0.1" xmlns="http://www.tableau.com/xml/extension_manifest">
  <dashboard-extension id="${id}" extension-version="${EXTENSION_VERSION}">
    <default-locale>de_DE</default-locale>
    <name resource-id="name"/>
    <description>Chat mit dem geöffneten Tableau-Dashboard (OpenAI-kompatibler LLM-Endpunkt)</description>
    <author name="OpenVizPilot" email="info@werkworks.de" organization="OpenVizPilot" website="https://github.com/bl0rb/OpenVizPilot"/>
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
