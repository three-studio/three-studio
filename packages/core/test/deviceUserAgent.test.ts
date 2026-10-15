import { describeUserAgent } from '@three-studio/core';
import { describe, expect, it } from 'vitest';

/*
 * What a device row is called, read from the user agent a phone sends.
 *
 * Real user agents, copied from the browsers they name: each one embeds the
 * names of the browsers it grew out of — Edge says Chrome, Chrome says Safari,
 * an iPhone says Mac OS X — so the order of the checks is the whole of the
 * logic, and only real strings test it.
 */

const AGENTS: readonly [string, string, string, string][] = [
  [
    'Safari on an iPhone',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    'iPhone',
    'Safari',
  ],
  [
    'Chrome on an iPhone',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1',
    'iPhone',
    'Chrome',
  ],
  [
    'Firefox on an iPhone',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/131.0 Mobile/15E148 Safari/605.1.15',
    'iPhone',
    'Firefox',
  ],
  [
    'Chrome on Android, reduced',
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
    'Android',
    'Chrome',
  ],
  [
    'Samsung Internet',
    'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
    'Android',
    'Samsung Internet',
  ],
  [
    'Firefox on Android',
    'Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0',
    'Android',
    'Firefox',
  ],
  [
    'Safari on a Mac',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    'Mac',
    'Safari',
  ],
  [
    'Chrome on a Mac',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    'Mac',
    'Chrome',
  ],
  [
    'Edge on Windows',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
    'Windows',
    'Edge',
  ],
  [
    'Opera on Windows',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 OPR/114.0.0.0',
    'Windows',
    'Opera',
  ],
  [
    'Electron on a Mac',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) three-studio/0.3.0 Chrome/138.0.7204.100 Electron/37.2.0 Safari/537.36',
    'Mac',
    'Electron',
  ],
  [
    'Chrome on a Chromebook',
    'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    'Chromebook',
    'Chrome',
  ],
  [
    'Firefox on Linux',
    'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
    'Linux',
    'Firefox',
  ],
];

describe('the name a user agent gives', () => {
  it.each(AGENTS)('%s', (_name, userAgent, name, browser) => {
    expect(describeUserAgent(userAgent)).toEqual({ name, browser });
  });

  it('calls an iPad a Mac, as the iPad itself does', () => {
    // Safari on an iPad asks for the desktop site by default, with a Mac's user
    // agent to the letter. A known limit, pinned so that it is not mistaken
    // for a regression the day it is lifted.
    const ipad =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

    expect(describeUserAgent(ipad)).toEqual({ name: 'Mac', browser: 'Safari' });
  });

  it('names an iPad that says so', () => {
    const ipad =
      'Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1';

    expect(describeUserAgent(ipad)).toEqual({ name: 'iPad', browser: 'Safari' });
  });

  it('has a name for nothing at all', () => {
    expect(describeUserAgent('')).toEqual({ name: 'Device', browser: 'Browser' });
  });
});
