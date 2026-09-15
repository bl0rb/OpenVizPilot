import { TableauError, isTableauError } from './errors';
import type { TableauClient, TableauSignInUser } from './client';
import type { TableauConfig } from './config';
import { tableauMetadataFieldSchema, tableauMetadataSearchSchema, type TableauMetadataFieldInput, type TableauMetadataSearchInput } from './metadata-schema';
import { METADATA_FIELD_QUERY, METADATA_SEARCH_QUERY } from './metadata-queries';

const OPERATION_DEADLINE_MS = 10_000;
const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_OUTPUT_BYTES = 20_000;
const MAX_OUTPUT_TEXT = 512;
const MAX_OUTPUT_FORMULA = 4_096;
const SEARCH_PAGE_SIZE = 100;
const SEARCH_SCAN_LIMIT = 500;
const UPSTREAM_FIELD_LIMIT = 10;
const UPSTREAM_COLUMN_LIMIT = 10;
const DOWNSTREAM_SHEET_LIMIT = 20;
const DOWNSTREAM_WORKBOOK_LIMIT = 20;

type MetadataClient = Pick<TableauClient, 'queryMetadata'>;
type MetadataObject = Record<string, unknown>;

export interface TableauMetadataDatasource {
  id: string;
  name?: string;
}

export interface TableauMetadataItem {
  id: string;
  type: string;
  name?: string;
  description?: string;
  dataType?: string;
  formula?: string;
  datasource?: TableauMetadataDatasource;
}

export interface TableauMetadataColumn {
  id: string;
  name?: string;
  table?: { id: string; name?: string };
}

export interface TableauMetadataSheet {
  id: string;
  name?: string;
  workbook?: { id: string; name?: string };
}

export interface TableauMetadataField extends TableauMetadataItem {
  upstream: {
    fields: TableauMetadataItem[];
    columns: TableauMetadataColumn[];
  };
  downstream: {
    sheets: TableauMetadataSheet[];
    workbooks: TableauMetadataItem[];
  };
}

export interface TableauMetadataSearchResult {
  source: 'Tableau Metadata API';
  retrievedAt: string;
  items: TableauMetadataItem[];
  truncated: boolean;
  scanned: number;
  limitations: string[];
}

export interface TableauMetadataFieldResult {
  source: 'Tableau Metadata API';
  retrievedAt: string;
  field: TableauMetadataField | null;
  truncated: boolean;
  limitations: string[];
}

export type { TableauMetadataSearchInput, TableauMetadataFieldInput } from './metadata-schema';

function objectValue(value: unknown): MetadataObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as MetadataObject : undefined;
}

function isRedacted(value: string): boolean {
  const normalized = value.trim().toLocaleLowerCase();
  return normalized === 'redacted'
    || normalized === '[redacted]'
    || normalized === 'obfuscated'
    || normalized === '[obfuscated]';
}

function safeString(value: unknown): string | undefined {
  return typeof value === 'string' && !isRedacted(value) ? value : undefined;
}

function requiredString(value: unknown): string | undefined {
  const result = safeString(value);
  return result && result.trim().length > 0 ? result : undefined;
}

function addLimitation(limitations: string[], message: string): void {
  if (!limitations.includes(message)) limitations.push(message);
}

function metadataFailure(): TableauError {
  return new TableauError('TABLEAU_METADATA_FAILED');
}

function invalidInput(): TableauError {
  return new TableauError('TABLEAU_QUERY_INVALID');
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new TableauError('TABLEAU_ABORTED');
}

function responseWithinBudget(value: unknown): void {
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== 'string' || Buffer.byteLength(serialized, 'utf8') > MAX_RESPONSE_BYTES) {
      throw new TableauError('TABLEAU_RESPONSE_TOO_LARGE');
    }
  } catch (error) {
    if (isTableauError(error)) throw error;
    throw metadataFailure();
  }
}

