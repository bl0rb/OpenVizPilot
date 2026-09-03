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
export const adminPageHtml = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>OpenVizPilot — Admin</title>
<style>
  :root {
    --accent: #1a699e;
    --bg: #f7f8fa;
    --surface: #ffffff;
    --border: #dde1e6;
    --text: #1b1f24;
    --text-muted: #5b6470;
    --danger: #b3261e;
    --danger-bg: #fdecea;
    --ok-bg: #eaf3ec;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 2rem 1.25rem 4rem;
    background: var(--bg);
    color: var(--text);
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  main { max-width: 960px; margin: 0 auto; }
  h1 { font-size: 1.3rem; margin: 0 0 0.25rem; }
  .subtitle { color: var(--text-muted); margin: 0 0 2rem; }
  h2 { font-size: 1.05rem; margin: 0 0 0.75rem; }
  section.card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 1.25rem 1.5rem;
    margin-bottom: 1.5rem;
  }
  .row { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
  input[type="text"], input[type="password"], textarea, select {
    font: inherit;
    color: inherit;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.4rem 0.55rem;
  }
  textarea { width: 100%; resize: vertical; min-height: 3.5rem; }
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
  button.primary:hover { opacity: 0.9; }
  button.danger { color: var(--danger); }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 0.75rem; }
  th, td { text-align: left; padding: 0.4rem 0.5rem; border-bottom: 1px solid var(--border); vertical-align: top; }
  th { color: var(--text-muted); font-weight: 600; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.02em; }
  td input[type="text"] { width: 100%; }
  .col-name { width: 12%; }
  .col-desc { width: 20%; }
  .col-hint { width: 12%; }
  .col-del { width: 2.5rem; text-align: center; }
  .hint { color: var(--text-muted); font-size: 0.85rem; margin: 0.25rem 0 1rem; }
  .banner { border-radius: 6px; padding: 0.6rem 0.8rem; margin-bottom: 1rem; font-size: 0.9rem; display: none; }
  .banner.error { display: block; background: var(--danger-bg); color: var(--danger); }
  .banner.ok { display: block; background: var(--ok-bg); color: #1e5631; }
  .hint.error { color: var(--danger); font-weight: 600; }
  .stats-grid { display: flex; flex-wrap: wrap; gap: 1.25rem; }
  .stats-block { min-width: 220px; flex: 1 1 220px; }
  .stats-block h3 { font-size: 0.85rem; margin: 0 0 0.4rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.02em; }
  .stats-block table td:last-child, .stats-block table th:last-child { text-align: right; }
  .total-turns { font-size: 1.6rem; font-weight: 600; color: var(--accent); }
  .stats-heading { font-size: 0.85rem; margin: 1rem 0 0.25rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.02em; }
  th.num, td.num { text-align: right; }
  #gate { max-width: 360px; margin: 4rem auto; text-align: center; }
  #gate .row { justify-content: center; margin-top: 0.75rem; }
  #app { display: none; }
</style>
</head>
<body>
<main>
  <div id="gate">
    <h1>OpenVizPilot — Admin</h1>

    <div id="gate-token" hidden>
      <p class="subtitle">Bitte den Admin-Token eingeben.</p>
      <div class="row">
        <input type="password" id="token-input" placeholder="Admin-Token" autocomplete="off" />
        <button class="primary" id="token-submit">Anmelden</button>
      </div>
    </div>

    <div id="gate-setup" hidden>
      <p class="subtitle">Ersteinrichtung: Lege jetzt das Admin-Passwort fest (mindestens 12 Zeichen).</p>
      <div class="row">
        <input type="password" id="setup-password" placeholder="Neues Admin-Passwort" autocomplete="new-password" />
      </div>
      <div class="row">
        <input type="password" id="setup-confirm" placeholder="Passwort wiederholen" autocomplete="new-password" />
        <button class="primary" id="setup-submit">Admin anlegen</button>
      </div>
    </div>

    <div id="gate-login" hidden>
      <p class="subtitle">Bitte mit dem Admin-Passwort anmelden.</p>
      <div class="row">
        <input type="password" id="login-password" placeholder="Admin-Passwort" autocomplete="current-password" />
        <button class="primary" id="login-submit">Anmelden</button>
      </div>
    </div>

    <p id="gate-error" class="banner error"></p>
    <div class="row"><button id="gate-retry" hidden>Erneut versuchen</button></div>
  </div>

  <div id="app">
    <div class="row" style="justify-content: space-between; align-items: baseline;">
      <h1>OpenVizPilot — Admin</h1>
      <button id="logout">Abmelden</button>
    </div>
    <p class="subtitle">Slash-Befehle zentral verwalten und anonyme Nutzung einsehen.</p>

    <section class="card">
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

    <section class="card">
      <h2>Anmeldung, Single Sign-On &amp; Lizenz</h2>
      <p class="hint">
        Wer die Extension (und damit die Middleware) nutzen darf. <strong>Benutzerkonten</strong> (Open Core):
        Anwender melden sich in der Extension mit Konten aus dem Abschnitt unten an.
        <strong>Single Sign-On</strong> (Enterprise): Anmeldung mit dem Firmenkonto über Microsoft Entra ID oder
        Keycloak — braucht einen gültigen Lizenzschlüssel. Einstellungen hier überschreiben die Env-Defaults
        (AUTH_MODE, OIDC_*, OVP_LICENSE) sofort für alle Replicas.
      </p>
      <p id="auth-source" class="hint"></p>
      <p id="auth-banner" class="banner"></p>
      <div class="row">
        <label>Anmeldemodus
          <select id="auth-mode">
            <option value="none">Offen (nur Netzwerkschutz)</option>
            <option value="local">Benutzerkonten (Open Core)</option>
            <option value="oidc">Single Sign-On per OIDC (Enterprise)</option>
          </select>
        </label>
        <label style="flex: 1 1 320px;">Öffentliche URL der Middleware (für die SSO-Redirect-URI)
          <input type="text" id="auth-public-url" placeholder="https://chat.example.com" autocomplete="off" />
        </label>
      </div>
      <div id="oidc-fields">
        <div class="row">
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
        <div class="row">
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
      <label>Enterprise-Lizenzschlüssel
        <textarea id="license-token" rows="3" placeholder="Signierter Lizenz-Token (leer lassen = unverändert)" spellcheck="false"></textarea>
      </label>
      <p id="license-summary" class="hint">Lade …</p>
      <div class="row">
        <button class="primary" id="save-auth">Prüfen &amp; speichern</button>
        <button id="remove-license">Lizenz entfernen</button>
        <button class="danger" id="reset-auth">Auf Env-Defaults zurücksetzen</button>
      </div>
    </section>

    <section class="card">
      <h2>Benutzerkonten (Open Core)</h2>
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
      <div class="row">
        <input type="text" id="new-username" placeholder="Benutzername" autocomplete="off" />
        <input type="text" id="new-display-name" placeholder="Anzeigename (optional)" autocomplete="off" />
        <input type="password" id="new-password" placeholder="Passwort (min. 10 Zeichen)" autocomplete="new-password" />
        <button class="primary" id="create-user">Benutzer anlegen</button>
      </div>
    </section>

    <section class="card">
      <h2>Playbooks pro Dashboard</h2>
      <p class="hint">
        Eigene Starter-Fragen (max. 5) und Slash-Befehle je Dashboard. Die Extension lädt das Playbook
        für das geöffnete Dashboard: Starter erscheinen vor den generischen Vorschlägen, Dashboard-Befehle
        überlagern gleichnamige globale. Schlüssel ist der Dashboard-Name, wie er in Tableau heißt.
      </p>
      <p id="playbooks-banner" class="banner"></p>
      <div class="row" style="margin-bottom: 0.75rem;">
        <label for="playbook-key">Dashboard:</label>
        <input type="text" id="playbook-key" list="playbook-keys" style="flex: 1 1 260px;" placeholder="Dashboard-Name (exakt wie in Tableau)" autocomplete="off" />
        <datalist id="playbook-keys"></datalist>
        <button id="playbook-load">Laden</button>
      </div>
      <div id="playbook-list" class="row" style="margin-bottom: 0.75rem;"></div>
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
        <button class="primary" id="playbook-save">Playbook speichern</button>
        <button class="danger" id="playbook-delete">Playbook löschen</button>
      </div>
    </section>

    <section class="card">
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

    <section class="card">
      <h2>Extension für Tableau</h2>
      <p class="hint">
        Lädt das Manifest (.trex) mit der eingetragenen Extension-URL herunter — die Adresse, unter der
        diese Middleware die Extension ausliefert (HTTPS-Pflicht auf Tableau Server; die Extension
        verbindet sich dann automatisch mit demselben Host). Anschließend die URL in die
        Server-Safelist eintragen und das Manifest im Dashboard auswählen.
      </p>
      <p id="trex-banner" class="banner"></p>
      <div class="row">
        <input type="text" id="trex-url" style="flex: 1 1 320px;" placeholder="https://chat.example.com/" autocomplete="off" />
        <button class="primary" id="trex-download">Manifest (.trex) herunterladen</button>
      </div>
    </section>

    <section class="card">
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
</main>

<script>
(function () {
  'use strict';

  var STORAGE_KEY = 'openvizpilotAdminToken';
  var gate = document.getElementById('gate');
  var app = document.getElementById('app');
  var gateError = document.getElementById('gate-error');

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
  }

  function showGate(message) {
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
  }

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
    delBtn.title = 'Zeile löschen';
    delBtn.textContent = '✕';
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
    return 'Open-Core-Edition (keine Enterprise-Lizenz hinterlegt).';
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
    authPublicUrl.value = eff.publicUrl || (data.envDefaults && data.envDefaults.publicUrl) || window.location.origin;
    authPublicUrl.placeholder = data.envDefaults && data.envDefaults.publicUrl ? 'Env: ' + data.envDefaults.publicUrl : 'https://chat.example.com';
    updateRedirectPreview();
    updateOidcVisibility();
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
      pw.textContent = 'Passwort';
      pw.addEventListener('click', function () {
        var next = window.prompt('Neues Passwort für ' + u.username + ' (min. 10 Zeichen):');
        if (!next) return;
        userAction('/users/' + encodeURIComponent(u.username) + '/password', jsonRequest('PUT', { password: next }), 'Passwort gesetzt — laufende Sitzungen beendet.');
      });
      var toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.textContent = u.disabled ? 'Entsperren' : 'Sperren';
      toggle.addEventListener('click', function () {
        userAction('/users/' + encodeURIComponent(u.username) + '/disabled', jsonRequest('PUT', { disabled: !u.disabled }), u.disabled ? 'Entsperrt.' : 'Gesperrt.');
      });
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'danger';
      del.textContent = 'Löschen';
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

  document.getElementById('create-user').addEventListener('click', function () {
    var username = document.getElementById('new-username').value.trim();
    var displayName = document.getElementById('new-display-name').value.trim();
    var password = document.getElementById('new-password').value;
    if (!username || !password) {
      showBanner(usersBanner, 'Benutzername und Passwort angeben.', 'error');
      return;
    }
    userAction('/users', jsonRequest('POST', { username: username, displayName: displayName, password: password }), 'Benutzer angelegt.')
      .then(function (ok) {
        if (!ok) return;
        document.getElementById('new-username').value = '';
        document.getElementById('new-display-name').value = '';
        document.getElementById('new-password').value = '';
      });
  });

  // ---------- Playbooks pro Dashboard ----------

  var playbookKey = document.getElementById('playbook-key');
  var playbookKeys = document.getElementById('playbook-keys');
  var playbookList = document.getElementById('playbook-list');
  var playbookStarters = document.getElementById('playbook-starters');
  var playbookCommandsBody = document.getElementById('playbook-commands-body');
  var playbooksBanner = document.getElementById('playbooks-banner');
  var knownPlaybooks = [];

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
    playbookStarters.value = entry ? entry.playbook.starters.join('\\n') : '';
    playbookCommandsBody.innerHTML = '';
    (entry ? entry.playbook.commands : []).forEach(function (cmd) { commandRowInto(playbookCommandsBody, cmd); });
  }

  function renderPlaybookList(entries, dashboardKeys) {
    knownPlaybooks = entries;
    playbookList.innerHTML = '';
    playbookKeys.innerHTML = '';
    // Object.create(null): Dashboard-Namen wie "__proto__" dürfen nicht im
    // Prototyp verschwinden.
    var keys = Object.create(null);
    entries.forEach(function (e) { keys[e.dashboardKey] = true; });
    (dashboardKeys || []).forEach(function (k) { keys[k] = true; });
    Object.keys(keys).sort().forEach(function (k) {
      var opt = document.createElement('option');
      opt.value = k;
      playbookKeys.appendChild(opt);
    });
    if (entries.length === 0) {
      var hint = document.createElement('span');
      hint.className = 'hint';
      hint.textContent = 'Noch keine Playbooks gespeichert.';
      playbookList.appendChild(hint);
      return;
    }
    var label = document.createElement('span');
    label.className = 'hint';
    label.textContent = 'Gespeichert:';
    playbookList.appendChild(label);
    entries.forEach(function (e) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = e.dashboardKey + ' (' + e.playbook.starters.length + ' Starter, ' + e.playbook.commands.length + ' Befehle)';
      btn.addEventListener('click', function () { showPlaybook(e); });
      playbookList.appendChild(btn);
    });
  }

  function loadPlaybooks() {
    return adminFetch('/playbooks')
      .then(function (res) { return res.json(); })
      .then(function (data) { renderPlaybookList(data.playbooks || [], knownDashboardKeys); })
      .catch(function () { /* adminFetch hat bei 401 schon reagiert */ });
  }

  document.getElementById('playbook-load').addEventListener('click', function () {
    var key = playbookKey.value.trim();
    var entry = knownPlaybooks.filter(function (e) { return e.dashboardKey === key; })[0];
    showPlaybook(entry || null);
    showBanner(playbooksBanner, entry ? 'Playbook geladen.' : 'Noch kein Playbook für dieses Dashboard — leeres Formular.', 'ok');
  });

  document.getElementById('playbook-add-command').addEventListener('click', function () {
    commandRowInto(playbookCommandsBody, { name: '', description: '', argHint: '', template: '' });
  });

  document.getElementById('playbook-save').addEventListener('click', function () {
    showBanner(playbooksBanner, '', 'ok');
    var key = playbookKey.value.trim();
    if (!key) {
      showBanner(playbooksBanner, 'Bitte den Dashboard-Namen eintragen.', 'error');
      return;
    }
    var starters = playbookStarters.value.split('\\n').map(function (l) { return l.trim(); }).filter(Boolean);
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
        showBanner(playbooksBanner, 'Playbook gespeichert — die Extension lädt es beim nächsten Start des Dashboards.', 'ok');
        return loadPlaybooks();
      })
      .catch(function () { /* adminFetch hat bei 401 schon reagiert */ });
  });

  document.getElementById('playbook-delete').addEventListener('click', function () {
    var key = playbookKey.value.trim();
    if (!key || !confirm('Playbook für „' + key + '“ löschen?')) return;
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
      td.appendChild(field);
      tr.appendChild(td);
    });
    var delTd = document.createElement('td');
    delTd.className = 'col-del';
    var delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.title = 'Zeile löschen';
    delBtn.textContent = '✕';
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
    renderPlaybookList(knownPlaybooks, knownDashboardKeys);
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

  document.getElementById('setup-submit').addEventListener('click', function () {
    var password = document.getElementById('setup-password').value;
    var confirm = document.getElementById('setup-confirm').value;
    if (!password) return;
    if (password !== confirm) {
      showBanner(gateError, 'Die Passwörter stimmen nicht überein.', 'error');
      return;
    }
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
      .catch(function () { showBanner(gateError, 'Server nicht erreichbar.', 'error'); });
  });
  document.getElementById('setup-confirm').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') document.getElementById('setup-submit').click();
  });

  document.getElementById('login-submit').addEventListener('click', function () {
    var password = document.getElementById('login-password').value;
    if (!password) return;
    authPost('/login', password)
      .then(function (result) {
        if (!result.res.ok) {
          showBanner(gateError, result.data.error || 'Anmeldung fehlgeschlagen.', 'error');
          return;
        }
        enterApp(result.data.token);
      })
      .catch(function () { showBanner(gateError, 'Server nicht erreichbar.', 'error'); });
  });
  document.getElementById('login-password').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') document.getElementById('login-submit').click();
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
