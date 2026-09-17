import { TABLEAU_MIN_SERVER_VERSION, TABLEAU_REST_API_VERSION } from './config';

export const tableauAdminStyles = `
  #tableau-server-admin { border: 0; padding-top: 1.5rem; }
  #tableau-server-admin .tableau-server-panel { max-width: 900px; }
  #tableau-server-controls { border: 0; padding: 0; margin: 0; min-width: 0; }
  #tableau-server-admin h3 { font-size: 0.95rem; margin: 1.25rem 0 0.5rem; }
  #tableau-server-admin .tableau-server-status { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; margin: 0.5rem 0 1.25rem; color: var(--text-muted); font-size: 12px; }
  #tableau-server-admin .tableau-server-status span { overflow-wrap: anywhere; }
  #tableau-server-admin .tableau-server-status strong { color: var(--text); font-weight: 600; }
  #tableau-server-admin .tableau-server-auth { display: flex; align-items: center; min-height: 38px; font-weight: 400; padding: 0.4rem 0.55rem; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text-muted); }
  #tableau-server-admin .tableau-server-toggle { grid-column: 1 / -1; display: flex; align-items: center; gap: 0.55rem; cursor: pointer; }
  #tableau-server-admin .tableau-server-toggle input { flex: 0 0 auto; }
  #tableau-server-admin .tableau-server-toggle span { flex: 1; }
  #tableau-server-admin .tableau-server-custom { margin-top: -0.25rem; }
  #tableau-server-admin .tableau-server-actions { align-items: center; }
  #tableau-server-admin .tableau-server-actions .hint { margin: 0; }
  #tableau-server-admin .tableau-server-inline-field { display: flex; gap: 0.4rem; }
  #tableau-server-admin .tableau-server-inline-field input { flex: 1; min-width: 0; }
  #tableau-server-admin input[readonly] { background: var(--bg); color: var(--text-muted); }
  #tableau-server-admin details { border: 1px solid var(--border); border-radius: 6px; padding: 0.6rem 0.75rem; margin-top: 0.75rem; }
  #tableau-server-admin details summary { cursor: pointer; font-weight: 600; }
  #tableau-server-admin details ol { margin: 0.5rem 0 0; padding-left: 1.25rem; }
  #tableau-server-admin details li { margin: 0.3rem 0; }
  #tableau-server-admin details .hint { margin: 0.5rem 0 0; }
  #tableau-server-admin .tableau-server-site { border: 1px solid var(--border); border-radius: 6px; background: var(--surface); padding: 0.85rem; margin: 0.6rem 0; }
  #tableau-server-admin .tableau-server-site summary { cursor: pointer; font-weight: 600; overflow-wrap: anywhere; }
  #tableau-server-admin .tableau-server-site-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr)); gap: 0.75rem; margin: 0.75rem 0; }
  #tableau-server-admin .tableau-server-site-fields label { display: grid; gap: 0.2rem; min-width: 0; font-size: 13px; font-weight: 500; }
  #tableau-server-admin .tableau-server-site-fields input, #tableau-server-admin .tableau-server-site-fields select { width: 100%; min-width: 0; }
  #tableau-server-admin .tableau-server-site-secret { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin: 0.5rem 0; font-size: 13px; }
  #tableau-server-admin .tableau-server-site-result { margin: 0.5rem 0 0; font-size: 12px; }
  #tableau-server-admin .tableau-server-site-result .ok { color: var(--success, #18794e); }
  #tableau-server-admin .tableau-server-site-result .error { color: var(--danger, #b42318); }
  #tableau-server-admin table { width: 100%; border-collapse: collapse; margin: 0.5rem 0; }
  #tableau-server-admin table th, #tableau-server-admin table td { text-align: left; padding: 0.35rem 0.5rem; border-bottom: 1px solid var(--border); font-size: 13px; }
  #tableau-server-admin table select { width: 100%; min-width: 160px; }
`;