function parseGraphqlResponse(value: unknown): MetadataObject {
  responseWithinBudget(value);
  const root = typeof value === 'string'
    ? (() => {
        try { return JSON.parse(value) as unknown; } catch { throw metadataFailure(); }
      })()
    : value;
  const rootObject = objectValue(root);
  if (!rootObject) throw metadataFailure();
  if (Object.prototype.hasOwnProperty.call(rootObject, 'errors')) {
    const errors = rootObject.errors;
    if (!Array.isArray(errors) || errors.length > 0) throw metadataFailure();
  }
  const data = objectValue(rootObject.data);
  if (!data) throw metadataFailure();
  return data;
}

function operationError(error: unknown): never {
  if (isTableauError(error)) throw error;
  throw metadataFailure();
}

function optionalText(record: MetadataObject, key: string): string | undefined {
  return safeString(record[key]);
}

function datasourceSummary(value: unknown): TableauMetadataDatasource | undefined {
  const datasource = objectValue(value);
  const id = requiredString(datasource?.id);
  const name = requiredString(datasource?.name);
  if (!id || !name) return undefined;
  return { id, name };
}

function baseItem(value: unknown, fallbackType?: string, includeFormula = true): TableauMetadataItem | undefined {
  const record = objectValue(value);
  const id = requiredString(record?.id);
  const name = requiredString(record?.name);
  const type = requiredString(record?.__typename) ?? fallbackType;
  if (!record || !id || !name || !type) return undefined;
  const result: TableauMetadataItem = { id, type, name };
  const description = optionalText(record, 'description');
  const dataType = optionalText(record, 'dataType');
  if (description !== undefined) result.description = description;
  if (dataType !== undefined) result.dataType = dataType;
  if (includeFormula && type === 'CalculatedField') {
    const formula = optionalText(record, 'formula');
    if (formula !== undefined) result.formula = formula;
  }
  const datasource = datasourceSummary(record.datasource);
  if (datasource) result.datasource = datasource;
  return result;
}

interface ConnectionPage {
  nodes: unknown[];
  hasNextPage: boolean;
}

function connectionPage(value: unknown, label: string, limit: number, limitations: string[], paginate = false): ConnectionPage {
  if (value === null || value === undefined) {
    addLimitation(limitations, `${label} was unavailable or redacted.`);
    return { nodes: [], hasNextPage: false };
  }
  const connection = objectValue(value);
  if (!connection) throw metadataFailure();
  const rawNodes = connection.nodes;
  if (rawNodes === null || rawNodes === undefined) {
    addLimitation(limitations, `${label} contained no visible nodes.`);
    return { nodes: [], hasNextPage: false };
  }
  if (!Array.isArray(rawNodes) || rawNodes.length > limit) throw metadataFailure();
  const pageInfo = objectValue(connection.pageInfo);
  const hasNextPage = pageInfo?.hasNextPage;
  if (typeof hasNextPage !== 'boolean') throw metadataFailure();
  if (hasNextPage) {
    if (!requiredString(pageInfo.endCursor)) throw metadataFailure();
    if (!paginate) addLimitation(limitations, `${label} is partial: only the first ${limit} authorized nodes were inspected.`);
  }
  return { nodes: rawNodes, hasNextPage };
}

function columnSummary(value: unknown): TableauMetadataColumn | undefined {
  const record = objectValue(value);
  const id = requiredString(record?.id);
  const name = requiredString(record?.name);
  if (!id || !name) return undefined;
  const result: TableauMetadataColumn = { id };
  result.name = name;
  const table = objectValue(record?.table);
  const tableId = requiredString(table?.id);
  const tableName = requiredString(table?.name);
  if (tableId && tableName) {
    result.table = { id: tableId, name: tableName };
  }
  return result;
}

function sheetSummary(value: unknown): TableauMetadataSheet | undefined {
  const record = objectValue(value);
  const id = requiredString(record?.id);
  const name = requiredString(record?.name);
  if (!id || !name) return undefined;
  const result: TableauMetadataSheet = { id };
  result.name = name;
  const workbook = objectValue(record?.workbook);
  const workbookId = requiredString(workbook?.id);
  const workbookName = requiredString(workbook?.name);
  if (workbookId && workbookName) {
    result.workbook = { id: workbookId, name: workbookName };
  }
  return result;
}

function addOmittedNodeLimitation(limitations: string[], label: string, before: number, after: number): void {
  if (after < before) addLimitation(limitations, `${label} node(s) were omitted because they were null, redacted, or lacked an opaque Metadata API id/type.`);
}

