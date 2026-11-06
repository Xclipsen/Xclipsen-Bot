const dns = require('node:dns');
const net = require('node:net');

// Custom radio stations are URLs that admins type in and ffmpeg then opens from inside the bot's
// network. These checks keep them on the public internet: no localhost, no single-label hosts
// (Docker service names such as `tts`) and no private, loopback, link-local or CGNAT addresses.

const BLOCKED_V4 = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16]
];

function ipv4ToInt(address) {
  return address.split('.').reduce((value, part) => (value * 256) + Number(part), 0);
}

function isPrivateIpv4(address) {
  const value = ipv4ToInt(address);
  return BLOCKED_V4.some(([base, bits]) => {
    const size = 2 ** (32 - bits);
    return Math.floor(value / size) === Math.floor(ipv4ToInt(base) / size);
  });
}

// Expands an IPv6 address (with optional embedded IPv4 tail) to eight 16-bit groups.
function ipv6Groups(address) {
  let text = address.toLowerCase().split('%')[0];
  const v4 = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const value = ipv4ToInt(v4[1]);
    text = `${text.slice(0, -v4[1].length)}${Math.floor(value / 65536).toString(16)}:${(value % 65536).toString(16)}`;
  }
  const [head, tail] = text.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const fill = text.includes('::') ? Array(8 - left.length - right.length).fill('0') : [];
  return [...left, ...fill, ...right].map((group) => Number.parseInt(group || '0', 16));
}

function isPrivateIpv6(address) {
  const groups = ipv6Groups(address);
  if (groups.length !== 8) return true;
  if (groups.every((group) => group === 0)) return true; // ::
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return true; // ::1
  if ((groups[0] & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((groups[0] & 0xffc0) === 0xfe80) return true; // fe80::/10
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible addresses carry an IPv4 address.
  if (groups.slice(0, 5).every((group) => group === 0) && (groups[5] === 0xffff || groups[5] === 0)) {
    return isPrivateIpv4(`${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`);
  }
  return false;
}

function isPrivateAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return false;
}

// The reason a URL is refused, or null. Only looks at the URL itself (no DNS).
function checkStationUrl(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    return 'Enter a full stream URL starting with http:// or https://.';
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) return 'Enter a full stream URL starting with http:// or https://.';
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (net.isIP(host)) return isPrivateAddress(host) ? 'Stream URLs may not point to private or local addresses.' : null;
  if (host === 'localhost' || host.endsWith('.localhost')) return 'Stream URLs may not point to localhost.';
  if (!host.includes('.')) return 'Stream URLs need a public host name (like stream.example.com).';
  return null;
}

// Play-time check: the URL check again plus DNS, so a public name that resolves to a private
// address is refused too. Returns the normalized URL that ffmpeg should open.
async function assertPublicStationUrl(value, { lookup = dns.promises.lookup } = {}) {
  const reason = checkStationUrl(value);
  if (reason) throw new Error(reason);
  const url = new URL(String(value).trim());
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!net.isIP(host)) {
    let addresses;
    try {
      addresses = await lookup(host, { all: true });
    } catch {
      throw new Error('The station host could not be found.');
    }
    if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
      throw new Error('Stream URLs may not point to private or local addresses.');
    }
  }
  return url.href;
}

module.exports = { checkStationUrl, assertPublicStationUrl, isPrivateAddress };