export const tableauAdminSection = `
    <section id="tableau-server-admin" aria-labelledby="tableau-server-heading" hidden>
      <div class="row" style="justify-content:space-between">
        <h2 id="tableau-server-heading">Tableau Server <small>Enterprise</small></h2>
        <button id="tableau-server-reload" type="button">Aktualisieren</button>
      </div>
      <p id="tableau-server-banner" class="banner" role="status" aria-live="polite"></p>
      <div class="tableau-server-panel">
        <div class="tableau-server-status" aria-label="Tableau-Server-Status">
          <span id="tableau-server-license-status"></span>
          <span id="tableau-server-oidc-status"></span>
          <span id="tableau-server-secretkey-status"></span>
        </div>
        <fieldset id="tableau-server-controls" disabled>
          <div class="form-grid">
            <label class="tableau-server-toggle" for="tableau-server-enabled">
              <input id="tableau-server-enabled" type="checkbox" role="switch" />
              <span>Tableau Server-Integration aktiviert</span>
            </label>
            <label for="tableau-server-url" class="has-help"><span class="help-term">Server-URL</span><span role="tooltip" id="help-tableau-url" class="help-tip">HTTPS-Origin ohne Pfad, z. B. <code>https://tableau.example.com</code>. Gilt für alle Sites.</span>
              <input id="tableau-server-url" type="url" autocomplete="off" placeholder="https://tableau.example.com" aria-describedby="help-tableau-url" />
            </label>
            <label for="tableau-server-username-claim" class="has-help"><span class="help-term">Username-Claim</span><span role="tooltip" id="help-tableau-username-claim" class="help-tip">Muss dem Tableau-Benutzernamen entsprechen (Tableau Cloud: der E-Mail-Adresse). Gilt für alle Sites.</span>
              <select id="tableau-server-username-claim" aria-describedby="help-tableau-username-claim">
                <option value="email">email</option>
                <option value="preferred_username">preferred_username</option>
                <option value="upn">upn</option>
                <option value="custom">Benutzerdefiniert</option>
              </select>
            </label>
            <label id="tableau-server-custom-claim-field" class="tableau-server-custom" for="tableau-server-custom-claim">Benutzerdefinierter Username-Claim
              <input id="tableau-server-custom-claim" type="text" autocomplete="off" />
            </label>
            <div class="form-field"><span>Tableau-Mindestversion</span><span class="tableau-server-auth">${TABLEAU_MIN_SERVER_VERSION} (REST API ${TABLEAU_REST_API_VERSION})</span></div>
          </div>

          <h3>Sites</h3>
          <p class="hint">Connected Apps sind pro Tableau-Site — für jede Site hier eine eigene Karte anlegen.</p>
          <div id="tableau-server-sites"></div>
          <button id="tableau-server-add-site" type="button">+ Site hinzufügen</button>

          <details id="tableau-server-eas-block">
            <summary>OAuth 2.0 Trust: Issuer URL / JWKS <small>gilt für alle Sites</small></summary>
            <div class="form-grid">
              <label for="tableau-server-eas-issuer" class="has-help help-left"><span class="help-term">Issuer URL</span><span role="tooltip" id="help-tableau-issuer" class="help-tip">In Tableau bei „New Connected App → OAuth 2.0 Trust“ je Site als Issuer URL eintragen. Muss per HTTPS erreichbar sein (OIDC-Metadaten unter <code>/.well-known/openid-configuration</code>; Tableau Server ab 2024.2 bzw. Tableau Cloud). Ändert sich die Public URL dieser Middleware, ändert sich auch die Issuer-URL — dann in Tableau je Site nachziehen.</span>
                <span class="tableau-server-inline-field">
                  <input id="tableau-server-eas-issuer" type="text" readonly aria-describedby="help-tableau-issuer" />
                  <button id="tableau-server-eas-issuer-copy" type="button" disabled>Kopieren</button>
                </span>
              </label>
              <label for="tableau-server-eas-jwks">JWKS-URL
                <input id="tableau-server-eas-jwks" type="text" readonly />
              </label>
              <label for="tableau-server-eas-kid">Key-ID
                <input id="tableau-server-eas-kid" type="text" readonly />
              </label>
              <p id="tableau-server-eas-warning" class="hint error" role="status" hidden>
                Für OAuth 2.0 Trust muss die Middleware unter einer HTTPS-Public-URL erreichbar sein. Im Abschnitt
                <a href="#auth-admin">Anmeldung, Single Sign-On &amp; Lizenz</a> eintragen.
              </p>
            </div>
          </details>

          <details id="tableau-server-setup-connected-app">
            <summary>Einrichtung Schritt für Schritt (Direct Trust)</summary>
            <ol>
              <li>Voraussetzung: Single Sign-On (OIDC) im Abschnitt <a href="#auth-admin">Anmeldung, Single Sign-On &amp; Lizenz</a> einrichten; Lizenz mit den Merkmalen <code>sso</code> und <code>tableauServer</code>.</li>
              <li>Je Site eine Connected App in Tableau: <em>Settings → Connected Apps → New Connected App → Direct Trust</em>. Name vergeben, Access level und Domain allowlist setzen (die Public URL dieser Middleware eintragen), <em>Enable connected app</em> aktivieren.</li>
              <li><em>Client ID</em> kopieren.</li>
              <li><em>Generate New Secret</em> klicken — Tableau zeigt <em>Secret ID</em> und <em>Secret Value</em> an.</li>
              <li>Secret Value entweder direkt in der Site-Karte speichern (verschlüsselt im Web, braucht <code>OVP_SECRET_KEY</code>) oder als Umgebungsvariable mit Präfix <code>OVP_TABLEAU_</code> bereitstellen; Secret-ID in der Site-Karte eintragen.</li>
              <li>Site (Name, Content-URL, Client-ID, Secret) anlegen bzw. ausfüllen, Integration aktivieren, speichern.</li>
              <li><strong>Konfiguration prüfen</strong> je Site ausführen.</li>
              <li><strong>Verbindung als Nutzer prüfen</strong> je Site ausführen.</li>
            </ol>
          </details>
          <details id="tableau-server-setup-oauth2-trust">
            <summary>Einrichtung Schritt für Schritt (OAuth 2.0 Trust)</summary>
            <ol>
              <li>Voraussetzung: Single Sign-On (OIDC) im Abschnitt <a href="#auth-admin">Anmeldung, Single Sign-On &amp; Lizenz</a> einrichten; Lizenz mit den Merkmalen <code>sso</code> und <code>tableauServer</code>.</li>
              <li>Diesen Modus für mindestens eine Site hier zuerst speichern — auch im deaktivierten Entwurf. Dabei erzeugt die Middleware einmalig den EAS-Schlüssel (gilt für alle Sites).</li>
              <li>Issuer URL oben kopieren.</li>
              <li>Je Site in Tableau: <em>Settings → Connected Apps → New Connected App → OAuth 2.0 Trust</em>. Name vergeben, Issuer URL einfügen, <em>Enable connected app</em> aktivieren.</li>
              <li>Die von Tableau angezeigte <em>Site ID</em> kopieren.</li>
              <li>Site-ID in der jeweiligen Site-Karte eintragen, speichern.</li>
              <li><strong>Konfiguration prüfen</strong> je Site ausführen.</li>
              <li><strong>Verbindung als Nutzer prüfen</strong> je Site ausführen.</li>
            </ol>
          </details>

          <h3>Dashboard-Zuordnung</h3>
          <p id="tableau-server-mapping-hint" class="hint"></p>
          <table id="tableau-server-mapping-table">
            <thead><tr><th scope="col">Dashboard</th><th scope="col">Site</th><th scope="col"></th></tr></thead>
            <tbody id="tableau-server-mapping-rows"></tbody>
          </table>
          <button id="tableau-server-add-mapping" type="button">+ Zuordnung</button>

          <div class="form-actions tableau-server-actions">
            <button id="tableau-server-save" class="primary" type="button">Speichern</button>
          </div>
        </fieldset>
        <div class="form-actions tableau-server-actions">
          <button id="tableau-server-reset" class="danger" type="button">Zurücksetzen</button>
        </div>
      </div>
    </section>
`;