function projectOutputValue(value: unknown, key: string, limitations: string[]): unknown {
  if (typeof value === 'string') {
    if (key === 'formula' && value.length > MAX_OUTPUT_FORMULA) {
      addLimitation(limitations, 'A calculated-field formula exceeded the output budget and was omitted; no partial formula is returned.');
      return undefined;
    }
    if ((key === 'id' || key === 'type') && value.length > 2_000) throw metadataFailure();
    if ((key === 'name' || key === 'description') && value.length > MAX_OUTPUT_TEXT) {
      addLimitation(limitations, 'One or more metadata text values were shortened to keep the response bounded.');
      return `${value.slice(0, MAX_OUTPUT_TEXT)}...`;
    }
    return value;
  }
  if (Array.isArray(value)) return value.flatMap((item) => {
    const projected = projectOutputValue(item, key, limitations);
    return projected === undefined ? [] : [projected];
  });
  const object = objectValue(value);
  if (!object) return value;
  const projected: MetadataObject = {};
  for (const [childKey, childValue] of Object.entries(object)) {
    const child = projectOutputValue(childValue, childKey, limitations);
    if (child !== undefined) projected[childKey] = child;
  }
  return projected;
}

function outputBytes(value: unknown): number {
  const serialized = JSON.stringify(value);
  return typeof serialized === 'string' ? Buffer.byteLength(serialized, 'utf8') : Number.POSITIVE_INFINITY;
}

function outputArrays(value: unknown, result: unknown[][] = []): unknown[][] {
  if (Array.isArray(value)) {
    result.push(value);
    for (const item of value) outputArrays(item, result);
  } else {
    const object = objectValue(value);
    if (object) for (const [key, item] of Object.entries(object)) if (key !== 'limitations') outputArrays(item, result);
  }
  return result;
}

function fitOutput<T extends { truncated: boolean; limitations: string[] }>(result: T): T {
  const initialLimitationCount = result.limitations.length;
  const projected = projectOutputValue(result, '', result.limitations) as T;
  projected.limitations = result.limitations;
  if (projected.limitations.length > initialLimitationCount) projected.truncated = true;
  const arrays = outputArrays(projected).sort((left, right) => right.length - left.length);
  while (outputBytes(projected) > MAX_OUTPUT_BYTES) {
    const target = arrays.find((array) => array.length > 0);
    if (!target) throw metadataFailure();
    target.pop();
    projected.truncated = true;
    addLimitation(projected.limitations, 'Some bounded metadata items were omitted to keep the response under 20,000 bytes.');
  }
  return projected;
}

function normalizeSearchInput(input: TableauMetadataSearchInput): TableauMetadataSearchInput & { query: string; limit: number } {
  try {
    return tableauMetadataSearchSchema.parse(input);
  } catch {
    throw invalidInput();
  }
}

function normalizeFieldInput(input: TableauMetadataFieldInput): TableauMetadataFieldInput {
  try {
    return tableauMetadataFieldSchema.parse(input);
  } catch {
    throw invalidInput();
  }
}

function lower(value: string): string {
  return value.toLocaleLowerCase();
}

export class TableauMetadata {
  constructor(private readonly client: MetadataClient, private readonly config: TableauConfig) {
    // Keep the configured connector context part of this primitive's contract.
    void this.config;
  }

