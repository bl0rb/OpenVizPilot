<p align="center">
  <img src="docs/images/logo.svg" width="96" alt="OpenVizPilot logo" />
</p>

<h1 align="center">OpenVizPilot</h1>

<p align="center">A source-available AI copilot that lets you talk to your Tableau dashboards.</p>

<p align="center">
  <em>"Nice charts. And what do they mean?" — "Just ask them."</em>
</p>

<p align="center">
  <img src="docs/images/teaser.jpeg" width="620" alt="Two colleagues in front of a dashboard: one asks “Nice bars. And what does that mean?”, the other answers “Just ask them.”" />
</p>

OpenVizPilot is a Tableau dashboard extension with a chat UI that answers questions about the currently open dashboard. A lightweight Node.js middleware connects the extension to any existing OpenAI-compatible LLM endpoint (for example a LiteLLM proxy). The LLM queries dashboard data selectively via tool calling, and every data access happens in the viewer's own Tableau session, so nobody can ask for data they are not allowed to see.

## What it does

For dashboard users

- Ask in plain language: the LLM reads worksheet data, filters, parameters and selections through 10 read-only tools (5 tool rounds per question in Ask mode, 12 when investigating, 16 across the estate), including aggregation drilldowns (`aggregate_summary_data`: group by/sum/avg/min/max/count over summary data — no full-data permission required).
- Action chips (Enterprise, `actions`): the LLM proposes follow-up questions and dashboard actions — apply or clear filters, change parameters, highlight marks (for example “show me the top 3 regions”) and show or hide a dashboard zone. Actions run only on click, with the technical detail always shown in plain text — human-in-the-loop by design, which also reduces prompt injection risk. Without a license the model is not told the action syntax and never proposes one.
- It knows what you are looking at: the context lists which views are currently hidden behind a show/hide zone, so the assistant can say “that view is closed — shall I open it?” instead of describing something you cannot see. It also names the real controls of the dashboard when you ask where to change something. Mark highlights are counted too, not just what you click. The chat panel inherits the workbook font and text color so it does not stick out on a dashboard with a corporate theme.
- Transparency: analysis trace (every tool call is visible and expandable), source references in answers, transcript export as Markdown.
- Personal context: an author-managed glossary for everyone; with an Enterprise license also user memory (name/preferences, visible and deletable by the user) and saved queries — answer-focus onboarding plus up to 5 standard questions per dashboard.
- Slash commands: German and English prompt playbooks (for example `/summary` and `/compare`) with a picker menu in the chat.

For administrators (`/admin` — the first visitor sets the admin password on first access, in a PaddleDoc-style flow; a static `OVP_ADMIN_TOKEN` also works; that initial admin can grant the **Admin** role to user accounts or SSO identities, which then sign in to `/admin` with their own account but cannot grant the role themselves)

