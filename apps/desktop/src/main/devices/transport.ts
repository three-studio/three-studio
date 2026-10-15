import { createServer as createHttpServer, type Server } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { TLSSocket } from 'node:tls';
import { plainAddress } from './addresses';
import { refusesCertificate } from './certificate';
import type { DeviceRequestHandler } from './routes';

/*
 * The one request handler, under plain HTTP or under TLS: the routes never
 * know which, and the server switches between them by listening again.
 */

export interface DeviceListenerOptions {
  /** The certificate and its key, in PEM. HTTPS only. */
  credentials?: { key: string; certificate: string };
  /**
   * A browser refused the certificate: the address it came from, without
   * `::ffff:`, and the alert's code. HTTPS only.
   */
  onRefused?: (address: string, code: string) => void;
}

/** A server, not yet listening, that answers with `handler` over `transport`. */
export function createDeviceListener(
  transport: 'http' | 'https',
  handler: DeviceRequestHandler,
  { credentials, onRefused }: DeviceListenerOptions = {},
): Server {
  if (transport === 'http') return createHttpServer(handler);
  if (credentials === undefined) throw new Error('An HTTPS listener needs a certificate.');
  const server = createHttpsServer(
    { key: credentials.key, cert: credentials.certificate, minVersion: 'TLSv1.2' },
    handler,
  );
  // A browser that will not accept the certificate ends the handshake with an
  // alert saying so, and that is the one thing a person at the computer can
  // act on: the phone is waiting for someone to accept it. Every other failed
  // handshake — a client gone mid-way, a scanner, plain HTTP from a link made
  // before the switch — is ordinary, and dropped.
  server.on('tlsClientError', (error: Error & { code?: string }, socket: TLSSocket) => {
    if (onRefused === undefined || !refusesCertificate(error)) return;
    const remote = socket.remoteAddress;
    if (remote !== undefined) onRefused(plainAddress(remote), error.code ?? error.message);
  });
  return server;
}
