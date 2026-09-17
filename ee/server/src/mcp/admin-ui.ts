export const mcpAdminStyles = `
  #mcp-admin { margin: 0 0 2rem; padding: 1.25rem 0; border-block: 1px solid var(--border); }
  #mcp-admin h3 { font-size: 0.95rem; margin: 1.25rem 0 0.5rem; }
  #mcp-admin fieldset { margin: 0; padding: 0; border: 0; min-width: 0; }
  #mcp-admin .mcp-entry { border: 1px solid var(--border); border-radius: 6px; background: var(--surface); padding: 0.85rem; margin: 0.6rem 0; }
  #mcp-admin summary { cursor: pointer; font-weight: 600; overflow-wrap: anywhere; }
  #mcp-admin .mcp-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr)); gap: 0.75rem; margin: 0.75rem 0; }
  #mcp-admin .mcp-fields label { display: grid; gap: 0.2rem; min-width: 0; }
  #mcp-admin input[type=text], #mcp-admin textarea { width: 100%; min-width: 0; }
  #mcp-admin .mcp-choices { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr)); gap: 0.25rem 1rem; margin: 0.5rem 0 1rem; max-height: 260px; overflow: auto; overscroll-behavior: contain; }
  #mcp-admin .mcp-choices label { display: flex; align-items: baseline; gap: 0.5rem; overflow-wrap: anywhere; min-width: 0; padding: 0.5rem 0.25rem; cursor: pointer; }
  #mcp-admin .mcp-choices label:hover { background: var(--bg); }
  #mcp-admin .mcp-choice-description { display: block; color: var(--text-muted); font-size: 12px; font-weight: 400; }
  #mcp-admin .mcp-filter { display: grid; gap: 0.25rem; max-width: 420px; margin-top: 0.5rem; font-size: 12px; }
  #mcp-admin .mcp-selection-count { font-size: 12px; color: var(--text-muted); margin-left: 0.5rem; }
  #mcp-admin .mcp-choices input { flex-shrink: 0; }
  #mcp-admin .mcp-empty { color: var(--text-muted); margin: 0.5rem 0; }
  #mcp-admin input[aria-invalid="true"], #mcp-admin fieldset[aria-invalid="true"] { border-color: var(--danger); }
  #mcp-admin .mcp-summary { border-top: 1px solid var(--border); padding-top: 0.6rem; margin-top: 0.75rem; }
`;

export const mcpAdminSection = `
    <section id="mcp-admin" aria-labelledby="mcp-heading">
      <div class="row" style="justify-content:space-between">
        <h2 id="mcp-heading">MCP &amp; Sites <small>Enterprise</small></h2>
        <button id="mcp-reload" type="button">Aktualisieren</button>
      </div>
      <p class="hint">Bindet externe, nur lesende MCP-Tools an bestimmte Dashboards an — braucht eine Enterprise-Lizenz mit Feature „mcp“.</p>
      <p class="hint">1 Site mit Dashboards und Mitgliedern anlegen · 2 Server verbinden und Tools laden · 3 Tools und Sites auswählen · 4 Freigaben speichern. Felder mit * sind Pflichtfelder.</p>
      <p id="mcp-banner" class="banner" role="status" aria-live="polite"></p>
      <fieldset id="mcp-controls" disabled>
        <h3>Sites</h3>
        <div id="mcp-sites"></div>
        <button id="mcp-add-site" type="button">+ Site hinzufügen</button>
        <h3>MCP-Server</h3>
        <div id="mcp-servers"></div>
        <p id="mcp-summary" class="hint mcp-summary" role="status" aria-live="polite"></p>
        <div class="row">
          <button id="mcp-add-server" type="button">+ MCP-Server hinzufügen</button>
          <button id="mcp-save" class="primary" type="button">Freigaben speichern</button>
        </div>
      </fieldset>
    </section>
`;

