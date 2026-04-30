import net from 'net';

// The rollout mode lets operators test the policy before actually blocking clients.
export type RtmpPlayAllowlistMode = 'off' | 'audit' | 'enforce';

// This result describes both the final yes/no answer and why that answer happened.
export interface IpMatchResult {
  allowed: boolean;
  clientIp: string | null;
  matchedCidr: string | null;
  reason: 'mode_off' | 'internal_cidr' | 'event_allowlist' | 'invalid_client_ip' | 'not_allowed';
}

interface ParsedCidr {
  version: 4 | 6;
  value: bigint;
  prefix: number;
  cidr: string;
}

// Unknown values intentionally fall back to audit, which is safer than enforce.
export function getRtmpPlayAllowlistMode(value = process.env.RTMP_PLAY_IP_ALLOWLIST_MODE): RtmpPlayAllowlistMode {
  if (value === 'off' || value === 'enforce' || value === 'audit') return value;
  return 'audit';
}

// Convert a comma-separated env var into normalized CIDR strings.
export function parseCidrList(value = ''): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => normalizeIpOrCidr(item));
}

// Store every rule in one format so duplicate detection is reliable.
// Example: "203.0.113.10" becomes "203.0.113.10/32".
// Example: "203.0.113.99/24" becomes the network CIDR "203.0.113.0/24".
export function normalizeIpOrCidr(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('IP address or CIDR is required');

  const slashIndex = trimmed.indexOf('/');
  if (slashIndex >= 0) {
    const ipPart = trimmed.slice(0, slashIndex);
    const prefixPart = trimmed.slice(slashIndex + 1);
    const ip = normalizeIp(ipPart);
    const prefix = parsePrefix(prefixPart, ip.version);
    return `${formatIp(maskNetwork(ip.value, prefix, ip.version), ip.version)}/${prefix}`;
  }

  const ip = normalizeIp(trimmed);
  return `${ip.text}/${ip.version === 4 ? 32 : 128}`;
}

// RTMP-GO reports peers as "ip:port" for IPv4 and "[ip]:port" for IPv6.
// The allow-list should compare only the IP address, not the temporary port.
export function extractIpFromRemoteAddress(remoteAddress?: string | null): string | null {
  if (!remoteAddress) return null;
  const value = remoteAddress.trim();
  if (!value || value === 'unknown') return null;

  if (value.startsWith('[')) {
    const close = value.indexOf(']');
    if (close > 0) return normalizeIp(value.slice(1, close)).text;
  }

  if (net.isIP(value)) return normalizeIp(value).text;

  const lastColon = value.lastIndexOf(':');
  if (lastColon > -1) {
    const possibleIpv4 = value.slice(0, lastColon);
    const possiblePort = value.slice(lastColon + 1);
    if (/^\d+$/.test(possiblePort) && net.isIP(possibleIpv4) === 4) return normalizeIp(possibleIpv4).text;
  }

  return null;
}

// Evaluate one RTMP PLAY attempt against rollout mode, internal CIDRs, and event rules.
export function evaluateRtmpPlayIpAccess(
  remoteAddress: string | null | undefined,
  eventCidrs: string[],
  internalCidrs: string[],
  mode: RtmpPlayAllowlistMode,
): IpMatchResult {
  if (mode === 'off') {
    return { allowed: true, clientIp: extractIpFromRemoteAddress(remoteAddress), matchedCidr: null, reason: 'mode_off' };
  }

  const clientIp = extractIpFromRemoteAddress(remoteAddress);
  if (!clientIp) {
    return { allowed: false, clientIp: null, matchedCidr: null, reason: 'invalid_client_ip' };
  }

  const internalMatch = findMatchingCidr(clientIp, internalCidrs);
  if (internalMatch) {
    return { allowed: true, clientIp, matchedCidr: internalMatch, reason: 'internal_cidr' };
  }

  const eventMatch = findMatchingCidr(clientIp, eventCidrs);
  if (eventMatch) {
    return { allowed: true, clientIp, matchedCidr: eventMatch, reason: 'event_allowlist' };
  }

  return { allowed: false, clientIp, matchedCidr: null, reason: 'not_allowed' };
}

function findMatchingCidr(clientIp: string, cidrs: string[]): string | null {
  const ip = normalizeIp(clientIp);
  for (const cidr of cidrs) {
    try {
      const parsed = parseCidr(cidr);
      if (parsed.version === ip.version && cidrContains(parsed, ip.value)) return parsed.cidr;
    } catch {
      continue;
    }
  }
  return null;
}