- Extension manifest download: enter the public HTTPS URL, get the ready-made `openvizpilot.trex`; the extension then talks to the origin it was loaded from, and nothing else has to be configured.
- Model catalog: look up the models your endpoint offers and map them to friendly display names shown in the extension; the catalog is enforced on the chat endpoint.
- Enterprise MCP: connect approved read-only sources and web-search services in the admin UI, assign them to managed sites, dashboards and authenticated members, and require consent before external queries. See [MCP setup and permission boundaries](docs/mcp.md).
- Tableau Server integration (Enterprise): optional Connected-App/JWT sign-in, REST content search and Metadata API are implemented for Tableau Server 2024.2 or newer; status and scope are documented in [docs/tableau-server.md](docs/tableau-server.md).
- Slash-command management: edit, add or reset the global playbooks centrally.
- Standard analyses per dashboard: embedded extensions register automatically after sign-in. Select a dashboard in the admin portal to configure up to five starter questions and its own slash commands. Global commands remain available; open extensions refresh within a minute. See [setup and workbook copies](docs/admin-deployment.md#standardanalysen-pro-dashboard).
- Anonymous usage: counters per model, tool, command and error, plus a per-dashboard view (questions, number of users, average and maximum questions per user) — users are counted only as non-reversible pseudonyms, never names, IDs or content.

Built-in guardrails

- Topic guard: a cheap classifier model checks every question server-side before the main LLM call; off-topic questions are refused without ever reaching the main model (`OVP_SCOPE_GUARD`, enabled by default) — on top of the scope rule in the system prompt.
- Data isolation: see below — the middleware has no Tableau identity at all.

## How it works

![Architecture: the chat extension runs inside the Tableau dashboard and executes tool calls in the viewer session, the stateless middleware injects system prompt and tool definitions and streams over SSE to an OpenAI-compatible LLM endpoint, an operational database holds settings, grants and user memory, and a separate Enterprise zone adds Tableau Server APIs, server-side view data, the Watch scheduler and the daily license heartbeat](docs/diagrams/architecture.png)

The extension executes the LLM's tool calls in the user's browser (Extensions API, viewer session); the middleware stays stateless, injects the system prompt and tool definitions, and streams via SSE.

📖 User guide: the [wiki](https://github.com/bl0rb/OpenVizPilot/wiki) explains the chat, slash commands, action chips and privacy for end users — in German and English.

## What you can ask

Everything below happens inside the open dashboard, in the viewer's own Tableau session: the assistant can only read data that this user is allowed to see — row-level security and user filters apply unchanged. It never changes the dashboard on its own; every change is a chip the user clicks.

| Ask it | What happens |
|---|---|
| “Summarize the dashboard briefly.” | Reads the key figures and active filters through tool calls and answers with a few core statements plus a compact metrics table; the central figures name the worksheet they came from. |
| “What stands out in the data? Name the three most important points.” | Aggregates summary data across all reader pages (`aggregate_summary_data`) and names outliers, weak categories and unusual ratios — with figures, not impressions. |
| `/compare North South` | Groups both sides and returns a comparison table (metric · A · B · difference absolute and in %) plus a short reading of what drives the gap. Typed as a question it answers too, just without the fixed format. |
| `/top 5 products` | Produces a ranking with each entry's share of the total and a statement on concentration — how much the top entries actually account for. |
| “Which filters are active right now?” | Lists the filters per worksheet with their selected values, ranges and exclude mode — the answer says what the numbers are currently based on. |
| “Show only the North region.” | With an Enterprise license (`actions`), offers the filter as an action chip for the worksheet in question, spelled out in plain text; it is applied only when the user clicks. Chips set categorical values — date ranges are chosen in the dashboard itself. |
| “What have I selected right now?” | Reads the selected marks — and if nothing is selected but something is highlighted (highlighter, legend, highlight action), it uses that and says so. |
| “Where do I change the region?” | Names the actual control on the dashboard (“Region”, filter control) instead of guessing a field, because the context knows the dashboard's zones. |
| “What does ‘Order details’ show?” | If Tableau reports that view's zone as hidden, the assistant says so instead of describing something the user cannot see — and offers to show it as a chip. |
| “Where does this number come from?” or `/lineage Revenue` | Answers with a fixed provenance chain: dashboard → worksheet → field (formula if Tableau Server metadata is available) → catalogue definition → data source and connection → upstream tables → active filters and parameters → certification status. Nothing is invented: what the APIs do not provide is marked “not available”. No server addresses leave the browser. |
| Switch the composer to **Investigate** and ask “Why did margin drop in the South?” | The assistant first writes a 3–6 step analysis plan, works through it with more tool rounds (`breakdown_by` for shares and concentration, `compare_periods` for period-over-period differences, aggregations), and closes with **Main cause**, **Evidence** and **Sources** — every claim backed by a tool result shown in the trail. |
| “Why is our revenue dropping? — across all workbooks” | With an Enterprise license (`serverData`) and scope switched to **Entire Tableau environment**, the assistant searches other workbooks/views (`tableau_server_search`), reads at most 5 of them server-side on the user's behalf, prefers a server-side aggregation over raw rows, and closes with **Main cause**, **Evidence** and **Sources** (workbook · view · link per source). Without the license or the per-person grant it explains that plainly and investigates only the open dashboard instead. |
| “What does contribution margin II mean?” | Answers from the glossary the workbook author maintains — house definitions instead of textbook knowledge. |
| “How high is our DB II?” | If the admin maintains the metric in the company-wide catalogue (`/admin` → “Kennzahlen”: definition, synonyms, owner, data source, verified questions), the assistant looks it up before answering and the answer carries a “✓ Verified definition: Deckungsbeitrag II” note — shown only when the lookup actually happened. |
| `/exec-brief for the board` | Produces a management summary with a fixed structure: key statements, main metrics with change, anomalies, up to three recommendations, data basis (worksheets, filters, as-of). Every answer can be downloaded as Markdown. |
| `/` in the input box | Opens the playbook menu: summary, findings, comparison, top-N, recommendations, report, data quality — admins can replace them and add their own per dashboard. |
| “Remember: numbers should always be presented as a table.” | With an Enterprise license and Tableau 2023.2 or newer, remembers the preference for this user; every stored fact stays visible and deletable in the settings panel. |
| “Let me know when margin drops below 20%.” | With an Enterprise license (`watch`, needs `serverData`), proposes a rule as a confirmation card (view, threshold, schedule, delivery channel) — nothing is created until the user confirms it. Once running, the middleware re-checks every guardrail on each evaluation and delivers a short message (webhook, Microsoft Teams or email) only on a state change. |
| “Write me a poem about cats.” | Declined with a short fixed message. The assistant answers dashboard questions only — the scope guard runs server-side, before the model sees the question. |

Every answer keeps its analysis trail: which tools ran on which worksheet, expandable down to the raw tool result — so a figure can be traced instead of believed.

## Examples

A summary on request. One click on “Summarize the dashboard briefly.” reads the metrics via tool calls and returns a structured summary of a profitability dashboard, including an overview of the other worksheets:

![Example: OpenVizPilot summarizes a profitability dashboard](docs/images/beispiel-dashboard.png)

An open question, answered with sources. “What stands out in the data? Name the three most important points.” — the assistant aggregates the summary data itself (the `aggregate_summary_data` call sits above the answer, expandable), names three findings with their figures and says for each one which worksheet it came from. The chips below continue the analysis; the badge in the header reports what changed in the dashboard — here the layout:

![Example: OpenVizPilot names the three most important findings in a profitability dashboard — profit ratio, weakest category, worst loss ratio — each with figures and its source worksheet](docs/images/three-things.png)

A filter as an action chip (Enterprise, `actions`). Asked to filter the order date to the last 90 days, the assistant does not touch the dashboard itself — it computes the date range, explains where the filter currently applies and offers the change as a chip. The filter is applied only when the user clicks it; the follow-up chips below continue the analysis on the filtered view:

![Example: the assistant proposes a “last 90 days” order-date filter as an action chip, applied only on click](docs/images/image_filter_1.png)

First contact and the slash menu. With an Enterprise license (`savedQueries`), a new user is first asked which answer focus they want for this dashboard (management summary, detailed analysis, compact tables, recommendations — or none); without it the starter chips appear right away. Typing `/` opens the playbook menu with the built-in German and English prompt presets:

![Example: onboarding question for the answer focus and the slash-command menu](docs/images/image_start.png)

Settings panel. Backend URL (empty = same origin, the recommended production setup), optional API token, model selection with the admin’s display names, the author-managed glossary — and, with an Enterprise license, the user’s stored memory facts (viewable, deletable) plus the per-dashboard answer focus and standard questions:

![Example: the extension settings panel](docs/images/image_settings.png)

## User memory, saved queries and dashboard actions (Enterprise)

`memory`, `savedQueries` and `actions` are Enterprise features and live in [`ee/`](ee/) (`actions` gates the
prompt section and client-side rendering in the core; see [`packages/server/src/system-prompt.ts`](packages/server/src/system-prompt.ts)).
Without a license the core runs unchanged, only without personalization and action chips: nothing is extracted, the answer focus is ignored, `/api/memory/prefs` returns `402 license_required`, the model is never told the action syntax and a chip never appears or executes. Reading and deleting already stored facts stays available regardless of the license (`GET`/`DELETE /api/memory`), so the rights of access and erasure never depend on a license key — and the settings panel keeps showing existing facts with their delete button.

Both need a user identity from Tableau (`uniqueUserId`, Extensions API 1.11), so they require Tableau 2023.2 or newer — on older versions the extension still runs, and the settings panel explains why the personal sections are missing instead of hiding them silently.

The middleware can remember personal facts per user (name, role, preferred views/formats) to personalize dashboard answers — identified via the obfuscated `uniqueUserId` of the Extensions API, stored in Postgres (on EKS via CloudNativePG; locally SQLite via `OVP_DATABASE_PATH`). A cheap model (`OVP_MEMORY_MODEL`) extracts the facts after each turn exclusively from the user’s messages — dashboard data and metrics never reach the extraction, and the prompt additionally forbids storing them. The topical scope stays strict: the assistant only answers dashboard questions. Users can view and delete their stored facts themselves in the settings panel (`GET`/`DELETE /api/memory`).

Saved queries are the second half: the answer focus a user picks for a dashboard and the standard questions they keep as start chips, stored per (user, dashboard) and served through `GET`/`PUT /api/memory/prefs`.

## Data isolation

Every user can only query data they can see in Tableau. All data access runs client-side through the Extensions API in the Tableau session of the signed-in user — row-level security and user filters apply automatically. The middleware has no Tableau identity (no service account, no PAT), caches no dashboard data, keeps no chat history — conversations live in the user’s browser — and logs metadata only (never message content or dashboard data). What it does store is the application’s own state: sign-in accounts and sessions, admin settings, anonymous usage counters and, with an Enterprise license, personal facts and saved queries per user. Prerequisite: RLS is modeled in the Tableau data sources (user filters/entitlement table); hierarchies such as branch manager → sales partner are handled there, not in this application. Watch and cross-dashboard investigation need their own explicit opt-in (site switch, per-person grant, user consent — see [docs/admin-deployment.md](docs/admin-deployment.md#serverseitiger-datenzugriff-tableau-views-außerhalb-des-dashboards)) for a bounded serverside read of another view's summary data; without it, everything stays in the browser as described above.

## Packages

| Package | Contents |
|---|---|
| `packages/shared` | Contract between both sides: zod schemas, SSE protocol, tool definitions, Markdown helpers, `.trex` template |
| `packages/server` | Middleware (Hono): `POST /api/chat` (SSE streaming), `GET /api/models`, admin API, `GET /healthz` |
| `packages/extension` | Dashboard extension (Vite + Preact): chat UI, context snapshot, tool executors, `.trex` manifest |

## Development

```bash
npm install
cp .env.example .env   # set OVP_LLM_BASE_URL, OVP_LLM_API_KEY, OVP_DEFAULT_MODEL
```

| Command | Purpose |
|---|---|
| `npm run dev` | Middleware (:3000) + extension (:5173) — for Tableau Desktop |
| `npm run dev:mock` | Same, but with a mock dashboard in the browser (no Tableau) |
| `npm run dev:demo` | Like `dev:mock`, plus a mock LLM server (:4010) — no LLM endpoint at all |
| `npm run dev:claude` | For Tableau Desktop, answers via the locally signed-in Claude Code CLI (:4020) — a real LLM without an API key (`.env`: `OVP_LLM_BASE_URL=http://localhost:4020`) |
| `npm test` | All unit/integration tests (vitest) |
| `npm run typecheck` | TypeScript across all packages |
| `npm run build` | Production build (server + extension) |

Testing with Tableau Desktop: run `npm run dev`, open a dashboard in Tableau, drag an “Extension” object onto the dashboard and pick [packages/extension/public/openvizpilot.dev.trex](packages/extension/public/openvizpilot.dev.trex) — this one points at the Vite dev server. (The manifest from the admin UI points at the middleware, which only serves the extension in production.) Debugging: start Tableau Desktop with `--remote-debugging-port=8696` and open Chrome at `http://localhost:8696`.

Testing without Tableau: run `npm run dev:demo` and open http://localhost:5173 — questions containing “Filter” or “Revenue” trigger tool calls in the mock LLM.

## Production (EKS + Helm)

The middleware runs stateless on EKS and scales horizontally (HPA) and vertically — chat history lives in the extension, user memory in Postgres with DB-side version checking, no sticky sessions. It also serves the extension's static files — one origin, no CORS. Deployment via the Helm chart [charts/openvizpilot](charts/openvizpilot/Chart.yaml), which optionally provisions a CloudNativePG Postgres cluster for user memory (operator required):

```bash
helm install openvizpilot oci://ghcr.io/bl0rb/charts/openvizpilot -f my-values.yaml
```

Image (`ghcr.io/bl0rb/openvizpilot`) and the chart are published by the GitHub workflows on `v*` tags (`.github/workflows/`: PR CI as the release gate, GHCR/OCI). Release images are signed keyless with Sigstore cosign (GitHub OIDC) and carry an SPDX SBOM attestation (signature and attestation are stored as Sigstore bundles next to the image, so use cosign 3.x), so you can check that an image was built by this repository's release workflow before deploying it:

```bash
cosign verify ghcr.io/bl0rb/openvizpilot:1.6.0 --certificate-oidc-issuer https://token.actions.githubusercontent.com --certificate-identity-regexp '^https://github.com/bl0rb/OpenVizPilot/'
```

The production manifest for Tableau comes straight from the admin UI (`/admin` → “Extension for Tableau”); alternatively, generate it from a checkout:

```bash
npm run build:trex -w @openvizpilot/extension -- --url https://chat.example.com/
```

Details (safelist, HTTPS, access protection, admin modes, memory and usage privacy): [docs/admin-deployment.md](docs/admin-deployment.md). The extension needs no full-data permission (summary data only).

### Configuration from a vault (Helm)

The chart never needs a secret in `values.yaml`: every sensitive value is read from an existing Kubernetes Secret (`existingSecret` + `key`), so a vault integration — External Secrets Operator, Vault Agent Injector, Secrets Store CSI — only has to materialise these keys. The plain-text fallbacks (`llm.apiKey`, `app.authToken`, `app.adminToken`) are for dev/CI only.

**Secrets — keep in the vault**

| Vault key → env var | `values.yaml` | Required | Purpose |
| --- | --- | --- | --- |
| `OVP_LLM_API_KEY` | `llm.apiKeySecret.{existingSecret,key}` | yes | API key for the OpenAI-compatible LLM endpoint |
| `OVP_API_AUTH_TOKEN` | `app.authTokenSecret.{existingSecret,key}` | `auth.mode=token` | Shared bearer token the extension sends to `/api/*` |
| `OVP_ADMIN_TOKEN` | `app.adminTokenSecret.{existingSecret,key}` | token-mode admin | Initial admin for `/admin`; leave unset with memory enabled for password mode |
| `OVP_OIDC_CLIENT_SECRET` | `oidc.clientSecretSecret.{existingSecret,key}` | confidential OIDC clients | Client secret for Entra ID / Keycloak (public PKCE clients need none) |
| `OVP_LICENSE` | `license.{existingSecret,key}` | Enterprise | Signed licence key |
| `OVP_DATABASE_URL` | `memory.database.external.{existingSecret,key}` | `memory.database.mode=external` | Postgres URI (`postgresql://user:pass@host:5432/db`); with `mode=cnpg` the operator's `<release>-db-app`/`uri` is used |
| `OVP_SECRET_KEY` | `app.secretKeySecret.{existingSecret,key}` | secrets entered in the admin UI | ≥ 32 characters (`openssl rand -hex 32`); encrypts Tableau Connected-App secrets at rest (AES-256-GCM) |
| `OVP_SMTP_URL` | `smtp.urlSecret.{existingSecret,key}` | Watch email channel | SMTP URL for Watch alert emails, e.g. `smtps://user:pass@mail.example.com:465` |
| `OVP_TABLEAU_<NAME>` | `tableau.secretRefs[]` (`env`, `secretName`, `key`) | env-referenced site secrets | Connected-App secret per Tableau site, referenced by name in the admin UI instead of storing it in the DB |
| `OVP_MCP_<NAME>` | `mcp.secretRefs[]` (`env`, `secretName`, `key`) | MCP servers with tokens | Bearer token per MCP server, referenced by name in the admin UI |
| registry pull credentials | `imagePullSecrets` (list of `{ name }`) | `image.edition=enterprise` | `kubernetes.io/dockerconfigjson` secret with the customer's GHCR read token for the private `ghcr.io/bl0rb/openvizpilot-enterprise` package (`kubectl create secret docker-registry …`, see [docs/enterprise.md](docs/enterprise.md)) |

**Plain configuration — `values.yaml`, no vault needed**

| Env var | `values.yaml` | Purpose |
| --- | --- | --- |
| `OVP_LLM_BASE_URL` | `llm.baseUrl` | LLM endpoint (required) |
| `OVP_DEFAULT_MODEL`, `OVP_MODEL_ALLOWLIST` | `app.defaultModel`, `app.modelAllowlist` | Default model (required) and optional allow-list |
| `OVP_PUBLIC_URL` | `app.publicUrl` | HTTPS origin of the middleware (SSO redirect URI, OAuth 2.0 Trust issuer) |
| `OVP_ENVIRONMENT` | `app.environment` | `production` (default) \| `development` \| `test` \| `staging` — counted during licence activation |
| `OVP_AUTH_MODE` | `auth.mode` | `none` \| `token` \| `local` \| `oidc` |
| `OVP_OIDC_PROVIDER`, `OVP_OIDC_ISSUER`, `OVP_OIDC_CLIENT_ID`, `OVP_OIDC_SCOPES` | `oidc.*` | Identity provider (Enterprise); the issuer must be `https://` (plain `http://` only for localhost) |
| `OVP_SMTP_FROM` | `smtp.from` | Sender address for Watch alert emails (Enterprise) |
| `OVP_WATCH_ENABLED` | `app.watchEnabled` | Global switch for the Watch engine (default on; Enterprise) |
| `OVP_MEMORY_MODEL` | `memory.model` | Model for memory summaries |
| `OVP_SCOPE_GUARD`, `OVP_SCOPE_MODEL` | `app.scopeGuard`, `app.scopeModel` | Off-topic guard and its model |
| `OVP_LOG_LEVEL`, `PORT` | `app.logLevel`, `containerPort` | Logging and container port |

Example with one Secret synced from the vault:

```yaml
# my-values.yaml
llm:
  baseUrl: http://litellm.llm.svc.cluster.local:4000
  apiKeySecret: { existingSecret: openvizpilot-vault, key: OVP_LLM_API_KEY }
app:
  defaultModel: gpt-4.1
  publicUrl: https://chat.example.com
  adminTokenSecret: { existingSecret: openvizpilot-vault, key: OVP_ADMIN_TOKEN }
  secretKeySecret: { existingSecret: openvizpilot-vault, key: OVP_SECRET_KEY }
auth: { mode: oidc }
oidc:
  provider: entra
  issuer: https://login.microsoftonline.com/<tenant>/v2.0
  clientId: <client-id>
  clientSecretSecret: { existingSecret: openvizpilot-vault, key: OVP_OIDC_CLIENT_SECRET }
license:
  existingSecret: openvizpilot-vault
  key: OVP_LICENSE
memory:
  enabled: true
  database:
    mode: external
    external: { existingSecret: openvizpilot-vault, key: OVP_DATABASE_URL }
tableau:
  secretRefs:
    - { env: OVP_TABLEAU_SECRET_SALES, secretName: openvizpilot-vault, key: TABLEAU_SECRET_SALES }
```

```yaml
# External Secrets Operator: one ExternalSecret produces the Secret above
apiVersion: external-secrets.io/v1
kind: ExternalSecret
metadata: { name: openvizpilot-vault }
spec:
  secretStoreRef: { name: vault, kind: ClusterSecretStore }
  target: { name: openvizpilot-vault }
  dataFrom:
    - extract: { key: openvizpilot/prod }   # vault path holding the keys from the table
```

## Editions

OpenVizPilot is **source-available**, not open source. Everything outside `ee/` is the Core Edition under the [PolyForm Noncommercial license](LICENSE) — free for any noncommercial purpose; commercial use, including running it inside a company, requires an agreement. The Enterprise Edition — Single Sign-On (OIDC), user memory, saved queries, MCP sources, dashboard actions, the Tableau Server integration and license activation — lives in a private repository and is available to customers for source review under contract/NDA; **`ee/` in this (public) repository is a stub** with the same package name and exports but no-op implementations, so the Core Edition builds and runs standalone. The Enterprise image is published as `ghcr.io/bl0rb/openvizpilot-enterprise`, a private GHCR package — customers receive a read-only token to pull it (`imagePullSecrets` in the chart, see [docs/enterprise.md](docs/enterprise.md)). One licence covers one production installation; development, test and staging installations (`OVP_ENVIRONMENT`) are included. Enterprise features switch on once the installation has activated itself against WerkWorks (immediately at startup, or via an offline lease); after that, an unreachable service does not switch anything off for 30 days after the lease expires. Setup and feature details: [docs/enterprise.md](docs/enterprise.md).

## Manual test script

See [docs/testing.md](docs/testing.md).

## License

Core (everything outside `ee/`): [PolyForm Noncommercial 1.0.0](LICENSE) — the full source is public and free for any **noncommercial** purpose. Any commercial use, including internal use in a company and any form of resale or hosting for others, requires an agreement with WerkWorks (info@werkworks.de).

Enterprise Edition: proprietary — `ee/` in this repository is a stub; the full source and its license live in the private repository, available for review under contract/NDA, see [docs/enterprise.md](docs/enterprise.md#bezug-des-enterprise-images). Usable in production only with a valid license key.

This is deliberately **source-available**, not open source: the code is there to be read, audited and evaluated, not to be taken commercially without a contract.
