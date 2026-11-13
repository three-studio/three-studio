import { describe, expect, it } from 'vitest';
import { decodeCdpMessage, decodeTargets } from '../launch/cdp';

/*
 * What arrives over the debugging socket is text, and nothing in it is trusted
 * until decoded: a reply names the request it answers, an event names its
 * method, an error carries its message so a failed call can say which method
 * it was.
 */

describe('a CDP message', () => {
  it('is a reply when it carries an id and a result', () => {
    expect(decodeCdpMessage('{"id":3,"result":{"result":{"type":"number","value":4}}}')).toEqual({
      kind: 'reply',
      id: 3,
      result: { result: { type: 'number', value: 4 } },
    });
  });

  it('is a reply with an empty result when the method answers nothing', () => {
    expect(decodeCdpMessage('{"id":7,"result":{}}')).toEqual({ kind: 'reply', id: 7, result: {} });
  });

  it('is an error when it carries an id and an error', () => {
    expect(decodeCdpMessage('{"id":4,"error":{"code":-32601,"message":"\'Nope.go\' wasn\'t found"}}')).toEqual({
      kind: 'error',
      id: 4,
      message: "'Nope.go' wasn't found",
    });
  });

  it('is an event when it carries a method and no id', () => {
    expect(decodeCdpMessage('{"method":"Runtime.consoleAPICalled","params":{"type":"error","args":[]}}')).toEqual({
      kind: 'event',
      method: 'Runtime.consoleAPICalled',
      params: { type: 'error', args: [] },
    });
  });

  it('is refused when it is neither', () => {
    expect(() => decodeCdpMessage('[1,2]')).toThrow();
    expect(() => decodeCdpMessage('{"what":"else"}')).toThrow();
  });
});

describe('the target list', () => {
  it('keeps the targets it can attach to and drops the rest', () => {
    const listed: unknown = [
      { type: 'page', url: 'file:///x/out/renderer/index.html', webSocketDebuggerUrl: 'ws://127.0.0.1:9/devtools/page/A' },
      { type: 'page', url: 'about:blank' },
      'nonsense',
    ];
    expect(decodeTargets(listed)).toEqual([
      { type: 'page', url: 'file:///x/out/renderer/index.html', webSocketDebuggerUrl: 'ws://127.0.0.1:9/devtools/page/A' },
    ]);
    expect(decodeTargets({ not: 'a list' })).toEqual([]);
  });
});