// Parse and normalize a CIDR once before matching so all comparisons use the same shape.
function parseCidr(cidr: string): ParsedCidr {
  const normalized = normalizeIpOrCidr(cidr);
  const [ipPart, prefixPart] = normalized.split('/');
  const ip = normalizeIp(ipPart);
  return { version: ip.version, value: ip.value, prefix: Number(prefixPart), cidr: normalized };
}

// CIDR matching works by zeroing host bits on both addresses and comparing networks.
function cidrContains(cidr: ParsedCidr, ipValue: bigint): boolean {
  return maskNetwork(cidr.value, cidr.prefix, cidr.version) === maskNetwork(ipValue, cidr.prefix, cidr.version);
}

// Convert an IP value to its containing network for a prefix length.
function maskNetwork(value: bigint, prefix: number, version: 4 | 6): bigint {
  const bits = BigInt(version === 4 ? 32 : 128);
  const hostBits = bits - BigInt(prefix);
  const mask = hostBits === bits ? 0n : ((1n << bits) - 1n) ^ ((1n << hostBits) - 1n);
  return value & mask;
}

// Validate an IP string and convert it to a BigInt so IPv4 and IPv6 math is simple.
function normalizeIp(input: string): { text: string; value: bigint; version: 4 | 6 } {
  const trimmed = input.trim();
  const version = net.isIP(trimmed);
  if (version === 4) {
    return { text: trimmed, value: ipv4ToBigInt(trimmed), version: 4 };
  }
  if (version === 6) {
    const groups = expandIpv6(trimmed);
    return { text: groups.map((group) => group.toString(16)).join(':'), value: ipv6GroupsToBigInt(groups), version: 6 };
  }
  throw new Error('Invalid IP address');
}

// CIDR prefixes are the numbers after the slash, such as 24 in 10.0.0.0/24.
function parsePrefix(prefixPart: string, version: 4 | 6): number {
  if (!/^\d+$/.test(prefixPart)) throw new Error('CIDR prefix must be a number');
  const prefix = Number(prefixPart);
  const max = version === 4 ? 32 : 128;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) throw new Error(`CIDR prefix must be between 0 and ${max}`);
  return prefix;
}

// Turn dotted IPv4 into a 32-bit number held in a BigInt.
function ipv4ToBigInt(ip: string): bigint {
  return ip.split('.').reduce((acc, part) => (acc << 8n) + BigInt(Number(part)), 0n);
}

// Expand compressed IPv6 notation into exactly eight 16-bit groups.
function expandIpv6(ip: string): number[] {
  const withoutZone = ip.split('%')[0];
  const [headRaw, tailRaw] = withoutZone.split('::');
  const head = headRaw ? parseIpv6Part(headRaw) : [];
  const tail = tailRaw ? parseIpv6Part(tailRaw) : [];
  if (withoutZone.includes('::')) {
    const missing = 8 - head.length - tail.length;
    if (missing < 0) throw new Error('Invalid IPv6 address');
    return [...head, ...Array(missing).fill(0), ...tail];
  }
  if (head.length !== 8) throw new Error('Invalid IPv6 address');
  return head;
}

// Parse one side of an IPv6 address. IPv6 can also embed an IPv4 address at the end.
function parseIpv6Part(part: string): number[] {
  if (!part) return [];
  const pieces = part.split(':');
  const last = pieces[pieces.length - 1];
  if (last && net.isIP(last) === 4) {
    const ipv4 = ipv4ToBigInt(last);
    return [
      ...pieces.slice(0, -1).map((piece) => parseInt(piece || '0', 16)),
      Number((ipv4 >> 16n) & 0xffffn),
      Number(ipv4 & 0xffffn),
    ];
  }
  return pieces.map((piece) => parseInt(piece || '0', 16));
}

// Turn eight IPv6 groups into one 128-bit BigInt.
function ipv6GroupsToBigInt(groups: number[]): bigint {
  if (groups.length !== 8 || groups.some((group) => !Number.isInteger(group) || group < 0 || group > 0xffff)) {
    throw new Error('Invalid IPv6 address');
  }
  return groups.reduce((acc, group) => (acc << 16n) + BigInt(group), 0n);
}

// Convert a BigInt IP back into text after network masking.
function formatIp(value: bigint, version: 4 | 6): string {
  if (version === 4) {
    return [24n, 16n, 8n, 0n].map((shift) => Number((value >> shift) & 0xffn)).join('.');
  }

  const groups: string[] = [];
  for (let shift = 112n; shift >= 0n; shift -= 16n) {
    groups.push(Number((value >> shift) & 0xffffn).toString(16));
  }
  return groups.join(':');
}