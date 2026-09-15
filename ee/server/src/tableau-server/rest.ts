import { TableauError, isTableauError } from './errors';
import type { TableauClient, TableauReadResource, TableauSignInUser } from './client';
import type { TableauConfig } from './config';
import { tableauSearchSchema, type TableauContent, type TableauSearchInput, type TableauSearchResult } from './schema';

type ContentResource = 'workbooks' | 'views' | 'projects' | 'datasources';
type ClientReader = Pick<TableauClient, 'read'>;

const PAGE_SIZE = 100;
const SEARCH_SCAN_LIMIT = 500;

interface Pagination {
  pageNumber: number;
  pageSize: number;
  totalAvailable: number;
}

interface ParsedCollection {
  records: Record<string, unknown>[];
  pagination: Pagination;
}

interface AuthorizedWorkbook {
  content: TableauContent;
  contentUrl?: string;
}

function invalidResponse(): TableauError {
  return new TableauError('TABLEAU_RESPONSE_INVALID');
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function requiredString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && /^[0-9]+$/.test(value)) return Number(value);
  return undefined;
}

function recordsValue(container: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const value = container[key];
  if (value === undefined || value === null) return [];
  const values = Array.isArray(value) ? value : [value];
  if (values.some((item) => !objectValue(item))) throw invalidResponse();
  return values as Record<string, unknown>[];
}

function parseCollection(value: unknown, resource: ContentResource, fallbackPage: number, fallbackSize: number): ParsedCollection {
  const root = objectValue(value);
  if (!root) throw invalidResponse();
  const container = objectValue(root[resource]);
  if (!container) throw invalidResponse();
  const itemKey = resource === 'datasources' ? 'datasource' : resource.slice(0, -1);
  const records = recordsValue(container, itemKey);
  const paginationValue = objectValue(root.pagination) ?? objectValue(container.pagination);
  const pageNumber = numberValue(paginationValue?.pageNumber) ?? fallbackPage;
  const pageSize = numberValue(paginationValue?.pageSize) ?? fallbackSize;
  const totalAvailable = numberValue(paginationValue?.totalAvailable);
  if (pageNumber !== fallbackPage
    || pageSize !== fallbackSize
    || pageNumber < 1
    || pageSize < 1
    || totalAvailable === undefined
    || totalAvailable < records.length
    || records.length > pageSize
    || (records.length === 0 && totalAvailable > 0)) throw invalidResponse();
  return { records, pagination: { pageNumber, pageSize, totalAvailable } };
}

function childObject(record: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  return objectValue(value);
}

function nestedIdentity(record: Record<string, unknown> | undefined): { id: string; name?: string } | undefined {
  const id = requiredString(record?.id);
  if (!id) return undefined;
  const name = optionalString(record?.name);
  return name === undefined ? { id } : { id, name };
}

function readTags(record: Record<string, unknown>): string[] {
  const tags = record.tags;
  if (tags === undefined || tags === null) return [];
  const tagObject = objectValue(tags);
  if (!tagObject) throw invalidResponse();
  const values = tagObject.tag === undefined || tagObject.tag === null
    ? []
    : Array.isArray(tagObject.tag) ? tagObject.tag : [tagObject.tag];
  return values.flatMap((tag) => {
    const label = requiredString(objectValue(tag)?.label);
    return label ? [label] : [];
  });
}

