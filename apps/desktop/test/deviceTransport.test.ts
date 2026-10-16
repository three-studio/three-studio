import { once } from 'node:events';
import {
  get as httpGet,
  type IncomingHttpHeaders,
  type RequestOptions,
  type Server,
} from 'node:http';
import { get as httpsGet } from 'node:https';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCertificate } from '../src/main/devices/certificate';
import type { DeviceRequestHandler } from '../src/main/devices/routes';
import { createDeviceListener } from '../src/main/devices/transport';

/*
 * The one handler under either transport, for real on loopback, and what the
 * HTTPS listener makes of a handshake that fails.
 */

const credentials = createCertificate(['localhost', '127.0.0.1'], Date.now());
const answerOk: DeviceRequestHandler = (_, response) => response.end('ok');

const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

async function listening(server: Server): Promise<number> {
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return (server.address() as AddressInfo).port;
}

interface Answer {
  status: number;
  body: string;
  headers: IncomingHttpHeaders;
}

function answerOf(get: typeof httpGet, options: RequestOptions & { ca?: string }): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const sent = get({ host: '127.0.0.1', path: '/', agent: false, ...options }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => (body += chunk));
      response.on('end', () =>
        resolve({ status: response.statusCode ?? 0, body, headers: response.headers }),
      );
    });
    sent.on('error', reject);
  });
}

/**
 * A handshake that failed, as the HTTPS server hears of it. Node's own
 * listener destroys the connection, so the socket stood in for has to allow it.
 */
function failedHandshake(server: Server, code: string, remoteAddress: string): void {
  const socket = { remoteAddress, destroy: () => undefined };
  server.emit('tlsClientError', Object.assign(new Error(code), { code }), socket);
}

describe('over HTTP', () => {
  it('answers plain HTTP, with no word of HTTPS', async () => {
    const port = await listening(createDeviceListener('http', answerOk));

    const answer = await answerOf(httpGet, { port });

    expect(answer.status).toBe(200);
    expect(answer.body).toBe('ok');
    expect(answer.headers['strict-transport-security']).toBeUndefined();
  });
});

describe('over HTTPS', () => {
  it('answers through the certificate, with no word of keeping to HTTPS', async () => {
    const port = await listening(createDeviceListener('https', answerOk, { credentials }));

    const answer = await answerOf(httpsGet, { port, ca: credentials.certificate });

    expect(answer.status).toBe(200);
    expect(answer.body).toBe('ok');
    // A phone told to keep to HTTPS would refuse the next certificate made
    // for this computer, with nothing to press to accept it.
    expect(answer.headers['strict-transport-security']).toBeUndefined();
  });

  it('answers no plain HTTP, and does not take it for a refused certificate', async () => {
    const onRefused = vi.fn();
    const server = createDeviceListener('https', answerOk, { credentials, onRefused });
    const port = await listening(server);
    const failed = once(server, 'tlsClientError');

    await expect(answerOf(httpGet, { port })).rejects.toThrow();

    await failed;
    expect(onRefused).not.toHaveBeenCalled();
  });

  it('says which address refused the certificate', () => {
    const onRefused = vi.fn();
    const server = createDeviceListener('https', answerOk, { credentials, onRefused });

    failedHandshake(server, 'ERR_SSL_TLSV1_ALERT_UNKNOWN_CA', '::ffff:192.168.1.50');

    expect(onRefused).toHaveBeenCalledExactlyOnceWith(
      '192.168.1.50',
      'ERR_SSL_TLSV1_ALERT_UNKNOWN_CA',
    );
  });

  it('does not count a connection that went away', () => {
    // Also what a port scanner leaves behind, and what some clients do
    // instead of saying why.
    const onRefused = vi.fn();
    const server = createDeviceListener('https', answerOk, { credentials, onRefused });

    failedHandshake(server, 'ECONNRESET', '::ffff:192.168.1.50');

    expect(onRefused).not.toHaveBeenCalled();
  });
});
