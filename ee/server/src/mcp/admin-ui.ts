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
`;

export const mcpAdminSection = `
    <section id="mcp-admin" aria-labelledby="mcp-heading">
      <div class="row" style="justify-content:space-between">
        <h2 id="mcp-heading">MCP &amp; Sites <small>Enterprise</small></h2>
        <button id="mcp-reload" type="button">Aktualisieren</button>
      </div>
      <p id="mcp-banner" class="banner" role="status" aria-live="polite"></p>
      <fieldset id="mcp-controls" disabled>
        <h3>Sites</h3>
        <div id="mcp-sites"></div>
        <button id="mcp-add-site" type="button">+ Site hinzufügen</button>
        <h3>MCP-Server</h3>
        <div id="mcp-servers"></div>
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

  function mcpField(parent, labelText, value, change, multiline) {
    var label = mcpElement('label', labelText, parent);
    var field = mcpElement(multiline ? 'textarea' : 'input', '', label);
    if (!multiline) field.type = 'text';
    field.value = value || '';
    field.autocomplete = 'off';
    field.addEventListener('input', function () { change(field.value); mcpChanged(); });
    return field;
  }

  function mcpChoices(parent, labelText, choices, selected, change, emptyText) {
    var group = mcpElement('fieldset', '', parent);
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
      mcpField(fields, 'Site-Name', site.name, function (value) { site.name = value; summary.textContent = value || site.id; });
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
      mcpField(extraFields, 'Weitere Identitäten (eine pro Zeile, z. B. oidc:subject)', site.members.filter(function (member) { return knownUsers.indexOf(member) < 0; }).join('\n'), function (value) {
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
      mcpField(fields, 'Server-Name', server.name, function (value) { server.name = value; summary.textContent = value || server.id; });
      mcpField(fields, 'HTTPS-Endpunkt (Streamable HTTP)', server.url, function (value) { server.url = value.trim(); server.tools = []; delete mcpTools[server.id]; renderTools(); });
      mcpField(fields, 'Secret-Referenz (optional, OVP_MCP_...)', server.tokenEnv, function (value) {
        if (value.trim()) server.tokenEnv = value.trim(); else delete server.tokenEnv;
        server.tools = []; delete mcpTools[server.id]; renderTools();
      });
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
        mcpChoices(toolsRoot, 'Freigegebene lesende Tools', tools.map(function (tool) { return { id: tool.name, name: tool.name, description: tool.description }; }), server.tools, function (values) { server.tools = values; }, 'Keine lesenden Tools ausgewählt.');
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
  document.getElementById('mcp-save').addEventListener('click', function () {
    mcpControls.disabled = true;
    adminFetch('/mcp', jsonRequest('PUT', { settings: mcpState.settings, revision: mcpState.revision })).then(mcpResult).then(function (data) {
      mcpState.revision = data.revision;
      mcpDirty = false;
      mcpMessage('Gespeichert. Site-Freigaben gelten für die nächsten Tool-Aufrufe.', 'ok');
    }).catch(function (error) { mcpMessage(error.message, 'error'); }).finally(function () { mcpControls.disabled = false; });
  });
`;