/**
 * Selbstenthaltene Admin-UI unter GET /admin (nur wenn OVP_ADMIN_TOKEN gesetzt
 * ist, siehe app.ts) — verwaltet die zentralen Slash-Befehle und zeigt die
 * anonyme Nutzungsstatistik. Bewusst als ein Template-String ohne
 * Build-Schritt (kein Vite/Extension-Bundle nötig) mit Vanilla-JS.
 *
 * Der Admin-Token wird NUR im sessionStorage des Browsers gehalten und bei
 * jedem Request als "Authorization: Bearer <token>" an /api/admin/* gesendet
 * — nie in der URL (siehe Datenschutz-Regel: keine Secrets in URLs/Logs).
 */
import { mcpAdminScript, mcpAdminSection, mcpAdminStyles, tableauAdminScript, tableauAdminSection, tableauAdminStyles, watchAdminScript, watchAdminSection, watchAdminStyles } from '@openvizpilot/ee/server';
import { ChartNoAxesCombined, Download, Eye, KeyRound, LayoutDashboard, LockKeyhole, LockKeyholeOpen, LogOut, Network, RefreshCw, Ruler, Save, Settings, ShieldCheck, Terminal, Trash2, Users, type IconNode } from 'lucide';
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
  .inline-field { display: flex; gap: 0.4rem; }
  .inline-field input { flex: 1; min-width: 0; }
  .setup-steps { border: 1px solid var(--border); border-radius: 6px; padding: 0.6rem 0.75rem; margin: 0 0 1rem; font-size: 13px; }
  .setup-steps summary { cursor: pointer; font-weight: 600; }
  .setup-steps ol, .setup-steps ul { margin: 0.5rem 0 0; padding-left: 1.25rem; }
  .setup-steps li { margin: 0.3rem 0; }
  .setup-steps table { border-collapse: collapse; margin-top: 0.5rem; font-size: 12px; }
  .license-card { width: auto; margin: 0.5rem 0 0.75rem; font-size: 13px; }
  .license-card th { background: none; white-space: nowrap; padding-left: 0; }
  .license-card td { overflow-wrap: anywhere; }
  .license-card .lease-blocked { color: var(--danger); font-weight: 600; }
  .setup-steps th, .setup-steps td { text-align: left; padding: 0.3rem 0.6rem 0.3rem 0; vertical-align: top; }
  .setup-steps code { font-size: 11px; }
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
  /* Der Seitentitel wird beim Bereichswechsel nur für Screenreader fokussiert — kein Rahmen. */
  #view-title:focus { outline: none; }
  /* Kontrollkästchen, Schalter und Auswahllisten im Stil der Oberfläche statt der Browser-Standards. */
  input[type="checkbox"] { appearance: none; -webkit-appearance: none; flex-shrink: 0; width: 18px; height: 18px; margin: 0; border: 1px solid var(--border); border-radius: 4px; background: var(--surface); cursor: pointer; vertical-align: middle; position: relative; transition: background 0.15s, border-color 0.15s; }
  input[type="checkbox"]:hover { border-color: var(--accent); }
  input[type="checkbox"]:checked { background: var(--accent); border-color: var(--accent); }
  input[type="checkbox"]:checked::after { content: ''; position: absolute; inset: 0; background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23fff' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 6 9 17l-5-5'/%3E%3C/svg%3E") center / 12px no-repeat; }
  input[type="checkbox"][role="switch"] { width: 36px; height: 20px; border-radius: 999px; background: var(--border); }
  input[type="checkbox"][role="switch"]::before { content: ''; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: var(--surface); box-shadow: 0 1px 2px rgb(13 15 22 / 25%); transition: transform 0.15s; }
  input[type="checkbox"][role="switch"]:checked::before { transform: translateX(16px); }
  input[type="checkbox"][role="switch"]:checked::after { content: none; }
  input[type="checkbox"]:disabled { opacity: 0.5; cursor: not-allowed; }
  select { appearance: none; -webkit-appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 0.6rem center; background-size: 14px; }
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
  #user-access-table { min-width: 860px; }
  #user-access-table .col-access { width: 110px; text-align: center; }
  #user-access-table .col-save { width: 90px; white-space: nowrap; }
  .user-access-table-wrapper { max-width: 100%; overflow-x: auto; }
  .user-access-identity { min-width: 180px; }
  .user-access-identity small { display: block; color: var(--text-muted); overflow-wrap: anywhere; }
  .user-access-checkbox { display: flex; justify-content: center; min-width: 44px; }
  .user-access-checkbox input { width: 18px; height: 18px; }
  .icon-button { display: inline-flex; align-items: center; justify-content: center; width: 38px; height: 38px; padding: 0; flex-shrink: 0; }
  #users-table .icon-button + .icon-button { margin-left: 4px; }
  dialog { width: min(440px, calc(100% - 2rem)); max-height: calc(100dvh - 2rem); overflow: auto; padding: 1.5rem; border: 1px solid var(--border); border-radius: 8px; color: var(--text); background: var(--surface); }
  dialog::backdrop { background: rgb(13 15 22 / 45%); }
  dialog input { min-height: 44px; }
  #metric-dialog { width: min(640px, calc(100% - 2rem)); }
  #metric-dialog input[aria-invalid="true"], #metric-dialog textarea[aria-invalid="true"] { border-color: var(--danger); }
  .metric-question-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr)); gap: 0.5rem 0.75rem; align-items: end; border: 1px solid var(--border); border-radius: 6px; padding: 0.65rem; margin: 0 0 0.6rem; }
  .metric-question-row label { display: grid; gap: 0.3rem; font-size: 13px; font-weight: 500; min-width: 0; }
  .has-help { position: relative; }
  /* Nur der Begriff ist der Auslöser — nicht das Eingabefeld darunter, sonst
     ploppt beim Überfahren eines Formulars an jedem Feld ein Tooltip auf. */
  .help-term { cursor: help; text-decoration: underline dotted; text-decoration-color: var(--text-muted); text-underline-offset: 2px; }
  .help-tip { display: none; position: absolute; z-index: 30; top: 100%; left: 0; margin-top: 2px; width: max-content; max-width: 320px; background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: 6px; box-shadow: 0 4px 14px rgb(13 15 22 / 15%); padding: 0.55rem 0.7rem; font-size: 12px; font-weight: 400; line-height: 1.5; white-space: normal; text-decoration: none; }
  .has-help:has(> .help-term:hover) > .help-tip, .has-help:focus-within > .help-tip, .has-help:has(+ :focus) > .help-tip, .has-help[aria-expanded="true"] > .help-tip { display: block; }
  .help-left .help-tip { left: auto; right: 0; }
  /* Über Formularfeldern erscheint der Tooltip oberhalb des Begriffs; in Tabellen
     bleibt er darunter, weil die Tabellenhülle (overflow) nach oben abschneidet. */
  label.has-help > .help-tip, legend.has-help > .help-tip { top: auto; bottom: 100%; margin-top: 0; margin-bottom: 2px; }
  .help-below > .help-tip { top: 100% !important; bottom: auto !important; margin-top: 2px !important; margin-bottom: 0 !important; }
  .help-tip code { font-size: 11px; }
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
  ${tableauAdminStyles}
  ${watchAdminStyles}
  [hidden] { display: none !important; }
  .ui-icon { flex: 0 0 18px; vertical-align: middle; }
  .masthead { height: 72px; padding: 0 2rem; background: var(--graphite); color: #e7e9f2; display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
  .brand { display: flex; align-items: center; gap: 0.75rem; font-size: 18px; font-weight: 700; }
  .brand img { width: 34px; height: 34px; }
  .brand-origin { font-size: 12px; font-weight: 400; color: #a1a8c0; border-left: 1px solid #343847; padding-left: 1rem; }
  .masthead-label { font-size: 12px; color: #a1a8c0; }
  #admin-identity::before { content: '·'; margin: 0 0.4rem; }
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
  #gate .gate-divider { margin: 1.75rem 0 1rem; padding-top: 1rem; border-top: 1px solid var(--border); color: var(--text-muted); font-size: 12px; text-align: center; }
  #gate #gate-sso .primary { margin-top: 1rem; }
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
  <span class="masthead-label">Administration<span id="admin-identity" hidden></span></span>
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

    <div id="gate-user" hidden>
      <p class="gate-divider">Mit Benutzerkonto anmelden</p>
      <form id="gate-user-login" hidden>
        <p class="subtitle">Nur für Konten mit Admin-Rolle (siehe „Benutzerzugriff“).</p>
        <label for="user-login-name">Benutzername</label>
        <input type="text" id="user-login-name" autocomplete="username" required maxlength="100" />
        <label for="user-login-password">Passwort</label>
        <input type="password" id="user-login-password" autocomplete="current-password" required maxlength="200" />
        <button class="primary" id="user-login-submit" type="submit">Mit Benutzerkonto anmelden</button>
      </form>
      <div id="gate-sso" hidden>
        <p class="subtitle">Nur für Konten mit Admin-Rolle (siehe „Benutzerzugriff“).</p>
        <button class="primary" id="sso-submit" type="button">Mit Single Sign-On anmelden</button>
      </div>
    </div>

    <p id="gate-error" class="banner error" role="alert"></p>
    <div class="row"><button id="gate-retry" hidden>Erneut versuchen</button></div>
  </div>

  <div id="app">
    <div class="admin-shell">
    <aside class="sidebar">
      <nav aria-label="Administration">
        <p class="nav-group">Arbeitsbereich</p>
        <a href="#mcp-admin" aria-current="page">${adminIcon(Network)}MCP &amp; Sites <span class="nav-ee">EE</span></a>
        <a href="#tableau-server-admin">${adminIcon(Network)}Tableau Server <span class="nav-ee">EE</span></a>
        <a href="#commands-admin">${adminIcon(Terminal)}Slash-Befehle</a>
        <a href="#playbooks-admin">${adminIcon(LayoutDashboard)}Dashboard-Analysen</a>
        <a href="#metrics-admin">${adminIcon(Ruler)}Kennzahlen</a>
        <a href="#models-admin">${adminIcon(Settings)}Modelle</a>
        <p class="nav-group">Zugriff</p>
        <a href="#auth-admin">${adminIcon(ShieldCheck)}Anmeldung &amp; Lizenz</a>
        <a href="#users-admin">${adminIcon(Users)}Benutzerkonten</a>
        <p class="nav-group">Betrieb</p>
        <a href="#extension-admin">${adminIcon(Download)}Tableau-Extension</a>
        <a href="#usage-admin">${adminIcon(ChartNoAxesCombined)}Nutzung</a>
        <a href="#watch-admin">${adminIcon(Eye)}Watch <span class="nav-ee">EE</span></a>
      </nav>
      <select id="admin-navigation" class="mobile-navigation" aria-label="Administrationsbereich">
        <optgroup label="Arbeitsbereich"><option value="mcp-admin">MCP &amp; Sites</option><option value="tableau-server-admin">Tableau Server</option><option value="commands-admin">Slash-Befehle</option><option value="playbooks-admin">Dashboard-Analysen</option><option value="metrics-admin">Kennzahlen</option><option value="models-admin">Modelle</option></optgroup>
        <optgroup label="Zugriff"><option value="auth-admin">Anmeldung &amp; Lizenz</option><option value="users-admin">Benutzerkonten</option></optgroup>
        <optgroup label="Betrieb"><option value="extension-admin">Tableau-Extension</option><option value="usage-admin">Nutzung</option><option value="watch-admin">Watch</option></optgroup>
      </select>
      <button id="logout" title="Abmelden" aria-label="Abmelden">${adminIcon(LogOut)}<span>Abmelden</span></button>
    </aside>
    <div class="workspace">
      <header class="workspace-heading"><p id="view-group">Arbeitsbereich</p><h1 id="view-title" tabindex="-1">MCP &amp; Sites</h1></header>

    ${mcpAdminSection}
    ${tableauAdminSection}
    ${watchAdminSection}

    <section class="card" id="commands-admin" hidden>
      <h2>Slash-Befehle</h2>
      <p class="hint">Eigene „/name“-Befehle, die Anwender im Chat eintippen, um ein festes Prompt-Template zu starten (z. B. <code>/vergleich Umsatz DACH</code>).</p>
      <p id="commands-source" class="hint"></p>
      <p id="commands-banner" class="banner"></p>
      <div style="overflow-x: auto;">
        <table id="commands-table">
          <thead>
            <tr>
              <th class="col-name has-help" aria-expanded="false"><span class="help-term">Name</span><span role="tooltip" id="help-cmd-name" class="help-tip">Gilt dashboardübergreifend; für einzelne Dashboards siehe „Dashboard-Analysen“.</span></th>
              <th class="col-desc">Beschreibung</th>
              <th class="col-hint has-help" aria-expanded="false"><span class="help-term">Arg-Hinweis</span><span role="tooltip" id="help-cmd-arghint" class="help-tip">Erscheint als Platzhaltertext hinter dem Befehlsnamen, z. B. <code>Region, Zeitraum</code>.</span></th>
              <th class="has-help" aria-expanded="false"><span class="help-term">Template</span><span role="tooltip" id="help-cmd-template" class="help-tip"><code>{{args}}</code> im Template wird durch den vom Anwender eingegebenen Text ersetzt.</span></th>
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
      <p class="hint">Wer die Extension nutzen darf — Benutzerkonten (Core) oder Single Sign-On (Enterprise).</p>
      <p id="auth-source" class="hint"></p>
      <p id="auth-banner" class="banner"></p>
      <div class="form-grid">
        <label class="has-help"><span class="help-term">Anmeldemodus</span><span role="tooltip" id="help-auth-mode" class="help-tip">Offen: keine Anwenderidentität — Chat und Tableau API bleiben für alle gesperrt, auch mit Häkchen unter Benutzerzugriff. Benutzerkonten: Anmeldung mit Konten aus „Benutzerkonten“. Single Sign-On: Firmenkonto (Entra ID/Keycloak), braucht eine gültige Lizenz.</span>
          <select id="auth-mode" aria-describedby="help-auth-mode">
            <option value="none">Offen (kein Login — Chat &amp; Tableau API bleiben gesperrt)</option>
            <option value="local">Benutzerkonten (Core-Edition)</option>
            <option value="oidc">Single Sign-On per OIDC (Enterprise)</option>
          </select>
        </label>
        <label style="flex: 1 1 320px;">Öffentliche URL der Middleware (für die SSO-Redirect-URI)
          <input type="text" id="auth-public-url" placeholder="https://chat.example.com" autocomplete="off" />
        </label>
      </div>
      <div id="oidc-fields">
        <p class="hint">Reihenfolge: öffentliche URL eintragen · Redirect-URI beim Provider registrieren · Issuer und Client-ID übernehmen · speichern · nach dem ersten Login unter „Benutzerzugriff" freischalten.</p>
        <div class="form-grid">
          <label class="has-help" style="grid-column: 1 / -1;"><span class="help-term">Redirect-URI (Callback-URL)</span><span role="tooltip" id="help-oidc-redirect" class="help-tip">Genau diese Adresse beim Identity-Provider als Redirect-URI eintragen — Entra ID: Plattform „Web"; Keycloak: „Valid redirect URIs". Sie ergibt sich aus der öffentlichen URL oben und muss HTTPS sein.</span>
            <span class="inline-field">
              <input type="text" id="oidc-redirect" readonly placeholder="Öffentliche URL oben eintragen" aria-describedby="help-oidc-redirect" />
              <button type="button" id="oidc-redirect-copy">Kopieren</button>
            </span>
          </label>
        </div>
        <div class="form-grid">
          <label class="has-help"><span class="help-term">Identity-Provider</span><span role="tooltip" id="help-oidc-provider" class="help-tip">Legt Issuer-Format und Claim-Zuordnung fest. „Anderer" funktioniert mit jedem Provider, der ein Discovery-Dokument unter <code>&lt;Issuer&gt;/.well-known/openid-configuration</code> liefert.</span>
            <select id="oidc-provider" aria-describedby="help-oidc-provider">
              <option value="entra">Microsoft Entra ID</option>
              <option value="keycloak">Keycloak</option>
              <option value="generic">Anderer OIDC-Provider</option>
            </select>
          </label>
          <label style="flex: 1 1 320px;" class="has-help help-left"><span class="help-term">Issuer-URL</span><span role="tooltip" id="help-oidc-issuer" class="help-tip">Entra ID: <code>https://login.microsoftonline.com/&lt;Tenant-ID&gt;/v2.0</code> · Keycloak: <code>https://&lt;host&gt;/realms/&lt;realm&gt;</code> · sonst der „issuer"-Wert aus dem Discovery-Dokument — ohne Pfad-Suffix wie <code>/.well-known/…</code>.</span>
            <input type="text" id="oidc-issuer" placeholder="https://login.microsoftonline.com/&lt;tenant-id&gt;/v2.0" autocomplete="off" aria-describedby="help-oidc-issuer" />
          </label>
        </div>
        <div class="form-grid">
          <label style="flex: 1 1 240px;" class="has-help"><span class="help-term">Client-ID</span><span role="tooltip" id="help-oidc-client-id" class="help-tip">Entra ID: „Anwendungs-ID (Client)" der App-Registrierung · Keycloak: „Client ID" des Clients.</span>
            <input type="text" id="oidc-client-id" autocomplete="off" aria-describedby="help-oidc-client-id" />
          </label>
          <label style="flex: 1 1 240px;" class="has-help"><span class="help-term">Client-Secret (nur confidential clients)</span><span role="tooltip" id="help-oidc-client-secret" class="help-tip">Leer lassen für einen public client mit PKCE (empfohlen — die Extension läuft im Browser). Nur ausfüllen, wenn der Client beim Provider als „confidential" angelegt ist (Keycloak: „Client authentication: On"). Wird in der Datenbank gespeichert; für Vault-Deployments stattdessen <code>OVP_OIDC_CLIENT_SECRET</code> setzen.</span>
            <input type="password" id="oidc-client-secret" autocomplete="new-password" placeholder="unverändert lassen" aria-describedby="help-oidc-client-secret" />
          </label>
          <label style="flex: 1 1 200px;" class="has-help help-left"><span class="help-term">Scopes</span><span role="tooltip" id="help-oidc-scopes" class="help-tip"><code>openid profile email</code> reicht: „email" liefert die Adresse für Tableau Cloud bzw. den Username-Claim, „profile" den Anzeigenamen unter „Benutzerzugriff".</span>
            <input type="text" id="oidc-scopes" value="openid profile email" autocomplete="off" aria-describedby="help-oidc-scopes" />
          </label>
        </div>
        <details class="setup-steps" id="oidc-setup">
          <summary>Einrichtung Schritt für Schritt</summary>
          <ol id="oidc-setup-entra">
            <li>Entra Admin Center → <em>App-Registrierungen</em> → „Neue Registrierung": Name vergeben, Kontotyp „Nur Konten in diesem Organisationsverzeichnis".</li>
            <li>Unter <em>Authentifizierung</em> → „Plattform hinzufügen" → <strong>Web</strong> → die Redirect-URI von oben eintragen. Kein Client-Secret anlegen (public client mit PKCE); unter „Erweiterte Einstellungen" „Öffentliche Clientflows zulassen" auf <em>Nein</em> lassen.</li>
            <li>Auf der Übersichtsseite „Anwendungs-ID (Client)" → hier als <strong>Client-ID</strong>; „Verzeichnis-ID (Mandant)" → in die <strong>Issuer-URL</strong> <code>https://login.microsoftonline.com/&lt;Tenant-ID&gt;/v2.0</code> einsetzen.</li>
            <li><em>API-Berechtigungen</em>: Microsoft Graph → <code>openid</code>, <code>profile</code>, <code>email</code> (delegiert), Admin-Einwilligung erteilen.</li>
            <li>Gültigen Lizenzschlüssel unten eintragen, „Prüfen &amp; speichern". Dann in der Extension einmal per SSO anmelden — die Identität erscheint unter „Benutzerzugriff" und wird dort für Chat/Tableau freigeschaltet.</li>
          </ol>
          <ol id="oidc-setup-keycloak" hidden>
            <li>Keycloak Admin Console → Realm wählen → <em>Clients</em> → „Create client": Typ OpenID Connect, Client-ID frei wählen (→ hier als <strong>Client-ID</strong>).</li>
            <li>„Capability config": <em>Client authentication</em> <strong>Off</strong> (public client mit PKCE), „Standard flow" an. Bei „On" (confidential) das Secret aus dem Tab <em>Credentials</em> unten als Client-Secret eintragen.</li>
            <li>„Login settings": <em>Valid redirect URIs</em> = Redirect-URI von oben, <em>Web origins</em> = öffentliche URL der Middleware.</li>
            <li><strong>Issuer-URL</strong>: <code>https://&lt;keycloak-host&gt;/realms/&lt;realm&gt;</code>. Die Nutzer brauchen im Realm eine E-Mail-Adresse (Claim „email").</li>
            <li>Gültigen Lizenzschlüssel unten eintragen, „Prüfen &amp; speichern". Dann in der Extension einmal per SSO anmelden und die Identität unter „Benutzerzugriff" freischalten.</li>
          </ol>
          <ol id="oidc-setup-generic" hidden>
            <li>Beim Provider einen OIDC-Client mit <em>Authorization Code Flow + PKCE</em> anlegen; Redirect-URI von oben registrieren.</li>
            <li><strong>Issuer-URL</strong> = „issuer" aus <code>&lt;Issuer&gt;/.well-known/openid-configuration</code>; <strong>Client-ID</strong> aus dem Client. Secret nur bei confidential clients.</li>
            <li>Das ID-Token muss die Claims <code>sub</code>, <code>email</code> und <code>name</code> enthalten (Scopes <code>openid profile email</code>).</li>
            <li>Lizenzschlüssel eintragen, „Prüfen &amp; speichern", einmal per SSO anmelden, Identität unter „Benutzerzugriff" freischalten.</li>
          </ol>
        </details>
        <details class="setup-steps">
          <summary>Env-Variablen oder Admin-UI — wann was?</summary>
          <p>Alles hier Gespeicherte landet in der Datenbank und hat Vorrang vor den Env-Variablen (oben steht „Quelle: Admin-UI" bzw. „Env-Defaults"). Env eignet sich für Deployments, deren Konfiguration aus Helm/Vault kommt; das Admin-UI für die Einrichtung von Hand. „Auf Env-Defaults zurücksetzen" löscht die Datenbank-Werte.</p>
          <table>
            <tr><th>Einstellung</th><th>Env-Variable</th><th>Admin-UI</th></tr>
            <tr><td>Anmeldemodus</td><td><code>OVP_AUTH_MODE</code></td><td>Feld „Anmeldemodus"</td></tr>
            <tr><td>Öffentliche URL</td><td><code>OVP_PUBLIC_URL</code></td><td>Feld „Öffentliche URL"</td></tr>
            <tr><td>Provider, Issuer, Client-ID, Scopes</td><td><code>OVP_OIDC_PROVIDER</code>, <code>OVP_OIDC_ISSUER</code>, <code>OVP_OIDC_CLIENT_ID</code>, <code>OVP_OIDC_SCOPES</code></td><td>Felder oben</td></tr>
            <tr><td>Client-Secret</td><td><code>OVP_OIDC_CLIENT_SECRET</code> (empfohlen bei Vault)</td><td>Feld „Client-Secret" (Datenbank)</td></tr>
            <tr><td>Lizenz</td><td><code>OVP_LICENSE</code> oder <code>OVP_LICENSE_PATH</code></td><td>Feld „Lizenzschlüssel"</td></tr>
            <tr><td>Umgebung</td><td><code>OVP_ENVIRONMENT</code> (nur per Env)</td><td>—</td></tr>
            <tr><td>Shared-Token-Modus</td><td><code>OVP_API_AUTH_TOKEN</code> (nur per Env)</td><td>—</td></tr>
          </table>
        </details>
      </div>
      <fieldset class="form-section"><legend>Enterprise-Lizenz</legend>
      <label class="form-field has-help"><span class="help-term">Lizenzschlüssel</span><span role="tooltip" id="help-license-token" class="help-tip">Vom Lizenz-Aussteller erhaltener Token im Format „<code>&lt;Payload&gt;.&lt;Signatur&gt;</code>“ (zwei durch Punkt getrennte Zeichenblöcke) — vollständig einfügen.</span>
        <textarea id="license-token" rows="3" placeholder="Signierter Lizenz-Token (leer lassen = unverändert)" spellcheck="false" aria-describedby="help-license-token"></textarea>
      </label>
      <p id="license-summary" class="hint">Lade …</p>
      <div id="license-card" hidden>
        <p id="license-pending" class="banner" role="alert"><strong>Installation noch nicht aktiviert — es laufen nur die Core-Funktionen.</strong> Enterprise-Funktionen schalten sich mit der ersten Aktivierung frei. Online: ausgehend HTTPS auf <code>werkworks.de</code> (Port 443) zulassen und „Jetzt aktualisieren“ klicken — der Heartbeat läuft auch sofort beim Start. Offline: unter „Offline-Aktivierung“ die Anfrage herunterladen, an WerkWorks senden und die Lease einfügen.</p>
        <p id="license-subscription-grace" class="banner error" role="status" hidden></p>
        <table class="license-card">
          <tr><th scope="row">Lizenznehmer</th><td id="lic-licensee"></td></tr>
          <tr><th scope="row">Lizenz-ID</th><td id="lic-id"></td></tr>
          <tr><th scope="row" class="has-help" aria-expanded="false"><span class="help-term">Umgebung</span><span role="tooltip" id="help-lic-env" class="help-tip">Aus <code>OVP_ENVIRONMENT</code> (production | development | test | staging, Helm <code>app.environment</code>). Eine Lizenz erlaubt eine produktive Installation; Entwicklung, Test und Staging sind inklusive.</span></th><td id="lic-env"></td></tr>
          <tr><th scope="row" class="has-help" aria-expanded="false"><span class="help-term">Installation-ID</span><span role="tooltip" id="help-lic-inst" class="help-tip">Zufällige, dauerhafte Kennung dieser Installation aus der Datenbank — an sie ist die Lease gebunden. Ein neuer Datenbank-Cluster ist eine neue Installation.</span></th><td><span class="has-help" aria-expanded="false" id="lic-inst"><span class="help-term">…</span><span role="tooltip" id="lic-inst-full" class="help-tip">…</span></span></td></tr>
          <tr><th scope="row" class="has-help" aria-expanded="false"><span class="help-term">Aktivierung</span><span role="tooltip" id="help-lic-lease" class="help-tip">Der tägliche Heartbeat holt bei WerkWorks eine 7-Tage-Lease für diese Installation. Ohne jede Lease laufen nur Core-Funktionen. Ist werkworks.de nach einer Aktivierung nicht erreichbar, bleibt Enterprise 30 Tage nach Lease-Ablauf aktiv (Grace). Blockiert: mehr produktive Installationen als lizenziert — eine stilllegen oder die Lizenz erweitern.</span></th><td id="lic-lease"></td></tr>
          <tr><th scope="row">Lizenz gültig bis</th><td id="lic-valid"></td></tr>
          <tr><th scope="row">Features</th><td id="lic-features"></td></tr>
        </table>
        <div class="row" style="gap: 0.5rem; flex-wrap: wrap;">
          <button id="license-refresh">Jetzt aktualisieren</button>
        </div>
        <div id="license-installations-box" class="hint" style="border-top: 1px solid var(--border); margin-top: 0.75rem; padding-top: 0.75rem;" hidden>
          <strong>Installationen dieser Lizenz</strong>
          <p id="license-installations-hint" class="banner error" role="alert" hidden></p>
          <div style="overflow-x: auto;">
            <table id="license-installations-table">
              <thead>
                <tr><th>ID</th><th>Umgebung</th><th>Öffentliche URL</th><th>Zuletzt gesehen</th><th>Version</th><th>Offline</th><th class="col-del"></th></tr>
              </thead>
              <tbody id="license-installations-body"></tbody>
            </table>
          </div>
          <div class="row" style="gap: 0.5rem; flex-wrap: wrap; margin-top: 0.5rem;">
            <button id="license-deactivate">Diese Installation stilllegen</button>
          </div>
        </div>
        <details class="setup-steps" id="offline-activation" style="margin-top: 0.75rem;">
          <summary>Offline-Aktivierung</summary>
          <p>Für Installationen ohne Zugang zu werkworks.de: Anfrage herunterladen, an WerkWorks senden, die zurückerhaltene Lease hier einfügen. Sie gilt bis zu 365 Tage; der Heartbeat läuft weiter und ersetzt sie nur durch eine längere.</p>
          <div class="row" style="gap: 0.5rem; flex-wrap: wrap; align-items: flex-end;">
            <button id="activation-request-download">Aktivierungsanfrage herunterladen</button>
            <label class="form-field has-help" style="flex: 1 1 320px;"><span class="help-term">Lease einfügen</span><span role="tooltip" id="help-lic-lease-paste" class="help-tip">Datei <code>&lt;Lizenznehmer&gt;.openvizpilot-lease</code> von WerkWorks — Inhalt vollständig einfügen. Sie muss zu Installation-ID und Lizenz-ID passen.</span>
              <textarea id="license-lease" rows="2" placeholder="Signierte Lease (<Payload>.<Signatur>)" spellcheck="false" aria-describedby="help-lic-lease-paste"></textarea>
            </label>
            <button class="primary" id="license-lease-save">Lease speichern</button>
          </div>
          <p>Ohne Internetzugang: Anfrage-Datei direkt unter <a href="https://werkworks.de/ovp-lizenz/offline.php" target="_blank" rel="noopener">werkworks.de/ovp-lizenz/offline.php</a> einreichen (Lizenz-Token bereithalten) — die Lease kommt sofort zurück, ohne WerkWorks-Rückfrage.</p>
        </details>
      </div>
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
      <p class="hint">Konten für die Anmeldung in der Extension im Modus „Benutzerkonten“.</p>
      <p id="users-banner" class="banner"></p>
      <div style="overflow-x: auto;">
        <table id="users-table">
          <thead>
            <tr>
              <th>Benutzername</th>
              <th>Anzeigename</th>
              <th class="has-help" aria-expanded="false"><span class="help-term">Status</span><span role="tooltip" id="help-users-status" class="help-tip">Sperren beendet laufende Sitzungen sofort.</span></th>
              <th class="col-del"></th>
            </tr>
          </thead>
          <tbody id="users-body"></tbody>
        </table>
      </div>
      <form id="create-user-form">
      <fieldset class="form-section"><legend class="has-help" aria-expanded="false"><span class="help-term">Benutzer anlegen</span><span role="tooltip" id="help-users-create" class="help-tip">Kann sich sofort anmelden, erhält aber erst nach Freigabe unter „Benutzerzugriff“ Zugriff auf Chat oder Tableau API.</span></legend>
      <div class="form-grid">
        <label for="new-username">Benutzername<input type="text" id="new-username" autocomplete="off" autocapitalize="none" spellcheck="false" required /></label>
        <label for="new-display-name">Anzeigename (optional)<input type="text" id="new-display-name" autocomplete="off" /></label>
        <label for="new-password" class="has-help"><span class="help-term">Passwort (mindestens 10 Zeichen)</span><span role="tooltip" id="help-users-password" class="help-tip">Wird nur als Hash gespeichert.</span><input type="password" id="new-password" autocomplete="new-password" minlength="10" required aria-describedby="help-users-password" /></label>
      </div>
      <div class="form-actions">
        <button class="primary" id="create-user" type="submit">Benutzer anlegen</button>
      </div>
      </fieldset>
      </form>

      <fieldset class="form-section" id="user-access-section">
        <legend class="has-help" aria-expanded="false"><span class="help-term">Benutzerzugriff</span><span role="tooltip" id="help-access-legend" class="help-tip">Lokale Konten erscheinen automatisch; eine SSO-Identität erst, nachdem sich die Person einmal per Single Sign-On angemeldet hat — danach hier aktualisieren.</span></legend>
        <p id="user-access-banner" class="banner" role="status"></p>
        <div class="form-actions">
          <button type="button" id="user-access-refresh">Zugriffe aktualisieren</button>
        </div>
        <div class="user-access-table-wrapper">
          <table id="user-access-table">
            <thead><tr><th>Identität</th><th>E-Mail</th><th>Status</th><th class="col-access has-help" aria-expanded="false"><span class="help-term">AI-Chat</span><span role="tooltip" id="help-access-ai" class="help-tip">Schaltet die Chat-Nutzung frei.</span></th><th class="col-access has-help help-left" aria-expanded="false"><span class="help-term">Tableau API</span><span role="tooltip" id="help-access-tableau" class="help-tip">Schaltet den Zugriff auf Tableau-Server-Inhalte aus dem Chat frei; ohne Häkchen weist die Extension die Anfrage ab, auch nach erfolgreicher Anmeldung.</span></th><th class="col-access has-help help-left" aria-expanded="false"><span class="help-term">Serverdaten</span><span role="tooltip" id="help-access-serverdata" class="help-tip">Erlaubt der Middleware, im Namen dieser Person Summary-Daten von Tableau-Views zu lesen — nur mit Site-Schalter und Einwilligung der Person; jede Abfrage steht im Audit unter Tableau Server.</span></th><th class="col-access has-help help-left" aria-expanded="false"><span class="help-term">Admin</span><span role="tooltip" id="help-access-admin" class="help-tip">Darf die Administration bedienen; Admin-Rolle vergeben kann nur der initiale Admin (Token bzw. Admin-Konto).</span></th><th class="col-save"></th></tr></thead>
            <tbody id="user-access-body"></tbody>
          </table>
        </div>
      </fieldset>
    </section>

    <section class="card" id="playbooks-admin" hidden>
      <h2>Standardanalysen pro Dashboard</h2>
      <p class="hint">Eigene Starter-Fragen (max. 5) und Slash-Befehle je Dashboard.</p>
      <p id="playbooks-banner" class="banner"></p>
      <div class="row" style="margin-bottom: 0.75rem;">
        <label for="playbook-key" class="has-help"><span class="help-term">Dashboard:</span><span role="tooltip" id="help-playbook-key" class="help-tip">Eingebundene Dashboards erscheinen automatisch nach dem ersten angemeldeten Start — auch ohne Chatfragen; die Zuordnung wird im Workbook gespeichert.</span></label>
        <select id="playbook-key" style="flex: 1 1 260px;" aria-describedby="help-playbook-key"><option value="">Dashboard auswählen …</option></select>
        <button id="playbook-refresh">Dashboards aktualisieren</button>
      </div>
      <p id="playbook-status" class="hint"></p>
      <fieldset id="playbook-editor" class="form-section" disabled><legend>Analysen bearbeiten (erst nach Dashboard-Auswahl oben verfügbar)</legend>
      <label for="playbook-starters" class="hint has-help" style="display: block;"><span class="help-term">Starter-Fragen (eine je Zeile, max. 5)</span><span role="tooltip" id="help-playbook-starters" class="help-tip">Erscheinen im Chat vor den generischen Vorschlägen, z. B. <code>Wie hat sich der Umsatz im letzten Quartal entwickelt?</code></span></label>
      <textarea id="playbook-starters" rows="4" placeholder="z. B. Wie hat sich der Umsatz im letzten Quartal entwickelt?" aria-describedby="help-playbook-starters"></textarea>
      <p class="hint" style="margin-top: 0.75rem;">Slash-Befehle nur für dieses Dashboard</p>
      <div style="overflow-x: auto;">
        <table id="playbook-commands-table">
          <thead>
            <tr>
              <th class="col-name has-help" aria-expanded="false"><span class="help-term">Name</span><span role="tooltip" id="help-pcmd-name" class="help-tip">Überlagert einen gleichnamigen globalen Slash-Befehl nur auf diesem Dashboard.</span></th>
              <th class="col-desc">Beschreibung</th>
              <th class="col-hint has-help" aria-expanded="false"><span class="help-term">Arg-Hinweis</span><span role="tooltip" id="help-pcmd-arghint" class="help-tip">Erscheint als Platzhaltertext hinter dem Befehlsnamen, z. B. <code>Region, Zeitraum</code>.</span></th>
              <th class="has-help" aria-expanded="false"><span class="help-term">Template</span><span role="tooltip" id="help-pcmd-template" class="help-tip"><code>{{args}}</code> im Template wird durch den vom Anwender eingegebenen Text ersetzt.</span></th>
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

    <section class="card" id="metrics-admin" hidden>
      <h2>Kennzahlen</h2>
      <p class="hint">Unternehmensweit verbindliche Definitionen — der Assistent erkennt Name oder Synonym in der Frage und hält sich an die hinterlegte Definition.</p>
      <p id="metrics-source" class="hint"></p>
      <p id="metrics-banner" class="banner"></p>
      <div style="overflow-x: auto;">
        <table id="metrics-table">
          <thead>
            <tr>
              <th>Kennzahl</th>
              <th class="has-help" aria-expanded="false"><span class="help-term">Synonyme</span><span role="tooltip" id="help-metric-synonyms" class="help-tip">Abkürzungen und Schreibweisen, unter denen Anwender fragen — z. B. DB2, DB II, CM2.</span></th>
              <th class="col-desc">Definition</th>
              <th>Owner</th>
              <th>Datenquelle</th>
              <th class="col-del"></th>
            </tr>
          </thead>
          <tbody id="metrics-body"></tbody>
        </table>
      </div>
      <div class="row">
        <button id="add-metric">+ Kennzahl</button>
        <button class="primary" id="save-metrics">Speichern</button>
        <button class="danger" id="reset-metrics">Zurücksetzen</button>
      </div>
    </section>

    <section class="card" id="models-admin" hidden>
      <h2>Modelle in der Extension</h2>
      <p class="hint">Welche Modelle die Extension im Auswahlmenü anbietet — mit sprechendem Anzeigenamen statt der technischen Modell-ID.</p>
      <p id="models-source" class="hint"></p>
      <p id="models-banner" class="banner"></p>
      <div style="overflow-x: auto;">
        <table id="models-table">
          <thead>
            <tr>
              <th class="has-help" style="width: 45%;" aria-expanded="false"><span class="help-term">Modell-ID (am Endpunkt)</span><span role="tooltip" id="help-models-id" class="help-tip">Ohne gespeicherte Liste zeigt die Extension alle vom Endpunkt gemeldeten Modelle (ggf. gefiltert über <code>OVP_MODEL_ALLOWLIST</code>).</span></th>
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
      <p class="hint">Lädt das Manifest (.trex) mit der eingetragenen Extension-URL herunter.</p>
      <p id="trex-banner" class="banner"></p>
      <label class="form-field has-help" for="trex-url"><span class="help-term">Öffentliche Extension-URL</span><span role="tooltip" id="help-trex-url" class="help-tip">Die Adresse, unter der diese Middleware die Extension ausliefert — HTTPS-Pflicht auf Tableau Server; die Extension verbindet sich dann automatisch mit demselben Host.</span>
        <input type="url" id="trex-url" placeholder="https://chat.example.com/" autocomplete="off" spellcheck="false" aria-describedby="help-trex-url" />
      </label>
      <div class="form-actions">
        <button class="primary" id="trex-download" title="Danach die URL in der Server-Safelist eintragen und das Manifest im Dashboard auswählen.">Manifest (.trex) herunterladen</button>
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
      <p class="hint">Fragen je Dashboard und je Anwender.</p>
      <div style="overflow-x: auto;">
        <table id="dashboard-stats">
          <thead>
            <tr>
              <th>Dashboard</th>
              <th class="num">Fragen</th>
              <th class="num has-help" aria-expanded="false"><span class="help-term">Anwender</span><span role="tooltip" id="help-usage-users" class="help-tip">Nicht umkehrbare Pseudonyme — keine Namen, IDs oder Inhalte. Kennzahlen je Anwender erscheinen erst ab 3 Anwendern (darunter <code>&lt; 3</code>).</span></th>
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

<dialog id="metric-dialog" aria-labelledby="metric-dialog-title">
  <form id="metric-form">
    <h2 id="metric-dialog-title">Kennzahl anlegen</h2>
    <label class="form-field has-help" for="metric-id"><span class="help-term">ID</span><span role="tooltip" id="help-metric-id" class="help-tip">Eindeutiger technischer Schlüssel (Kleinbuchstaben, Ziffern, „-“) — nur intern; im Chat zählen Name und Synonyme.</span>
      <input type="text" id="metric-id" required maxlength="40" placeholder="z. B. deckungsbeitrag-ii" autocomplete="off" aria-describedby="metric-id-error" />
    </label>
    <p id="metric-id-error" class="hint error" role="status" hidden></p>
    <label class="form-field" for="metric-name">Kennzahl
      <input type="text" id="metric-name" required maxlength="80" placeholder="z. B. Deckungsbeitrag II" autocomplete="off" aria-describedby="metric-name-error" />
    </label>
    <p id="metric-name-error" class="hint error" role="status" hidden></p>
    <label class="form-field has-help" for="metric-synonyms"><span class="help-term">Synonyme (kommagetrennt)</span><span role="tooltip" id="help-metric-synonyms-field" class="help-tip">Abkürzungen und Schreibweisen, unter denen Anwender fragen — z. B. DB2, DB II, CM2.</span>
      <input type="text" id="metric-synonyms" maxlength="440" placeholder="z. B. DB2, DB II, CM2" autocomplete="off" aria-describedby="metric-synonyms-error" />
    </label>
    <p id="metric-synonyms-error" class="hint error" role="status" hidden></p>
    <label class="form-field" for="metric-definition">Definition
      <textarea id="metric-definition" rows="3" required maxlength="1000" placeholder="z. B. Umsatz − variable Kosten − Fixkosten" aria-describedby="metric-definition-error"></textarea>
    </label>
    <p id="metric-definition-error" class="hint error" role="status" hidden></p>
    <div class="form-grid">
      <label class="form-field" for="metric-owner">Owner (optional)
        <input type="text" id="metric-owner" maxlength="80" placeholder="z. B. Controlling" autocomplete="off" />
      </label>
      <label class="form-field" for="metric-datasource">Datenquelle (optional)
        <input type="text" id="metric-datasource" maxlength="120" placeholder="z. B. Finance Semantic Model" autocomplete="off" />
      </label>
    </div>
    <label class="form-field has-help" for="metric-interpretation"><span class="help-term">Interpretationshinweis (optional)</span><span role="tooltip" id="help-metric-interpretation" class="help-tip">Wie der Wert einzuordnen ist, z. B. Schwellenwerte — hilft dem Assistenten bei der Einschätzung.</span>
      <textarea id="metric-interpretation" rows="2" maxlength="500" placeholder="z. B. Unter 18 % kritisch"></textarea>
    </label>
    <fieldset class="form-section">
      <legend class="has-help" aria-expanded="false"><span class="help-term">Geprüfte Fragen (bis zu 5)</span><span role="tooltip" id="help-metric-questions" class="help-tip">Typische Frage und wie sie beantwortet werden soll; der Assistent hält sich daran.</span></legend>
      <div id="metric-questions"></div>
      <button type="button" id="metric-add-question">+ Frage</button>
    </fieldset>
    <p id="metric-dialog-banner" class="banner" role="alert"></p>
    <div class="form-actions">
      <button type="button" id="metric-dialog-cancel">Abbrechen</button>
      <button type="submit" id="metric-dialog-save" class="primary">Übernehmen</button>
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
  var actionIcons = { remove: ${JSON.stringify(adminIcon(Trash2))}, password: ${JSON.stringify(adminIcon(KeyRound))}, lock: ${JSON.stringify(adminIcon(LockKeyhole))}, unlock: ${JSON.stringify(adminIcon(LockKeyholeOpen))}, refresh: ${JSON.stringify(adminIcon(RefreshCw))}, save: ${JSON.stringify(adminIcon(Save))} };

  function setActionIcon(button, icon, label) {
    button.innerHTML = actionIcons[icon];
    button.classList.add('icon-button');
    button.title = label;
    button.setAttribute('aria-label', label);
  }

  // ---------- Hilfe-Tooltips (Hover/Fokus statt ?-Symbol) ----------
  // Reines CSS zeigt den Tooltip bei :hover/:focus-within (bzw. Fokus auf ein
  // Eingabefeld direkt hinter dem Label — siehe :has(+ :focus) im CSS); hier
  // kommt nur der Klick/Touch-Umschalter für Header/Legenden ohne eigenes
  // Eingabefeld dazu (aria-expanded, Escape, Klick außerhalb) und die
  // Rechtsrand-Heuristik für Tooltips, die sonst abgeschnitten würden. Ein
  // Klick auf ein Label MIT Eingabefeld wird nicht abgefangen, damit das
  // normale Fokussieren des Feldes nicht gestört wird.
  function helpCloseAll() {
    Array.prototype.forEach.call(document.querySelectorAll('.has-help[aria-expanded="true"]'), function (el) {
      el.setAttribute('aria-expanded', 'false');
    });
  }
  // Einmal je Element messen, nie eine statisch gesetzte Ausrichtung entfernen:
  // mouseover feuert bei jeder Bewegung über Kindelemente — würde die Klasse
  // dabei erst entfernt und dann neu gesetzt, spränge der Tooltip hin und her.
  function helpPosition(el) {
    if (el.dataset.helpPositioned) return;
    var tip = el.querySelector('.help-tip');
    if (!tip) return;
    var wasHidden = getComputedStyle(tip).display === 'none';
    if (wasHidden) tip.style.display = 'block';
    var rect = tip.getBoundingClientRect();
    if (rect.right > document.documentElement.clientWidth) el.classList.add('help-left');
    if (rect.top < 0) el.classList.add('help-below');
    if (wasHidden) tip.style.display = '';
    el.dataset.helpPositioned = '1';
  }
  window.addEventListener('resize', function () {
    Array.prototype.forEach.call(document.querySelectorAll('.has-help[data-help-positioned]'), function (el) {
      delete el.dataset.helpPositioned;
    });
  });
  document.addEventListener('mouseover', function (event) {
    var el = event.target.closest && event.target.closest('.has-help');
    if (el) helpPosition(el);
  });
  document.addEventListener('focusin', function (event) {
    var el = event.target.closest && event.target.closest('.has-help');
    if (el) helpPosition(el);
  });
  document.addEventListener('click', function (event) {
    var el = event.target.closest && event.target.closest('.has-help');
    if (el && el.tagName !== 'LABEL') {
      event.stopPropagation();
      var wasOpen = el.getAttribute('aria-expanded') === 'true';
      helpCloseAll();
      if (!wasOpen) { el.setAttribute('aria-expanded', 'true'); helpPosition(el); }
      return;
    }
    if (!(event.target.closest && event.target.closest('.help-tip'))) helpCloseAll();
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') helpCloseAll();
  });

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
    ['gate-token', 'gate-setup', 'gate-login', 'gate-retry', 'gate-user', 'gate-user-login', 'gate-sso'].forEach(function (id) {
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
        if (result.data.mode !== 'setup') initUserGate();
      })
      .catch(function () {
        showBanner(gateError, 'Server nicht erreichbar.', 'error');
        document.getElementById('gate-retry').hidden = false;
      });
  }

  /** Angemeldeter Admin ({ role: 'initial' | 'delegated', name, provider }) — steuert den Admin-Schalter. */
  var adminMe = null;

  function loadMe() {
    return adminFetch('/me')
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (me) {
        adminMe = me;
        var identity = document.getElementById('admin-identity');
        identity.hidden = !me;
        identity.textContent = me ? 'Angemeldet als ' + me.name + (me.role === 'delegated' ? ' (delegierter Admin)' : '') : '';
      });
  }

  /** Zweiter Weg ins Admin: Benutzerkonto mit Admin-Rolle — Formular (lokal) oder SSO-Button (OIDC), je nach Anmeldemodus. */
  var ssoConfig = null;
  function initUserGate() {
    fetch('/api/auth/config')
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (result) {
        if (!result.ok) return;
        if (result.data.mode === 'local') {
          document.getElementById('gate-user').hidden = false;
          document.getElementById('gate-user-login').hidden = false;
        } else if (result.data.mode === 'oidc' && result.data.authorizationEndpoint && result.data.redirectUri) {
          ssoConfig = result.data;
          document.getElementById('gate-user').hidden = false;
          document.getElementById('gate-sso').hidden = false;
        }
      })
      .catch(function () { /* ohne Benutzer-Anmeldung bleibt der Token-/Passwort-Weg */ });
  }

  function showApp() {
    gate.style.display = 'none';
    app.style.display = 'block';
    selectAdminView(false);
    // Erst die Rolle, dann die Bereiche — nach 401/403 steht bereits das Gate.
    loadMe().then(loadAll, function (error) { if (error.message !== 'unauthorized') loadAll(); });
  }

  function loadAll() {
    loadMcp();
    loadTableauServer(false);
    loadAuth();
    loadUsers();
    loadUserAccess();
    loadCommands();
    loadPlaybooks();
    loadMetrics();
    loadModels();
    loadStats();
    loadWatch();
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
      if (res.status === 403) {
        // Benutzerkonto ohne (oder mit inzwischen entzogener) Admin-Rolle.
        return res.clone().json().catch(function () { return {}; }).then(function (data) {
          if (data && data.code === 'not_admin') {
            clearToken();
            showGate('Dieses Konto hat keine Admin-Rolle.');
            throw new Error('unauthorized');
          }
          return res;
        });
      }
      return res;
    });
  }

  ${mcpAdminScript}
  ${tableauAdminScript}
  ${watchAdminScript}

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
    oidcRedirect.value = origin ? origin + '/auth/callback' : '';
  }
  authPublicUrl.addEventListener('input', updateRedirectPreview);
  document.getElementById('oidc-redirect-copy').addEventListener('click', function () {
    if (!oidcRedirect.value) { authPublicUrl.focus(); return; }
    var button = this;
    navigator.clipboard.writeText(oidcRedirect.value).then(function () {
      button.textContent = 'Kopiert';
      setTimeout(function () { button.textContent = 'Kopieren'; }, 1500);
    }, function () { oidcRedirect.select(); });
  });
  function updateOidcSetup() {
    ['entra', 'keycloak', 'generic'].forEach(function (key) {
      document.getElementById('oidc-setup-' + key).hidden = oidcProvider.value !== key;
    });
  }
  oidcProvider.addEventListener('change', updateOidcSetup);

  function describeLicenseStatus(lic) {
    if (lic.status === 'valid') return 'Enterprise Edition — Lizenz gültig (Schlüssel ' + lic.kid + ').';
    if (lic.status === 'inactive') return 'Enterprise-Lizenz gültig, Installation nicht aktiviert — Enterprise-Funktionen deaktiviert: ' + lic.reason;
    if (lic.status === 'expired') return 'Enterprise-Lizenz für „' + lic.licensee + '“ (Lizenz-ID ' + lic.licenseId + ' · Schlüssel ' + lic.kid + ') ist am ' + String(lic.validUntil).slice(0, 10) + ' abgelaufen — Enterprise-Funktionen deaktiviert.';
    if (lic.status === 'invalid') return 'Lizenz ungültig: ' + lic.reason;
    return 'Core-Edition (keine Enterprise-Lizenz hinterlegt).';
  }

  function fmtDate(iso) {
    return iso ? new Date(iso).toLocaleDateString('de-DE') : '—';
  }

  /** Aktivierungszeile der Lizenzkarte — Zustand aus auth-state.ts, Zeiten aus dem Heartbeat. */
  function describeLease(lic, telemetry) {
    var lastOk = telemetry && telemetry.lastOkAt ? fmtDate(telemetry.lastOkAt) : null;
    var limit = lic.leaseServerState === 'activation_limit' && lic.message ? ' — ' + lic.message : '';
    switch (lic.leaseState) {
      case 'active': return { text: (lic.leaseOffline ? 'Offline-Lease bis ' : 'Aktiv bis ') + fmtDate(lic.leaseUntil) + limit, blocked: false };
      case 'grace': return { text: 'Grace bis ' + fmtDate(lic.graceUntil) + ' — WerkWorks nicht erreichbar seit ' + (lastOk || fmtDate(lic.leaseUntil)) + ' (Lease abgelaufen ' + fmtDate(lic.leaseUntil) + ')', blocked: false };
      case 'blocked': return { text: 'Blockiert: ' + (lic.message || 'Aktivierungslimit erreicht') + ' — Installation übertragen oder alte stilllegen', blocked: true };
      case 'expired': return { text: 'Abgelaufen — Lease seit ' + fmtDate(lic.leaseUntil) + ' nicht erneuert, Karenz endete ' + fmtDate(lic.graceUntil) + '. Nur Core-Funktionen.', blocked: true };
      case 'pending': return { text: lic.leaseServerState === 'deactivated' && lic.message ? lic.message : 'Ausstehend — noch nie aktiviert (nur Core-Funktionen)', blocked: true };
      default: return { text: '—', blocked: false };
    }
  }

  function renderLicenseCard(lic, data) {
    var card = document.getElementById('license-card');
    var licensed = lic.status === 'valid' || lic.status === 'inactive';
    card.hidden = !licensed;
    if (!licensed) return;
    document.getElementById('lic-licensee').textContent = lic.licensee || '—';
    document.getElementById('lic-id').textContent = lic.licenseId || '—';
    document.getElementById('lic-env').textContent = lic.environment || '—';
    var inst = document.getElementById('lic-inst');
    var full = lic.installationId || '—';
    inst.querySelector('.help-term').textContent = full.length > 13 ? full.slice(0, 8) + '…' + full.slice(-4) : full;
    document.getElementById('lic-inst-full').textContent = full;
    var lease = describeLease(lic, data.telemetry);
    var leaseCell = document.getElementById('lic-lease');
    leaseCell.textContent = lease.text;
    leaseCell.className = lease.blocked ? 'lease-blocked' : '';
    document.getElementById('license-pending').className = 'banner' + (lic.leaseState === 'pending' ? ' error' : '');
    var graceBanner = document.getElementById('license-subscription-grace');
    graceBanner.hidden = !lic.subscriptionGraceUntil;
    if (lic.subscriptionGraceUntil) {
      graceBanner.textContent = 'Lizenz am ' + fmtDate(lic.validUntil) + ' abgelaufen — Enterprise-Funktionen laufen noch bis ' + fmtDate(lic.subscriptionGraceUntil) + '. Bitte Lizenz verlängern.';
    }
    document.getElementById('lic-valid').textContent = fmtDate(lic.validUntil);
    document.getElementById('lic-features').textContent = (lic.features || []).map(function (f) { return featureLabels[f] || f; }).join(', ') || '—';
    var available = Boolean(data.leaseAvailable);
    document.getElementById('license-refresh').disabled = !available;
    document.getElementById('activation-request-download').disabled = !available;
    document.getElementById('license-lease-save').disabled = !available;
    // Stilllegen ist nur dem initialen Admin vorbehalten (Server erzwingt es ohnehin, code initial_admin_required).
    var deactivateButton = document.getElementById('license-deactivate');
    var canManageInstallations = Boolean(adminMe && adminMe.role === 'initial');
    deactivateButton.disabled = !available || !canManageInstallations;
    deactivateButton.title = canManageInstallations ? '' : 'Nur der initiale Admin (Token bzw. Admin-Konto) kann stilllegen.';
  }

  /** Installationen dieser Lizenz — aus der Antwort des letzten (erzwungenen) Heartbeats, nie gespeichert. */
  function renderInstallations(list) {
    var box = document.getElementById('license-installations-box');
    var body = document.getElementById('license-installations-body');
    body.innerHTML = '';
    box.hidden = list.length === 0;
    var ownId = document.getElementById('lic-inst-full').textContent || '';
    var canManageInstallations = Boolean(adminMe && adminMe.role === 'initial');
    var hint = document.getElementById('license-installations-hint');
    var blocked = document.getElementById('lic-lease').className === 'lease-blocked';
    hint.hidden = !blocked;
    if (blocked) hint.textContent = 'Eine der folgenden Installationen ersetzen oder dort stilllegen.';
    list.forEach(function (inst) {
      var tr = document.createElement('tr');
      var idCell = document.createElement('td');
      var full = inst.id || '';
      var short = full.length > 13 ? full.slice(0, 8) + '…' + full.slice(-4) : full;
      idCell.textContent = short;
      if (full) idCell.title = full;
      tr.appendChild(idCell);
      var envCell = document.createElement('td'); envCell.textContent = inst.environment || '—'; tr.appendChild(envCell);
      var urlCell = document.createElement('td'); urlCell.textContent = inst.publicUrl || '—'; tr.appendChild(urlCell);
      var seenCell = document.createElement('td'); seenCell.textContent = inst.lastSeenAt ? new Date(inst.lastSeenAt).toLocaleString('de-DE') : '—'; tr.appendChild(seenCell);
      var verCell = document.createElement('td'); verCell.textContent = inst.version || '—'; tr.appendChild(verCell);
      var offCell = document.createElement('td'); offCell.textContent = inst.offline ? 'Ja' : 'Nein'; tr.appendChild(offCell);
      var actionCell = document.createElement('td');
      if (full && full !== ownId) {
        var btn = document.createElement('button');
        btn.textContent = 'Diese Installation ersetzen';
        btn.disabled = !canManageInstallations;
        btn.title = canManageInstallations ? '' : 'Nur der initiale Admin (Token bzw. Admin-Konto) kann übertragen.';
        btn.addEventListener('click', function () {
          if (!window.confirm('Die Installation ' + short + ' verliert ihre Enterprise-Funktionen beim nächsten Heartbeat. Fortfahren?')) return;
          btn.disabled = true;
          adminFetch('/license/transfer', jsonRequest('POST', { installationId: full }))
            .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
            .then(function (result) {
              if (!result.ok) { showBanner(authBanner, errorText(result.data, 'Übertragen fehlgeschlagen'), 'error'); return; }
              renderAuth(result.data);
              showBanner(authBanner, 'Installation übernommen.', 'ok');
              loadInstallations();
            })
            .catch(function () { showBanner(authBanner, 'Übertragen fehlgeschlagen', 'error'); })
            .then(function () { btn.disabled = !canManageInstallations; });
        });
        actionCell.appendChild(btn);
      }
      tr.appendChild(actionCell);
      body.appendChild(tr);
    });
  }

  function loadInstallations() {
    return adminFetch('/license/installations')
      .then(function (res) { return res.json(); })
      .then(function (data) { renderInstallations(data.installations || []); })
      .catch(function () { /* adminFetch hat bei 401 schon reagiert */ });
  }

  function updateOidcVisibility() {
    oidcFields.hidden = authMode.value !== 'oidc';
  }
  authMode.addEventListener('change', updateOidcVisibility);

  function renderAuth(data) {
    featureLabels = data.featureLabels || {};
    var eff = data.effective;
    var modeLabels = { none: 'offen (nur Netzwerkschutz)', token: 'Shared-Token (OVP_API_AUTH_TOKEN, per Env)', local: 'Benutzerkonten', oidc: 'Single Sign-On' };
    var text = 'Aktiv: ' + (modeLabels[eff.mode] || eff.mode) + ' (Quelle: ' + (eff.source === 'db' ? 'Admin-UI' : 'Env-Defaults') + ')';
    if (eff.blockedReason) text += ' — BLOCKIERT: ' + eff.blockedReason;
    authSource.textContent = text;
    authSource.classList.toggle('error', Boolean(eff.blockedReason));
    var lic = eff.license || { status: 'none' };
    licenseSummary.textContent = describeLicenseStatus(lic) + (data.stored && data.stored.hasLicense ? ' (aus Admin-UI)' : data.envDefaults && data.envDefaults.hasLicense ? ' (aus Env)' : '');
    licenseSummary.classList.toggle('error', lic.status === 'inactive' || lic.status === 'expired' || lic.status === 'invalid');
    renderLicenseCard(lic, data);
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
    updateOidcSetup();
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
      .then(function (data) { renderAuth(data); loadInstallations(); })
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
  document.getElementById('license-refresh').addEventListener('click', function () {
    var button = this;
    button.disabled = true;
    adminFetch('/license/refresh', { method: 'POST' })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (result) {
        if (!result.ok) { showBanner(authBanner, errorText(result.data, 'Aktualisierung fehlgeschlagen'), 'error'); return; }
        renderAuth(result.data);
        loadInstallations();
        showBanner(authBanner, 'Aktivierung aktualisiert.', 'ok');
      })
      .catch(function () { showBanner(authBanner, 'Aktualisierung fehlgeschlagen', 'error'); })
      .then(function () { button.disabled = false; });
  });
  document.getElementById('license-deactivate').addEventListener('click', function () {
    if (!window.confirm('Diese Installation stilllegen? Enterprise-Funktionen enden beim nächsten Heartbeat, der Platz wird sofort frei.')) return;
    var button = this;
    button.disabled = true;
    adminFetch('/license/deactivate', jsonRequest('POST', { confirm: true }))
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (result) {
        if (!result.ok) { showBanner(authBanner, errorText(result.data, 'Stilllegen fehlgeschlagen'), 'error'); return; }
        renderAuth(result.data);
        showBanner(authBanner, 'Installation stillgelegt.', 'ok');
      })
      .catch(function () { showBanner(authBanner, 'Stilllegen fehlgeschlagen', 'error'); })
      .then(function () { button.disabled = false; });
  });
  document.getElementById('activation-request-download').addEventListener('click', function () {
    adminFetch('/license/activation-request')
      .then(function (res) {
        if (!res.ok) return res.json().then(function (data) { showBanner(authBanner, errorText(data, 'Anfrage fehlgeschlagen'), 'error'); });
        return res.blob().then(function (blob) {
          var href = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = href;
          a.download = 'ovp-activation-request.json';
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(href);
        });
      })
      .catch(function () { /* adminFetch hat bei 401 schon reagiert */ });
  });
  document.getElementById('license-lease-save').addEventListener('click', function () {
    var lease = document.getElementById('license-lease');
    if (!lease.value.trim()) { lease.focus(); return; }
    adminFetch('/license/lease', jsonRequest('PUT', { lease: lease.value.trim() }))
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (result) {
        if (!result.ok) { showBanner(authBanner, errorText(result.data, 'Lease abgelehnt'), 'error'); return; }
        lease.value = '';
        renderAuth(result.data);
        showBanner(authBanner, 'Lease gespeichert — Installation aktiviert.', 'ok');
      })
      .catch(function () { showBanner(authBanner, 'Lease konnte nicht gespeichert werden', 'error'); });
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
  var userAccessBody = document.getElementById('user-access-body');
  var userAccessBanner = document.getElementById('user-access-banner');

  function renderUserAccess(users) {
    userAccessBody.innerHTML = '';
    if (users.length === 0) {
      var empty = document.createElement('tr');
      var emptyCell = document.createElement('td');
      emptyCell.colSpan = 8;
      emptyCell.className = 'hint';
      emptyCell.textContent = 'Keine Identitäten gefunden.';
      empty.appendChild(emptyCell);
      userAccessBody.appendChild(empty);
      return;
    }
    users.forEach(function (u) {
      var tr = document.createElement('tr');
      var identity = document.createElement('td');
      identity.className = 'user-access-identity';
      var name = document.createElement('div');
      name.textContent = u.displayName || u.email || u.subject || u.id;
      identity.appendChild(name);
      var details = document.createElement('small');
      details.textContent = u.provider === 'oidc'
        ? 'SSO · ' + (u.issuer || 'Issuer unbekannt') + ' · subject: ' + (u.subject || 'unbekannt')
        : 'Lokal · ' + (u.subject || u.id);
      identity.appendChild(details);
      var email = document.createElement('td');
      email.textContent = u.email || '—';
      var status = document.createElement('td');
      var ai = document.createElement('td');
      ai.className = 'col-access';
      var aiLabel = document.createElement('label');
      aiLabel.className = 'user-access-checkbox';
      var aiInput = document.createElement('input');
      aiInput.type = 'checkbox';
      aiInput.setAttribute('role', 'switch');
      aiInput.checked = u.ai === true;
      aiInput.setAttribute('aria-label', 'AI-Chat für ' + (u.displayName || u.email || u.id));
      aiLabel.appendChild(aiInput);
      ai.appendChild(aiLabel);
      var tableau = document.createElement('td');
      tableau.className = 'col-access';
      var tableauLabel = document.createElement('label');
      tableauLabel.className = 'user-access-checkbox';
      var tableauInput = document.createElement('input');
      tableauInput.type = 'checkbox';
      tableauInput.setAttribute('role', 'switch');
      tableauInput.checked = u.tableauApi === true;
      tableauInput.setAttribute('aria-label', 'Tableau API für ' + (u.displayName || u.email || u.id));
      tableauLabel.appendChild(tableauInput);
      tableau.appendChild(tableauLabel);
      var serverData = document.createElement('td');
      serverData.className = 'col-access';
      var serverDataLabel = document.createElement('label');
      serverDataLabel.className = 'user-access-checkbox';
      var serverDataInput = document.createElement('input');
      serverDataInput.type = 'checkbox';
      serverDataInput.setAttribute('role', 'switch');
      serverDataInput.checked = u.serverData === true;
      serverDataInput.setAttribute('aria-label', 'Serverdaten für ' + (u.displayName || u.email || u.id));
      serverDataLabel.appendChild(serverDataInput);
      serverData.appendChild(serverDataLabel);
      var adminCell = document.createElement('td');
      adminCell.className = 'col-access';
      var adminLabel = document.createElement('label');
      adminLabel.className = 'user-access-checkbox';
      var adminInput = document.createElement('input');
      adminInput.type = 'checkbox';
      adminInput.setAttribute('role', 'switch');
      adminInput.checked = u.admin === true;
      // Nur der initiale Admin vergibt die Rolle — delegierte Admins sehen den Schalter nur lesend.
      var canGrantAdmin = Boolean(adminMe && adminMe.role === 'initial');
      adminInput.disabled = !canGrantAdmin;
      adminInput.setAttribute('aria-label', 'Admin für ' + (u.displayName || u.email || u.id));
      adminLabel.appendChild(adminInput);
      adminCell.appendChild(adminLabel);
      status.textContent = aiInput.checked || tableauInput.checked ? 'freigegeben' : 'ausstehend';
      var actions = document.createElement('td');
      actions.className = 'col-save';
      var save = document.createElement('button');
      save.type = 'button';
      setActionIcon(save, 'save', 'Zugriff speichern');
      save.addEventListener('click', function () {
        save.disabled = true;
        aiInput.disabled = true;
        tableauInput.disabled = true;
        serverDataInput.disabled = true;
        adminInput.disabled = true;
        adminFetch('/user-access/' + encodeURIComponent(u.id), jsonRequest('PUT', { ai: aiInput.checked, tableauApi: tableauInput.checked, serverData: serverDataInput.checked, admin: adminInput.checked }))
          .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
          .then(function (result) {
            if (!result.ok) throw new Error(errorText(result.data, 'Zugriff konnte nicht gespeichert werden.'));
            showBanner(userAccessBanner, 'Zugriff gespeichert.', 'ok');
            status.textContent = aiInput.checked || tableauInput.checked ? 'freigegeben' : 'ausstehend';
          })
          .catch(function (error) { showBanner(userAccessBanner, error.message || 'Zugriff konnte nicht gespeichert werden.', 'error'); })
          .finally(function () { save.disabled = false; aiInput.disabled = false; tableauInput.disabled = false; serverDataInput.disabled = false; adminInput.disabled = !canGrantAdmin; });
      });
      actions.appendChild(save);
      tr.appendChild(identity);
      tr.appendChild(email);
      tr.appendChild(status);
      tr.appendChild(ai);
      tr.appendChild(tableau);
      tr.appendChild(serverData);
      tr.appendChild(adminCell);
      tr.appendChild(actions);
      userAccessBody.appendChild(tr);
    });
  }

  function loadUserAccess() {
    return adminFetch('/user-access')
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (result) {
        if (!result.ok) throw new Error(errorText(result.data, 'Zugriffe konnten nicht geladen werden.'));
        renderUserAccess(result.data.users || []);
        if (result.data.storeAvailable === false) showBanner(userAccessBanner, 'Benutzerzugriff benötigt einen Memory-Store.', 'error');
      })
      .catch(function (error) { showBanner(userAccessBanner, error.message || 'Zugriffe konnten nicht geladen werden.', 'error'); });
  }

  function userAction(path, options, okText) {
    return adminFetch(path, options)
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (result) {
        if (!result.ok) {
          showBanner(usersBanner, errorText(result.data, 'Aktion fehlgeschlagen'), 'error');
          return false;
        }
        showBanner(usersBanner, okText, 'ok');
        return loadUsers().then(loadUserAccess).then(function () { return true; });
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

  document.getElementById('user-access-refresh').addEventListener('click', function () {
    var button = document.getElementById('user-access-refresh');
    button.disabled = true;
    loadUserAccess().finally(function () { button.disabled = false; });
  });

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
    if (mcpDirty || tableauServerDirty || playbookIsDirty()) { event.preventDefault(); event.returnValue = ''; }
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

  // ---------- Kennzahlen ----------

  var metricsState = { metrics: [], source: 'default' };
  var metricsBody = document.getElementById('metrics-body');
  var metricsSource = document.getElementById('metrics-source');
  var metricsBanner = document.getElementById('metrics-banner');
  var metricDialog = document.getElementById('metric-dialog');
  var metricDialogBanner = document.getElementById('metric-dialog-banner');
  var metricQuestionsRoot = document.getElementById('metric-questions');
  var metricEditIndex = -1;
  var metricDraftQuestions = [];

  function metricsChanged() {
    showBanner(metricsBanner, 'Ungespeicherte Änderungen.', '');
    metricsBanner.style.display = 'block';
  }

  function openMetricDialog(index) {
    metricEditIndex = index;
    var metric = index >= 0 ? metricsState.metrics[index] : { id: '', name: '', synonyms: [], definition: '', owner: '', datasource: '', interpretation: '', verifiedQuestions: [] };
    document.getElementById('metric-dialog-title').textContent = index >= 0 ? 'Kennzahl bearbeiten' : 'Kennzahl anlegen';
    document.getElementById('metric-id').value = metric.id || '';
    document.getElementById('metric-name').value = metric.name || '';
    document.getElementById('metric-synonyms').value = (metric.synonyms || []).join(', ');
    document.getElementById('metric-definition').value = metric.definition || '';
    document.getElementById('metric-owner').value = metric.owner || '';
    document.getElementById('metric-datasource').value = metric.datasource || '';
    document.getElementById('metric-interpretation').value = metric.interpretation || '';
    metricDraftQuestions = (metric.verifiedQuestions || []).map(function (q) { return { question: q.question, answerGuidance: q.answerGuidance }; });
    renderMetricQuestions();
    ['metric-id', 'metric-name', 'metric-synonyms', 'metric-definition'].forEach(function (id) { metricClearFieldError(document.getElementById(id)); });
    document.getElementById('metric-id').dataset.auto = metric.id ? '' : '1';
    showBanner(metricDialogBanner, '', 'ok');
    metricDialog.showModal();
    document.getElementById('metric-name').focus();
  }

  function metricRow(metric, index) {
    var tr = document.createElement('tr');
    function textCell(text, cls) {
      var td = document.createElement('td');
      if (cls) td.className = cls;
      td.textContent = text || '';
      return td;
    }
    tr.appendChild(textCell(metric.name));
    tr.appendChild(textCell((metric.synonyms || []).join(', ')));
    tr.appendChild(textCell(metric.definition, 'col-desc'));
    tr.appendChild(textCell(metric.owner));
    tr.appendChild(textCell(metric.datasource));
    var actionsTd = document.createElement('td');
    actionsTd.className = 'col-del';
    var editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.textContent = 'Bearbeiten';
    editBtn.addEventListener('click', function () { openMetricDialog(index); });
    actionsTd.appendChild(editBtn);
    var delBtn = document.createElement('button');
    delBtn.type = 'button';
    setActionIcon(delBtn, 'remove', 'Kennzahl entfernen');
    delBtn.addEventListener('click', function () {
      metricsState.metrics.splice(index, 1);
      metricsChanged();
      renderMetrics();
    });
    actionsTd.appendChild(delBtn);
    tr.appendChild(actionsTd);
    return tr;
  }

  function renderMetrics() {
    metricsBody.innerHTML = '';
    metricsState.metrics.forEach(function (metric, index) { metricsBody.appendChild(metricRow(metric, index)); });
    metricsSource.textContent =
      metricsState.source === 'custom'
        ? 'Aktuell: eigene, gespeicherte Kennzahlen.'
        : 'Aktuell: kein Katalog gepflegt — der Assistent kennt keine verbindlichen Definitionen.';
  }

  function loadMetrics() {
    return adminFetch('/metrics')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        metricsState = { metrics: data.metrics || [], source: data.source };
        renderMetrics();
      })
      .catch(function () { /* adminFetch hat bei 401 schon reagiert */ });
  }

  function metricFieldError(fieldId) {
    return fieldId ? document.getElementById(fieldId + '-error') : null;
  }

  function metricClearFieldError(field) {
    if (!field) return;
    field.removeAttribute('aria-invalid');
    var errorEl = metricFieldError(field.id);
    if (errorEl) { errorEl.hidden = true; errorEl.textContent = ''; }
  }

  function metricSetFieldError(fieldId, message) {
    var field = document.getElementById(fieldId);
    if (!field) return null;
    if (!message) { metricClearFieldError(field); return null; }
    var errorEl = metricFieldError(fieldId);
    if (errorEl) { errorEl.textContent = message; errorEl.hidden = false; }
    field.setAttribute('aria-invalid', 'true');
    return field;
  }

  // ID aus dem Namen ableiten, solange der Admin sie nicht selbst angefasst hat.
  function metricSlug(name) {
    var slug = name.toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
    return /^[a-z]/.test(slug) ? slug : (slug ? 'k-' + slug.slice(0, 38) : '');
  }
  document.getElementById('metric-name').addEventListener('input', function () {
    var idField = document.getElementById('metric-id');
    if (idField.dataset.auto === '1') { idField.value = metricSlug(this.value); metricClearFieldError(idField); }
  });
  document.getElementById('metric-id').addEventListener('input', function () { this.dataset.auto = ''; });
  ['metric-id', 'metric-name', 'metric-synonyms', 'metric-definition'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', function () { metricClearFieldError(document.getElementById(id)); });
  });

  function renderMetricQuestions() {
    metricQuestionsRoot.innerHTML = '';
    metricDraftQuestions.forEach(function (question, index) {
      var row = document.createElement('div');
      row.className = 'metric-question-row';
      var qLabel = document.createElement('label');
      qLabel.textContent = 'Frage';
      var qInput = document.createElement('input');
      qInput.type = 'text';
      qInput.maxLength = 200;
      qInput.value = question.question || '';
      qInput.addEventListener('input', function () { question.question = qInput.value; });
      qLabel.appendChild(qInput);
      var aLabel = document.createElement('label');
      aLabel.textContent = 'Antwortlogik';
      var aInput = document.createElement('textarea');
      aInput.rows = 2;
      aInput.maxLength = 500;
      aInput.value = question.answerGuidance || '';
      aInput.addEventListener('input', function () { question.answerGuidance = aInput.value; });
      aLabel.appendChild(aInput);
      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'danger';
      removeBtn.textContent = 'Frage entfernen';
      removeBtn.addEventListener('click', function () {
        metricDraftQuestions.splice(index, 1);
        renderMetricQuestions();
      });
      row.appendChild(qLabel);
      row.appendChild(aLabel);
      row.appendChild(removeBtn);
      metricQuestionsRoot.appendChild(row);
    });
    document.getElementById('metric-add-question').disabled = metricDraftQuestions.length >= 5;
  }

  document.getElementById('metric-add-question').addEventListener('click', function () {
    if (metricDraftQuestions.length >= 5) return;
    metricDraftQuestions.push({ question: '', answerGuidance: '' });
    renderMetricQuestions();
  });

  document.getElementById('add-metric').addEventListener('click', function () { openMetricDialog(-1); });
  metricDialog.addEventListener('close', function () { document.getElementById('metric-form').reset(); });
  document.getElementById('metric-dialog-cancel').addEventListener('click', function () { metricDialog.close(); });

  function validateMetricDraft(draft) {
    var firstInvalid = null;
    function check(fieldId, message) {
      var invalid = metricSetFieldError(fieldId, message);
      if (invalid && !firstInvalid) firstInvalid = invalid;
    }
    var idError = '';
    if (!/^[a-z][a-z0-9-]{0,39}$/.test(draft.id)) {
      idError = 'Kleinbuchstaben, Ziffern und "-", muss mit einem Buchstaben beginnen, max. 40 Zeichen.';
    } else if (metricsState.metrics.some(function (m, i) { return i !== metricEditIndex && m.id === draft.id; })) {
      idError = 'ID bereits vergeben.';
    }
    check('metric-id', idError);
    check('metric-name', draft.name ? '' : 'Name ist erforderlich.');
    check('metric-definition', draft.definition ? '' : 'Definition ist erforderlich.');
    var synonymTooLong = draft.synonyms.some(function (s) { return s.length > 40; });
    check('metric-synonyms', draft.synonyms.length > 10 ? 'Höchstens 10 Synonyme.' : (synonymTooLong ? 'Jedes Synonym höchstens 40 Zeichen.' : ''));
    var names = [draft.name].concat(draft.synonyms).filter(Boolean).map(function (s) { return s.toLocaleLowerCase(); });
    var collision = metricsState.metrics.some(function (m, i) {
      if (i === metricEditIndex) return false;
      var otherNames = [m.name].concat(m.synonyms || []).map(function (s) { return s.toLocaleLowerCase(); });
      return names.some(function (n) { return otherNames.indexOf(n) >= 0; });
    });
    if (collision) check('metric-name', 'Name oder Synonym ist bei einer anderen Kennzahl bereits vergeben.');
    return firstInvalid;
  }

  document.getElementById('metric-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var draft = {
      id: document.getElementById('metric-id').value.trim(),
      name: document.getElementById('metric-name').value.trim(),
      synonyms: document.getElementById('metric-synonyms').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean),
      definition: document.getElementById('metric-definition').value.trim(),
      owner: document.getElementById('metric-owner').value.trim(),
      datasource: document.getElementById('metric-datasource').value.trim(),
      interpretation: document.getElementById('metric-interpretation').value.trim(),
      verifiedQuestions: metricDraftQuestions
        .map(function (q) { return { question: (q.question || '').trim(), answerGuidance: (q.answerGuidance || '').trim() }; })
        .filter(function (q) { return q.question && q.answerGuidance; }),
    };
    var firstInvalid = validateMetricDraft(draft);
    if (firstInvalid) {
      showBanner(metricDialogBanner, 'Bitte die markierten Felder korrigieren.', 'error');
      firstInvalid.focus();
      return;
    }
    if (!draft.owner) delete draft.owner;
    if (!draft.datasource) delete draft.datasource;
    if (!draft.interpretation) delete draft.interpretation;
    if (metricEditIndex >= 0) metricsState.metrics[metricEditIndex] = draft; else metricsState.metrics.push(draft);
    metricsChanged();
    renderMetrics();
    metricDialog.close();
  });

  document.getElementById('save-metrics').addEventListener('click', function () {
    showBanner(metricsBanner, '', 'ok');
    adminFetch('/metrics', jsonRequest('PUT', metricsState.metrics))
      .then(function (res) { return res.json().then(function (data) { return { res: res, data: data }; }); })
      .then(function (result) {
        if (!result.res.ok) {
          showBanner(metricsBanner, errorText(result.data, 'Speichern fehlgeschlagen'), 'error');
          return;
        }
        showBanner(metricsBanner, 'Gespeichert.', 'ok');
        return loadMetrics();
      })
      .catch(function () { /* adminFetch hat bei 401 schon reagiert */ });
  });

  document.getElementById('reset-metrics').addEventListener('click', function () {
    if (!confirm('Alle Kennzahlen löschen?')) return;
    adminFetch('/metrics', { method: 'DELETE' })
      .then(function (res) {
        if (!res.ok) {
          showBanner(metricsBanner, 'Zurücksetzen fehlgeschlagen.', 'error');
          return;
        }
        showBanner(metricsBanner, 'Katalog gelöscht.', 'ok');
        return loadMetrics();
      })
      .catch(function () { /* adminFetch hat bei 401 schon reagiert */ });
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
  // Extension gerade gar nicht aus (Dev ohne OVP_SERVE_STATIC_DIR), würde das
  // Manifest ins Leere zeigen — im Dev gehört openvizpilot.dev.trex (Vite)
  // nach Tableau Desktop.
  fetch('/', { method: 'HEAD' })
    .then(function (res) {
      if (res.status === 404) {
        showBanner(
          trexBanner,
          'Achtung: Dieser Server liefert die Extension aktuell NICHT aus (OVP_SERVE_STATIC_DIR nicht gesetzt) — ' +
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
    ['setup-password', 'setup-confirm', 'login-password', 'token-input', 'user-login-name', 'user-login-password'].forEach(function (id) { document.getElementById(id).value = ''; });
    showBanner(gateError, '', 'error');
    showApp();
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

  // ---------- Gate: Benutzerkonto mit Admin-Rolle (lokal / SSO) ----------

  /** Benutzer-Token gegen /me prüfen — ohne Admin-Rolle bleibt das Token draußen (lokale Sitzung wird beendet). */
  function enterAsUser(token, provider) {
    return fetch('/api/admin/me', { headers: { authorization: 'Bearer ' + token } })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (data) { return { res: res, data: data }; }); })
      .then(function (result) {
        if (result.res.ok) { enterApp(token); return; }
        if (provider === 'local') {
          fetch('/api/auth/logout', { method: 'POST', headers: { authorization: 'Bearer ' + token } }).catch(function () { /* Sitzung läuft sonst ab */ });
        }
        showBanner(gateError, result.data.code === 'not_admin' ? 'Dieses Konto hat keine Admin-Rolle.' : (result.data.error || 'Anmeldung fehlgeschlagen.'), 'error');
      });
  }

  document.getElementById('gate-user-login').addEventListener('submit', function (event) {
    event.preventDefault();
    var button = document.getElementById('user-login-submit');
    if (button.disabled) return;
    var username = document.getElementById('user-login-name').value.trim();
    var password = document.getElementById('user-login-password').value;
    if (!username || !password) return;
    button.disabled = true;
    fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: username, password: password }) })
      .then(function (res) { return res.json().then(function (data) { return { res: res, data: data }; }); })
      .then(function (result) {
        if (!result.res.ok) {
          showBanner(gateError, result.data.error || 'Anmeldung fehlgeschlagen.', 'error');
          return;
        }
        return enterAsUser(result.data.token, 'local');
      })
      .catch(function () { showBanner(gateError, 'Server nicht erreichbar.', 'error'); })
      .finally(function () { button.disabled = false; });
  });

  // PKCE (S256) im Browser, Popup auf den Authorization-Endpoint, Rückkehr über
  // /auth/callback (postMessage an den Opener), Code-Tausch über den BFF —
  // dasselbe Muster wie der Extension-Login (ee/extension/src/oidc-login.ts).
  function base64url(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).split('+').join('-').split('/').join('_').replace(/=+$/, '');
  }
  function randomString(bytes) {
    var buf = new Uint8Array(bytes);
    crypto.getRandomValues(buf);
    return base64url(buf);
  }
  document.getElementById('sso-submit').addEventListener('click', function () {
    var button = document.getElementById('sso-submit');
    if (button.disabled || !ssoConfig) return;
    if (!window.crypto || !crypto.subtle) {
      showBanner(gateError, 'Single Sign-On braucht einen sicheren Kontext (HTTPS).', 'error');
      return;
    }
    var verifier = randomString(48);
    var state = randomString(24);
    var expectedOrigin = new URL(ssoConfig.redirectUri).origin;
    button.disabled = true;
    showBanner(gateError, '', 'error');
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)).then(function (digest) {
      var url = new URL(ssoConfig.authorizationEndpoint);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('client_id', ssoConfig.clientId);
      url.searchParams.set('redirect_uri', ssoConfig.redirectUri);
      url.searchParams.set('scope', ssoConfig.scopes || 'openid profile email');
      url.searchParams.set('state', state);
      url.searchParams.set('code_challenge', base64url(new Uint8Array(digest)));
      url.searchParams.set('code_challenge_method', 'S256');
      if (ssoConfig.provider === 'entra') url.searchParams.set('prompt', 'select_account');
      var popup = window.open(url.toString(), 'openvizpilot-admin-login', 'popup,width=520,height=680');
      if (!popup) throw new Error('Das Anmeldefenster wurde blockiert — bitte Popups für diese Seite erlauben.');
      return new Promise(function (resolve, reject) {
        var closedPoll = null;
        var timeout = null;
        function cleanup() { window.removeEventListener('message', onMessage); clearInterval(closedPoll); clearTimeout(timeout); }
        function onMessage(event) {
          if (event.origin !== expectedOrigin) return;
          var data = event.data;
          if (!data || data.type !== 'openvizpilot-oidc' || data.state !== state) return;
          cleanup();
          if (data.error || !data.code) reject(new Error(data.error === 'access_denied' ? 'Anmeldung abgebrochen.' : 'Anmeldung fehlgeschlagen.'));
          else resolve(data.code);
        }
        window.addEventListener('message', onMessage);
        closedPoll = setInterval(function () { if (popup.closed) { cleanup(); reject(new Error('Das Anmeldefenster wurde geschlossen.')); } }, 500);
        timeout = setTimeout(function () { cleanup(); reject(new Error('Zeitüberschreitung bei der Anmeldung.')); }, 5 * 60 * 1000);
      });
    }).then(function (code) {
      return fetch('/api/auth/exchange', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: code, codeVerifier: verifier, redirectUri: ssoConfig.redirectUri }),
      }).then(function (res) { return res.json().then(function (data) { return { res: res, data: data }; }); });
    }).then(function (result) {
      if (!result.res.ok) throw new Error(result.data.error || 'Anmeldung fehlgeschlagen.');
      return enterAsUser(result.data.token, 'oidc');
    }).catch(function (error) { showBanner(gateError, error.message || 'Anmeldung fehlgeschlagen.', 'error'); })
      .finally(function () { button.disabled = false; });
  });

  document.getElementById('logout').addEventListener('click', function () {
    // Delegierter Admin mit lokaler Sitzung: Sitzung serverseitig beenden; sonst Admin-Session.
    if (adminMe && adminMe.role === 'delegated') {
      if (adminMe.provider === 'local') fetch('/api/auth/logout', { method: 'POST', headers: { authorization: 'Bearer ' + getToken() } }).catch(function () { /* Sitzung läuft sonst ab */ });
    } else {
      adminFetch('/logout', { method: 'POST' }).catch(function () { /* Session ist ohnehin weg */ });
    }
    adminMe = null;
    clearToken();
    showGate();
  });

  if (getToken()) {
    showApp();
  } else {
    showGate();
  }
})();
</script>
</body>
</html>
`;
