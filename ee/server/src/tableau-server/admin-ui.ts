import { TABLEAU_MIN_SERVER_VERSION, TABLEAU_REST_API_VERSION } from './config';

export const tableauAdminStyles = `
  #tableau-server-admin { border: 0; padding-top: 1.5rem; }
  #tableau-server-admin .tableau-server-panel { max-width: 820px; }
  #tableau-server-controls { border: 0; padding: 0; margin: 0; min-width: 0; }
  #tableau-server-admin .tableau-server-status { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; margin: 0.5rem 0 1.25rem; color: var(--text-muted); font-size: 12px; }
  #tableau-server-admin .tableau-server-status span { overflow-wrap: anywhere; }
  #tableau-server-admin .tableau-server-status strong { color: var(--text); font-weight: 600; }
  #tableau-server-admin .tableau-server-auth { display: flex; align-items: center; min-height: 38px; padding: 0.4rem 0.55rem; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text-muted); }
  #tableau-server-admin .tableau-server-toggle { display: flex; align-items: center; gap: 0.55rem; min-height: 38px; cursor: pointer; }
  #tableau-server-admin .tableau-server-toggle input { width: auto; flex: 0 0 auto; margin: 0; }
  #tableau-server-admin .tableau-server-toggle span { flex: 1; }
  #tableau-server-admin .tableau-server-custom { margin-top: -0.25rem; }
  #tableau-server-admin .tableau-server-actions { align-items: center; }
  #tableau-server-admin .tableau-server-actions .hint { margin: 0; }
  #tableau-server-admin .tableau-server-connection-result { margin: 0.75rem 0 0; color: var(--text-muted); font-size: 12px; }
  #tableau-server-admin .tableau-server-connection-result ul { margin: 0.35rem 0 0; padding-left: 1.25rem; }
  #tableau-server-admin .tableau-server-connection-result .ok { color: var(--success, #18794e); }
  #tableau-server-admin .tableau-server-connection-result .error { color: var(--danger, #b42318); }
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
              <input id="tableau-server-enabled" type="checkbox" />
              <span>Tableau Server-Integration aktiviert</span>
            </label>
            <label for="tableau-server-url">Server-URL
              <input id="tableau-server-url" type="url" autocomplete="off" placeholder="https://tableau.example.com" />
            </label>
            <label for="tableau-server-site">Site-Inhalt-URL
              <input id="tableau-server-site" type="text" autocomplete="off" placeholder="site-content-url" />
            </label>
            <label for="tableau-server-client-id">Client-ID
              <input id="tableau-server-client-id" type="text" autocomplete="off" />
            </label>
            <label for="tableau-server-secret-id">Secret-ID
              <input id="tableau-server-secret-id" type="text" autocomplete="off" />
            </label>
            <label for="tableau-server-secret-env">Secret-Env-Referenz
              <input id="tableau-server-secret-env" type="text" autocomplete="off" placeholder="OVP_TABLEAU_CONNECTED_APP_SECRET" />
            </label>
            <label for="tableau-server-username-claim">Username-Claim
              <select id="tableau-server-username-claim">
                <option value="email">email</option>
                <option value="preferred_username">preferred_username</option>
                <option value="upn">upn</option>
                <option value="custom">Benutzerdefiniert</option>
              </select>
            </label>
            <label id="tableau-server-custom-claim-field" class="tableau-server-custom" for="tableau-server-custom-claim">Benutzerdefinierter Username-Claim
              <input id="tableau-server-custom-claim" type="text" autocomplete="off" />
            </label>
            <div class="form-field"><span>Authentifizierung</span><span class="tableau-server-auth">Connected App (JWT)</span></div>
            <div class="form-field"><span>Tableau-Mindestversion</span><span class="tableau-server-auth">${TABLEAU_MIN_SERVER_VERSION} (REST API ${TABLEAU_REST_API_VERSION})</span></div>
          </div>
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
  var tableauServerState = { config: null, revision: null, secretConfigured: false, licensed: false, oidcReady: false };
  var tableauServerDirty = false;
  var tableauServerLoaded = false;
  var tableauServerTest = null;
  var tableauServerTestRevision = 0;
  var tableauServerBanner = document.getElementById('tableau-server-banner');
  var tableauServerControls = document.getElementById('tableau-server-controls');
  var tableauServerFields = {
    enabled: document.getElementById('tableau-server-enabled'),
    serverUrl: document.getElementById('tableau-server-url'),
    siteContentUrl: document.getElementById('tableau-server-site'),
    clientId: document.getElementById('tableau-server-client-id'),
    secretId: document.getElementById('tableau-server-secret-id'),
    secretEnv: document.getElementById('tableau-server-secret-env'),
    usernameClaim: document.getElementById('tableau-server-username-claim'),
    customClaim: document.getElementById('tableau-server-custom-claim')
  };

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
    return {
      enabled: tableauServerFields.enabled.checked,
      serverUrl: tableauServerFields.serverUrl.value.trim(),
      siteContentUrl: tableauServerFields.siteContentUrl.value.trim(),
      clientId: tableauServerFields.clientId.value.trim(),
      secretId: tableauServerFields.secretId.value.trim(),
      secretEnv: tableauServerFields.secretEnv.value.trim(),
      usernameClaim: claim,
      apiVersion: '${TABLEAU_REST_API_VERSION}',
      authMode: 'connected-app'
    };
  }

  function renderTableauServer() {
    var config = tableauServerState.config;
    tableauServerFields.enabled.checked = Boolean(config && config.enabled);
    tableauServerFields.serverUrl.value = config ? config.serverUrl || '' : '';
    tableauServerFields.siteContentUrl.value = config ? config.siteContentUrl || '' : '';
    tableauServerFields.clientId.value = config ? config.clientId || '' : '';
    tableauServerFields.secretId.value = config ? config.secretId || '' : '';
    tableauServerFields.secretEnv.value = config ? config.secretEnv || '' : '';
    var claim = config ? config.usernameClaim || 'email' : 'email';
    var knownClaim = ['email', 'preferred_username', 'upn'].indexOf(claim) >= 0;
    tableauServerFields.usernameClaim.value = knownClaim ? claim : 'custom';
    tableauServerFields.customClaim.value = knownClaim ? '' : claim;
    document.getElementById('tableau-server-custom-claim-field').hidden = knownClaim;
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
    field.addEventListener(key === 'enabled' || key === 'usernameClaim' ? 'change' : 'input', tableauServerChanged);
  });
  tableauServerFields.usernameClaim.addEventListener('change', function () {
    document.getElementById('tableau-server-custom-claim-field').hidden = tableauServerFields.usernameClaim.value !== 'custom';
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
