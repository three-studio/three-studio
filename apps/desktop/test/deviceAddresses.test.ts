import { describe, expect, it } from 'vitest';
import {
  deviceUrls,
  isFromOutside,
  isOwnHost,
  listAddresses,
  ownHostNames,
  selectedUrl,
  serverNames,
  type NetworkInterfaces,
} from '../src/main/devices/addresses';

/*
 * Which addresses the device server names, and which names it answers to.
 *
 * The table is a Mac's on a Wi-Fi with a wired dock, Tailscale up, and a
 * virtual machine's bridge: the interfaces a phone can reach first, the ones
 * it cannot reach at all left out.
 */

const INTERFACES: NetworkInterfaces = {
  lo0: [
    { address: '127.0.0.1', family: 'IPv4', internal: true },
    { address: '::1', family: 'IPv6', internal: true },
  ],
  bridge100: [{ address: '192.168.64.1', family: 'IPv4', internal: false }],
  utun4: [{ address: '100.101.102.103', family: 'IPv4', internal: false }],
  en1: [{ address: '10.0.0.7', family: 'IPv4', internal: false }],
  en0: [
    { address: 'fe80::1c2a:3b4c:5d6e:7f80', family: 'IPv6', internal: false },
    { address: '192.168.1.42', family: 'IPv4', internal: false },
  ],
  // What a cable with no DHCP server behind it gets: nobody can reach it.
  en5: [{ address: '169.254.3.4', family: 'IPv4', internal: false }],
};

const TOKEN = 'abcdefghijKLMNOPQRST01';

describe('the addresses listed', () => {
  it('puts the local network first, then Tailscale, then the rest', () => {
    expect(listAddresses(INTERFACES)).toEqual([
      { address: '192.168.1.42', label: 'en0', kind: 'network' },
      { address: '10.0.0.7', label: 'en1', kind: 'network' },
      { address: '100.101.102.103', label: 'Tailscale', kind: 'tailscale' },
      { address: '192.168.64.1', label: 'bridge100', kind: 'other' },
    ]);
  });

  it('sorts interfaces the way a person counts them', () => {
    const listed = listAddresses({
      en10: [{ address: '10.0.10.1', family: 'IPv4', internal: false }],
      en2: [{ address: '10.0.2.1', family: 'IPv4', internal: false }],
    });

    expect(listed.map((entry) => entry.label)).toEqual(['en2', 'en10']);
  });

  it('lists nothing when the machine is on no network', () => {
    expect(listAddresses({ lo0: INTERFACES['lo0'] })).toEqual([]);
  });
});

describe('the URLs', () => {
  const urls = deviceUrls(listAddresses(INTERFACES), 'http', 7700, TOKEN);

  it('names every address, then this computer, under the transport and the token', () => {
    expect(urls).toEqual([
      { address: '192.168.1.42', label: 'en0', url: `http://192.168.1.42:7700/${TOKEN}/` },
      { address: '10.0.0.7', label: 'en1', url: `http://10.0.0.7:7700/${TOKEN}/` },
      {
        address: '100.101.102.103',
        label: 'Tailscale',
        url: `http://100.101.102.103:7700/${TOKEN}/`,
      },
      { address: '192.168.64.1', label: 'bridge100', url: `http://192.168.64.1:7700/${TOKEN}/` },
      { address: 'localhost', label: 'This computer', url: `http://localhost:7700/${TOKEN}/` },
    ]);
  });

  it('selects the local network’s, and this computer’s when there is no other', () => {
    expect(selectedUrl(urls, null)).toBe(`http://192.168.1.42:7700/${TOKEN}/`);
    expect(selectedUrl(deviceUrls([], 'http', 7701, TOKEN), null)).toBe(
      `http://localhost:7701/${TOKEN}/`,
    );
    expect(selectedUrl([], null)).toBeNull();
  });

  it('selects the address chosen, when it is listed', () => {
    expect(selectedUrl(urls, '100.101.102.103')).toBe(`http://100.101.102.103:7700/${TOKEN}/`);
  });

  it('chooses as if nobody had while the chosen address is gone', () => {
    // A Wi-Fi left, a lease that moved: the choice applies again once the
    // address is back, and until then a link that works beats none.
    expect(selectedUrl(urls, '10.9.9.9')).toBe(`http://192.168.1.42:7700/${TOKEN}/`);
    expect(selectedUrl(deviceUrls([], 'http', 7701, TOKEN), '192.168.1.42')).toBe(
      `http://localhost:7701/${TOKEN}/`,
    );
  });
});

