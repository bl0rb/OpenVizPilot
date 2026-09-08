/**
 * Selbstenthaltene Admin-UI unter GET /admin (nur wenn ADMIN_TOKEN gesetzt
 * ist, siehe app.ts) — verwaltet die zentralen Slash-Befehle und zeigt die
 * anonyme Nutzungsstatistik. Bewusst als ein Template-String ohne
 * Build-Schritt (kein Vite/Extension-Bundle nötig) mit Vanilla-JS.
 *
 * Der Admin-Token wird NUR im sessionStorage des Browsers gehalten und bei
 * jedem Request als "Authorization: Bearer <token>" an /api/admin/* gesendet
 * — nie in der URL (siehe Datenschutz-Regel: keine Secrets in URLs/Logs).
 */
import { mcpAdminScript, mcpAdminSection, mcpAdminStyles } from '@openvizpilot/ee/server';
import { ChartNoAxesCombined, Download, KeyRound, LayoutDashboard, LockKeyhole, LockKeyholeOpen, LogOut, Network, Settings, ShieldCheck, Terminal, Trash2, Users, type IconNode } from 'lucide';
import { adminFont } from './admin-font';

const adminLogo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="tdabg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3b82f6"/>
      <stop offset="1" stop-color="#1e40af"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="14" fill="url(#tdabg)"/>
  <path d="M14 18 a6 6 0 0 1 6 -6 h24 a6 6 0 0 1 6 6 v20 a6 6 0 0 1 -6 6 H28 l-8 8 v-8 a6 6 0 0 1 -6 -6 Z" fill="#ffffff"/>
  <rect x="20.5" y="30" width="5.5" height="8" rx="1.6" fill="#60a5fa"/>
  <rect x="29.25" y="25" width="5.5" height="13" rx="1.6" fill="#2563eb"/>
  <rect x="38" y="20" width="5.5" height="18" rx="1.6" fill="#1e40af"/>
  <path d="M51 43 L53 49 L59 51 L53 53 L51 59 L49 53 L43 51 L49 49 Z" fill="#ffffff"/>
  <path d="M58 38 L59 40.6 L61.6 41.6 L59 42.6 L58 45.2 L57 42.6 L54.4 41.6 L57 40.6 Z" fill="#bfdbfe"/>
</svg>`;

function adminIcon(nodes: IconNode): string {
  return `<svg class="ui-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${nodes.map(([tag, attributes]) => `<${tag} ${Object.entries(attributes).map(([name, value]) => `${name}="${value}"`).join(' ')} />`).join('')}</svg>`;
}