export const mcpAdminScript = String.raw`
  var mcpState = { settings: { sites: [], servers: [] }, revision: 0, dashboards: [], users: [] };
  var mcpDirty = false;
  var mcpTools = {};
  var mcpBanner = document.getElementById('mcp-banner');
  var mcpControls = document.getElementById('mcp-controls');

  function mcpChanged() {
    mcpDirty = true;
    showBanner(mcpBanner, 'Ungespeicherte Änderungen.', '');
    mcpBanner.style.display = 'block';
    renderMcpSummary();
  }

  function renderMcpSummary() {
    var summary = document.getElementById('mcp-summary');
    if (!summary) return;
    var lines = [];
    mcpState.settings.servers.forEach(function (server) {
      var siteNames = server.siteIds.map(function (id) {
        var site = mcpState.settings.sites.filter(function (item) { return item.id === id; })[0];
        return site ? (site.name || site.id) : id;
      });
      if (!siteNames.length || !server.tools.length) return;
      lines.push((server.name || server.id) + ' → ' + siteNames.join(', ') + ' (' + server.tools.length + ' Tool' + (server.tools.length === 1 ? '' : 's') + (server.enabled ? '' : ', deaktiviert') + ')');
    });
    summary.textContent = lines.length
      ? 'Geplante Freigaben: ' + lines.join(' · ') + '. Ob der Zugriff tatsächlich wirksam wird, hängt zusätzlich von Lizenz, Anmeldung und weiteren bestehenden Freigaben ab.'
      : 'Noch keine Server-Freigabe einer Site mit Tools zugeordnet.';
  }

  function mcpMessage(message, kind) {
    mcpBanner.style.display = '';
    showBanner(mcpBanner, message, kind);
  }

  function mcpResult(response) {
    return response.json().then(function (data) {
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Ungültige MCP-Konfiguration. Pflichtfelder und Freigaben prüfen.');
      return data;
    });
  }

  function loadMcp() {
    if (mcpDirty && !confirm('Ungespeicherte MCP-Änderungen verwerfen?')) return;
    mcpControls.disabled = true;
    return adminFetch('/mcp').then(mcpResult).then(function (data) {
      mcpState = data;
      mcpDirty = false;
      mcpTools = {};
      renderMcp();
      mcpControls.disabled = false;
      mcpMessage('', 'ok');
    }).catch(function (error) {
      mcpMessage(error.message || 'MCP-Konfiguration nicht verfügbar.', 'error');
    });
  }

  function mcpElement(tag, text, parent) {
    var element = document.createElement(tag);
    if (text) element.textContent = text;
    if (parent) parent.appendChild(element);
    return element;
  }

  function mcpFieldError(fieldId) {
    return fieldId ? document.getElementById(fieldId + '-error') : null;
  }

  function mcpClearFieldError(field) {
    field.removeAttribute('aria-invalid');
    var errorEl = mcpFieldError(field.id);
    if (errorEl) { errorEl.hidden = true; errorEl.textContent = ''; }
  }

  function mcpSetFieldError(fieldId, message) {
    var field = document.getElementById(fieldId);
    if (!field) return null;
    if (!message) { mcpClearFieldError(field); return null; }
    var errorEl = mcpFieldError(fieldId);
    if (errorEl) { errorEl.textContent = message; errorEl.hidden = false; }
    field.setAttribute('aria-invalid', 'true');
    return field.tagName === 'FIELDSET' ? (field.querySelector('input[type=checkbox]') || field) : field;
  }

  function mcpValidUrl(value) {
    try {
      var url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && !url.hash && !url.search;
    } catch (e) { return false; }
  }

  function mcpField(parent, labelText, value, change, multiline, fieldId) {
    var label = mcpElement('label', labelText, parent);
    var field = mcpElement(multiline ? 'textarea' : 'input', '', label);
    if (!multiline) field.type = 'text';
    field.value = value || '';
    field.autocomplete = 'off';
    if (fieldId) {
      field.id = fieldId;
      var errorEl = mcpElement('p', '', label);
      errorEl.id = fieldId + '-error';
      errorEl.className = 'hint error';
      errorEl.setAttribute('role', 'status');
      errorEl.hidden = true;
      field.setAttribute('aria-describedby', errorEl.id);
    }
    field.addEventListener('input', function () { change(field.value); mcpChanged(); if (fieldId) mcpClearFieldError(field); });
    return field;
  }

  function mcpChoices(parent, labelText, choices, selected, change, emptyText, groupId) {
    var group = mcpElement('fieldset', '', parent);
    if (groupId) { group.id = groupId; group.tabIndex = -1; }
    var legend = mcpElement('legend', labelText, group);
    var count = mcpElement('span', '', legend);
    count.className = 'mcp-selection-count';
    count.setAttribute('role', 'status');
    var search;
    if (choices.length > 6) {
      var searchLabel = mcpElement('label', 'Auswahl filtern', group);
      searchLabel.className = 'mcp-filter';
      search = mcpElement('input', '', searchLabel);
      search.type = 'search';
      search.setAttribute('aria-label', labelText + ' filtern');
      search.autocomplete = 'off';
    }
    var list = mcpElement('div', '', group);
    list.className = 'mcp-choices';
    var noMatches = mcpElement('p', 'Keine Treffer.', group);
    noMatches.className = 'mcp-empty';
    noMatches.hidden = true;
    if (groupId) {
      var groupError = mcpElement('p', '', group);
      groupError.id = groupId + '-error';
      groupError.className = 'hint error';
      groupError.setAttribute('role', 'status');
      groupError.hidden = true;
      group.setAttribute('aria-describedby', groupError.id);
    }
    function updateCount() {
      count.textContent = list.querySelectorAll('input:checked').length + ' von ' + choices.length + ' ausgewählt';
    }
    if (search) search.addEventListener('input', function () {
      var query = search.value.trim().toLocaleLowerCase();
      var visible = 0;
      Array.from(list.children).forEach(function (label) {
        label.hidden = !label.textContent.toLocaleLowerCase().includes(query);
        if (!label.hidden) visible++;
      });
      noMatches.hidden = visible > 0;
    });
    if (!choices.length) mcpElement('p', emptyText, list).className = 'mcp-empty';
    choices.forEach(function (choice) {
      var label = mcpElement('label', '', list);
      var checkbox = mcpElement('input', '', label);
      checkbox.type = 'checkbox';
      checkbox.value = choice.id;
      checkbox.checked = selected.indexOf(choice.id) >= 0;
      var text = mcpElement('span', choice.name, label);
      if (choice.description) mcpElement('span', choice.description, text).className = 'mcp-choice-description';
      checkbox.addEventListener('change', function () {
        change(Array.from(list.querySelectorAll('input:checked')).map(function (input) { return input.value; }));
        updateCount();
        mcpChanged();
        if (groupId) mcpClearFieldError(group);
      });
    });
    updateCount();
    return group;
  }

  function mcpNewId(prefix, entries) {
    var index = 1;
    while (entries.some(function (entry) { return entry.id === prefix + index; })) index++;
    return prefix + index;
  }

  function renderMcp() {
    var sitesRoot = document.getElementById('mcp-sites');
    var serversRoot = document.getElementById('mcp-servers');
    sitesRoot.replaceChildren();
    serversRoot.replaceChildren();
    if (!mcpState.settings.sites.length) mcpElement('p', 'Noch keine Sites angelegt.', sitesRoot).className = 'mcp-empty';
    if (!mcpState.settings.servers.length) mcpElement('p', 'Noch keine MCP-Server angebunden.', serversRoot).className = 'mcp-empty';

    mcpState.settings.sites.forEach(function (site) {
      var entry = mcpElement('details', '', sitesRoot);
      entry.className = 'mcp-entry';
      entry.open = true;
      var summary = mcpElement('summary', site.name || site.id, entry);
      var fields = mcpElement('div', '', entry);
      fields.className = 'mcp-fields';
      mcpField(fields, 'Site-Name *', site.name, function (value) { site.name = value; summary.textContent = value || site.id; }, false, 'mcp-site-name-' + site.id).required = true;
      var idField = mcpField(fields, 'Site-ID', site.id, function () {});
      idField.readOnly = true;
      mcpChoices(entry, 'Registrierte Dashboards', mcpState.dashboards.map(function (dashboard) {
        return { id: dashboard.dashboardKey, name: dashboard.name + ' (' + dashboard.dashboardKey.slice(-8) + ')' };
      }), site.dashboardKeys, function (values) { site.dashboardKeys = values; }, 'Noch keine Dashboards registriert.');
      mcpChoices(entry, 'Lokale Benutzer', mcpState.users, site.members, function (values) {
        var known = mcpState.users.map(function (user) { return user.id; });
        site.members = site.members.filter(function (member) { return known.indexOf(member) < 0; }).concat(values);
      }, 'Keine aktiven lokalen Benutzer.');
      var extraFields = mcpElement('div', '', entry);
      extraFields.className = 'mcp-fields';
      var knownUsers = mcpState.users.map(function (user) { return user.id; });
      mcpField(extraFields, 'Weitere Identitäten (eine pro Zeile, Format oidc:<Subject> — Subject-Wert nach der ersten SSO-Anmeldung unter Benutzerkonten → Benutzerzugriff ablesen)', site.members.filter(function (member) { return knownUsers.indexOf(member) < 0; }).join('\n'), function (value) {
        site.members = site.members.filter(function (member) { return knownUsers.indexOf(member) >= 0; }).concat(value.split(/\r?\n/).map(function (item) { return item.trim(); }).filter(Boolean));
      }, true);
      var remove = mcpElement('button', 'Site entfernen', entry);
      remove.type = 'button';
      remove.className = 'danger';
      remove.addEventListener('click', function () {
        if (!confirm('Site und zugehörige MCP-Freigaben entfernen?')) return;
        mcpState.settings.sites = mcpState.settings.sites.filter(function (item) { return item !== site; });
        mcpState.settings.servers.forEach(function (server) { server.siteIds = server.siteIds.filter(function (id) { return id !== site.id; }); });
        mcpChanged(); renderMcp();
      });
    });

    mcpState.settings.servers.forEach(function (server) {
      var entry = mcpElement('details', '', serversRoot);
      entry.className = 'mcp-entry';
      entry.open = true;
      var summary = mcpElement('summary', server.name || server.id, entry);
      var fields = mcpElement('div', '', entry);
      fields.className = 'mcp-fields';
      mcpField(fields, 'Server-Name *', server.name, function (value) { server.name = value; summary.textContent = value || server.id; }, false, 'mcp-server-name-' + server.id).required = true;
      mcpField(fields, 'HTTPS-Endpunkt (Streamable HTTP) *', server.url, function (value) { server.url = value.trim(); server.tools = []; delete mcpTools[server.id]; renderTools(); }, false, 'mcp-server-url-' + server.id).required = true;
      mcpField(fields, 'Secret-Referenz (optional, OVP_MCP_...)', server.tokenEnv, function (value) {
        if (value.trim()) server.tokenEnv = value.trim(); else delete server.tokenEnv;
        server.tools = []; delete mcpTools[server.id]; renderTools();
      }, false, 'mcp-server-token-' + server.id);
      var enabledLabel = mcpElement('label', '', entry);
      var enabled = mcpElement('input', '', enabledLabel);
      enabled.type = 'checkbox'; enabled.checked = server.enabled;
      mcpElement('span', ' Aktiviert', enabledLabel);
      enabled.addEventListener('change', function () { server.enabled = enabled.checked; mcpChanged(); });
      var toolsRoot = mcpElement('div', '', entry);
      function renderTools() {
        toolsRoot.replaceChildren();
        var tools = (mcpTools[server.id] || []).slice();
        server.tools.forEach(function (name) {
          if (!tools.some(function (tool) { return tool.name === name; })) tools.push({ name: name, description: 'Gespeicherte Freigabe; Verbindung erneut prüfen.' });
        });
        mcpChoices(toolsRoot, 'Freigegebene lesende Tools *', tools.map(function (tool) { return { id: tool.name, name: tool.name, description: tool.description }; }), server.tools, function (values) { server.tools = values; }, 'Keine lesenden Tools ausgewählt.', 'mcp-server-tools-' + server.id);
      }
      renderTools();
      mcpChoices(entry, 'Für Sites verfügbar', mcpState.settings.sites.map(function (site) { return { id: site.id, name: site.name || site.id }; }), server.siteIds, function (values) { server.siteIds = values; }, 'Noch keine Sites angelegt.');
      var result = mcpElement('p', '', entry);
      result.setAttribute('role', 'status');
      var actions = mcpElement('div', '', entry); actions.className = 'row';
      var probe = mcpElement('button', 'Verbindung prüfen & Tools laden', actions); probe.type = 'button';
      probe.addEventListener('click', function () {
        probe.disabled = true; result.textContent = 'Verbindung wird geprüft …';
        var request = { id: server.id, url: server.url };
        if (server.tokenEnv) request.tokenEnv = server.tokenEnv;
        var destination = JSON.stringify(request);
        adminFetch('/mcp/probe', jsonRequest('POST', request)).then(mcpResult).then(function (data) {
          var current = { id: server.id, url: server.url };
          if (server.tokenEnv) current.tokenEnv = server.tokenEnv;
          if (JSON.stringify(current) !== destination) { result.textContent = 'Endpunkt geändert. Bitte erneut prüfen.'; return; }
          mcpTools[server.id] = data.tools;
          renderTools();
          result.textContent = data.tools.length ? data.tools.length + ' lesende Tools verfügbar.' : 'Verbindung hergestellt; keine unterstützten lesenden Tools verfügbar.';
        }).catch(function (error) { result.textContent = error.message; }).finally(function () { probe.disabled = false; });
      });
      var remove = mcpElement('button', 'Server entfernen', actions); remove.type = 'button'; remove.className = 'danger';
      remove.addEventListener('click', function () {
        if (!confirm('MCP-Server und alle Site-Freigaben entfernen?')) return;
        mcpState.settings.servers = mcpState.settings.servers.filter(function (item) { return item !== server; });
        mcpChanged(); renderMcp();
      });
    });
    renderMcpSummary();
  }

  document.getElementById('mcp-add-site').addEventListener('click', function () {
    if (mcpState.settings.sites.length >= 50) return mcpMessage('Maximal 50 Sites.', 'error');
    mcpState.settings.sites.push({ id: mcpNewId('site-', mcpState.settings.sites), name: '', members: [], dashboardKeys: [] });
    mcpChanged(); renderMcp();
  });
  document.getElementById('mcp-add-server').addEventListener('click', function () {
    if (mcpState.settings.servers.length >= 5) return mcpMessage('Maximal 5 MCP-Server.', 'error');
    mcpState.settings.servers.push({ id: mcpNewId('server-', mcpState.settings.servers), name: '', url: '', tools: [], siteIds: [], enabled: false });
    mcpChanged(); renderMcp();
  });
  document.getElementById('mcp-reload').addEventListener('click', loadMcp);

  function validateMcp() {
    var firstInvalid = null;
    function check(fieldId, message) {
      var invalidField = mcpSetFieldError(fieldId, message);
      if (invalidField && !firstInvalid) firstInvalid = invalidField;
    }
    mcpState.settings.sites.forEach(function (site) {
      check('mcp-site-name-' + site.id, site.name && site.name.trim() ? '' : 'Site-Name ist erforderlich.');
    });
    mcpState.settings.servers.forEach(function (server) {
      check('mcp-server-name-' + server.id, server.name && server.name.trim() ? '' : 'Server-Name ist erforderlich.');
      var url = (server.url || '').trim();
      var urlError = '';
      if (!url) urlError = 'HTTPS-Endpunkt ist erforderlich.';
      else if (url.length > 500) urlError = 'Adresse zu lang (max. 500 Zeichen).';
      else if (!mcpValidUrl(url)) urlError = 'Nur eine HTTPS-Adresse ohne Anmeldedaten, Anker (#) oder Query-Parameter (?), z. B. https://server.example.com/mcp';
      check('mcp-server-url-' + server.id, urlError);
      var tokenEnv = server.tokenEnv || '';
      check('mcp-server-token-' + server.id, tokenEnv && (tokenEnv.length > 100 || !/^OVP_MCP_[A-Z0-9_]+$/.test(tokenEnv)) ? 'Format: OVP_MCP_ gefolgt von Großbuchstaben, Ziffern oder _.' : '');
      var toolsError = '';
      if (!server.tools || server.tools.length < 1) toolsError = 'Mindestens ein lesendes Tool auswählen. Zuerst Verbindung prüfen.';
      else if (server.tools.length > 10) toolsError = 'Höchstens 10 Tools auswählen.';
      check('mcp-server-tools-' + server.id, toolsError);
    });
    return firstInvalid;
  }

  document.getElementById('mcp-save').addEventListener('click', function () {
    var firstInvalid = validateMcp();
    if (firstInvalid) {
      mcpMessage('Bitte die markierten Felder korrigieren.', 'error');
      firstInvalid.focus();
      return;
    }
    mcpControls.disabled = true;
    adminFetch('/mcp', jsonRequest('PUT', { settings: mcpState.settings, revision: mcpState.revision })).then(mcpResult).then(function (data) {
      mcpState.revision = data.revision;
      mcpDirty = false;
      mcpMessage('Gespeichert. Site-Freigaben gelten für die nächsten Tool-Aufrufe.', 'ok');
    }).catch(function (error) { mcpMessage(error.message, 'error'); }).finally(function () { mcpControls.disabled = false; });
  });
`;