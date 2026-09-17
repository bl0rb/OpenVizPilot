import { TABLEAU_MIN_SERVER_VERSION, TABLEAU_REST_API_VERSION } from './config';

export const tableauAdminStyles = `
  #tableau-server-admin { border: 0; padding-top: 1.5rem; }
  #tableau-server-admin .tableau-server-panel { max-width: 820px; }
  #tableau-server-controls { border: 0; padding: 0; margin: 0; min-width: 0; }
  #tableau-server-admin .tableau-server-status { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; margin: 0.5rem 0 1.25rem; color: var(--text-muted); font-size: 12px; }
  #tableau-server-admin .tableau-server-status span { overflow-wrap: anywhere; }
  #tableau-server-admin .tableau-server-status strong { color: var(--text); font-weight: 600; }
  #tableau-server-admin .tableau-server-auth { display: flex; align-items: center; min-height: 38px; font-weight: 400; padding: 0.4rem 0.55rem; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text-muted); }
  #tableau-server-admin .tableau-server-toggle { grid-column: 1 / -1; display: flex; align-items: center; gap: 0.55rem; cursor: pointer; }
  /* Als Schalter statt Checkbox — passt zum Rest der Oberfläche. */
  #tableau-server-admin .tableau-server-toggle input { appearance: none; -webkit-appearance: none; flex: 0 0 auto; width: 36px; height: 20px; margin: 0; border-radius: 999px; border: 1px solid var(--border); background: var(--border); position: relative; cursor: pointer; transition: background 0.15s; }
  #tableau-server-admin .tableau-server-toggle input::before { content: ''; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: var(--surface); box-shadow: 0 1px 2px rgb(13 15 22 / 25%); transition: transform 0.15s; }
  #tableau-server-admin .tableau-server-toggle input:checked { background: var(--accent); border-color: var(--accent); }
  #tableau-server-admin .tableau-server-toggle input:checked::before { transform: translateX(16px); }
  #tableau-server-admin .tableau-server-toggle input:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }
  #tableau-server-admin .tableau-server-toggle span { flex: 1; }
  #tableau-server-admin .tableau-server-custom { margin-top: -0.25rem; }
  #tableau-server-admin .tableau-server-actions { align-items: center; }
  #tableau-server-admin .tableau-server-actions .hint { margin: 0; }
  #tableau-server-admin .tableau-server-connection-result { margin: 0.75rem 0 0; color: var(--text-muted); font-size: 12px; }
  #tableau-server-admin .tableau-server-connection-result ul { margin: 0.35rem 0 0; padding-left: 1.25rem; }
  #tableau-server-admin .tableau-server-connection-result .ok { color: var(--success, #18794e); }
  #tableau-server-admin .tableau-server-connection-result .error { color: var(--danger, #b42318); }
  #tableau-server-admin .tableau-server-mode-fields { display: contents; }
  #tableau-server-admin .tableau-server-mode-fields > label { display: grid; gap: 0.4rem; min-width: 0; font-size: 13px; font-weight: 500; }
  #tableau-server-admin .tableau-server-mode-fields > label > input, #tableau-server-admin .tableau-server-mode-fields > label > select { width: 100%; min-width: 0; }
  /* Lange, nur lesbare URLs bekommen eine ganze Zeile; der HTTPS-Hinweis ebenso. */
  #tableau-server-admin label:has(> .tableau-server-inline-field), #tableau-server-admin label:has(> #tableau-server-eas-jwks), #tableau-server-admin #tableau-server-eas-warning { grid-column: 1 / -1; }
  #tableau-server-admin .tableau-server-inline-field { display: flex; gap: 0.4rem; }
  #tableau-server-admin .tableau-server-inline-field input { flex: 1; min-width: 0; }
  #tableau-server-admin input[readonly] { background: var(--bg); color: var(--text-muted); }
  #tableau-server-admin details { border: 1px solid var(--border); border-radius: 6px; padding: 0.6rem 0.75rem; margin-top: 0.75rem; }
  #tableau-server-admin details summary { cursor: pointer; font-weight: 600; }
  #tableau-server-admin details ol { margin: 0.5rem 0 0; padding-left: 1.25rem; }
  #tableau-server-admin details li { margin: 0.3rem 0; }
  #tableau-server-admin details .hint { margin: 0.5rem 0 0; }
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
          <span id="tableau-server-secret-status"></span>
        </div>
        <fieldset id="tableau-server-controls" disabled>
          <div class="form-grid">
            <label class="tableau-server-toggle" for="tableau-server-enabled">
              <input id="tableau-server-enabled" type="checkbox" role="switch" />
              <span>Tableau Server-Integration aktiviert</span>
            </label>
            <label for="tableau-server-auth-mode">Authentifizierung
              <select id="tableau-server-auth-mode">
                <option value="connected-app">Connected App – Direct Trust (Client-ID, Secret)</option>
                <option value="oauth2-trust">Connected App – OAuth 2.0 Trust (Issuer-URL, JWKS)</option>
              </select>
            </label>
            <label for="tableau-server-url" class="has-help"><span class="help-term">Server-URL</span><span role="tooltip" id="help-tableau-url" class="help-tip">HTTPS-Origin ohne Pfad, z. B. <code>https://tableau.example.com</code>.</span>
              <input id="tableau-server-url" type="url" autocomplete="off" placeholder="https://tableau.example.com" aria-describedby="help-tableau-url" />
            </label>
            <label for="tableau-server-site" class="has-help"><span class="help-term">Site (Content-URL)</span><span role="tooltip" id="help-tableau-site" class="help-tip">Der Site-Kürzel aus der Tableau-Adresse: <code>https://tableau.example.com/#/site/vertrieb/…</code> → <code>vertrieb</code>. Tableau Server: für die Standard-Site leer lassen. Tableau Cloud: immer erforderlich.</span>
              <input id="tableau-server-site" type="text" autocomplete="off" placeholder="site-content-url" aria-describedby="help-tableau-site" />
            </label>
            <div id="tableau-server-connected-app-fields" class="tableau-server-mode-fields">
              <label for="tableau-server-client-id" class="has-help"><span class="help-term">Client-ID</span><span role="tooltip" id="help-tableau-client-id" class="help-tip">Aus Tableau: Connected App → Client ID.</span>
                <input id="tableau-server-client-id" type="text" autocomplete="off" aria-describedby="help-tableau-client-id" />
              </label>
              <label for="tableau-server-secret-id" class="has-help"><span class="help-term">Secret-ID</span><span role="tooltip" id="help-tableau-secret-id" class="help-tip">Secret ID des erzeugten Secrets.</span>
                <input id="tableau-server-secret-id" type="text" autocomplete="off" aria-describedby="help-tableau-secret-id" />
              </label>
              <label for="tableau-server-secret-env" class="has-help help-left"><span class="help-term">Secret-Env-Referenz</span><span role="tooltip" id="help-tableau-secret-env" class="help-tip">Name der Umgebungsvariable mit dem Secret value, Präfix <code>OVP_TABLEAU_</code>; der Wert wird nie hier eingegeben.</span>
                <input id="tableau-server-secret-env" type="text" autocomplete="off" placeholder="OVP_TABLEAU_CONNECTED_APP_SECRET" aria-describedby="help-tableau-secret-env" />
              </label>
            </div>
            <label for="tableau-server-username-claim" class="has-help"><span class="help-term">Username-Claim</span><span role="tooltip" id="help-tableau-username-claim" class="help-tip">Muss dem Tableau-Benutzernamen entsprechen (Tableau Cloud: der E-Mail-Adresse).</span>
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
            <div id="tableau-server-oauth2-fields" class="tableau-server-mode-fields">
              <label for="tableau-server-site-id" class="has-help"><span class="help-term">Site-ID</span><span role="tooltip" id="help-tableau-site-id" class="help-tip">Site-LUID, nach dem Anlegen der Connected App in Tableau angezeigt.</span>
                <input id="tableau-server-site-id" type="text" autocomplete="off" placeholder="LUID der Site (UUID)" aria-describedby="help-tableau-site-id" />
              </label>
              <label for="tableau-server-eas-issuer" class="has-help help-left"><span class="help-term">Issuer URL</span><span role="tooltip" id="help-tableau-issuer" class="help-tip">In Tableau bei „New Connected App → OAuth 2.0 Trust“ als Issuer URL eintragen. Muss per HTTPS erreichbar sein (OIDC-Metadaten unter <code>/.well-known/openid-configuration</code>; Tableau Server ab 2024.2 bzw. Tableau Cloud). Ändert sich die Public URL dieser Middleware, ändert sich auch die Issuer-URL — dann in Tableau nachziehen.</span>
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
            <div class="form-field"><span>Tableau-Mindestversion</span><span class="tableau-server-auth">${TABLEAU_MIN_SERVER_VERSION} (REST API ${TABLEAU_REST_API_VERSION})</span></div>
          </div>
          <details id="tableau-server-setup-connected-app">
            <summary>Einrichtung Schritt für Schritt (Direct Trust)</summary>
            <ol>
              <li>Voraussetzung: Single Sign-On (OIDC) im Abschnitt <a href="#auth-admin">Anmeldung, Single Sign-On &amp; Lizenz</a> einrichten; Lizenz mit den Merkmalen <code>sso</code> und <code>tableauServer</code>.</li>
              <li>In Tableau: <em>Settings → Connected Apps → New Connected App → Direct Trust</em>. Name vergeben, Access level und Domain allowlist setzen (die Public URL dieser Middleware eintragen), <em>Enable connected app</em> aktivieren.</li>
              <li><em>Client ID</em> kopieren.</li>
              <li><em>Generate New Secret</em> klicken — Tableau zeigt <em>Secret ID</em> und <em>Secret Value</em> an.</li>
              <li>Secret Value als Umgebungsvariable mit Präfix <code>OVP_TABLEAU_</code> bereitstellen; Secret-ID hier eintragen.</li>
              <li>Server-URL, Site (Content-URL), Client-ID, Secret-ID, Secret-Env-Referenz und Username-Claim oben eintragen, Integration aktivieren, speichern.</li>
              <li><strong>Konfiguration prüfen</strong> ausführen.</li>
              <li><strong>Verbindung als Nutzer prüfen</strong> ausführen.</li>
            </ol>
          </details>
          <details id="tableau-server-setup-oauth2-trust">
            <summary>Einrichtung Schritt für Schritt (OAuth 2.0 Trust)</summary>
            <ol>
              <li>Voraussetzung: Single Sign-On (OIDC) im Abschnitt <a href="#auth-admin">Anmeldung, Single Sign-On &amp; Lizenz</a> einrichten; Lizenz mit den Merkmalen <code>sso</code> und <code>tableauServer</code>.</li>
              <li>Diesen Modus hier zuerst speichern — auch im deaktivierten Entwurf. Dabei erzeugt die Middleware einmalig den EAS-Schlüssel.</li>
              <li>Issuer URL oben kopieren.</li>
              <li>In Tableau: <em>Settings → Connected Apps → New Connected App → OAuth 2.0 Trust</em>. Name vergeben, Issuer URL einfügen, <em>Enable connected app</em> aktivieren.</li>
              <li>Die von Tableau angezeigte <em>Site ID</em> kopieren.</li>
              <li>Site-ID oben eintragen, speichern.</li>
              <li><strong>Konfiguration prüfen</strong> ausführen.</li>
              <li><strong>Verbindung als Nutzer prüfen</strong> ausführen.</li>
            </ol>
          </details>
          <div class="form-actions tableau-server-actions">
            <button id="tableau-server-save" class="primary" type="button">Speichern</button>
            <button id="tableau-server-check" type="button">Konfiguration prüfen</button>
            <button id="tableau-server-connection-test" type="button" disabled>Verbindung als Nutzer prüfen</button>
          </div>
          <div id="tableau-server-connection-result" class="tableau-server-connection-result" role="status" aria-live="polite" hidden></div>
        </fieldset>
        <div class="form-actions tableau-server-actions">
          <button id="tableau-server-reset" class="danger" type="button">Zurücksetzen</button>
        </div>
      </div>
    </section>
`;