describe('the Host a request names', () => {
  const addresses = listAddresses(INTERFACES);

  it.each([
    '192.168.1.42:7700',
    'LOCALHOST:7700',
    '127.0.0.1',
    '[::1]:7700',
    '100.101.102.103:7700',
  ])('answers %s', (host) => {
    expect(isOwnHost(host, addresses, 'Mac')).toBe(true);
  });

  it('answers the machine’s own name, and its .local form', () => {
    expect(isOwnHost('Mac.local', addresses, 'Mac.local')).toBe(true);
    expect(isOwnHost('mac.local:7700', addresses, 'Mac')).toBe(true);
    expect(isOwnHost('mac', addresses, 'Mac')).toBe(true);
  });

  it.each(['evil.example', 'evil.example:7700', '192.168.1.43', '', undefined])(
    'refuses %j',
    (host) => {
      // A page on another site that resolves its own name to this machine —
      // DNS rebinding — names that site in `Host`, and is answered nothing.
      expect(isOwnHost(host, addresses, 'Mac')).toBe(false);
    },
  );
});

describe('the names the machine goes by', () => {
  it.each([
    ['Mac', ['mac', 'mac.local']],
    ['jerome.local', ['jerome.local']],
    ['mac.lan', ['mac.lan', 'mac.local']],
    // Neither a Host a browser sends nor a name a certificate can carry.
    ['My Mac', []],
  ])('%s is %j', (hostName, names) => {
    expect(ownHostNames(hostName)).toEqual(names);
  });
});

describe('the names a certificate needs', () => {
  const addresses = listAddresses(INTERFACES);
  const everyday = [
    'localhost',
    'mac',
    'mac.local',
    '127.0.0.1',
    '192.168.1.42',
    '10.0.0.7',
    '100.101.102.103',
  ];

  it('are this computer’s, then the networks a phone reaches, and no virtual machine’s', () => {
    // A bridge comes and goes with its virtual machine: a certificate made
    // again for each one would have every phone accept it again.
    expect(serverNames(addresses, 'Mac', null)).toEqual(everyday);
  });

  it('end with the address chosen, whatever its interface', () => {
    expect(serverNames(addresses, 'Mac', '192.168.64.1')).toEqual([...everyday, '192.168.64.1']);
    expect(serverNames(addresses, 'Mac', '192.168.1.42')).toEqual(everyday);
  });

  it('leave out a chosen address that is not listed', () => {
    // The choice outlives the network it was made on, and a certificate
    // naming an address this computer no longer has helps nobody.
    expect(serverNames(addresses, 'Mac', '10.9.9.9')).toEqual(everyday);
  });

  it('name each name once', () => {
    expect(serverNames([], 'localhost', null)).toEqual([
      'localhost',
      'localhost.local',
      '127.0.0.1',
    ]);
  });
});

describe('where a request comes from', () => {
  const addresses = listAddresses(INTERFACES);

  it('says so for another machine', () => {
    expect(isFromOutside('::ffff:192.168.1.23', addresses)).toBe(true);
    expect(isFromOutside('192.168.1.23', addresses)).toBe(true);
  });

  it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1', '192.168.1.42', '::ffff:192.168.1.42', undefined])(
    'not for %j, which is this one',
    (remote) => {
      expect(isFromOutside(remote, addresses)).toBe(false);
    },
  );
});
