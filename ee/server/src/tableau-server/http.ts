import dns from 'node:dns';
import type { ClientRequest, IncomingMessage } from 'node:http';
import https from 'node:https';
import type { RequestOptions } from 'node:https';
import net from 'node:net';
import { parseTableauServerOrigin } from './config';
import { TableauError } from './errors';

export const TABLEAU_REQUEST_TIMEOUT_MS = 10_000;
export const TABLEAU_MAX_RESPONSE_BYTES = 1_048_576;

export interface TableauTransportRequest {
  method: 'GET' | 'POST';
  path: string;
  headers: Readonly<Record<string, string>>;
  body?: string;
  signal?: AbortSignal;
}

export interface TableauTransportResponse {
  status: number;
  headers: Readonly<Record<string, string>>;
  body: string;
}

export type TableauTransport = (request: TableauTransportRequest) => Promise<TableauTransportResponse>;

export interface TableauResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type TableauDnsLookup = (hostname: string) => Promise<ReadonlyArray<TableauResolvedAddress>>;
export type TableauHttpsRequest = (options: RequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest;

export interface TableauHttpsTransportOptions {
  timeoutMs?: number;
  maxResponseBytes?: number;
  lookup?: TableauDnsLookup;
  request?: TableauHttpsRequest;
}

function ipv4IsForbidden(address: string): boolean {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return true;
  return octets[0] === 0
    || octets[0] === 127
    || (octets[0] === 169 && octets[1] === 254)
    || octets[0]! >= 224;
}

function ipv6Bytes(address: string): number[] | undefined {
  const normalized = address.toLowerCase().split('%')[0]!;
  const halves = normalized.split('::');
  if (halves.length > 2) return undefined;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const expand = (part: string[]): number[] | undefined => {
    const values: number[] = [];
    for (const item of part) {
      if (item.includes('.')) {
        if (item !== part.at(-1) || ipv4IsForbidden(item)) return undefined;
        const octets = item.split('.').map(Number);
        values.push((octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!);
      } else if (/^[0-9a-f]{1,4}$/.test(item)) {
        values.push(Number.parseInt(item, 16));
      } else {
        return undefined;
      }
    }
    return values;
  };
  const leftValues = expand(left);
  const rightValues = expand(right);
  if (!leftValues || !rightValues) return undefined;
  const missing = 8 - leftValues.length - rightValues.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return undefined;
  return [...leftValues, ...Array.from({ length: Math.max(0, missing) }, () => 0), ...rightValues]
    .flatMap((word) => [word >> 8, word & 0xff]);
}

/** Loopback/link-local/unspecified/multicast are blocked, including IPv4-mapped IPv6. */
export function isForbiddenTableauAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return ipv4IsForbidden(address);
  if (family !== 6) return true;
  const bytes = ipv6Bytes(address);
  if (!bytes || bytes.length !== 16) return true;
  const mapped = bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  if (mapped) return ipv4IsForbidden(bytes.slice(12).join('.'));
  const unspecified = bytes.every((byte) => byte === 0);
  const loopback = unspecified === false && bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1;
  const linkLocal = bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80;
  const multicast = bytes[0] === 0xff;
  return unspecified || loopback || linkLocal || multicast;
}

async function systemLookup(hostname: string): Promise<ReadonlyArray<TableauResolvedAddress>> {
  const entry = await dns.promises.lookup(hostname, { verbatim: true });
  return [{ address: entry.address, family: entry.family === 6 ? 6 : 4 }];
}

const ALLOWED_POST_PATHS = new Set(['/api/3.27/auth/signin', '/api/3.27/auth/signout', '/api/metadata/graphql']);

function isAllowedGetPath(path: string): boolean {
  try {
    const url = new URL(path, 'https://tableau.invalid');
    if (url.origin !== 'https://tableau.invalid' || url.hash || url.username || url.password) return false;
    if (url.pathname === '/api/3.27/serverinfo') return url.search === '';
    const match = /^\/api\/3\.27\/sites\/([^/?#]+)\/(workbooks|views|projects|datasources)$/.exec(url.pathname);
    if (!match) return false;
    const keys = [...url.searchParams.keys()];
    if (keys.some((key) => key !== 'pageSize' && key !== 'pageNumber') || new Set(keys).size !== keys.length) return false;
    for (const key of keys) {
      const value = url.searchParams.get(key)!;
      if (!/^[1-9][0-9]{0,3}$/.test(value)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function isAllowedRequest(request: TableauTransportRequest): boolean {
  return request.method === 'POST'
    ? ALLOWED_POST_PATHS.has(request.path)
    : request.method === 'GET' && isAllowedGetPath(request.path);
}

/** A deliberately narrow HTTPS transport for Phase 1 auth and Phase 2 content reads. */
export function createTableauHttpsTransport(serverUrl: string, options: TableauHttpsTransportOptions = {}): TableauTransport {
  const origin = parseTableauServerOrigin(serverUrl);
  const hostname = origin.hostname.replace(/^\[|\]$/g, '');
  const timeoutMs = options.timeoutMs ?? TABLEAU_REQUEST_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? TABLEAU_MAX_RESPONSE_BYTES;
  const lookup = options.lookup ?? systemLookup;
  const requestImpl = options.request ?? ((requestOptions, callback) => https.request(requestOptions, callback));

  return async (request) => {
    const deadline = Date.now() + timeoutMs;
    if (!isAllowedRequest(request)) {
      throw new TableauError('TABLEAU_ENDPOINT_FORBIDDEN');
    }
    if (request.signal?.aborted) throw new TableauError('TABLEAU_ABORTED');
    if (request.body && Buffer.byteLength(request.body, 'utf8') > maxResponseBytes) {
      throw new TableauError('TABLEAU_REQUEST_FAILED');
    }

    let resolved: ReadonlyArray<TableauResolvedAddress>;
    try {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new TableauError('TABLEAU_TIMEOUT');
      let timer: ReturnType<typeof setTimeout> | undefined;
      const abortPromise = request.signal
        ? new Promise<ReadonlyArray<TableauResolvedAddress>>((_, reject) => {
            request.signal!.addEventListener('abort', () => reject(new TableauError('TABLEAU_ABORTED')), { once: true });
          })
        : undefined;
      try {
        resolved = await Promise.race([
          lookup(hostname),
          new Promise<ReadonlyArray<TableauResolvedAddress>>((_, reject) => {
            timer = setTimeout(() => reject(new TableauError('TABLEAU_TIMEOUT')), remaining);
          }),
          ...(abortPromise ? [abortPromise] : []),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    } catch (error) {
      if (error instanceof TableauError) throw error;
      throw new TableauError(Date.now() >= deadline ? 'TABLEAU_TIMEOUT' : 'TABLEAU_REQUEST_FAILED');
    }
    if (resolved.length === 0 || resolved.some((entry) => isForbiddenTableauAddress(entry.address))) {
      throw new TableauError('TABLEAU_TARGET_BLOCKED');
    }
    const selected = resolved[0]!;

    return new Promise<TableauTransportResponse>((resolve, reject) => {
      let settled = false;
      let bytes = 0;
      const chunks: Buffer[] = [];
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        reject(new TableauError('TABLEAU_TIMEOUT'));
        return;
      }
      let outgoing: ClientRequest | undefined;
      let deadlineTimer!: ReturnType<typeof setTimeout>;
      const finishError = (error: TableauError) => {
        if (settled) return;
        settled = true;
        request.signal?.removeEventListener('abort', onAbort);
        clearTimeout(deadlineTimer);
        reject(error);
      };
      const finish = (response: TableauTransportResponse) => {
        if (settled) return;
        settled = true;
        request.signal?.removeEventListener('abort', onAbort);
        clearTimeout(deadlineTimer);
        resolve(response);
      };
      const onAbort = () => {
        outgoing?.destroy();
        finishError(new TableauError('TABLEAU_ABORTED'));
      };
      request.signal?.addEventListener('abort', onAbort, { once: true });
      if (request.signal?.aborted) {
        onAbort();
        return;
      }
      deadlineTimer = setTimeout(() => {
        outgoing?.destroy();
        finishError(new TableauError('TABLEAU_TIMEOUT'));
      }, remaining);

      const requestOptions = {
        protocol: 'https:',
        hostname,
        port: origin.port || 443,
        method: request.method,
        path: request.path,
        headers: request.headers,
        servername: hostname,
        agent: false,
        rejectUnauthorized: true,
        autoSelectFamily: false,
        signal: request.signal,
        lookup: (_hostname, lookupOptions, callback) => {
          if (lookupOptions.all) callback(null, [{ address: selected.address, family: selected.family }]);
          else callback(null, selected.address, selected.family);
        },
      } as RequestOptions & { autoSelectFamily: false };
      try {
        outgoing = requestImpl(requestOptions, (response) => {
          const responseHeaders: Record<string, string> = {};
          for (const [name, value] of Object.entries(response.headers)) {
            if (typeof value === 'string') responseHeaders[name] = value;
            else if (Array.isArray(value)) responseHeaders[name] = value.join(', ');
          }
          response.on('data', (chunk: Buffer | string) => {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            bytes += buffer.byteLength;
            if (bytes > maxResponseBytes) {
              response.destroy();
              outgoing?.destroy();
              finishError(new TableauError('TABLEAU_RESPONSE_TOO_LARGE'));
              return;
            }
            chunks.push(buffer);
          });
          response.once('end', () => {
            if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
              finishError(new TableauError('TABLEAU_REDIRECT', response.statusCode));
              return;
            }
            finish({ status: response.statusCode ?? 0, headers: responseHeaders, body: Buffer.concat(chunks).toString('utf8') });
          });
          response.once('error', () => finishError(new TableauError('TABLEAU_REQUEST_FAILED')));
        });
      } catch {
        clearTimeout(deadlineTimer);
        finishError(new TableauError('TABLEAU_REQUEST_FAILED'));
        return;
      }
      if (!outgoing) {
        clearTimeout(deadlineTimer);
        finishError(new TableauError('TABLEAU_REQUEST_FAILED'));
        return;
      }
      outgoing.setTimeout(remaining, () => {
        outgoing.destroy();
        clearTimeout(deadlineTimer);
        finishError(new TableauError('TABLEAU_TIMEOUT'));
      });
      outgoing.once('error', () => {
        clearTimeout(deadlineTimer);
        finishError(new TableauError('TABLEAU_REQUEST_FAILED'));
      });
      outgoing.end(request.body);
    });
  };
}