export const tableauAdminScript = String.raw`
  var tableauServerState = { config: null, revision: null, secretConfigured: false, licensed: false, oidcReady: false, eas: null };
  var tableauServerDirty = false;
  var tableauServerLoaded = false;
  var tableauServerTest = null;
  var tableauServerTestRevision = 0;
  var tableauServerBanner = document.getElementById('tableau-server-banner');
  var tableauServerControls = document.getElementById('tableau-server-controls');
  var tableauServerFields = {
    enabled: document.getElementById('tableau-server-enabled'),
    authMode: document.getElementById('tableau-server-auth-mode'),
    serverUrl: document.getElementById('tableau-server-url'),
    siteContentUrl: document.getElementById('tableau-server-site'),
    clientId: document.getElementById('tableau-server-client-id'),
    secretId: document.getElementById('tableau-server-secret-id'),
    secretEnv: document.getElementById('tableau-server-secret-env'),
    usernameClaim: document.getElementById('tableau-server-username-claim'),
    customClaim: document.getElementById('tableau-server-custom-claim'),
    siteId: document.getElementById('tableau-server-site-id')
  };

  function tableauServerUpdateModeVisibility() {
    var oauth2 = tableauServerFields.authMode.value === 'oauth2-trust';
    document.getElementById('tableau-server-connected-app-fields').hidden = oauth2;
    document.getElementById('tableau-server-oauth2-fields').hidden = !oauth2;
    document.getElementById('tableau-server-setup-connected-app').hidden = oauth2;
    document.getElementById('tableau-server-setup-oauth2-trust').hidden = !oauth2;
  }

  function tableauServerRenderEas() {
    var eas = tableauServerState.eas;
    var pending = 'Nach dem ersten Speichern';
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

  function tableauServerSetText(id, value) {
    document.getElementById(id).textContent = value;
  }

  function tableauServerConnectionSucceeded(data) {
    var checks = Array.isArray(data.checks) ? data.checks : [];
    return data.ok === true && data.stage === 'connection' && checks.length > 0 && checks.every(function (check) { return check && check.ok === true; });
  }

  function tableauServerRenderConnectionResult(data) {
    var result = document.getElementById('tableau-server-connection-result');
    var success = tableauServerConnectionSucceeded(data);
    result.textContent = '';
    result.hidden = false;
    var heading = document.createElement('strong');
    heading.textContent = success ? 'Verbindung erfolgreich.' : 'Verbindung fehlgeschlagen.';
    heading.className = success ? 'ok' : 'error';
    result.appendChild(heading);
    if (data.serverVersion || data.apiVersion) {
      var version = document.createElement('span');
      version.textContent = ' ' + [data.serverVersion ? 'Tableau ' + data.serverVersion : '', data.apiVersion ? 'API ' + data.apiVersion : ''].filter(Boolean).join(' · ');
      result.appendChild(version);
    }
    if (Array.isArray(data.checks) && data.checks.length) {
      var list = document.createElement('ul');
      data.checks.forEach(function (check) {
        var item = document.createElement('li');
        item.textContent = String(check.resource || 'Prüfung') + ': ' + (check.ok ? 'OK' : 'fehlgeschlagen') + (check.code ? ' (' + String(check.code) + ')' : '');
        item.className = check.ok ? 'ok' : 'error';
        list.appendChild(item);
      });
      result.appendChild(list);
    }
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

  function tableauServerPersonalConnectionTest() {
    var button = document.getElementById('tableau-server-connection-test');
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
    var result = document.getElementById('tableau-server-connection-result');
    result.textContent = '';
    result.hidden = true;
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
      return fetch('/api/tableau-server/check', { method: 'POST', headers: { authorization: 'Bearer ' + idToken }, signal: controller.signal }).then(tableauServerResult);
    }).then(function (data) {
      if (revision !== tableauServerTestRevision) return;
      tableauServerRenderConnectionResult(data);
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
      if (!tableauServerState.config || tableauServerDirty) renderTableauServer();
    });
  }

  function tableauServerConfigFromFields() {
    var claim = tableauServerFields.usernameClaim.value === 'custom'
      ? tableauServerFields.customClaim.value.trim()
      : tableauServerFields.usernameClaim.value;
    var mode = tableauServerFields.authMode.value;
    return {
      enabled: tableauServerFields.enabled.checked,
      serverUrl: tableauServerFields.serverUrl.value.trim(),
      siteContentUrl: tableauServerFields.siteContentUrl.value.trim(),
      clientId: mode === 'oauth2-trust' ? '' : tableauServerFields.clientId.value.trim(),
      secretId: mode === 'oauth2-trust' ? '' : tableauServerFields.secretId.value.trim(),
      secretEnv: mode === 'oauth2-trust' ? '' : tableauServerFields.secretEnv.value.trim(),
      siteId: mode === 'oauth2-trust' ? tableauServerFields.siteId.value.trim() : '',
      usernameClaim: claim,
      apiVersion: '${TABLEAU_REST_API_VERSION}',
      authMode: mode
    };
  }

  function renderTableauServer() {
    var config = tableauServerState.config;
    tableauServerFields.enabled.checked = Boolean(config && config.enabled);
    tableauServerFields.authMode.value = config && config.authMode === 'oauth2-trust' ? 'oauth2-trust' : 'connected-app';
    tableauServerFields.serverUrl.value = config ? config.serverUrl || '' : '';
    tableauServerFields.siteContentUrl.value = config ? config.siteContentUrl || '' : '';
    tableauServerFields.clientId.value = config ? config.clientId || '' : '';
    tableauServerFields.secretId.value = config ? config.secretId || '' : '';
    tableauServerFields.secretEnv.value = config ? config.secretEnv || '' : '';
    tableauServerFields.siteId.value = config ? config.siteId || '' : '';
    var claim = config ? config.usernameClaim || 'email' : 'email';
    var knownClaim = ['email', 'preferred_username', 'upn'].indexOf(claim) >= 0;
    tableauServerFields.usernameClaim.value = knownClaim ? claim : 'custom';
    tableauServerFields.customClaim.value = knownClaim ? '' : claim;
    document.getElementById('tableau-server-custom-claim-field').hidden = knownClaim;
    tableauServerUpdateModeVisibility();
    tableauServerRenderEas();
    tableauServerSetText('tableau-server-license-status', 'Lizenz: ' + (tableauServerState.licensed ? 'vorhanden' : 'nicht vorhanden'));
    tableauServerSetText('tableau-server-oidc-status', 'OIDC: ' + (tableauServerState.oidcReady ? 'bereit' : 'nicht bereit'));
    tableauServerSetText('tableau-server-secret-status', 'Secret: ' + (tableauServerState.secretConfigured ? 'konfiguriert' : 'nicht konfiguriert'));
    document.getElementById('tableau-server-check').disabled = tableauServerDirty || !config;
    document.getElementById('tableau-server-connection-test').disabled = tableauServerDirty || !tableauServerLoaded || !config || !config.enabled || !tableauServerState.licensed || !tableauServerState.oidcReady;
  }

  function tableauServerChanged() {
    tableauServerAbortTest();
    tableauServerDirty = true;
    document.getElementById('tableau-server-check').disabled = true;
    document.getElementById('tableau-server-connection-test').disabled = true;
    var result = document.getElementById('tableau-server-connection-result');
    result.textContent = '';
    result.hidden = true;
    tableauServerMessage('Ungespeicherte Änderungen.', '');
  }

  function loadTableauServer(force) {
    if (!force && tableauServerDirty && !confirm('Ungespeicherte Tableau-Server-Änderungen verwerfen?')) return Promise.resolve(false);
    tableauServerAbortTest();
    document.getElementById('tableau-server-connection-test').disabled = true;
    tableauServerControls.disabled = true;
    return adminFetch('/tableau-server').then(tableauServerResult).then(function (data) {
      tableauServerState = data;
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

  Object.keys(tableauServerFields).forEach(function (key) {
    var field = tableauServerFields[key];
    field.addEventListener(key === 'enabled' || key === 'usernameClaim' || key === 'authMode' ? 'change' : 'input', tableauServerChanged);
  });
  tableauServerFields.usernameClaim.addEventListener('change', function () {
    document.getElementById('tableau-server-custom-claim-field').hidden = tableauServerFields.usernameClaim.value !== 'custom';
  });
  tableauServerFields.authMode.addEventListener('change', tableauServerUpdateModeVisibility);
  tableauServerUpdateModeVisibility();
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
  document.getElementById('tableau-server-save').addEventListener('click', function () {
    var button = document.getElementById('tableau-server-save');
    tableauServerAbortTest();
    document.getElementById('tableau-server-connection-test').disabled = true;
    tableauServerControls.disabled = true;
    button.textContent = 'Speichern …';
    tableauServerMessage('Wird gespeichert …', '');
    adminFetch('/tableau-server', jsonRequest('PUT', { config: tableauServerConfigFromFields(), expectedRevision: tableauServerState.revision }))
      .then(tableauServerResult)
      .then(function (data) { tableauServerState = data; tableauServerDirty = false; tableauServerLoaded = true; renderTableauServer(); tableauServerMessage('Gespeichert.', 'ok'); })
      .catch(function (error) {
        if (error.status === 409) {
          tableauServerMessage('Die Konfiguration wurde zwischenzeitlich geändert. Deine ungespeicherten Änderungen bleiben erhalten. Bitte aktualisieren und anschließend erneut bearbeiten.', 'error');
        } else tableauServerMessage(error.message || 'Speichern fehlgeschlagen.', 'error');
      }).finally(function () { button.textContent = 'Speichern'; tableauServerControls.disabled = !tableauServerLoaded; });
  });
  document.getElementById('tableau-server-check').addEventListener('click', function () {
    var button = document.getElementById('tableau-server-check');
    if (tableauServerDirty || !tableauServerState.config) {
      tableauServerMessage('Bitte zuerst eine gespeicherte Konfiguration anlegen oder die Änderungen speichern.', 'error');
      return;
    }
    button.disabled = true;
    tableauServerMessage('Konfiguration wird geprüft …', '');
    adminFetch('/tableau-server/check', { method: 'POST' }).then(tableauServerResult)
      .then(function (data) { tableauServerMessage(data.ok && data.stage === 'configuration' ? 'Konfiguration und Secret-Referenz sind vorhanden.' : 'Konfiguration konnte nicht bestätigt werden.', data.ok ? 'ok' : 'error'); })
      .catch(function (error) { tableauServerMessage(error.message || 'Konfigurationsprüfung fehlgeschlagen.', 'error'); })
      .finally(function () { button.disabled = false; });
  });
  document.getElementById('tableau-server-connection-test').addEventListener('click', tableauServerPersonalConnectionTest);
  document.getElementById('tableau-server-reset').addEventListener('click', function () {
    if (!confirm('Tableau-Server-Konfiguration zurücksetzen?')) return;
    tableauServerAbortTest();
    document.getElementById('tableau-server-connection-test').disabled = true;
    tableauServerControls.disabled = true;
    adminFetch('/tableau-server', jsonRequest('DELETE', { expectedRevision: tableauServerState.revision }))
      .then(tableauServerResult)
      .then(function (data) { tableauServerState = data; tableauServerDirty = false; tableauServerLoaded = true; renderTableauServer(); tableauServerMessage('Zurückgesetzt.', 'ok'); })
      .catch(function (error) { tableauServerMessage(error.message || 'Zurücksetzen fehlgeschlagen.', 'error'); })
      .finally(function () { tableauServerControls.disabled = !tableauServerLoaded; });
  });
`;
