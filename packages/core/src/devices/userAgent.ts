/*
 * What a device is called in the editor, read from the user agent it sends.
 *
 * A system and a browser, never a model: Android's reduced user agent names
 * none (`Android 10; K`, whatever the phone), and the client hints that would
 * name one need a secure context, which a page on a network address is not.
 * An iPad asks for the desktop site by default and calls itself a Mac to the
 * letter, so it is listed as one.
 */

export interface DescribedUserAgent {
  /** The system: `iPhone`, `Android`, `Mac`… */
  name: string;
  browser: string;
}

/*
 * Most specific first, in both lists: every user agent carries the names of
 * the ones it grew out of, so the first that matches is the one meant. An
 * iPhone says `like Mac OS X`, an Android phone says `Linux`, Edge says
 * `Chrome`, and Chrome says `Safari`.
 */

const SYSTEMS: readonly [string, RegExp][] = [
  ['iPhone', /\biPhone\b|\biPod\b/],
  ['iPad', /\biPad\b/],
  ['Android', /\bAndroid\b/],
  ['Chromebook', /\bCrOS\b/],
  ['Windows', /\bWindows\b/],
  ['Mac', /\bMacintosh\b|\bMac OS X\b/],
  ['Linux', /\bLinux\b|\bX11\b/],
];

const BROWSERS: readonly [string, RegExp][] = [
  ['Edge', /\bEdg(?:A|iOS)?\//],
  ['Samsung Internet', /\bSamsungBrowser\//],
  ['Opera', /\bOPR\/|\bOPT\/|\bOPiOS\//],
  ['Electron', /\bElectron\//],
  ['Firefox', /\bFirefox\/|\bFxiOS\//],
  ['Chrome', /\bChrome\/|\bCriOS\//],
  // Chrome's says `Safari/` too, but only Safari's says `Version/` beside it.
  ['Safari', /\bVersion\/[\d.]+.*\bSafari\//],
];

function firstMatch(table: readonly [string, RegExp][], userAgent: string, none: string): string {
  return table.find(([, pattern]) => pattern.test(userAgent))?.[0] ?? none;
}

/** `iPhone` and `Safari`, `Android` and `Chrome`; `Device` and `Browser` for what it cannot tell. */
export function describeUserAgent(userAgent: string): DescribedUserAgent {
  return {
    name: firstMatch(SYSTEMS, userAgent, 'Device'),
    browser: firstMatch(BROWSERS, userAgent, 'Browser'),
  };
}

/**
 * A device as its row, its Console lines and its screenshots' names all say
 * it: `iPhone · Safari`. The same words everywhere, so that typing what a row
 * says into the Console's Filter finds that device's lines.
 */
export function deviceLabel({ name, browser }: DescribedUserAgent): string {
  return `${name} · ${browser}`;
}