export const tableauAdminScript = String.raw`
  var tableauServerState = { config: null, revision: null, licensed: false, oidcReady: false, eas: null, secretKeyConfigured: false };
  var tableauServerSites = [];
  var tableauServerMappings = [];
  var tableauServerDashboards = [];
  var tableauServerDirty = false;
  var tableauServerLoaded = false;
  var tableauServerTest = null;
  var tableauServerTestRevision = 0;
  var tableauServerBanner = document.getElementById('tableau-server-banner');
  var tableauServerControls = document.getElementById('tableau-server-controls');
  var tableauServerFields = {
    enabled: document.getElementById('tableau-server-enabled'),
    serverUrl: document.getElementById('tableau-server-url'),
    usernameClaim: document.getElementById('tableau-server-username-claim'),
    customClaim: document.getElementById('tableau-server-custom-claim')
  };

  function tableauServerElement(tag, text, parent) {
    var element = document.createElement(tag);
    if (text) element.textContent = text;
    if (parent) parent.appendChild(element);
    return element;
  }

  function tableauServerMessage(message, kind) {
    showBanner(tableauServerBanner, message || '', kind || '');
  }

  function tableauServerResult(response) {
    return response.json().then(function (data) {
      if (!response.ok) {
        var error = typeof data.error === 'string' ? data.error : 'Tableau-Server-Konfiguration konnte nicht verarbeitet werden.';
        var result = new Error(error);
        result.status = response.status;
        result.data = data;
        throw result;
      }
      return data;
    });
  }

  function tableauServerAbortTest() {
    tableauServerTestRevision += 1;
    if (!tableauServerTest) return;
    if (tableauServerTest.controller) tableauServerTest.controller.abort();
    if (tableauServerTest.popup && !tableauServerTest.popup.closed) tableauServerTest.popup.close();
    if (tableauServerTest.cleanup) tableauServerTest.cleanup('aborted');
    tableauServerTest = null;
  }

  function tableauServerRandom(bytes) {
    var value = new Uint8Array(bytes);
    crypto.getRandomValues(value);
    var binary = '';
    value.forEach(function (byte) { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function tableauServerPkceChallenge(verifier) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)).then(function (digest) {
      var bytes = new Uint8Array(digest);
      var binary = '';
      bytes.forEach(function (byte) { binary += String.fromCharCode(byte); });
      return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    });
  }

  function tableauServerAuthConfig(response) {
    return response.json().then(function (data) {
      if (!response.ok || !data || data.mode !== 'oidc' || typeof data.authorizationEndpoint !== 'string' || typeof data.clientId !== 'string' || typeof data.redirectUri !== 'string') {
        throw new Error('OIDC-Anmeldung nicht verfügbar.');
      }
      return data;
    });
  }

  function tableauServerConnectionSucceeded(data) {
    var checks = Array.isArray(data.checks) ? data.checks : [];
    return data.ok === true && data.stage === 'connection' && checks.length > 0 && checks.every(function (check) { return check && check.ok === true; });
  }

  function tableauServerRenderConnectionResult(resultEl, data) {
    var success = tableauServerConnectionSucceeded(data);
    resultEl.textContent = '';
    resultEl.hidden = false;
    var heading = document.createElement('strong');
    heading.textContent = success ? 'Verbindung erfolgreich.' : 'Verbindung fehlgeschlagen.';
    heading.className = success ? 'ok' : 'error';
    resultEl.appendChild(heading);
    if (data.serverVersion || data.apiVersion) {
      var version = document.createElement('span');
      version.textContent = ' ' + [data.serverVersion ? 'Tableau ' + data.serverVersion : '', data.apiVersion ? 'API ' + data.apiVersion : ''].filter(Boolean).join(' · ');
      resultEl.appendChild(version);
    }
    if (Array.isArray(data.checks) && data.checks.length) {
      var list = document.createElement('ul');
      data.checks.forEach(function (check) {
        var item = document.createElement('li');
        item.textContent = String(check.resource || 'Prüfung') + ': ' + (check.ok ? 'OK' : 'fehlgeschlagen') + (check.code ? ' (' + String(check.code) + ')' : '');
        item.className = check.ok ? 'ok' : 'error';
        list.appendChild(item);
      });
      resultEl.appendChild(list);
    }
  }

  /** Persönliche Verbindungsprüfung (PKCE-Popup) für eine bestimmte Site — je Site-Karte ein Button. */
  function tableauServerRunConnectionTest(siteId, button, resultEl) {
    if (button.disabled || tableauServerDirty || !tableauServerLoaded || !tableauServerState.config || !tableauServerState.config.enabled || !tableauServerState.licensed || !tableauServerState.oidcReady) return;
    tableauServerAbortTest();
    var revision = tableauServerTestRevision;
    var controller = new AbortController();
    var popup = window.open('about:blank', 'openvizpilot-tableau-login', 'popup,width=520,height=680');
    if (!popup) {
      tableauServerMessage('Das Anmeldefenster konnte nicht geöffnet werden. Bitte Popups für diese Seite erlauben.', 'error');
      return;
    }
    button.disabled = true;
    tableauServerMessage('Persönliche Anmeldung wird geöffnet …', '');
    resultEl.textContent = '';
    resultEl.hidden = true;
    var rejectMessage;
    var messageSettled = false;
    var flowTimedOut = false;
    var detachCallback = function () {
      window.removeEventListener('message', onMessage);
      clearInterval(closedPoll);
    };
    var cleanup = function (reason) {
      detachCallback();
      clearTimeout(flowTimeout);
      if (reason && !messageSettled && rejectMessage) {
        messageSettled = true;
        rejectMessage(new Error(reason));
      }
      rejectMessage = null;
    };
    var closedPoll = 0;
    var flowTimeout = 0;
    var onMessage;
    tableauServerTest = { controller: controller, popup: popup, cleanup: cleanup };
    var verifier = tableauServerRandom(48);
    var state = tableauServerRandom(24);
    var expectedOrigin = window.location.origin;
    var redirectUri;
    var messagePromise = new Promise(function (resolve, reject) {
      rejectMessage = reject;
      onMessage = function (event) {
        if (event.origin !== expectedOrigin || event.source !== popup) return;
        var data = event.data || {};
        if (data.type !== 'openvizpilot-oidc' || data.state !== state) return;
        detachCallback();
        messageSettled = true;
        if (data.error || !data.code) { reject(new Error('Anmeldung abgebrochen.')); return; }
        resolve(data.code);
      };
      window.addEventListener('message', onMessage);
      closedPoll = window.setInterval(function () {
        if (popup.closed) {
          cleanup('Anmeldefenster geschlossen.');
          tableauServerMessage('Anmeldefenster geschlossen.', 'error');
          controller.abort();
        }
      }, 500);
      flowTimeout = window.setTimeout(function () {
        flowTimedOut = true;
        cleanup('Zeitüberschreitung bei der Anmeldung.');
        controller.abort();
      }, 5 * 60 * 1000);
    });
    // The popup can close before auth/config resolves and attaches the consumer.
    messagePromise.catch(function () {});
    fetch('/api/auth/config', { signal: controller.signal }).then(tableauServerAuthConfig).then(function (auth) {
      if (revision !== tableauServerTestRevision) throw new Error('aborted');
      redirectUri = auth.redirectUri;
      return tableauServerPkceChallenge(verifier).then(function (challenge) {
        var url = new URL(auth.authorizationEndpoint);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('client_id', auth.clientId);
        url.searchParams.set('redirect_uri', auth.redirectUri);
        url.searchParams.set('scope', auth.scopes || 'openid profile email');
        url.searchParams.set('code_challenge', challenge);
        url.searchParams.set('code_challenge_method', 'S256');
        url.searchParams.set('state', state);
        popup.location.href = url.toString();
        return messagePromise;
      });
    }).then(function (code) {
      if (revision !== tableauServerTestRevision) throw new Error('aborted');
      tableauServerMessage('Verbindung wird geprüft …', '');
      return fetch('/api/auth/exchange', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: code, codeVerifier: verifier, redirectUri: redirectUri }), signal: controller.signal });
    }).then(tableauServerResult).then(function (auth) {
      if (revision !== tableauServerTestRevision) throw new Error('aborted');
      var idToken = auth.token;
      if (typeof idToken !== 'string' || !idToken) throw new Error('Anmeldung fehlgeschlagen.');
      return fetch('/api/tableau-server/check', { method: 'POST', headers: { authorization: 'Bearer ' + idToken, 'content-type': 'application/json' }, body: JSON.stringify({ siteId: siteId }), signal: controller.signal }).then(tableauServerResult);
    }).then(function (data) {
      if (revision !== tableauServerTestRevision) return;
      tableauServerRenderConnectionResult(resultEl, data);
      tableauServerMessage(tableauServerConnectionSucceeded(data) ? 'Persönliche Verbindung geprüft.' : 'Die Verbindung konnte nicht bestätigt werden.', tableauServerConnectionSucceeded(data) ? 'ok' : 'error');
    }).catch(function (error) {
      if (revision !== tableauServerTestRevision || error.message === 'aborted') return;
      if (flowTimedOut) tableauServerMessage('Zeitüberschreitung bei der Anmeldung.', 'error');
      else if (error.name !== 'AbortError') tableauServerMessage(error.message === 'Anmeldung abgebrochen.' || error.message === 'Anmeldefenster geschlossen.' ? error.message : 'Persönliche Verbindung konnte nicht geprüft werden.', 'error');
    }).finally(function () {
      if (revision !== tableauServerTestRevision) return;
      cleanup('aborted');
      if (popup && !popup.closed) popup.close();
      tableauServerTest = null;
      button.disabled = false;
    });
  }

  function tableauServerChanged() {
    tableauServerAbortTest();
    tableauServerDirty = true;
    tableauServerMessage('Ungespeicherte Änderungen.', '');
  }

  function tableauServerNewSiteId() {
    var index = 1;
    while (tableauServerSites.some(function (site) { return site.id === 's' + index; })) index++;
    return 's' + index;
  }

  function tableauServerSiteLabel(site) {
    return site.name || site.id;
  }

  function tableauServerSecretStatusText(site) {
    if (site.secretAction === 'clear') return 'wird beim Speichern entfernt';
    if (site.secretAction === 'replace') return 'wird beim Speichern ersetzt';
    if (site.secretConfigured === 'db') return 'gespeichert (im Web, verschlüsselt)';
    if (site.secretConfigured === 'env') return 'aus Umgebungsvariable ' + (site.secretEnv || '');
    return 'nicht gesetzt';
  }

  function renderTableauSiteCard(site) {
    var entry = tableauServerElement('details', '', document.getElementById('tableau-server-sites'));
    entry.className = 'tableau-server-site';
    entry.open = true;
    var summary = tableauServerElement('summary', tableauServerSiteLabel(site), entry);
    var fields = tableauServerElement('div', '', entry);
    fields.className = 'tableau-server-site-fields';

    function field(labelText, value, onChange, type) {
      var label = tableauServerElement('label', labelText, fields);
      var input = tableauServerElement('input', '', label);
      input.type = type || 'text';
      input.autocomplete = 'off';
      input.value = value || '';
      input.addEventListener('input', function () { onChange(input.value); tableauServerChanged(); });
      return input;
    }

    field('Name *', site.name, function (value) { site.name = value; summary.textContent = tableauServerSiteLabel(site); });
    field('Content-URL (leer = Standard-Site)', site.contentUrl, function (value) { site.contentUrl = value.trim(); });

    var modeLabel = tableauServerElement('label', 'Authentifizierung', fields);
    var modeSelect = tableauServerElement('select', '', modeLabel);
    [['connected-app', 'Connected App – Direct Trust (Client-ID, Secret)'], ['oauth2-trust', 'Connected App – OAuth 2.0 Trust (Site-ID)']].forEach(function (pair) {
      var option = tableauServerElement('option', pair[1], modeSelect);
      option.value = pair[0];
    });
    modeSelect.value = site.authMode;
    modeSelect.addEventListener('change', function () { site.authMode = modeSelect.value; tableauServerChanged(); renderTableauSites(); });

    var connectedAppFields = tableauServerElement('div', '', fields);
    connectedAppFields.style.display = 'contents';
    var clientIdInput, secretIdInput, secretEnvInput;
    var oauth2Fields = tableauServerElement('div', '', fields);
    oauth2Fields.style.display = 'contents';
    var siteIdInput;

    if (site.authMode === 'oauth2-trust') {
      siteIdInput = tableauServerElement('input', '', tableauServerElement('label', 'Site-ID (Site-LUID aus Tableau)', oauth2Fields));
      siteIdInput.type = 'text';
      siteIdInput.autocomplete = 'off';
      siteIdInput.value = site.siteId || '';
      siteIdInput.addEventListener('input', function () { site.siteId = siteIdInput.value.trim(); tableauServerChanged(); });
    } else {
      clientIdInput = tableauServerElement('input', '', tableauServerElement('label', 'Client-ID', connectedAppFields));
      clientIdInput.type = 'text';
      clientIdInput.autocomplete = 'off';
      clientIdInput.value = site.clientId || '';
      clientIdInput.addEventListener('input', function () { site.clientId = clientIdInput.value.trim(); tableauServerChanged(); });

      secretIdInput = tableauServerElement('input', '', tableauServerElement('label', 'Secret-ID', connectedAppFields));
      secretIdInput.type = 'text';
      secretIdInput.autocomplete = 'off';
      secretIdInput.value = site.secretId || '';
      secretIdInput.addEventListener('input', function () { site.secretId = secretIdInput.value.trim(); tableauServerChanged(); });

      secretEnvInput = tableauServerElement('input', '', tableauServerElement('label', 'Secret-Env-Referenz (optional, OVP_TABLEAU_...)', connectedAppFields));
      secretEnvInput.type = 'text';
      secretEnvInput.autocomplete = 'off';
      secretEnvInput.placeholder = 'OVP_TABLEAU_CONNECTED_APP_SECRET';
      secretEnvInput.value = site.secretEnv || '';
      secretEnvInput.addEventListener('input', function () { site.secretEnv = secretEnvInput.value.trim(); tableauServerChanged(); });

      var secretRow = tableauServerElement('div', '', entry);
      secretRow.className = 'tableau-server-site-secret';
      var secretStatus = tableauServerElement('span', 'Secret: ' + tableauServerSecretStatusText(site), secretRow);
      if (!tableauServerState.secretKeyConfigured) {
        var keyHint = tableauServerElement('span', 'OVP_SECRET_KEY setzen, um Secrets zu speichern.', secretRow);
        keyHint.className = 'hint';
      } else if (site.secretAction === 'replace') {
        var secretInput = tableauServerElement('input', '', secretRow);
        secretInput.type = 'password';
        secretInput.autocomplete = 'off';
        secretInput.placeholder = 'Secret Value';
        secretInput.value = site.secretValue || '';
        secretInput.addEventListener('input', function () { site.secretValue = secretInput.value; tableauServerChanged(); });
        var cancelReplace = tableauServerElement('button', 'Abbrechen', secretRow);
        cancelReplace.type = 'button';
        cancelReplace.addEventListener('click', function () { site.secretAction = null; site.secretValue = ''; renderTableauSites(); });
      } else {
        var replaceButton = tableauServerElement('button', 'Ersetzen', secretRow);
        replaceButton.type = 'button';
        replaceButton.disabled = !tableauServerState.secretKeyConfigured;
        replaceButton.addEventListener('click', function () { site.secretAction = 'replace'; site.secretValue = ''; tableauServerChanged(); renderTableauSites(); });
        if (site.secretConfigured === 'db' || site.secretAction === 'clear') {
          var clearButton = tableauServerElement('button', site.secretAction === 'clear' ? 'Entfernen rückgängig' : 'Entfernen', secretRow);
          clearButton.type = 'button';
          clearButton.className = site.secretAction === 'clear' ? '' : 'danger';
          clearButton.addEventListener('click', function () { site.secretAction = site.secretAction === 'clear' ? null : 'clear'; tableauServerChanged(); renderTableauSites(); });
        }
      }
    }

    var actions = tableauServerElement('div', '', entry);
    actions.className = 'row';
    var checkButton = tableauServerElement('button', 'Konfiguration prüfen', actions);
    checkButton.type = 'button';
    var testButton = tableauServerElement('button', 'Verbindung als Nutzer prüfen', actions);
    testButton.type = 'button';
    testButton.disabled = tableauServerDirty || !tableauServerLoaded || !tableauServerState.config || !tableauServerState.config.enabled || !tableauServerState.licensed || !tableauServerState.oidcReady;
    var removeButton = tableauServerElement('button', 'Site entfernen', actions);
    removeButton.type = 'button';
    removeButton.className = 'danger';
    var resultEl = tableauServerElement('p', '', entry);
    resultEl.className = 'tableau-server-site-result';
    resultEl.setAttribute('role', 'status');
    resultEl.hidden = true;

    checkButton.addEventListener('click', function () {
      if (tableauServerDirty || !tableauServerState.config) {
        tableauServerMessage('Bitte zuerst eine gespeicherte Konfiguration anlegen oder die Änderungen speichern.', 'error');
        return;
      }
      checkButton.disabled = true;
      tableauServerMessage('Konfiguration wird geprüft …', '');
      adminFetch('/tableau-server/check', jsonRequest('POST', { siteId: site.id })).then(tableauServerResult)
        .then(function (data) { tableauServerMessage(data.ok && data.stage === 'configuration' ? 'Konfiguration und Secret-Referenz sind vorhanden.' : 'Konfiguration konnte nicht bestätigt werden.', data.ok ? 'ok' : 'error'); })
        .catch(function (error) { tableauServerMessage(error.message || 'Konfigurationsprüfung fehlgeschlagen.', 'error'); })
        .finally(function () { checkButton.disabled = false; });
    });
    testButton.addEventListener('click', function () { tableauServerRunConnectionTest(site.id, testButton, resultEl); });
    removeButton.addEventListener('click', function () {
      if (!confirm('Site "' + tableauServerSiteLabel(site) + '" entfernen?')) return;
      tableauServerSites = tableauServerSites.filter(function (item) { return item !== site; });
      tableauServerMappings = tableauServerMappings.filter(function (mapping) { return mapping.siteId !== site.id; });
      tableauServerChanged();
      renderTableauServer();
    });
  }

  function renderTableauSites() {
    var root = document.getElementById('tableau-server-sites');
    root.replaceChildren();
    if (!tableauServerSites.length) tableauServerElement('p', 'Noch keine Site angelegt.', root).className = 'hint';
    tableauServerSites.forEach(renderTableauSiteCard);
  }

  function tableauServerDashboardLabel(dashboardKey) {
    var known = tableauServerDashboards.filter(function (d) { return d.dashboardKey === dashboardKey; })[0];
    return known ? known.name : dashboardKey;
  }

  function renderTableauMapping() {
    var hint = document.getElementById('tableau-server-mapping-hint');
    var table = document.getElementById('tableau-server-mapping-table');
    var addButton = document.getElementById('tableau-server-add-mapping');
    var onlyOneSite = tableauServerSites.length <= 1;
    hint.textContent = onlyOneSite
      ? 'Mit nur einer Site ist keine Zuordnung nötig.'
      : 'Ordnet ein Dashboard einer bestimmten Tableau-Site zu; ohne Zuordnung funktioniert Tableau-Server-Suche nur, solange genau eine Site konfiguriert ist.';
    table.hidden = onlyOneSite;
    addButton.hidden = onlyOneSite;
    var body = document.getElementById('tableau-server-mapping-rows');
    body.replaceChildren();
    tableauServerMappings.forEach(function (mapping, index) {
      var row = tableauServerElement('tr', '', body);
      var dashboardCell = tableauServerElement('td', '', row);
      var dashboardSelect = tableauServerElement('select', '', dashboardCell);
      var placeholder = tableauServerElement('option', 'Dashboard auswählen …', dashboardSelect);
      placeholder.value = '';
      tableauServerDashboards.forEach(function (dashboard) {
        var option = tableauServerElement('option', dashboard.name, dashboardSelect);
        option.value = dashboard.dashboardKey;
      });
      if (mapping.dashboardKey && !tableauServerDashboards.some(function (d) { return d.dashboardKey === mapping.dashboardKey; })) {
        var unknownOption = tableauServerElement('option', tableauServerDashboardLabel(mapping.dashboardKey), dashboardSelect);
        unknownOption.value = mapping.dashboardKey;
      }
      dashboardSelect.value = mapping.dashboardKey || '';
      dashboardSelect.addEventListener('change', function () { mapping.dashboardKey = dashboardSelect.value; tableauServerChanged(); });

      var siteCell = tableauServerElement('td', '', row);
      var siteSelect = tableauServerElement('select', '', siteCell);
      tableauServerSites.forEach(function (site) {
        var option = tableauServerElement('option', tableauServerSiteLabel(site), siteSelect);
        option.value = site.id;
      });
      siteSelect.value = mapping.siteId || (tableauServerSites[0] ? tableauServerSites[0].id : '');
      siteSelect.addEventListener('change', function () { mapping.siteId = siteSelect.value; tableauServerChanged(); });

      var removeCell = tableauServerElement('td', '', row);
      var removeButton = tableauServerElement('button', 'Entfernen', removeCell);
      removeButton.type = 'button';
      removeButton.className = 'danger';
      removeButton.addEventListener('click', function () {
        tableauServerMappings = tableauServerMappings.filter(function (item) { return item !== mapping; });
        tableauServerChanged();
        renderTableauMapping();
      });
    });
  }

  function tableauServerRenderEas() {
    var eas = tableauServerState.eas;
    var pending = 'Nach dem ersten Speichern einer OAuth-2.0-Trust-Site';
    document.getElementById('tableau-server-eas-issuer').value = eas ? eas.issuerUrl : pending;
    document.getElementById('tableau-server-eas-jwks').value = eas ? eas.jwksUrl : pending;
    document.getElementById('tableau-server-eas-kid').value = eas ? eas.kid : pending;
    document.getElementById('tableau-server-eas-issuer-copy').disabled = !eas;
    document.getElementById('tableau-server-eas-warning').hidden = !(eas && eas.publicUrlOk === false);
  }

  function tableauServerCopyFallback(text) {
    var input = document.getElementById('tableau-server-eas-issuer');
    var previousValue = input.value;
    input.removeAttribute('readonly');
    input.value = text;
    input.select();
    try { document.execCommand('copy'); } catch (error) { /* best effort */ }
    input.value = previousValue;
    input.setAttribute('readonly', 'readonly');
    input.blur();
  }

  function tableauServerConfigFromState() {
    var claim = tableauServerFields.usernameClaim.value === 'custom'
      ? tableauServerFields.customClaim.value.trim()
      : tableauServerFields.usernameClaim.value;
    var dashboardSites = {};
    tableauServerMappings.forEach(function (mapping) {
      if (mapping.dashboardKey && mapping.siteId) dashboardSites[mapping.dashboardKey] = mapping.siteId;
    });
    var sites = tableauServerSites.map(function (site) {
      var payload = {
        id: site.id,
        name: site.name.trim(),
        contentUrl: site.contentUrl.trim(),
        authMode: site.authMode,
        clientId: site.authMode === 'oauth2-trust' ? '' : site.clientId.trim(),
        secretId: site.authMode === 'oauth2-trust' ? '' : site.secretId.trim(),
        secretEnv: site.authMode === 'oauth2-trust' ? '' : site.secretEnv.trim(),
        siteId: site.authMode === 'oauth2-trust' ? site.siteId.trim() : ''
      };
      if (site.secretAction === 'clear') payload.secretClear = true;
      else if (site.secretAction === 'replace' && site.secretValue) payload.secret = site.secretValue;
      return payload;
    });
    return {
      enabled: tableauServerFields.enabled.checked,
      serverUrl: tableauServerFields.serverUrl.value.trim(),
      usernameClaim: claim,
      apiVersion: '${TABLEAU_REST_API_VERSION}',
      sites: sites,
      dashboardSites: dashboardSites
    };
  }

  function tableauServerLoadSitesFromConfig(config) {
    tableauServerSites = (config && config.sites ? config.sites : []).map(function (site) {
      return {
        id: site.id, name: site.name, contentUrl: site.contentUrl, authMode: site.authMode,
        clientId: site.clientId, secretId: site.secretId, secretEnv: site.secretEnv, siteId: site.siteId,
        secretConfigured: site.secretConfigured, secretAction: null, secretValue: ''
      };
    });
    var dashboardSites = config && config.dashboardSites ? config.dashboardSites : {};
    tableauServerMappings = Object.keys(dashboardSites).map(function (dashboardKey) {
      return { dashboardKey: dashboardKey, siteId: dashboardSites[dashboardKey] };
    });
  }

  function renderTableauServer() {
    var config = tableauServerState.config;
    tableauServerFields.enabled.checked = Boolean(config && config.enabled);
    tableauServerFields.serverUrl.value = config ? config.serverUrl || '' : '';
    var claim = config ? config.usernameClaim || 'email' : 'email';
    var knownClaim = ['email', 'preferred_username', 'upn'].indexOf(claim) >= 0;
    tableauServerFields.usernameClaim.value = knownClaim ? claim : 'custom';
    tableauServerFields.customClaim.value = knownClaim ? '' : claim;
    document.getElementById('tableau-server-custom-claim-field').hidden = knownClaim;
    renderTableauSites();
    renderTableauMapping();
    tableauServerRenderEas();
    tableauServerSetText('tableau-server-license-status', 'Lizenz: ' + (tableauServerState.licensed ? 'vorhanden' : 'nicht vorhanden'));
    tableauServerSetText('tableau-server-oidc-status', 'OIDC: ' + (tableauServerState.oidcReady ? 'bereit' : 'nicht bereit'));
    tableauServerSetText('tableau-server-secretkey-status', 'OVP_SECRET_KEY: ' + (tableauServerState.secretKeyConfigured ? 'gesetzt' : 'nicht gesetzt'));
  }

  function tableauServerSetText(id, value) {
    document.getElementById(id).textContent = value;
  }

  function loadTableauServer(force) {
    if (!force && tableauServerDirty && !confirm('Ungespeicherte Tableau-Server-Änderungen verwerfen?')) return Promise.resolve(false);
    tableauServerAbortTest();
    tableauServerControls.disabled = true;
    return Promise.all([
      adminFetch('/tableau-server').then(tableauServerResult),
      adminFetch('/playbooks').then(function (res) { return res.ok ? res.json() : { dashboards: [] }; }).catch(function () { return { dashboards: [] }; })
    ]).then(function (results) {
      var data = results[0];
      tableauServerDashboards = (results[1] && results[1].dashboards) || [];
      tableauServerState = data;
      tableauServerLoadSitesFromConfig(data.config);
      tableauServerDirty = false;
      tableauServerLoaded = true;
      renderTableauServer();
      tableauServerMessage('', '');
      return true;
    }).catch(function (error) {
      tableauServerLoaded = false;
      tableauServerMessage(error.message || 'Tableau-Server-Konfiguration nicht verfügbar.', 'error');
      return false;
    }).finally(function () { tableauServerControls.disabled = !tableauServerLoaded; });
  }

  tableauServerFields.enabled.addEventListener('change', tableauServerChanged);
  tableauServerFields.serverUrl.addEventListener('input', tableauServerChanged);
  tableauServerFields.usernameClaim.addEventListener('change', function () {
    document.getElementById('tableau-server-custom-claim-field').hidden = tableauServerFields.usernameClaim.value !== 'custom';
    tableauServerChanged();
  });
  tableauServerFields.customClaim.addEventListener('input', tableauServerChanged);
  document.getElementById('tableau-server-eas-issuer-copy').addEventListener('click', function () {
    var eas = tableauServerState.eas;
    if (!eas) return;
    var button = document.getElementById('tableau-server-eas-issuer-copy');
    var revert = function () { button.textContent = 'Kopieren'; };
    var done = function () { button.textContent = 'Kopiert!'; setTimeout(revert, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(eas.issuerUrl).then(done).catch(function () {
        tableauServerCopyFallback(eas.issuerUrl);
        done();
      });
    } else {
      tableauServerCopyFallback(eas.issuerUrl);
      done();
    }
  });
  document.getElementById('tableau-server-reload').addEventListener('click', function () { loadTableauServer(false); });
  document.getElementById('tableau-server-add-site').addEventListener('click', function () {
    if (tableauServerSites.length >= 50) return tableauServerMessage('Maximal 50 Sites.', 'error');
    tableauServerSites.push({
      id: tableauServerNewSiteId(), name: '', contentUrl: '', authMode: 'connected-app',
      clientId: '', secretId: '', secretEnv: '', siteId: '', secretConfigured: false, secretAction: null, secretValue: ''
    });
    tableauServerChanged();
    renderTableauServer();
  });
  document.getElementById('tableau-server-add-mapping').addEventListener('click', function () {
    if (!tableauServerSites.length) return;
    tableauServerMappings.push({ dashboardKey: '', siteId: tableauServerSites[0].id });
    tableauServerChanged();
    renderTableauMapping();
  });
  document.getElementById('tableau-server-save').addEventListener('click', function () {
    var button = document.getElementById('tableau-server-save');
    var config = tableauServerConfigFromState();
    if (config.sites.some(function (site) { return !site.name; })) {
      tableauServerMessage('Bitte allen Sites einen Namen geben.', 'error');
      return;
    }
    tableauServerAbortTest();
    tableauServerControls.disabled = true;
    button.textContent = 'Speichern …';
    tableauServerMessage('Wird gespeichert …', '');
    adminFetch('/tableau-server', jsonRequest('PUT', { config: config, expectedRevision: tableauServerState.revision }))
      .then(tableauServerResult)
      .then(function (data) {
        tableauServerState = data;
        tableauServerLoadSitesFromConfig(data.config);
        tableauServerDirty = false;
        tableauServerLoaded = true;
        renderTableauServer();
        tableauServerMessage('Gespeichert.', 'ok');
      })
      .catch(function (error) {
        if (error.status === 409) {
          tableauServerMessage('Die Konfiguration wurde zwischenzeitlich geändert. Deine ungespeicherten Änderungen bleiben erhalten. Bitte aktualisieren und anschließend erneut bearbeiten.', 'error');
        } else tableauServerMessage(error.message || 'Speichern fehlgeschlagen.', 'error');
      }).finally(function () { button.textContent = 'Speichern'; tableauServerControls.disabled = !tableauServerLoaded; });
  });
  document.getElementById('tableau-server-reset').addEventListener('click', function () {
    if (!confirm('Tableau-Server-Konfiguration zurücksetzen?')) return;
    tableauServerAbortTest();
    tableauServerControls.disabled = true;
    adminFetch('/tableau-server', jsonRequest('DELETE', { expectedRevision: tableauServerState.revision }))
      .then(tableauServerResult)
      .then(function (data) {
        tableauServerState = data;
        tableauServerLoadSitesFromConfig(data.config);
        tableauServerDirty = false;
        tableauServerLoaded = true;
        renderTableauServer();
        tableauServerMessage('Zurückgesetzt.', 'ok');
      })
      .catch(function (error) { tableauServerMessage(error.message || 'Zurücksetzen fehlgeschlagen.', 'error'); })
      .finally(function () { tableauServerControls.disabled = !tableauServerLoaded; });
  });
`;