export const adminPageHtml = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>OpenVizPilot — Admin</title>
<style>
  @font-face { font-family: 'Inter Variable'; font-style: normal; font-weight: 100 900; font-display: swap; src: url('${adminFont}') format('woff2'); }
  :root {
    --accent: #635bff;
    --accent-hover: #4a35d6;
    --bg: #f6f8fb;
    --surface: #ffffff;
    --border: #e3e8ef;
    --text: #1a1f36;
    --text-muted: #5b6470;
    --graphite: #0d0f16;
    --danger: #b3261e;
    --danger-bg: #fdecea;
    --ok-bg: #eaf3ec;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 0;
    background: var(--bg);
    color: var(--text);
    font: 14px/1.6 'Inter Variable', Inter, sans-serif;
    letter-spacing: 0;
  }
  main { margin: 0 auto; }
  h1 { font-size: 1.3rem; margin: 0 0 0.25rem; }
  .subtitle { color: var(--text-muted); margin: 0 0 2rem; }
  h2 { font-size: 1.05rem; margin: 0 0 0.75rem; }
  section.card {
    background: transparent;
    border: 0;
    border-radius: 0;
    padding: 1.5rem 0;
    margin-bottom: 1rem;
  }
  .row { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
  input[type="text"], input[type="password"], input[type="url"], input[type="search"], textarea, select {
    font: inherit;
    color: inherit;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.4rem 0.55rem;
  }
  textarea { width: 100%; resize: vertical; min-height: 3.5rem; }
  select { max-width: 100%; padding-right: 2rem; cursor: pointer; }
  input:read-only { background: var(--bg); color: var(--text-muted); }
  input:disabled, textarea:disabled, select:disabled { background: var(--bg); color: var(--text-muted); cursor: not-allowed; }
  .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr)); gap: 1rem 1.25rem; margin-bottom: 1.25rem; align-items: end; }
  .form-field, .form-grid > label { display: grid; gap: 0.4rem; min-width: 0; font-size: 13px; font-weight: 500; }
  .form-field > input, .form-grid > label > input, .form-grid > label > select { width: 100%; min-width: 0; }
  .form-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; padding-top: 1.25rem; margin-top: 1.25rem; border-top: 1px solid var(--border); }
  .form-section { border: 0; border-top: 1px solid var(--border); min-width: 0; margin: 1.5rem 0 0; padding: 1.25rem 0 0; }
  .form-section legend { padding: 0 0.75rem 0 0; font-weight: 600; }
  button {
    font: inherit;
    cursor: pointer;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--surface);
    padding: 0.45rem 0.85rem;
  }
  button:hover { border-color: var(--accent); }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  button.primary:hover { background: var(--accent-hover); opacity: 1; }
  :is(button, input, select, textarea, a, summary):focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }
  input[type="checkbox"] { accent-color: var(--accent); }
  button.danger { color: var(--danger); }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 0.75rem; }
  th, td { text-align: left; padding: 0.4rem 0.5rem; border-bottom: 1px solid var(--border); vertical-align: top; }
  th { color: var(--text-muted); background: #eef1f6; font-weight: 600; font-size: 0.8rem; letter-spacing: 0; }
  td input[type="text"] { width: 100%; }
  .col-name { width: 12%; }
  .col-desc { width: 20%; }
  .col-hint { width: 12%; }
  .col-del { width: 2.5rem; text-align: center; }
  #commands-table, #playbook-commands-table { min-width: 820px; table-layout: fixed; }
  #commands-table .col-name, #playbook-commands-table .col-name { width: 17%; }
  #commands-table .col-hint, #playbook-commands-table .col-hint { width: 16%; }
  #models-table { min-width: 520px; }
  #users-table { min-width: 520px; }
  #users-table .col-del { width: 144px; white-space: nowrap; }
  .icon-button { display: inline-flex; align-items: center; justify-content: center; width: 38px; height: 38px; padding: 0; flex-shrink: 0; }
  #users-table .icon-button + .icon-button { margin-left: 4px; }
  dialog { width: min(440px, calc(100% - 2rem)); max-height: calc(100dvh - 2rem); overflow: auto; padding: 1.5rem; border: 1px solid var(--border); border-radius: 8px; color: var(--text); background: var(--surface); }
  dialog::backdrop { background: rgb(13 15 22 / 45%); }
  dialog input { min-height: 44px; }
  .hint { color: var(--text-muted); font-size: 0.85rem; margin: 0.25rem 0 1rem; }
  .banner { border-radius: 6px; padding: 0.6rem 0.8rem; margin-bottom: 1rem; font-size: 0.9rem; display: none; }
  .banner.error { display: block; background: var(--danger-bg); color: var(--danger); }
  .banner.ok { display: block; background: var(--ok-bg); color: #1e5631; }
  .hint.error { color: var(--danger); font-weight: 600; }
  .stats-grid { display: flex; flex-wrap: wrap; gap: 1.25rem; }
  .stats-block { min-width: 220px; flex: 1 1 220px; }
  .stats-block h3 { font-size: 0.85rem; margin: 0 0 0.4rem; color: var(--text-muted); letter-spacing: 0; }
  .stats-block table td:last-child, .stats-block table th:last-child { text-align: right; }
  .total-turns { font-size: 1.6rem; font-weight: 600; color: var(--accent); }
  .stats-heading { font-size: 0.85rem; margin: 1rem 0 0.25rem; color: var(--text-muted); letter-spacing: 0; }
  th.num, td.num { text-align: right; }
  #gate { max-width: 420px; margin: 5rem auto; padding: 2rem; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; }
  #gate .row { justify-content: center; margin-top: 0.75rem; }
  #app { display: none; }
  ${mcpAdminStyles}
  [hidden] { display: none !important; }
  .ui-icon { flex: 0 0 18px; vertical-align: middle; }
  .masthead { height: 72px; padding: 0 2rem; background: var(--graphite); color: #e7e9f2; display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
  .brand { display: flex; align-items: center; gap: 0.75rem; font-size: 18px; font-weight: 700; }
  .brand img { width: 34px; height: 34px; }
  .brand-origin { font-size: 12px; font-weight: 400; color: #a1a8c0; border-left: 1px solid #343847; padding-left: 1rem; }
  .masthead-label { font-size: 12px; color: #a1a8c0; }
  .admin-shell { display: grid; grid-template-columns: 236px minmax(0, 1fr); min-height: calc(100vh - 72px); }
  .sidebar { background: var(--surface); border-right: 1px solid var(--border); padding: 2rem 1rem 1.25rem; display: flex; flex-direction: column; gap: 1.5rem; }
  .sidebar nav { position: sticky; top: 1.5rem; }
  .nav-group { margin: 1.5rem 0 0.5rem; padding: 0 0.75rem; font-size: 11px; font-weight: 600; color: var(--text-muted); }
  .nav-group:first-child { margin-top: 0; }
  .sidebar a { min-height: 42px; display: flex; align-items: center; gap: 0.7rem; margin: 0.2rem 0; padding: 0.6rem 0.75rem; color: var(--text-muted); border-radius: 6px; text-decoration: none; font-size: 13px; font-weight: 500; }
  .sidebar a:hover { background: var(--bg); color: var(--text); }
  .sidebar a[aria-current="page"] { background: #eeedff; color: #4a35d6; box-shadow: inset 3px 0 var(--accent); }
  .nav-ee { margin-left: auto; font-size: 10px; font-weight: 700; }
  #logout { display: flex; align-items: center; gap: 0.7rem; margin-top: auto; color: var(--text-muted); background: transparent; border: 0; text-align: left; min-height: 42px; }
  .workspace { min-width: 0; width: 100%; max-width: 1280px; padding: 2rem 3rem 4rem; }
  .workspace-heading { border-bottom: 1px solid var(--border); padding-bottom: 1.5rem; margin-bottom: 0.25rem; }
  .workspace-heading p { margin: 0 0 0.5rem; color: var(--text-muted); font-size: 12px; }
  .workspace-heading h1 { font-size: 28px; line-height: 1.3; font-weight: 650; margin: 0; overflow-wrap: anywhere; }
  .workspace h2 { font-size: 18px; line-height: 1.4; font-weight: 600; }
  .workspace h2 small { font-size: 11px; font-weight: 600; color: #4a35d6; background: #eeedff; border-radius: 4px; padding: 4px 7px; margin-left: 6px; vertical-align: middle; }
  .workspace section { min-width: 0; }
  .workspace .hint { max-width: 85ch; line-height: 1.7; }
  .workspace button { min-height: 38px; font-size: 13px; font-weight: 500; }
  .workspace input:not([type="checkbox"]), .workspace select { min-height: 38px; }
  .workspace th, .workspace td { padding: 0.7rem 0.6rem; }
  .workspace table { font-size: 13px; }
  .workspace tbody tr:hover { background: #f0f2f7; }
  .row > input, .row > select { max-width: 100%; min-width: 0; }
  .banner, td, .hint { overflow-wrap: anywhere; }
  #mcp-admin { border: 0; padding-top: 1.5rem; }
  #mcp-admin .mcp-entry { padding: 1.1rem 1.25rem; margin: 0.75rem 0 1rem; border-radius: 8px; }
  #mcp-admin summary { font-size: 14px; }
  #mcp-admin .mcp-fields { gap: 1rem 1.25rem; }
  #mcp-admin .mcp-fields label { font-size: 12px; font-weight: 500; gap: 0.35rem; }
  #mcp-admin h3 { margin-top: 1.75rem; font-size: 13px; }
  .mobile-navigation { display: none; }
  #gate h1 { margin-bottom: 0.75rem; font-size: 23px; }
  #gate .subtitle { margin-bottom: 1.5rem; }
  #gate input, #gate .primary { width: 100%; min-height: 44px; }
  #gate input { max-width: 100%; }
  #gate label { display: block; margin: 1rem 0 0.4rem; font-size: 13px; font-weight: 500; }
  #gate form .primary { margin-top: 1.5rem; }
  #gate .gate-caption { color: var(--text-muted); font-size: 12px; margin: 0 0 0.5rem; }
  @media (max-width: 900px) {
    .admin-shell { grid-template-columns: 210px minmax(0, 1fr); }
    .workspace { padding: 1.75rem 1.5rem 3rem; }
    .brand-origin { display: none; }
  }
  @media (max-width: 680px) {
    .masthead { height: 64px; padding: 0 1.1rem; }
    .brand { font-size: 16px; }
    .masthead-label { font-size: 11px; }
    .admin-shell { display: block; min-height: calc(100vh - 64px); }
    .sidebar { padding: 0.75rem 1rem; border-right: 0; border-bottom: 1px solid var(--border); flex-direction: row; align-items: center; gap: 0.5rem; }
    .sidebar nav { display: none; }
    .mobile-navigation { display: block; flex: 1; min-width: 0; min-height: 42px; }
    #logout { margin: 0; padding: 0.5rem; }
    #logout span { display: none; }
    .workspace { padding: 1.5rem 1rem 3rem; }
    .workspace input:not([type="checkbox"]), .workspace textarea, .workspace select, #gate input, dialog input { font-size: 16px; }
    .workspace-heading h1 { font-size: 24px; }
    .workspace-heading { padding-bottom: 1.25rem; }
    #mcp-admin .mcp-entry { padding: 1rem; }
    #gate { margin: 2rem 1rem; padding: 1.5rem; }
    #commands-table, #playbook-commands-table { min-width: 680px; }
  }
</style>
</head>
<body>
<header class="masthead">
  <div class="brand"><img src="data:image/svg+xml,${encodeURIComponent(adminLogo)}" width="34" height="34" alt="" /><span>OpenVizPilot</span><span class="brand-origin">WerkWorks</span></div>
  <span class="masthead-label">Administration</span>
</header>
<main>
  <div id="gate">
    <p class="gate-caption">OpenVizPilot Administration</p>
    <h1 id="gate-title">Admin-Anmeldung</h1>

    <div id="gate-token" hidden>
      <p class="subtitle">Bitte den Admin-Token eingeben.</p>
      <div class="row">
        <label for="token-input">Admin-Token</label>
        <input type="password" id="token-input" placeholder="Admin-Token" autocomplete="off" />
        <button class="primary" id="token-submit">Anmelden</button>
      </div>
    </div>

    <form id="gate-setup" hidden>
      <p class="subtitle">Noch kein Admin vorhanden. Lege das Passwort für das erste Administratorkonto fest.</p>
      <label for="setup-password">Admin-Passwort</label>
      <input type="password" id="setup-password" autocomplete="new-password" required minlength="12" maxlength="200" aria-describedby="setup-password-hint" />
      <p class="hint" id="setup-password-hint">Mindestens 12 Zeichen.</p>
      <label for="setup-confirm">Passwort bestätigen</label>
      <input type="password" id="setup-confirm" autocomplete="new-password" required minlength="12" maxlength="200" />
      <button class="primary" id="setup-submit" type="submit">Administratorkonto anlegen</button>
    </form>

    <form id="gate-login" hidden>
      <p class="subtitle">Mit deinem Administratorkonto anmelden.</p>
      <label for="login-password">Admin-Passwort</label>
      <input type="password" id="login-password" autocomplete="current-password" required maxlength="200" />
      <button class="primary" id="login-submit" type="submit">Anmelden</button>
    </form>

    <p id="gate-error" class="banner error" role="alert"></p>
    <div class="row"><button id="gate-retry" hidden>Erneut versuchen</button></div>
  </div>

  <div id="app">
    <div class="admin-shell">
    <aside class="sidebar">
      <nav aria-label="Administration">
        <p class="nav-group">Arbeitsbereich</p>
        <a href="#mcp-admin" aria-current="page">${adminIcon(Network)}MCP &amp; Sites <span class="nav-ee">EE</span></a>
        <a href="#commands-admin">${adminIcon(Terminal)}Slash-Befehle</a>
        <a href="#playbooks-admin">${adminIcon(LayoutDashboard)}Dashboard-Analysen</a>
        <a href="#models-admin">${adminIcon(Settings)}Modelle</a>
        <p class="nav-group">Zugriff</p>
        <a href="#auth-admin">${adminIcon(ShieldCheck)}Anmeldung &amp; Lizenz</a>
        <a href="#users-admin">${adminIcon(Users)}Benutzerkonten</a>
        <p class="nav-group">Betrieb</p>
        <a href="#extension-admin">${adminIcon(Download)}Tableau-Extension</a>
        <a href="#usage-admin">${adminIcon(ChartNoAxesCombined)}Nutzung</a>
      </nav>
      <select id="admin-navigation" class="mobile-navigation" aria-label="Administrationsbereich">
        <optgroup label="Arbeitsbereich"><option value="mcp-admin">MCP &amp; Sites</option><option value="commands-admin">Slash-Befehle</option><option value="playbooks-admin">Dashboard-Analysen</option><option value="models-admin">Modelle</option></optgroup>
        <optgroup label="Zugriff"><option value="auth-admin">Anmeldung &amp; Lizenz</option><option value="users-admin">Benutzerkonten</option></optgroup>
        <optgroup label="Betrieb"><option value="extension-admin">Tableau-Extension</option><option value="usage-admin">Nutzung</option></optgroup>
      </select>
      <button id="logout" title="Abmelden" aria-label="Abmelden">${adminIcon(LogOut)}<span>Abmelden</span></button>
    </aside>
    <div class="workspace">
      <header class="workspace-heading"><p id="view-group">Arbeitsbereich</p><h1 id="view-title" tabindex="-1">MCP &amp; Sites</h1></header>

    ${mcpAdminSection}

    <section class="card" id="commands-admin" hidden>
      <h2>Slash-Befehle</h2>
      <p id="commands-source" class="hint"></p>
      <p id="commands-banner" class="banner"></p>
      <div style="overflow-x: auto;">
        <table id="commands-table">
          <thead>
            <tr>
              <th class="col-name">Name</th>
              <th class="col-desc">Beschreibung</th>
              <th class="col-hint">Arg-Hinweis</th>
              <th>Template</th>
              <th class="col-del"></th>
            </tr>
          </thead>
          <tbody id="commands-body"></tbody>
        </table>
      </div>
      <div class="row">
        <button id="add-command">+ Befehl hinzufügen</button>
        <button class="primary" id="save-commands">Speichern</button>
        <button class="danger" id="reset-commands">Auf Standard zurücksetzen</button>
      </div>
    </section>

    <section class="card" id="auth-admin" hidden>
      <h2>Anmeldung, Single Sign-On &amp; Lizenz</h2>
      <p class="hint">
        Wer die Extension (und damit die Middleware) nutzen darf. <strong>Benutzerkonten</strong> (Open Core):
        Anwender melden sich in der Extension mit Konten aus dem Bereich „Benutzerkonten“ an.
        <strong>Single Sign-On</strong> (Enterprise): Anmeldung mit dem Firmenkonto über Microsoft Entra ID oder
        Keycloak — braucht einen gültigen Lizenzschlüssel. Einstellungen hier überschreiben die Env-Defaults
        (AUTH_MODE, OIDC_*, OVP_LICENSE) sofort für alle Replicas.
      </p>
      <p id="auth-source" class="hint"></p>
      <p id="auth-banner" class="banner"></p>
      <div class="form-grid">
        <label>Anmeldemodus
          <select id="auth-mode">
            <option value="none">Offen (nur Netzwerkschutz)</option>
            <option value="local">Benutzerkonten (Core-Edition)</option>
            <option value="oidc">Single Sign-On per OIDC (Enterprise)</option>
          </select>
        </label>
        <label style="flex: 1 1 320px;">Öffentliche URL der Middleware (für die SSO-Redirect-URI)
          <input type="text" id="auth-public-url" placeholder="https://chat.example.com" autocomplete="off" />
        </label>
      </div>
      <div id="oidc-fields">
        <div class="form-grid">
          <label>Identity-Provider
            <select id="oidc-provider">
              <option value="entra">Microsoft Entra ID</option>
              <option value="keycloak">Keycloak</option>
              <option value="generic">Anderer OIDC-Provider</option>
            </select>
          </label>
          <label style="flex: 1 1 320px;">Issuer-URL
            <input type="text" id="oidc-issuer" placeholder="https://login.microsoftonline.com/&lt;tenant-id&gt;/v2.0" autocomplete="off" />
          </label>
        </div>
        <div class="form-grid">
          <label style="flex: 1 1 240px;">Client-ID
            <input type="text" id="oidc-client-id" autocomplete="off" />
          </label>
          <label style="flex: 1 1 240px;">Client-Secret (optional, nur confidential clients)
            <input type="password" id="oidc-client-secret" autocomplete="new-password" placeholder="unverändert lassen" />
          </label>
          <label style="flex: 1 1 200px;">Scopes
            <input type="text" id="oidc-scopes" value="openid profile email" autocomplete="off" />
          </label>
        </div>
        <p class="hint">Redirect-URI beim Provider registrieren: <code id="oidc-redirect">—</code> (ergibt sich aus der öffentlichen URL) — siehe docs/enterprise.md für die Einrichtung in Entra bzw. Keycloak.</p>
      </div>
      <fieldset class="form-section"><legend>Enterprise-Lizenz</legend>
      <label class="form-field">Lizenzschlüssel
        <textarea id="license-token" rows="3" placeholder="Signierter Lizenz-Token (leer lassen = unverändert)" spellcheck="false"></textarea>
      </label>
      <p id="license-summary" class="hint">Lade …</p>
      <div id="telemetry-box" class="hint" style="border-top: 1px solid var(--border); margin-top: 0.75rem; padding-top: 0.75rem;">
        <strong>Lizenz-Heartbeat</strong>
        <p id="telemetry-status" class="hint"></p>
        <details>
          <summary style="cursor: pointer;">Was gesendet wird</summary>
          <div class="row" style="align-items: flex-start; gap: 2rem;">
            <div><em>Gesendet:</em><ul id="telemetry-sends"></ul></div>
            <div><em>Nie gesendet:</em><ul id="telemetry-never"></ul></div>
          </div>
        </details>
      </div>
      </fieldset>
      <div class="form-actions">
        <button class="primary" id="save-auth">Prüfen &amp; speichern</button>
        <button id="remove-license">Lizenz entfernen</button>
        <button class="danger" id="reset-auth">Auf Env-Defaults zurücksetzen</button>
      </div>
    </section>

    <section class="card" id="users-admin" hidden>
      <h2>Benutzerkonten (Core-Edition)</h2>
      <p class="hint">
        Konten für die Anmeldung in der Extension im Modus „Benutzerkonten“. Passwörter werden nur als
        Hash gespeichert; Sperren beendet laufende Sitzungen sofort.
      </p>
      <p id="users-banner" class="banner"></p>
      <div style="overflow-x: auto;">
        <table id="users-table">
          <thead>
            <tr>
              <th>Benutzername</th>
              <th>Anzeigename</th>
              <th>Status</th>
              <th class="col-del"></th>
            </tr>
          </thead>
          <tbody id="users-body"></tbody>
        </table>
      </div>
      <form id="create-user-form">
      <fieldset class="form-section"><legend>Benutzer anlegen</legend>
      <div class="form-grid">
        <label for="new-username">Benutzername<input type="text" id="new-username" autocomplete="off" autocapitalize="none" spellcheck="false" required /></label>
        <label for="new-display-name">Anzeigename (optional)<input type="text" id="new-display-name" autocomplete="off" /></label>
        <label for="new-password">Passwort (mindestens 10 Zeichen)<input type="password" id="new-password" autocomplete="new-password" minlength="10" required /></label>
      </div>
      <div class="form-actions">
        <button class="primary" id="create-user" type="submit">Benutzer anlegen</button>
      </div>
      </fieldset>
      </form>
    </section>

    <section class="card" id="playbooks-admin" hidden>
      <h2>Standardanalysen pro Dashboard</h2>
      <p class="hint">
        Eigene Starter-Fragen (max. 5) und Slash-Befehle je Dashboard. Die Extension lädt das Playbook
        für das geöffnete Dashboard: Starter erscheinen vor den generischen Vorschlägen, Dashboard-Befehle
        überlagern gleichnamige globale. Eingebundene Dashboards erscheinen nach dem ersten angemeldeten Start automatisch – auch ohne Chatfragen. Die Zuordnung wird im Workbook gespeichert.
      </p>
      <p id="playbooks-banner" class="banner"></p>
      <div class="row" style="margin-bottom: 0.75rem;">
        <label for="playbook-key">Dashboard:</label>
        <select id="playbook-key" style="flex: 1 1 260px;"><option value="">Dashboard auswählen …</option></select>
        <button id="playbook-refresh">Dashboards aktualisieren</button>
      </div>
      <p id="playbook-status" class="hint"></p>
      <fieldset id="playbook-editor" class="form-section" disabled><legend>Analysen bearbeiten</legend>
      <label for="playbook-starters" class="hint" style="display: block;">Starter-Fragen (eine je Zeile, max. 5)</label>
      <textarea id="playbook-starters" rows="4" placeholder="z. B. Wie hat sich der Umsatz im letzten Quartal entwickelt?"></textarea>
      <p class="hint" style="margin-top: 0.75rem;">Slash-Befehle nur für dieses Dashboard</p>
      <div style="overflow-x: auto;">
        <table id="playbook-commands-table">
          <thead>
            <tr>
              <th class="col-name">Name</th>
              <th class="col-desc">Beschreibung</th>
              <th class="col-hint">Arg-Hinweis</th>
              <th>Template</th>
              <th class="col-del"></th>
            </tr>
          </thead>
          <tbody id="playbook-commands-body"></tbody>
        </table>
      </div>
      <div class="row">
        <button id="playbook-add-command">+ Befehl hinzufügen</button>
        <button class="primary" id="playbook-save">Analysen speichern</button>
        <button class="danger" id="playbook-delete">Analysen löschen</button>
      </div>
      </fieldset>
    </section>

    <section class="card" id="models-admin" hidden>
      <h2>Modelle in der Extension</h2>
      <p class="hint">
        Welche Modelle die Extension im Auswahlmenü anbietet — mit sprechendem Anzeigenamen statt
        der technischen Modell-ID. Ohne gespeicherte Liste zeigt die Extension alle Modelle, die der
        LLM-Endpunkt meldet (ggf. gefiltert über MODEL_ALLOWLIST).
      </p>
      <p id="models-source" class="hint"></p>
      <p id="models-banner" class="banner"></p>
      <div style="overflow-x: auto;">
        <table id="models-table">
          <thead>
            <tr>
              <th style="width: 45%;">Modell-ID (am Endpunkt)</th>
              <th>Anzeigename in der Extension</th>
              <th class="col-del"></th>
            </tr>
          </thead>
          <tbody id="models-body"></tbody>
        </table>
      </div>
      <div class="row">
        <button id="add-model">+ Modell hinzufügen</button>
        <button id="lookup-models">Vom Endpunkt laden</button>
        <button class="primary" id="save-models">Speichern</button>
        <button class="danger" id="reset-models">Auf Endpunkt-Liste zurücksetzen</button>
      </div>
      <div id="lookup-results" class="row" style="margin-top: 0.75rem;"></div>
    </section>

    <section class="card" id="extension-admin" hidden>
      <h2>Extension für Tableau</h2>
      <p class="hint">
        Lädt das Manifest (.trex) mit der eingetragenen Extension-URL herunter — die Adresse, unter der
        diese Middleware die Extension ausliefert (HTTPS-Pflicht auf Tableau Server; die Extension
        verbindet sich dann automatisch mit demselben Host). Anschließend die URL in die
        Server-Safelist eintragen und das Manifest im Dashboard auswählen.
      </p>
      <p id="trex-banner" class="banner"></p>
      <label class="form-field" for="trex-url">Öffentliche Extension-URL
        <input type="url" id="trex-url" placeholder="https://chat.example.com/" autocomplete="off" spellcheck="false" />
      </label>
      <div class="form-actions">
        <button class="primary" id="trex-download">Manifest (.trex) herunterladen</button>
      </div>
    </section>

    <section class="card" id="usage-admin" hidden>
      <h2>Nutzung (anonym)</h2>
      <p class="hint">Aggregierte Zähler ohne Nutzerbezug und ohne Inhalte.</p>
      <div class="row" style="margin-bottom: 1rem;">
        <label for="stats-days">Zeitraum:</label>
        <select id="stats-days">
          <option value="7">7 Tage</option>
          <option value="30" selected>30 Tage</option>
          <option value="90">90 Tage</option>
        </select>
        <span>Chat-Turns gesamt: <span class="total-turns" id="total-turns">–</span></span>
      </div>
      <p id="stats-banner" class="banner"></p>
      <h3 class="stats-heading">Dashboards</h3>
      <p class="hint">
        Fragen je Dashboard und je Anwender. Anwender werden ausschließlich als nicht umkehrbare
        Pseudonyme gezählt — keine Namen, keine Tableau-IDs, keine Inhalte. Kennzahlen je Anwender
        erscheinen erst ab 3 Anwendern (darunter „&lt; 3“), damit sich einzelne Personen nicht über
        die Zähler erraten lassen.
      </p>
      <div style="overflow-x: auto;">
        <table id="dashboard-stats">
          <thead>
            <tr>
              <th>Dashboard</th>
              <th class="num">Fragen</th>
              <th class="num">Anwender</th>
              <th class="num">Ø Fragen/Anwender</th>
              <th class="num">max. je Anwender</th>
            </tr>
          </thead>
          <tbody id="dashboard-stats-body"></tbody>
        </table>
      </div>
      <h3 class="stats-heading">Zähler</h3>
      <div class="stats-grid" id="stats-grid"></div>
    </section>
    </div>
    </div>
  </div>
</main>
<dialog id="user-password-dialog" aria-labelledby="user-password-title">
  <form id="user-password-form">
    <h2 id="user-password-title">Passwort ändern</h2>
    <p id="user-password-account" class="hint"></p>
    <label class="form-field" for="user-password-value">Neues Passwort (mindestens 10 Zeichen)
      <input type="password" id="user-password-value" autocomplete="new-password" minlength="10" required />
    </label>
    <p class="hint">Laufende Sitzungen dieses Benutzers werden beendet.</p>
    <p id="user-password-banner" class="banner" role="alert"></p>
    <div class="form-actions">
      <button type="button" id="user-password-cancel">Abbrechen</button>
      <button type="submit" id="user-password-save" class="primary">Passwort speichern</button>
    </div>
  </form>
</dialog>

<script>
(function () {
  'use strict';

  var STORAGE_KEY = 'openvizpilotAdminToken';
  var gate = document.getElementById('gate');
  var app = document.getElementById('app');
  var gateError = document.getElementById('gate-error');
  var actionIcons = { remove: ${JSON.stringify(adminIcon(Trash2))}, password: ${JSON.stringify(adminIcon(KeyRound))}, lock: ${JSON.stringify(adminIcon(LockKeyhole))}, unlock: ${JSON.stringify(adminIcon(LockKeyholeOpen))} };

  function setActionIcon(button, icon, label) {
    button.innerHTML = actionIcons[icon];
    button.classList.add('icon-button');
    button.title = label;
    button.setAttribute('aria-label', label);
  }

  function getToken() {
    try {
      return sessionStorage.getItem(STORAGE_KEY) || '';
    } catch (e) {
      return '';
    }
  }
  function setToken(token) {
    try {
      sessionStorage.setItem(STORAGE_KEY, token);
    } catch (e) { /* privater Modus o.ä. — Token gilt dann nur für diese Aktion */ }
  }
  function clearToken() {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch (e) { /* siehe oben */ }
  }

  function showBanner(el, text, kind) {
    el.textContent = text;
    el.className = 'banner' + (text ? ' ' + kind : '');
    el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    el.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite');
  }

  function showGate(message) {
    if (passwordDialog && passwordDialog.open) passwordDialog.close();
    app.style.display = 'none';
    gate.style.display = 'block';
    showBanner(gateError, message || '', 'error');
    initGate();
  }

  /** Fragt den Auth-Modus ab und blendet das passende Gate-Formular ein. */
  function initGate() {
    ['gate-token', 'gate-setup', 'gate-login', 'gate-retry'].forEach(function (id) {
      document.getElementById(id).hidden = true;
    });
    fetch('/api/admin/auth-status')
      .then(function (res) { return res.json().then(function (data) { return { res: res, data: data }; }); })
      .then(function (result) {
        if (!result.res.ok) {
          // z. B. 503 bei kurzem DB-Ausfall: Retry anbieten statt Sackgasse.
          showBanner(gateError, result.data.error || 'Admin-UI nicht verfügbar.', 'error');
          document.getElementById('gate-retry').hidden = false;
          return;
        }
        var id =
          result.data.mode === 'token' ? 'gate-token' :
          result.data.mode === 'setup' ? 'gate-setup' : 'gate-login';
        document.getElementById('gate-title').textContent = result.data.mode === 'setup' ? 'Admin-Konto einrichten' : 'Admin-Anmeldung';
        document.getElementById(id).hidden = false;
      })
      .catch(function () {
        showBanner(gateError, 'Server nicht erreichbar.', 'error');
        document.getElementById('gate-retry').hidden = false;
      });
  }

  function showApp() {
    gate.style.display = 'none';
    app.style.display = 'block';
    selectAdminView(false);
    loadMcp();
  }

  function selectAdminView(focus) {
    var selector = document.getElementById('admin-navigation');
    var selected = location.hash.slice(1);
    var option = Array.from(selector.options).find(function (entry) { return entry.value === selected; }) || selector.options[0];
    selected = option.value;
    selector.value = selected;
    document.querySelectorAll('.workspace > section').forEach(function (section) { section.hidden = section.id !== selected; });
    document.querySelectorAll('.sidebar nav a').forEach(function (link) {
      if (link.hash === '#' + selected) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    document.getElementById('view-title').textContent = option.textContent;
    document.getElementById('view-group').textContent = option.parentElement.label;
    if (focus && app.style.display !== 'none') {
      window.scrollTo(0, 0);
      document.getElementById('view-title').focus({ preventScroll: true });
    }
  }
  window.addEventListener('hashchange', function () { selectAdminView(true); });
  document.getElementById('admin-navigation').addEventListener('change', function (event) { location.hash = event.target.value; });

  /** fetch gegen /api/admin/* mit Bearer-Token; wirft bei 401 zurück ins Token-Gate. */
  function adminFetch(path, options) {
    options = options || {};
    var headers = Object.assign({}, options.headers, { authorization: 'Bearer ' + getToken() });
    return fetch('/api/admin' + path, Object.assign({}, options, { headers: headers })).then(function (res) {
      if (res.status === 401) {
        clearToken();
        showGate('Token ungültig oder abgelaufen — bitte erneut eingeben.');
        throw new Error('unauthorized');
      }
      return res;
    });
  }

  ${mcpAdminScript}

  // ---------- Slash-Befehle ----------

  var commandsBody = document.getElementById('commands-body');
  var commandsSource = document.getElementById('commands-source');
  var commandsBanner = document.getElementById('commands-banner');

  function commandRow(cmd) {
    var tr = document.createElement('tr');

    function cell(cls, valueKey, placeholder, isTextarea) {
      var td = document.createElement('td');
      td.className = cls || '';
      var field = document.createElement(isTextarea ? 'textarea' : 'input');
      if (!isTextarea) field.type = 'text';
      field.placeholder = placeholder || '';
      field.value = cmd[valueKey] || '';
      field.dataset.field = valueKey;
      field.setAttribute('aria-label', { name: 'Befehlsname', description: 'Beschreibung', argHint: 'Argument-Hinweis', template: 'Prompt-Template' }[valueKey]);
      td.appendChild(field);
      return td;
    }

    tr.appendChild(cell('col-name', 'name', 'z. B. vergleich'));
    tr.appendChild(cell('col-desc', 'description', 'Kurzbeschreibung'));
    tr.appendChild(cell('col-hint', 'argHint', 'optional'));
    tr.appendChild(cell('', 'template', 'Prompt-Template ({{args}} für Argumente)', true));

    var delTd = document.createElement('td');
    delTd.className = 'col-del';
    var delBtn = document.createElement('button');
    delBtn.type = 'button';
    setActionIcon(delBtn, 'remove', 'Befehl entfernen');
    delBtn.addEventListener('click', function () {
      tr.remove();
    });
    delTd.appendChild(delBtn);
    tr.appendChild(delTd);

    return tr;
  }

  function renderCommands(commands, source) {
    commandsBody.innerHTML = '';
    commands.forEach(function (cmd) {
      commandsBody.appendChild(commandRow(cmd));
    });
    commandsSource.textContent =
      source === 'custom'
        ? 'Aktuell: eigene, gespeicherte Befehle.'
        : 'Aktuell: eingebaute Standard-Befehle (nichts gespeichert).';
  }

  function readCommandsFromTable() {
    var rows = Array.prototype.slice.call(commandsBody.querySelectorAll('tr'));
    return rows.map(function (tr) {
      var out = {};
      Array.prototype.forEach.call(tr.querySelectorAll('[data-field]'), function (field) {
        var value = field.value.trim();
        if (field.dataset.field === 'argHint') {
          if (value) out.argHint = value;
        } else {
          out[field.dataset.field] = value;
        }
      });
      return out;
    });
  }

  function loadCommands() {
    return adminFetch('/commands')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        renderCommands(data.commands || [], data.source);
      })
      .catch(function () { /* adminFetch hat bei 401 schon reagiert */ });
  }

  document.getElementById('add-command').addEventListener('click', function () {
    commandsBody.appendChild(commandRow({ name: '', description: '', argHint: '', template: '' }));
  });

  document.getElementById('save-commands').addEventListener('click', function () {
    showBanner(commandsBanner, '', 'ok');
    var commands = readCommandsFromTable();
    adminFetch('/commands', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(commands),
    })
      .then(function (res) {
        return res.json().then(function (data) { return { res: res, data: data }; });
      })
      .then(function (result) {
        if (!result.res.ok) {
          var details = (result.data.details || [])
            .map(function (d) { return (d.path || []).join('.') + ': ' + d.message; })
            .join('; ');
          showBanner(commandsBanner, (result.data.error || 'Speichern fehlgeschlagen') + (details ? ' — ' + details : ''), 'error');
          return;
        }
        showBanner(commandsBanner, 'Gespeichert.', 'ok');
        return loadCommands();
      })
      .catch(function () { /* adminFetch hat bei 401 schon reagiert */ });
  });

  document.getElementById('reset-commands').addEventListener('click', function () {
    if (!confirm('Wirklich auf die eingebauten Standard-Befehle zurücksetzen?')) return;
    adminFetch('/commands', { method: 'DELETE' })
      .then(function (res) {
        if (!res.ok) {
          showBanner(commandsBanner, 'Zurücksetzen fehlgeschlagen.', 'error');
          return;
        }
        showBanner(commandsBanner, 'Auf Standard zurückgesetzt.', 'ok');
        return loadCommands();
      })
      .catch(function () { /* adminFetch hat bei 401 schon reagiert */ });
  });

  // ---------- Anmeldung, SSO & Lizenz ----------

  var authMode = document.getElementById('auth-mode');
  var authSource = document.getElementById('auth-source');
  var authBanner = document.getElementById('auth-banner');
  var oidcFields = document.getElementById('oidc-fields');
  var oidcProvider = document.getElementById('oidc-provider');
  var oidcIssuer = document.getElementById('oidc-issuer');
  var oidcClientId = document.getElementById('oidc-client-id');
  var oidcClientSecret = document.getElementById('oidc-client-secret');
  var oidcScopes = document.getElementById('oidc-scopes');
  var oidcRedirect = document.getElementById('oidc-redirect');
  var licenseToken = document.getElementById('license-token');
  var licenseSummary = document.getElementById('license-summary');
  var authPublicUrl = document.getElementById('auth-public-url');
  var featureLabels = {};

  function updateRedirectPreview() {
    var origin = authPublicUrl.value.trim().replace(/\\/$/, '');
    oidcRedirect.textContent = origin ? origin + '/auth/callback' : '— (öffentliche URL eintragen)';
  }
  authPublicUrl.addEventListener('input', updateRedirectPreview);

  function describeLicenseStatus(lic) {
    if (lic.status === 'valid') {
      return 'Enterprise Edition — Lizenz für „' + lic.licensee + '“ gültig bis ' + String(lic.validUntil).slice(0, 10) + ' · Features: ' + (lic.features || []).map(function (f) { return featureLabels[f] || f; }).join(', ');
    }
    if (lic.status === 'expired') return 'Enterprise-Lizenz für „' + lic.licensee + '“ ist am ' + String(lic.validUntil).slice(0, 10) + ' abgelaufen — Enterprise-Funktionen deaktiviert.';
    if (lic.status === 'invalid') return 'Lizenz ungültig: ' + lic.reason;
    return 'Core-Edition (keine Enterprise-Lizenz hinterlegt).';
  }

  function updateOidcVisibility() {
    oidcFields.hidden = authMode.value !== 'oidc';
  }
  authMode.addEventListener('change', updateOidcVisibility);

  function renderAuth(data) {
    featureLabels = data.featureLabels || {};
    var eff = data.effective;
    var modeLabels = { none: 'offen (nur Netzwerkschutz)', token: 'Shared-Token (API_AUTH_TOKEN, per Env)', local: 'Benutzerkonten', oidc: 'Single Sign-On' };
    var text = 'Aktiv: ' + (modeLabels[eff.mode] || eff.mode) + ' (Quelle: ' + (eff.source === 'db' ? 'Admin-UI' : 'Env-Defaults') + ')';
    if (eff.blockedReason) text += ' — BLOCKIERT: ' + eff.blockedReason;
    authSource.textContent = text;
    authSource.classList.toggle('error', Boolean(eff.blockedReason));
    licenseSummary.textContent = describeLicenseStatus(eff.license || { status: 'none' }) + (data.stored && data.stored.hasLicense ? ' (aus Admin-UI)' : data.envDefaults && data.envDefaults.hasLicense ? ' (aus Env)' : '');
    if (eff.mode === 'none' || eff.mode === 'local' || eff.mode === 'oidc') authMode.value = eff.mode;
    var oidc = (data.stored && data.stored.oidc) || eff.oidc;
    if (oidc) {
      oidcProvider.value = oidc.provider;
      oidcIssuer.value = oidc.issuer;
      oidcClientId.value = oidc.clientId;
      oidcScopes.value = oidc.scopes || 'openid profile email';
    }
    oidcClientSecret.value = '';
    oidcClientSecret.placeholder = data.stored && data.stored.hasClientSecret ? 'gespeichert — leer lassen = unverändert' : 'leer = public client (PKCE)';
    licenseToken.value = '';
    renderTelemetry(data.telemetry);
    authPublicUrl.value = eff.publicUrl || (data.envDefaults && data.envDefaults.publicUrl) || window.location.origin;
    authPublicUrl.placeholder = data.envDefaults && data.envDefaults.publicUrl ? 'Env: ' + data.envDefaults.publicUrl : 'https://chat.example.com';
    updateRedirectPreview();
    updateOidcVisibility();
  }

  function renderTelemetry(t) {
    var box = document.getElementById('telemetry-box');
    if (!t) { box.hidden = true; return; }
    box.hidden = false;
    var status = t.active
      ? 'Aktiv — alle ' + t.intervalHours + ' Stunden an ' + t.endpoint + '. ' + t.reason
      : 'Inaktiv — ' + t.reason;
    if (t.lastOkAt) status += ' Zuletzt erfolgreich: ' + new Date(t.lastOkAt).toLocaleString('de-DE') + '.';
    else if (t.lastAttemptAt) status += ' Letzter Versuch: ' + new Date(t.lastAttemptAt).toLocaleString('de-DE') + ' (' + (t.lastDetail || 'ohne Ergebnis') + ').';
    document.getElementById('telemetry-status').textContent = status;
    [['telemetry-sends', t.sends], ['telemetry-never', t.neverSends]].forEach(function (pair) {
      var list = document.getElementById(pair[0]);
      list.innerHTML = '';
      (pair[1] || []).forEach(function (entry) {
        var li = document.createElement('li');
        li.textContent = entry;
        list.appendChild(li);
      });
    });
  }

  function loadAuth() {
    return adminFetch('/auth-settings')
      .then(function (res) { return res.json(); })
      .then(renderAuth)
      .catch(function () { /* adminFetch hat bei 401 schon reagiert */ });
  }

  function jsonRequest(method, body) {
    return { method: method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  }

  function errorText(data, fallback) {
    if (data && typeof data.error === 'string') {
      var details = (data.details || []).map(function (d) { return (d.path || []).join('.') + ': ' + d.message; }).join('; ');
      return data.error + (details ? ' — ' + details : '');
    }
    return fallback;
  }

  function saveAuth(extra) {
    var body = { mode: authMode.value };
    if (oidcIssuer.value.trim() || oidcClientId.value.trim()) {
      body.oidc = {
        provider: oidcProvider.value,
        issuer: oidcIssuer.value.trim(),
        clientId: oidcClientId.value.trim(),
        scopes: oidcScopes.value.trim() || 'openid profile email'
      };
      if (oidcClientSecret.value) body.oidc.clientSecret = oidcClientSecret.value;
    }
    if (licenseToken.value.trim()) body.license = licenseToken.value.trim();
    body.publicUrl = authPublicUrl.value.trim();
    if (extra) Object.keys(extra).forEach(function (k) { body[k] = extra[k]; });
    return adminFetch('/auth-settings', jsonRequest('PUT', body))
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (result) {
        if (!result.ok) {
          showBanner(authBanner, errorText(result.data, 'Speichern fehlgeschlagen'), 'error');
          return;
        }
        renderAuth(result.data);
        showBanner(authBanner, 'Gespeichert — gilt sofort für alle Anmeldungen.', 'ok');
      })
      .catch(function () { showBanner(authBanner, 'Speichern fehlgeschlagen', 'error'); });
  }

  document.getElementById('save-auth').addEventListener('click', function () { saveAuth(); });
  document.getElementById('remove-license').addEventListener('click', function () {
    if (!window.confirm('Lizenzschlüssel aus der Admin-UI entfernen? Enterprise-Funktionen werden deaktiviert.')) return;
    licenseToken.value = '';
    if (authMode.value === 'oidc') authMode.value = 'local';
    saveAuth({ license: '' });
  });
  document.getElementById('reset-auth').addEventListener('click', function () {
    if (!window.confirm('Alle Anmelde-Einstellungen der Admin-UI verwerfen und die Env-Defaults verwenden?')) return;
    adminFetch('/auth-settings', { method: 'DELETE' })
      .then(function (res) { return res.json(); })
      .then(function (data) { renderAuth(data); showBanner(authBanner, 'Zurückgesetzt auf Env-Defaults.', 'ok'); })
      .catch(function () { showBanner(authBanner, 'Zurücksetzen fehlgeschlagen', 'error'); });
  });

  // ---------- Benutzerkonten ----------

  var usersBody = document.getElementById('users-body');
  var usersBanner = document.getElementById('users-banner');

  function userAction(path, options, okText) {
    return adminFetch(path, options)
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (result) {
        if (!result.ok) {
          showBanner(usersBanner, errorText(result.data, 'Aktion fehlgeschlagen'), 'error');
          return false;
        }
        showBanner(usersBanner, okText, 'ok');
        return loadUsers().then(function () { return true; });
      })
      .catch(function () { showBanner(usersBanner, 'Aktion fehlgeschlagen', 'error'); });
  }

  function renderUsers(users) {
    usersBody.innerHTML = '';
    if (users.length === 0) {
      var tr = document.createElement('tr');
      var td = document.createElement('td');
      td.colSpan = 4;
      td.className = 'hint';
      td.textContent = 'Noch keine Benutzerkonten.';
      tr.appendChild(td);
      usersBody.appendChild(tr);
      return;
    }
    users.forEach(function (u) {
      var tr = document.createElement('tr');
      var name = document.createElement('td');
      name.textContent = u.username;
      var display = document.createElement('td');
      display.textContent = u.displayName || '';
      var status = document.createElement('td');
      status.textContent = u.disabled ? 'gesperrt' : 'aktiv';
      var actions = document.createElement('td');
      actions.className = 'col-del';
      var pw = document.createElement('button');
      pw.type = 'button';
      setActionIcon(pw, 'password', 'Passwort ändern: ' + u.username);
      pw.addEventListener('click', function () {
        passwordUsername = u.username;
        document.getElementById('user-password-account').textContent = u.displayName ? u.displayName + ' (' + u.username + ')' : u.username;
        passwordForm.reset();
        showBanner(passwordBanner, '', 'error');
        passwordDialog.showModal();
        document.getElementById('user-password-value').focus();
      });
      var toggle = document.createElement('button');
      toggle.type = 'button';
      setActionIcon(toggle, u.disabled ? 'unlock' : 'lock', (u.disabled ? 'Entsperren: ' : 'Sperren: ') + u.username);
      toggle.addEventListener('click', function () {
        userAction('/users/' + encodeURIComponent(u.username) + '/disabled', jsonRequest('PUT', { disabled: !u.disabled }), u.disabled ? 'Entsperrt.' : 'Gesperrt.');
      });
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'danger';
      setActionIcon(del, 'remove', 'Benutzer löschen: ' + u.username);
      del.addEventListener('click', function () {
        if (!window.confirm('Benutzer ' + u.username + ' löschen?')) return;
        userAction('/users/' + encodeURIComponent(u.username), { method: 'DELETE' }, 'Gelöscht.');
      });
      actions.appendChild(pw);
      actions.appendChild(toggle);
      actions.appendChild(del);
      tr.appendChild(name);
      tr.appendChild(display);
      tr.appendChild(status);
      tr.appendChild(actions);
      usersBody.appendChild(tr);
    });
  }

  function loadUsers() {
    return adminFetch('/users')
      .then(function (res) { return res.json(); })
      .then(function (data) { renderUsers(data.users || []); })
      .catch(function () { /* adminFetch hat bei 401 schon reagiert */ });
  }

  var passwordDialog = document.getElementById('user-password-dialog');
  var passwordForm = document.getElementById('user-password-form');
  var passwordBanner = document.getElementById('user-password-banner');
  var passwordUsername = '';
  passwordDialog.addEventListener('close', function () { passwordForm.reset(); });
  passwordDialog.addEventListener('cancel', function (event) {
    if (document.getElementById('user-password-save').disabled) event.preventDefault();
  });
  document.getElementById('user-password-cancel').addEventListener('click', function () { passwordDialog.close(); });
  passwordForm.addEventListener('submit', function (event) {
    event.preventDefault();
    var button = document.getElementById('user-password-save');
    if (button.disabled) return;
    button.disabled = true;
    document.getElementById('user-password-cancel').disabled = true;
    document.getElementById('user-password-value').readOnly = true;
    button.textContent = 'Wird gespeichert …';
    adminFetch('/users/' + encodeURIComponent(passwordUsername) + '/password', jsonRequest('PUT', { password: document.getElementById('user-password-value').value }))
      .then(function (response) {
        if (!response.ok) return response.json().then(function (data) { throw new Error(data.error || 'Passwort konnte nicht gespeichert werden.'); });
        passwordDialog.close();
        showBanner(usersBanner, 'Passwort gesetzt. Laufende Sitzungen beendet.', 'ok');
      })
      .catch(function (error) { showBanner(passwordBanner, error.message || 'Server nicht erreichbar.', 'error'); })
      .finally(function () {
        button.disabled = false;
        button.textContent = 'Passwort speichern';
        document.getElementById('user-password-cancel').disabled = false;
        document.getElementById('user-password-value').readOnly = false;
      });
  });

  document.getElementById('create-user-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var button = document.getElementById('create-user');
    if (button.disabled) return;
    var username = document.getElementById('new-username').value.trim();
    var displayName = document.getElementById('new-display-name').value.trim();
    var password = document.getElementById('new-password').value;
    if (!username || !password) {
      showBanner(usersBanner, 'Benutzername und Passwort angeben.', 'error');
      return;
    }
    button.disabled = true;
    userAction('/users', jsonRequest('POST', { username: username, displayName: displayName, password: password }), 'Benutzer angelegt.')
      .then(function (ok) {
        if (!ok) return;
        document.getElementById('new-username').value = '';
        document.getElementById('new-display-name').value = '';
        document.getElementById('new-password').value = '';
      }).finally(function () { button.disabled = false; });
  });

  // ---------- Playbooks pro Dashboard ----------

  var playbookKey = document.getElementById('playbook-key');
  var playbookStatus = document.getElementById('playbook-status');
  var playbookEditor = document.getElementById('playbook-editor');
  var selectedPlaybookKey = '';
  var playbookBaseline = '';
  var playbookPending = false;
  var playbookStarters = document.getElementById('playbook-starters');
  var playbookCommandsBody = document.getElementById('playbook-commands-body');
  var playbooksBanner = document.getElementById('playbooks-banner');
  var knownPlaybooks = [];
  var registeredDashboards = [];

  function commandRowInto(body, cmd) {
    var tr = commandRow(cmd);
    body.appendChild(tr);
    return tr;
  }

  function readCommandsFrom(body) {
    return Array.prototype.map.call(body.querySelectorAll('tr'), function (tr) {
      var out = {};
      Array.prototype.forEach.call(tr.querySelectorAll('[data-field]'), function (field) {
        var value = field.value.trim();
        if (field.dataset.field === 'argHint') {
          if (value) out.argHint = value;
        } else {
          out[field.dataset.field] = value;
        }
      });
      return out;
    });
  }

  function showPlaybook(entry) {
    playbookKey.value = entry ? entry.dashboardKey : playbookKey.value;
    selectedPlaybookKey = playbookKey.value;
    playbookEditor.disabled = playbookPending || !selectedPlaybookKey;
    playbookStarters.value = entry ? entry.playbook.starters.join('\\n') : '';
    playbookCommandsBody.innerHTML = '';
    (entry ? entry.playbook.commands : []).forEach(function (cmd) { commandRowInto(playbookCommandsBody, cmd); });
    playbookBaseline = playbookDraft();
  }

  function playbookDraft() {
    return JSON.stringify({ starters: playbookStarters.value, commands: readCommandsFrom(playbookCommandsBody) });
  }

  function playbookIsDirty() {
    return Boolean(selectedPlaybookKey) && playbookDraft() !== playbookBaseline;
  }

  function setPlaybookPending(pending) {
    playbookPending = pending;
    playbookEditor.disabled = pending || !selectedPlaybookKey;
    playbookKey.disabled = pending;
    document.getElementById('playbook-refresh').disabled = pending;
  }

  window.addEventListener('beforeunload', function (event) {
    if (mcpDirty || playbookIsDirty()) { event.preventDefault(); event.returnValue = ''; }
  });

  function dashboardLabel(key) {
    var registered = registeredDashboards.filter(function (d) { return d.dashboardKey === key; })[0];
    return registered ? registered.name + ' · ' + key.slice(-8) : key + ' (bisherige Zuordnung nach Name)';
  }

  function renderPlaybookList(entries) {
    knownPlaybooks = entries;
    var selected = playbookKey.value;
    playbookKey.innerHTML = '';
    var placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Dashboard auswählen …';
    playbookKey.appendChild(placeholder);
    var keys = Object.create(null);
    entries.forEach(function (e) { keys[e.dashboardKey] = true; });
    registeredDashboards.forEach(function (d) { keys[d.dashboardKey] = true; });
    Object.keys(keys).sort(function (a, b) { return dashboardLabel(a).localeCompare(dashboardLabel(b)); }).forEach(function (key) {
      var opt = document.createElement('option');
      opt.value = key;
      var saved = entries.find(function (entry) { return entry.dashboardKey === key; });
      opt.textContent = dashboardLabel(key) + (saved ? ' (' + saved.playbook.starters.length + ' Fragen, ' + saved.playbook.commands.length + ' Befehle)' : ' (Standard)');
      playbookKey.appendChild(opt);
    });
    playbookKey.value = selected;
    playbookStatus.textContent = registeredDashboards.length
      ? registeredDashboards.length + ' eingebundene Dashboards. Standardanalysen stehen allen Anwendern der jeweiligen Zuordnung zur Verfügung.'
      : 'Noch kein Dashboard registriert. Extension im Bearbeitungsmodus öffnen, anmelden und Workbook speichern; danach hier aktualisieren.';
  }

  function loadPlaybooks() {
    return adminFetch('/playbooks')
      .then(function (res) { if (!res.ok) throw new Error('load'); return res.json(); })
      .then(function (data) {
        registeredDashboards = data.dashboards || [];
        renderPlaybookList(data.playbooks || []);
      })
      .catch(function () { showBanner(playbooksBanner, 'Dashboards konnten nicht geladen werden. Bitte erneut versuchen.', 'error'); });
  }

  function selectPlaybook() {
    var key = playbookKey.value;
    if (playbookIsDirty() && !confirm('Ungespeicherte Dashboard-Analysen verwerfen?')) {
      playbookKey.value = selectedPlaybookKey;
      return;
    }
    var entry = knownPlaybooks.filter(function (e) { return e.dashboardKey === key; })[0];
    showPlaybook(entry || null);
    showBanner(playbooksBanner, !key ? '' : entry ? 'Standardanalysen geladen.' : 'Für dieses Dashboard gelten bisher die globalen Standards. Hier eigene Analysen ergänzen.', 'ok');
  }
  playbookKey.addEventListener('change', selectPlaybook);
  document.getElementById('playbook-refresh').addEventListener('click', loadPlaybooks);

  document.getElementById('playbook-add-command').addEventListener('click', function () {
    commandRowInto(playbookCommandsBody, { name: '', description: '', argHint: '', template: '' });
  });

  document.getElementById('playbook-save').addEventListener('click', function () {
    if (playbookPending) return;
    showBanner(playbooksBanner, '', 'ok');
    var key = playbookKey.value.trim();
    if (!key) {
      showBanner(playbooksBanner, 'Bitte ein eingebundenes Dashboard auswählen.', 'error');
      return;
    }
    var starters = playbookStarters.value.split('\\n').map(function (l) { return l.trim(); }).filter(Boolean);
    var submittedDraft = playbookDraft();
    setPlaybookPending(true);
    adminFetch('/playbooks', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dashboardKey: key, playbook: { starters: starters, commands: readCommandsFrom(playbookCommandsBody) } }),
    })
      .then(function (res) { return res.json().then(function (data) { return { res: res, data: data }; }); })
      .then(function (result) {
        if (!result.res.ok) {
          var details = (result.data.details || [])
            .map(function (d) { return (d.path || []).join('.') + ': ' + d.message; })
            .join('; ');
          showBanner(playbooksBanner, (result.data.error || 'Speichern fehlgeschlagen') + (details ? ' — ' + details : ''), 'error');
          return;
        }
        playbookBaseline = submittedDraft;
        showBanner(playbooksBanner, 'Standardanalysen gespeichert — offene Extensions aktualisieren sie innerhalb einer Minute.', 'ok');
        return loadPlaybooks();
      })
      .catch(function () { showBanner(playbooksBanner, 'Speichern fehlgeschlagen. Bitte erneut versuchen.', 'error'); })
      .finally(function () { setPlaybookPending(false); });
  });

  document.getElementById('playbook-delete').addEventListener('click', function () {
    if (playbookPending) return;
    var key = playbookKey.value.trim();
    if (!key || !confirm('Standardanalysen für „' + dashboardLabel(key) + '“ löschen? Danach gelten wieder die globalen Standards.')) return;
    setPlaybookPending(true);
    adminFetch('/playbooks?dashboardKey=' + encodeURIComponent(key), { method: 'DELETE' })
      .then(function (res) {
        if (!res.ok) {
          showBanner(playbooksBanner, 'Löschen fehlgeschlagen.', 'error');
          return;
        }
        showPlaybook(null);
        showBanner(playbooksBanner, 'Playbook gelöscht.', 'ok');
        return loadPlaybooks();
      })
        .catch(function () { showBanner(playbooksBanner, 'Löschen fehlgeschlagen. Bitte erneut versuchen.', 'error'); })
        .finally(function () { setPlaybookPending(false); });
  });

  // ---------- Modell-Katalog ----------

  var modelsBody = document.getElementById('models-body');
  var modelsSource = document.getElementById('models-source');
  var modelsBanner = document.getElementById('models-banner');
  var lookupResults = document.getElementById('lookup-results');

  function modelRow(model) {
    var tr = document.createElement('tr');
    ['id', 'label'].forEach(function (key) {
      var td = document.createElement('td');
      var field = document.createElement('input');
      field.type = 'text';
      field.placeholder = key === 'id' ? 'z. B. claude-sonnet-5' : 'z. B. Standard (empfohlen)';
      field.value = model[key] || '';
      field.dataset.field = key;
      field.setAttribute('aria-label', key === 'id' ? 'Modell-ID' : 'Anzeigename');
      td.appendChild(field);
      tr.appendChild(td);
    });
    var delTd = document.createElement('td');
    delTd.className = 'col-del';
    var delBtn = document.createElement('button');
    delBtn.type = 'button';
    setActionIcon(delBtn, 'remove', 'Modell entfernen');
    delBtn.addEventListener('click', function () { tr.remove(); });
    delTd.appendChild(delBtn);
    tr.appendChild(delTd);
    return tr;
  }

  function renderModels(models, source) {
    modelsBody.innerHTML = '';
    models.forEach(function (m) { modelsBody.appendChild(modelRow(m)); });
    modelsSource.textContent =
      source === 'custom'
        ? 'Aktuell: eigener Katalog — die Extension zeigt genau diese Modelle.'
        : 'Aktuell: keine eigene Liste — die Extension zeigt die Endpunkt-Liste.';
  }

  function readModelsFromTable() {
    return Array.prototype.map.call(modelsBody.querySelectorAll('tr'), function (tr) {
      var out = {};
      Array.prototype.forEach.call(tr.querySelectorAll('[data-field]'), function (field) {
        out[field.dataset.field] = field.value.trim();
      });
      return out;
    });
  }

  function loadModels() {
    return adminFetch('/models')
      .then(function (res) { return res.json(); })
      .then(function (data) { renderModels(data.models || [], data.source); })
      .catch(function () { /* adminFetch hat bei 401 schon reagiert */ });
  }

  document.getElementById('add-model').addEventListener('click', function () {
    modelsBody.appendChild(modelRow({ id: '', label: '' }));
  });

  document.getElementById('lookup-models').addEventListener('click', function () {
    showBanner(modelsBanner, '', 'ok');
    lookupResults.innerHTML = 'Lade…';
    adminFetch('/upstream-models')
      .then(function (res) {
        return res.json().then(function (data) { return { res: res, data: data }; });
      })
      .then(function (result) {
        lookupResults.innerHTML = '';
        if (!result.res.ok) {
          showBanner(modelsBanner, result.data.error || 'Lookup fehlgeschlagen.', 'error');
          return;
        }
        var ids = result.data.models || [];
        if (ids.length === 0) {
          lookupResults.textContent = 'Der Endpunkt meldet keine Modelle.';
          return;
        }
        var hint = document.createElement('span');
        hint.className = 'hint';
        hint.textContent = 'Klicken zum Übernehmen:';
        lookupResults.appendChild(hint);
        ids.forEach(function (id) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = id;
          btn.addEventListener('click', function () {
            var exists = readModelsFromTable().some(function (m) { return m.id === id; });
            if (!exists) modelsBody.appendChild(modelRow({ id: id, label: id }));
          });
          lookupResults.appendChild(btn);
        });
      })
      .catch(function () {
        lookupResults.innerHTML = '';
        /* adminFetch hat bei 401 schon reagiert */
      });
  });

  document.getElementById('save-models').addEventListener('click', function () {
    showBanner(modelsBanner, '', 'ok');
    adminFetch('/models', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(readModelsFromTable()),
    })
      .then(function (res) {
        return res.json().then(function (data) { return { res: res, data: data }; });
      })
      .then(function (result) {
        if (!result.res.ok) {
          var details = (result.data.details || [])
            .map(function (d) { return (d.path || []).join('.') + ': ' + d.message; })
            .join('; ');
          showBanner(modelsBanner, (result.data.error || 'Speichern fehlgeschlagen') + (details ? ' — ' + details : ''), 'error');
          return;
        }
        showBanner(modelsBanner, 'Gespeichert — die Extension lädt die Liste beim nächsten Start.', 'ok');
        return loadModels();
      })
      .catch(function () { /* adminFetch hat bei 401 schon reagiert */ });
  });

  document.getElementById('reset-models').addEventListener('click', function () {
    if (!confirm('Eigenen Modell-Katalog löschen? Danach gilt wieder die Endpunkt-Liste.')) return;
    adminFetch('/models', { method: 'DELETE' })
      .then(function (res) {
        if (!res.ok) {
          showBanner(modelsBanner, 'Zurücksetzen fehlgeschlagen.', 'error');
          return;
        }
        showBanner(modelsBanner, 'Zurückgesetzt — es gilt die Endpunkt-Liste.', 'ok');
        return loadModels();
      })
      .catch(function () { /* adminFetch hat bei 401 schon reagiert */ });
  });

  // ---------- Extension-Download (.trex) ----------

  var trexUrl = document.getElementById('trex-url');
  var trexBanner = document.getElementById('trex-banner');

  // Vorbelegung: der Origin, unter dem die Admin-UI gerade läuft — in der
  // Regel exakt der Host, der auch die Extension ausliefert.
  trexUrl.value = window.location.origin + '/';

  // Frühwarnung statt 404-Rätselraten in Tableau: liefert DIESER Server die
  // Extension gerade gar nicht aus (Dev ohne SERVE_STATIC_DIR), würde das
  // Manifest ins Leere zeigen — im Dev gehört openvizpilot.dev.trex (Vite)
  // nach Tableau Desktop.
  fetch('/', { method: 'HEAD' })
    .then(function (res) {
      if (res.status === 404) {
        showBanner(
          trexBanner,
          'Achtung: Dieser Server liefert die Extension aktuell NICHT aus (SERVE_STATIC_DIR nicht gesetzt) — ' +
            'ein Manifest mit dieser URL zeigt in Tableau ins Leere (404). In der Entwicklung stattdessen ' +
            'packages/extension/public/openvizpilot.dev.trex verwenden.',
          'error',
        );
      }
    })
    .catch(function () { /* Warnung ist Komfort, kein Muss */ });

  document.getElementById('trex-download').addEventListener('click', function () {
    showBanner(trexBanner, '', 'ok');
    adminFetch('/trex?url=' + encodeURIComponent(trexUrl.value.trim()))
      .then(function (res) {
        if (!res.ok) {
          return res.json().then(function (data) {
            showBanner(trexBanner, data.error || 'Download fehlgeschlagen.', 'error');
          });
        }
        return res.blob().then(function (blob) {
          var href = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = href;
          a.download = 'openvizpilot.trex';
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(href);
          showBanner(trexBanner, 'Manifest heruntergeladen — in Tableau als Erweiterung auswählen.', 'ok');
        });
      })
      .catch(function () { /* adminFetch hat bei 401 schon reagiert */ });
  });

  // ---------- Nutzungsstatistik ----------

  var statsGrid = document.getElementById('stats-grid');
  var statsBanner = document.getElementById('stats-banner');
  var totalTurns = document.getElementById('total-turns');
  var statsDays = document.getElementById('stats-days');

  function loadStats() {
    showBanner(statsBanner, '', 'ok');
    statsGrid.innerHTML = '';
    totalTurns.textContent = '–';
    adminFetch('/stats?days=' + encodeURIComponent(statsDays.value))
      .then(function (res) { return res.json(); })
      .then(function (data) {
        renderStats(data.rows || []);
        renderDashboardStats(data.dashboards || []);
      })
      .catch(function () {
        showBanner(statsBanner, 'Statistik konnte nicht geladen werden.', 'error');
      });
  }

  var dashboardStatsBody = document.getElementById('dashboard-stats-body');

  var knownDashboardKeys = [];

  function renderDashboardStats(dashboards) {
    knownDashboardKeys = dashboards.map(function (d) { return d.dashboardKey; });
    // Dashboard registrations are loaded independently of usage statistics.
    dashboardStatsBody.innerHTML = '';
    if (dashboards.length === 0) {
      var tr = document.createElement('tr');
      var td = document.createElement('td');
      td.colSpan = 5;
      td.className = 'hint';
      td.textContent = 'Noch keine Dashboard-Nutzung im gewählten Zeitraum.';
      tr.appendChild(td);
      dashboardStatsBody.appendChild(tr);
      return;
    }
    dashboards.forEach(function (d) {
      var tr = document.createElement('tr');
      var suppressed = d.users === null;
      [d.dashboardKey, d.questions, suppressed ? '< 3' : d.users, suppressed ? '—' : d.avgPerUser, suppressed ? '—' : d.maxPerUser].forEach(function (value, i) {
        var td = document.createElement('td');
        if (i > 0) td.className = 'num';
        td.textContent = String(value);
        tr.appendChild(td);
      });
      dashboardStatsBody.appendChild(tr);
    });
  }

  function renderStats(rows) {
    var byMetric = {};
    var chatTurns = 0;
    rows.forEach(function (row) {
      byMetric[row.metric] = byMetric[row.metric] || {};
      byMetric[row.metric][row.key] = (byMetric[row.metric][row.key] || 0) + row.count;
      if (row.metric === 'chat_turn') chatTurns += row.count;
    });
    totalTurns.textContent = String(chatTurns);

    var metrics = Object.keys(byMetric).sort();
    if (metrics.length === 0) {
      statsGrid.innerHTML = '<p class="hint">Noch keine Daten im gewählten Zeitraum.</p>';
      return;
    }
    metrics.forEach(function (metric) {
      var block = document.createElement('div');
      block.className = 'stats-block';
      var h3 = document.createElement('h3');
      h3.textContent = metric;
      block.appendChild(h3);

      var table = document.createElement('table');
      var tbody = document.createElement('tbody');
      var entries = Object.keys(byMetric[metric])
        .map(function (key) { return { key: key, count: byMetric[metric][key] }; })
        .sort(function (a, b) { return b.count - a.count; });
      entries.forEach(function (entry) {
        var tr = document.createElement('tr');
        var keyTd = document.createElement('td');
        keyTd.textContent = entry.key;
        var countTd = document.createElement('td');
        countTd.textContent = String(entry.count);
        tr.appendChild(keyTd);
        tr.appendChild(countTd);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      block.appendChild(table);
      statsGrid.appendChild(block);
    });
  }

  statsDays.addEventListener('change', loadStats);

  // ---------- Gate: Token / Ersteinrichtung / Login ----------

  function enterApp(token) {
    setToken(token);
    ['setup-password', 'setup-confirm', 'login-password', 'token-input'].forEach(function (id) { document.getElementById(id).value = ''; });
    showBanner(gateError, '', 'error');
    showApp();
    loadAuth();
    loadUsers();
    loadCommands();
    loadPlaybooks();
    loadModels();
    loadStats();
  }

  document.getElementById('token-submit').addEventListener('click', function () {
    var value = document.getElementById('token-input').value.trim();
    if (!value) return;
    enterApp(value);
  });
  document.getElementById('token-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') document.getElementById('token-submit').click();
  });

  /** POST an /setup bzw. /login; bei Erfolg kommt {token} zurück. */
  function authPost(path, password) {
    return fetch('/api/admin' + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: password }),
    }).then(function (res) {
      return res.json().then(function (data) { return { res: res, data: data }; });
    });
  }

  document.getElementById('gate-setup').addEventListener('submit', function (event) {
    event.preventDefault();
    var button = document.getElementById('setup-submit');
    if (button.disabled) return;
    var password = document.getElementById('setup-password').value;
    var confirm = document.getElementById('setup-confirm').value;
    if (!password) return;
    if (password !== confirm) {
      showBanner(gateError, 'Die Passwörter stimmen nicht überein.', 'error');
      return;
    }
    button.disabled = true;
    button.textContent = 'Konto wird angelegt …';
    authPost('/setup', password)
      .then(function (result) {
        if (!result.res.ok) {
          var message = result.data.error || 'Einrichtung fehlgeschlagen.';
          // Modus neu abfragen: nach 409 (parallel eingerichtet) oder einem
          // Teilausfall (Konto angelegt, Session fehlgeschlagen) gehört hier
          // das Login-Formular hin — initGate lässt den Banner stehen.
          initGate();
          showBanner(gateError, message, 'error');
          return;
        }
        enterApp(result.data.token);
      })
      .catch(function () { showBanner(gateError, 'Server nicht erreichbar.', 'error'); })
      .finally(function () { button.disabled = false; button.textContent = 'Administratorkonto anlegen'; });
  });

  document.getElementById('gate-login').addEventListener('submit', function (event) {
    event.preventDefault();
    var button = document.getElementById('login-submit');
    if (button.disabled) return;
    var password = document.getElementById('login-password').value;
    if (!password) return;
    button.disabled = true;
    button.textContent = 'Anmeldung läuft …';
    authPost('/login', password)
      .then(function (result) {
        if (!result.res.ok) {
          showBanner(gateError, result.data.error || 'Anmeldung fehlgeschlagen.', 'error');
          return;
        }
        enterApp(result.data.token);
      })
      .catch(function () { showBanner(gateError, 'Server nicht erreichbar.', 'error'); })
      .finally(function () { button.disabled = false; button.textContent = 'Anmelden'; });
  });

  document.getElementById('logout').addEventListener('click', function () {
    adminFetch('/logout', { method: 'POST' }).catch(function () { /* Session ist ohnehin weg */ });
    clearToken();
    showGate();
  });

  if (getToken()) {
    showApp();
    loadAuth();
    loadUsers();
    loadCommands();
    loadPlaybooks();
    loadModels();
    loadStats();
  } else {
    showGate();
  }
})();
</script>
</body>
</html>
`;
