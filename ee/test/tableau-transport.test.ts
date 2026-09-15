import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { RequestOptions } from 'node:https';
import { describe, expect, it, vi } from 'vitest';
import { createTableauHttpsTransport, type TableauHttpsRequest } from '../server/src/tableau-server/http';

const request = { method: 'POST' as const, path: '/api/3.27/auth/signin', headers: {}, body: '{}' };
const lookup = async () => [{ address: '10.20.30.40', family: 4 as const }];

function wire(status: number, chunks: string[], end = true) {
  let captured: RequestOptions | undefined;
  const response = new EventEmitter() as IncomingMessage;
  response.headers = {};
  response.statusCode = status;
  response.destroy = vi.fn(() => response);
  const outgoing = new EventEmitter() as ClientRequest;
  outgoing.destroy = vi.fn(() => outgoing);
  outgoing.setTimeout = vi.fn(() => outgoing);
  const create: TableauHttpsRequest = (options, callback) => {
    captured = options;
    outgoing.end = (() => {
      queueMicrotask(() => {
        callback(response);
        chunks.forEach(chunk => response.emit('data', chunk));
        if (end) response.emit('end');
      });
      return outgoing;
    }) as ClientRequest['end'];
    return outgoing;
  };
  return { create, outgoing, captured: () => captured };
}

describe('Tableau HTTPS transport boundaries', () => {
  it('allows only the exact POST Metadata API endpoint', async () => {
    const socket = wire(200, ['{"data":{}}']);
    const transport = createTableauHttpsTransport('https://tableau.example.com', { lookup, request: socket.create });
    expect((await transport({ ...request, path: '/api/metadata/graphql' })).status).toBe(200);
    expect(socket.captured()).toMatchObject({ method: 'POST', path: '/api/metadata/graphql', rejectUnauthorized: true });
    for (const path of ['/metadata/graphiql/', '/api/metadata/graphql?query=other', '/api/metadata/graphql/']) {
      await expect(transport({ ...request, path })).rejects.toMatchObject({ code: 'TABLEAU_ENDPOINT_FORBIDDEN' });
    }
    await expect(transport({ ...request, method: 'GET', path: '/api/metadata/graphql' })).rejects.toMatchObject({ code: 'TABLEAU_ENDPOINT_FORBIDDEN' });
  });

  it('pins validated DNS and requires TLS verification without connection pooling', async () => {
    const socket = wire(200, ['{}']);
    const transport = createTableauHttpsTransport('https://tableau.example.com', { lookup, request: socket.create });
    expect((await transport(request)).body).toBe('{}');
    expect(socket.captured()).toMatchObject({ hostname: 'tableau.example.com', servername: 'tableau.example.com', rejectUnauthorized: true, agent: false, autoSelectFamily: false });
    const cb = vi.fn();
    (socket.captured()!.lookup as Function)('tableau.example.com', {}, cb);
    expect(cb).toHaveBeenCalledWith(null, '10.20.30.40', 4);
  });

  it('blocks all network access if DNS contains a forbidden address and rejects arbitrary paths', async () => {
    const create = vi.fn();
    const transport = createTableauHttpsTransport('https://tableau.example.com', {
      lookup: async () => [{ address: '127.0.0.1', family: 4 }], request: create,
    });
    await expect(transport(request)).rejects.toMatchObject({ code: 'TABLEAU_TARGET_BLOCKED' });
    await expect(transport({ ...request, path: '//other.example/api' })).rejects.toMatchObject({ code: 'TABLEAU_ENDPOINT_FORBIDDEN' });
    expect(create).not.toHaveBeenCalled();
  });

  it('bounds DNS resolution by the total deadline', async () => {
    const transport = createTableauHttpsTransport('https://tableau.example.com', { timeoutMs: 10, lookup: () => new Promise(() => {}) });
    await expect(transport(request)).rejects.toMatchObject({ code: 'TABLEAU_TIMEOUT' });
  });

  it('bounds responses that never finish, even without socket inactivity', async () => {
    const socket = wire(200, ['partial'], false);
    const transport = createTableauHttpsTransport('https://tableau.example.com', { timeoutMs: 10, lookup, request: socket.create });
    await expect(transport(request)).rejects.toMatchObject({ code: 'TABLEAU_TIMEOUT' });
    expect(socket.outgoing.destroy).toHaveBeenCalled();
  });

  it('rejects redirects and oversized response bodies', async () => {
    const redirect = wire(302, ['']);
    await expect(createTableauHttpsTransport('https://tableau.example.com', { lookup, request: redirect.create })(request))
      .rejects.toMatchObject({ code: 'TABLEAU_REDIRECT' });
    const huge = wire(200, ['12345']);
    await expect(createTableauHttpsTransport('https://tableau.example.com', { lookup, request: huge.create, maxResponseBytes: 4 })(request))
      .rejects.toMatchObject({ code: 'TABLEAU_RESPONSE_TOO_LARGE' });
    expect(huge.outgoing.destroy).toHaveBeenCalled();
  });
});