function safeUpstreamUrl(value: unknown, origin: URL): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.origin !== origin.origin || url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function safeViewUrl(contentUrl: unknown, origin: URL, siteContentUrl: string): string | undefined {
  if (typeof contentUrl !== 'string') return undefined;
  const match = /^([^/]+)\/sheets\/([^/]+)$/.exec(contentUrl);
  if (!match) return undefined;
  const workbook = match[1]!;
  const view = match[2]!;
  if ([workbook, view].some((part) => part === '.' || part === '..' || /[\\?#\u0000-\u001f]/.test(part))) return undefined;
  const site = siteContentUrl.length > 0 ? `/site/${encodeURIComponent(siteContentUrl)}` : '';
  return `${origin.origin}/#${site}/views/${encodeURIComponent(workbook)}/${encodeURIComponent(view)}`;
}

function normalizeRecord(
  record: Record<string, unknown>,
  resource: ContentResource,
  origin: URL,
  siteContentUrl: string,
  workbooks: ReadonlyMap<string, AuthorizedWorkbook>,
): TableauContent {
  const id = requiredString(record.id);
  if (!id) throw invalidResponse();
  const type: TableauContent['type'] = resource === 'datasources' ? 'datasource' : resource.slice(0, -1) as TableauContent['type'];
  const name = requiredString(record.name) ?? id;
  const workbook = type === 'view' ? workbooks.get(requiredString(childObject(record, 'workbook')?.id) ?? '') : undefined;
  const upstreamUrl = safeUpstreamUrl(record.webpageUrl, origin);
  const content: TableauContent = {
    type,
    id,
    name,
    tags: readTags(record),
  };
  if (upstreamUrl) content.url = upstreamUrl;
  else if (type === 'view') {
    const viewUrl = safeViewUrl(record.contentUrl, origin, siteContentUrl);
    if (viewUrl) content.url = viewUrl;
  }
  const updatedAt = optionalString(record.updatedAt);
  if (updatedAt !== undefined) content.updatedAt = updatedAt;
  if (type === 'view') {
    if (workbook?.content.project) content.project = workbook.content.project;
    if (workbook?.content.owner) content.owner = workbook.content.owner;
  } else {
    const project = nestedIdentity(childObject(record, 'project'));
    const owner = nestedIdentity(childObject(record, 'owner'));
    if (project) content.project = project;
    if (owner) content.owner = owner;
  }
  return content;
}

function errorCode(error: unknown): string {
  return isTableauError(error) ? error.code : 'TABLEAU_REQUEST_FAILED';
}

function versionPair(value: string): [number, number] | undefined {
  const match = /^(\d+)\.(\d+)/.exec(value.trim());
  return match ? [Number(match[1]), Number(match[2])] : undefined;
}

function atLeast(value: string, required: [number, number]): boolean {
  const pair = versionPair(value);
  return pair ? pair[0] > required[0] || (pair[0] === required[0] && pair[1] >= required[1]) : false;
}

function versionField(value: unknown): string | undefined {
  const object = objectValue(value);
  return requiredString(object?.value) ?? requiredString(value);
}

function fatalOperationError(error: unknown): boolean {
  return isTableauError(error) && [
    'TABLEAU_ABORTED',
    'TABLEAU_TIMEOUT',
    'TABLEAU_SIGNIN_INVALIDATED',
    'TABLEAU_IDENTITY_EXPIRED',
  ].includes(error.code);
}

export class TableauRest {
  private readonly origin: URL;

  constructor(private readonly client: ClientReader, private readonly config: TableauConfig) {
    this.origin = new URL(config.serverUrl);
  }

  private async readPage(user: TableauSignInUser, resource: ContentResource, pageNumber: number, pageSize: number, signal: AbortSignal): Promise<ParsedCollection> {
    const value = await this.client.read(user, resource, { pageNumber, pageSize }, signal);
    return parseCollection(value, resource, pageNumber, pageSize);
  }

  private async withDeadline<T>(signal: AbortSignal | undefined, operation: (boundedSignal: AbortSignal) => Promise<T>): Promise<T> {
    if (signal?.aborted) throw new TableauError('TABLEAU_ABORTED');
    const controller = new AbortController();
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout>;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        callback();
      };
      const onAbort = () => {
        controller.abort();
        finish(() => reject(new TableauError('TABLEAU_ABORTED')));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => {
        controller.abort();
        finish(() => reject(new TableauError('TABLEAU_TIMEOUT')));
      }, 10_000);
      Promise.resolve()
        .then(() => operation(controller.signal))
        .then(
          value => finish(() => resolve(value)),
          error => finish(() => reject(error)),
        );
    });
  }

  async list(
    user: TableauSignInUser,
    resource: ContentResource,
    options: { limit?: number; signal?: AbortSignal } = {},
  ): Promise<{ items: TableauContent[]; truncated: boolean; scanned: number }> {
    const limit = options.limit ?? 500;
    if (!['workbooks', 'views', 'projects', 'datasources'].includes(resource)
      || !Number.isInteger(limit)
      || limit < 1
      || limit > 500) throw new TableauError('TABLEAU_QUERY_INVALID');
    return this.withDeadline(options.signal, async (signal) => {
      const items: TableauContent[] = [];
      const workbooks = new Map<string, AuthorizedWorkbook>();
      let scanned = 0;
      let truncated = false;
      let pageNumber = 1;
      const pageSize = Math.min(PAGE_SIZE, limit);
      while (items.length < limit) {
        const page = await this.readPage(user, resource, pageNumber, pageSize, signal);
        if (page.pagination.totalAvailable > limit) truncated = true;
        for (const record of page.records) {
          scanned += 1;
          const item = normalizeRecord(record, resource, this.origin, this.config.siteContentUrl, workbooks);
          if (resource === 'workbooks') workbooks.set(item.id, { content: item, contentUrl: requiredString(record.contentUrl) });
          if (items.length < limit) items.push(item);
        }
        const hasMore = page.pagination.totalAvailable > page.pagination.pageNumber * page.pagination.pageSize;
        if (!hasMore) break;
        if (items.length >= limit) { truncated = true; break; }
        pageNumber = page.pagination.pageNumber + 1;
      }
      return { items, truncated, scanned };
    });
  }

  async check(user: TableauSignInUser, signal?: AbortSignal): Promise<{
    ok: boolean;
    stage: 'connection';
    serverVersion: string;
    apiVersion: string;
    checks: Array<{ resource: string; ok: boolean; code?: string }>;
  }> {
    return this.withDeadline(signal, async (boundedSignal) => {
      let serverVersion = '';
      let apiVersion = '';
      let compatibility = false;
      let serverInfoError: string | undefined;
      try {
        const value = await this.client.read(user, 'serverinfo', undefined, boundedSignal);
        const root = objectValue(value);
        const info = objectValue(root?.serverInfo);
        serverVersion = versionField(info?.productVersion) ?? '';
        apiVersion = versionField(info?.restApiVersion) ?? '';
        compatibility = atLeast(serverVersion, [2025, 3]) && atLeast(apiVersion, [3, 27]);
        if (!serverVersion || !apiVersion) serverInfoError = 'TABLEAU_RESPONSE_INVALID';
        else if (!compatibility) serverInfoError = 'TABLEAU_VERSION_UNSUPPORTED';
      } catch (error) {
        if (fatalOperationError(error)) throw error;
        serverInfoError = errorCode(error);
      }

      const checks: Array<{ resource: string; ok: boolean; code?: string }> = [{
        resource: 'serverinfo',
        ok: !serverInfoError && compatibility,
        ...(serverInfoError ? { code: serverInfoError } : {}),
      }];
      for (const resource of ['workbooks', 'views', 'projects', 'datasources'] as const) {
        try {
          const page = await this.readPage(user, resource, 1, 1, boundedSignal);
          if (page.pagination.pageNumber !== 1 || page.pagination.pageSize < 1) throw invalidResponse();
          checks.push({ resource, ok: true });
        } catch (error) {
          if (fatalOperationError(error)) throw error;
          checks.push({ resource, ok: false, code: errorCode(error) });
        }
      }
      return { ok: compatibility && !serverInfoError && checks.every((check) => check.ok), stage: 'connection' as const, serverVersion, apiVersion, checks };
    });
  }

  async search(user: TableauSignInUser, input: TableauSearchInput, signal?: AbortSignal): Promise<TableauSearchResult> {
    const parsed = tableauSearchSchema.parse(input);
    return this.withDeadline(signal, async (boundedSignal) => {
      const items: TableauContent[] = [];
      const workbooks = new Map<string, AuthorizedWorkbook>();
      const limitations = ['Search scans authorized Tableau content only and is not a server-wide completeness guarantee.'];
      let scanned = 0;
      let truncated = false;
      let missingViewParents = 0;
      const resources: ContentResource[] = parsed.type === 'workbook' ? ['workbooks'] : ['workbooks', 'views'];
      // Stable page sizes divide both 250-record budgets without over-fetching.
      const pageSize = resources.includes('views') ? 50 : PAGE_SIZE;

      const matches = (item: TableauContent): boolean => {
        const needle = parsed.query.toLocaleLowerCase();
        if (needle && !`${item.name} ${item.id}`.toLocaleLowerCase().includes(needle)) return false;
        if (parsed.project && !`${item.project?.name ?? ''} ${item.project?.id ?? ''}`.toLocaleLowerCase().includes(parsed.project.toLocaleLowerCase())) return false;
        if (parsed.owner && !`${item.owner?.name ?? ''} ${item.owner?.id ?? ''}`.toLocaleLowerCase().includes(parsed.owner.toLocaleLowerCase())) return false;
        if (parsed.tag && !item.tags.some((tag) => tag.toLocaleLowerCase().includes(parsed.tag!.toLocaleLowerCase()))) return false;
        return true;
      };

      for (const resource of resources) {
        if (scanned >= SEARCH_SCAN_LIMIT) { truncated = true; break; }
        const resourceBudget = resource === 'workbooks' && resources.includes('views') ? 250 : SEARCH_SCAN_LIMIT;
        const resourceStart = scanned;
        let pageNumber = 1;
        try {
          while (scanned < SEARCH_SCAN_LIMIT && scanned - resourceStart < resourceBudget) {
            const page = await this.readPage(user, resource, pageNumber, pageSize, boundedSignal);
            const remaining = Math.min(SEARCH_SCAN_LIMIT - scanned, resourceBudget - (scanned - resourceStart));
            const records = page.records.slice(0, remaining);
            if (page.records.length > records.length) truncated = true;
            for (const record of records) {
              scanned += 1;
              const item = normalizeRecord(record, resource, this.origin, this.config.siteContentUrl, workbooks);
              if (resource === 'workbooks') workbooks.set(item.id, { content: item, contentUrl: requiredString(record.contentUrl) });
              if (item.type === 'view' && !item.project && !item.owner) missingViewParents += 1;
              if (parsed.type !== 'view' || item.type === 'view') {
                if (matches(item)) {
                  if (items.length < parsed.limit) items.push(item);
                  else truncated = true;
                }
              }
            }
            const hasMore = page.pagination.totalAvailable > page.pagination.pageNumber * page.pagination.pageSize;
            if (!hasMore) break;
            if (records.length < page.records.length || scanned - resourceStart >= resourceBudget) { truncated = true; break; }
            pageNumber = page.pagination.pageNumber + 1;
          }
        } catch (error) {
          if (fatalOperationError(error)) throw error;
          truncated = true;
          limitations.push(`${resource} could not be read (${errorCode(error)}).`);
        }
      }
      if (missingViewParents > 0) limitations.push(`${missingViewParents} view result(s) had no authorized workbook parent metadata.`);
      if (truncated) limitations.push('The bounded scan or an endpoint limit stopped the search before all authorized records could be examined.');
      return { source: 'Tableau Server', retrievedAt: new Date().toISOString(), items, truncated, scanned, limitations };
    });
  }
}

export type { TableauContent, TableauSearchInput, TableauSearchResult } from './schema';
