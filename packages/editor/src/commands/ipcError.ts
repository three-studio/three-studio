/**
 * What a call to the main process said when it failed, without the wrapper.
 *
 * Electron rethrows a handler's error as `Error invoking remote method
 * '<channel>': Error: <message>`. The channel and the class name mean nothing
 * to the person reading it; the message after them is what they can act on.
 */
export function ipcErrorMessage(cause: unknown): string {
  return (cause instanceof Error ? cause.message : String(cause)).replace(
    /^Error invoking remote method '[^']+':\s*\w*Error:\s*/,
    '',
  );
}