  private async withDeadline<T>(signal: AbortSignal | undefined, operation: (boundedSignal: AbortSignal) => Promise<T>): Promise<T> {
    if (signal?.aborted) throw new TableauError('TABLEAU_ABORTED');
    const controller = new AbortController();
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (timer !== undefined) clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback();
      };
      const onAbort = () => {
        controller.abort();
        finish(() => reject(new TableauError('TABLEAU_ABORTED')));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
        return;
      }
      timer = setTimeout(() => {
        controller.abort();
        finish(() => reject(new TableauError('TABLEAU_TIMEOUT')));
      }, OPERATION_DEADLINE_MS);
      void operation(controller.signal).then(
        value => finish(() => resolve(value)),
        error => finish(() => reject(error)),
      );
    });
  }

  private async execute(document: string, user: TableauSignInUser, variables: Record<string, unknown>, signal: AbortSignal): Promise<MetadataObject> {
    throwIfAborted(signal);
    try {
      return parseGraphqlResponse(await this.client.queryMetadata(user, document, variables, signal));
    } catch (error) {
      if (isTableauError(error)) throw error;
      operationError(error);
    }
  }

  async search(user: TableauSignInUser, input: TableauMetadataSearchInput, signal?: AbortSignal): Promise<TableauMetadataSearchResult> {
    const parsed = normalizeSearchInput(input);
    return this.withDeadline(signal, async (boundedSignal) => {
      const limitations = ['Search is limited to authorized Metadata API results and at most 500 retrieved fields.'];
      const items: TableauMetadataItem[] = [];
      const ids = new Set<string>();
      let scanned = 0;
      let truncated = false;
      let after: string | null = null;
      const seenCursors = new Set<string>();
      const query = lower(parsed.query);
      const datasourceId = parsed.datasourceId ? parsed.datasourceId : undefined;

      while (scanned < SEARCH_SCAN_LIMIT) {
        throwIfAborted(boundedSignal);
        if (after !== null) {
          if (seenCursors.has(after)) throw metadataFailure();
          seenCursors.add(after);
        }
        const pageSize = Math.min(SEARCH_PAGE_SIZE, SEARCH_SCAN_LIMIT - scanned);
        const data = await this.execute(METADATA_SEARCH_QUERY, user, {
          filter: parsed.query ? { text: parsed.query } : null,
          first: pageSize,
          after,
        }, boundedSignal);
        const root = data.fieldsConnection;
        const page = connectionPage(root, 'Search results', pageSize, limitations, true);
        if (page.nodes.length === 0 && page.hasNextPage) throw metadataFailure();
        if (scanned + page.nodes.length > SEARCH_SCAN_LIMIT) {
          const remaining = SEARCH_SCAN_LIMIT - scanned;
          scanned += remaining;
          truncated = true;
          break;
        }
        scanned += page.nodes.length;
        for (const rawNode of page.nodes) {
          const item = baseItem(rawNode, undefined, false);
          if (!item) {
            addLimitation(limitations, 'A null, redacted, or incomplete search node was omitted.');
            continue;
          }
          if (ids.has(item.id)) {
            addLimitation(limitations, 'A duplicate Metadata API field id was omitted.');
            continue;
          }
          ids.add(item.id);
          if (query && !lower(`${item.name ?? ''} ${item.id}`).includes(query)) continue;
          const rawRecord = objectValue(rawNode);
          const rawDatasource = objectValue(rawRecord?.datasource);
          const rawDatasourceId = requiredString(rawDatasource?.id);
          if (datasourceId && rawDatasourceId !== datasourceId) continue;
          if (items.length < parsed.limit) items.push(item);
          else truncated = true;
        }
        if (!page.hasNextPage) break;
        const pageInfo = objectValue(objectValue(root)?.pageInfo);
        const nextCursor = requiredString(pageInfo?.endCursor);
        if (!nextCursor || nextCursor === after) throw metadataFailure();
        after = nextCursor;
        if (scanned >= SEARCH_SCAN_LIMIT) truncated = true;
      }
      if (scanned >= SEARCH_SCAN_LIMIT) {
        if (truncated) addLimitation(limitations, 'The 500-record scan budget or requested result limit was reached; results are not server-wide complete.');
      }
      return fitOutput<TableauMetadataSearchResult>({
        source: 'Tableau Metadata API',
        retrievedAt: new Date().toISOString(),
        items,
        truncated,
        scanned,
        limitations,
      });
    });
  }

  async field(user: TableauSignInUser, input: TableauMetadataFieldInput, signal?: AbortSignal): Promise<TableauMetadataFieldResult> {
    const parsed = normalizeFieldInput(input);
    return this.withDeadline(signal, async (boundedSignal) => {
      const limitations = ['Lineage and impact are bounded to 10 upstream fields, 10 upstream columns, 20 downstream sheets, and 20 downstream workbooks.'];
      const data = await this.execute(METADATA_FIELD_QUERY, user, { filter: { id: parsed.fieldId }, first: 1 }, boundedSignal);
      const root = objectValue(data.fieldsConnection);
      if (!root) throw metadataFailure();
      const rootPage = connectionPage(root, 'Field lookup', 1, limitations);
      if (rootPage.nodes.length === 0) {
        addLimitation(limitations, 'The requested field was not returned by the authorized Metadata API query.');
        return fitOutput<TableauMetadataFieldResult>({
          source: 'Tableau Metadata API', retrievedAt: new Date().toISOString(), field: null,
          truncated: rootPage.hasNextPage, limitations,
        });
      }
      const rootItem = baseItem(rootPage.nodes[0]);
      if (rootItem && rootItem.id !== parsed.fieldId) throw metadataFailure();
      if (!rootItem) {
        addLimitation(limitations, 'The requested field was null, redacted, or incomplete and was omitted.');
        return fitOutput<TableauMetadataFieldResult>({
          source: 'Tableau Metadata API', retrievedAt: new Date().toISOString(), field: null,
          truncated: rootPage.hasNextPage, limitations,
        });
      }
      const rootRecord = objectValue(rootPage.nodes[0]);
      if (!rootRecord) throw metadataFailure();
      const upstreamFieldsPage = connectionPage(rootRecord.upstreamFieldsConnection, 'Upstream fields', UPSTREAM_FIELD_LIMIT, limitations);
      const upstreamColumnsPage = connectionPage(rootRecord.upstreamColumnsConnection, 'Upstream columns', UPSTREAM_COLUMN_LIMIT, limitations);
      const downstreamSheetsPage = connectionPage(rootRecord.downstreamSheetsConnection, 'Downstream sheets', DOWNSTREAM_SHEET_LIMIT, limitations);
      const downstreamWorkbooksPage = connectionPage(rootRecord.downstreamWorkbooksConnection, 'Downstream workbooks', DOWNSTREAM_WORKBOOK_LIMIT, limitations);
      const upstreamFields = upstreamFieldsPage.nodes.flatMap((node) => {
        const item = baseItem(node);
        if (!item) addLimitation(limitations, 'An upstream field node was omitted because it was null, redacted, or incomplete.');
        return item ? [item] : [];
      });
      const upstreamColumns = upstreamColumnsPage.nodes.flatMap((node) => {
        const item = columnSummary(node);
        if (!item) addLimitation(limitations, 'An upstream column node was omitted because it was null, redacted, or lacked an opaque Metadata API id.');
        return item ? [item] : [];
      });
      const downstreamSheets = downstreamSheetsPage.nodes.flatMap((node) => {
        const item = sheetSummary(node);
        if (!item) addLimitation(limitations, 'A downstream sheet node was omitted because it was null, redacted, or lacked an opaque Metadata API id.');
        return item ? [item] : [];
      });
      const downstreamWorkbooks = downstreamWorkbooksPage.nodes.flatMap((node) => {
        const item = baseItem(node, 'Workbook');
        if (!item) addLimitation(limitations, 'A downstream workbook node was omitted because it was null, redacted, or incomplete.');
        return item ? [item] : [];
      });
      addOmittedNodeLimitation(limitations, 'upstream field', upstreamFieldsPage.nodes.length, upstreamFields.length);
      addOmittedNodeLimitation(limitations, 'upstream column', upstreamColumnsPage.nodes.length, upstreamColumns.length);
      addOmittedNodeLimitation(limitations, 'downstream sheet', downstreamSheetsPage.nodes.length, downstreamSheets.length);
      addOmittedNodeLimitation(limitations, 'downstream workbook', downstreamWorkbooksPage.nodes.length, downstreamWorkbooks.length);
      const truncated = rootPage.hasNextPage
        || upstreamFieldsPage.hasNextPage
        || upstreamColumnsPage.hasNextPage
        || downstreamSheetsPage.hasNextPage
        || downstreamWorkbooksPage.hasNextPage;
      return fitOutput<TableauMetadataFieldResult>({
        source: 'Tableau Metadata API',
        retrievedAt: new Date().toISOString(),
        field: { ...rootItem, upstream: { fields: upstreamFields, columns: upstreamColumns }, downstream: { sheets: downstreamSheets, workbooks: downstreamWorkbooks } },
        truncated,
        limitations,
      });
    });
  }
}
