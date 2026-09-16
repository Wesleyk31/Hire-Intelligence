import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';

// Verified official archive members, 2026-09-16. Title archives have different
// identity/domain semantics and deliberately remain outside this recovery.
export const RECOVERED_KML_MEMBERS: Readonly<Record<string, string>> = {
  'nt-mines': 'MINESITES.kml',
  'nt-mineral-occurrences': 'MINERALOCCURRENCES.kml',
};
const MAX_COMPRESSED = 25 * 1024 * 1024;
const MAX_EXPANDED = 32 * 1024 * 1024;
const MAX_ENTRIES = 64;
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++)
    value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}

function zipKml(bytes: Uint8Array): Map<string, string> {
  if (bytes.byteLength > MAX_COMPRESSED)
    throw new Error('KML_ZIP_COMPRESSED_LIMIT');
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = data.length - 22;
  const minimum = Math.max(0, end - 65535);
  for (; end >= minimum; end--) {
    if (
      data.readUInt32LE(end) === 0x06054b50 &&
      end + 22 + data.readUInt16LE(end + 20) === data.length
    )
      break;
  }
  if (end < minimum) throw new Error('KML_ZIP_INVALID');
  const count = data.readUInt16LE(end + 10);
  const centralSize = data.readUInt32LE(end + 12);
  const central = data.readUInt32LE(end + 16);
  if (
    data.readUInt16LE(end + 4) ||
    data.readUInt16LE(end + 6) ||
    data.readUInt16LE(end + 8) !== count ||
    count === 0xffff ||
    central === 0xffffffff ||
    centralSize === 0xffffffff
  )
    throw new Error('KML_ZIP_UNSUPPORTED');
  if (!count || count > MAX_ENTRIES || central + centralSize !== end)
    throw new Error('KML_ZIP_INVALID');
  const entries: Array<{
    name: string;
    start: number;
    end: number;
    local: number;
    size: number;
    crc: number;
    method: number;
  }> = [];
  const names = new Set<string>();
  let at = central,
    expanded = 0;
  for (let index = 0; index < count; index++) {
    if (at + 46 > end || data.readUInt32LE(at) !== 0x02014b50)
      throw new Error('KML_ZIP_INVALID');
    const flags = data.readUInt16LE(at + 8),
      method = data.readUInt16LE(at + 10);
    const crc = data.readUInt32LE(at + 16),
      compressed = data.readUInt32LE(at + 20),
      size = data.readUInt32LE(at + 24);
    const nameLength = data.readUInt16LE(at + 28),
      extraLength = data.readUInt16LE(at + 30),
      commentLength = data.readUInt16LE(at + 32);
    const local = data.readUInt32LE(at + 42),
      next = at + 46 + nameLength + extraLength + commentLength;
    if (
      next > end ||
      data.readUInt16LE(at + 34) ||
      flags & ~0x080e ||
      ![0, 8].includes(method) ||
      [compressed, size, local].includes(0xffffffff)
    )
      throw new Error('KML_ZIP_UNSUPPORTED');
    const nameBytes = data.subarray(at + 46, at + 46 + nameLength);
    const name = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes);
    if (
      !name ||
      /[\\:\u0000-\u001f]/.test(name) ||
      name.startsWith('/') ||
      name.split('/').some((part) => part === '..' || part === '.') ||
      ((data.readUInt32LE(at + 38) >>> 16) & 0xf000) === 0xa000
    )
      throw new Error('KML_ZIP_UNSAFE_PATH');
    if (names.has(name.toLowerCase()))
      throw new Error('KML_ZIP_DUPLICATE_MEMBER');
    names.add(name.toLowerCase());
    expanded += size;
    if (expanded > MAX_EXPANDED) throw new Error('KML_ZIP_EXPANDED_LIMIT');
    if (local + 30 > central || data.readUInt32LE(local) !== 0x04034b50)
      throw new Error('KML_ZIP_INVALID');
    const localNameLength = data.readUInt16LE(local + 26),
      localExtraLength = data.readUInt16LE(local + 28);
    const start = local + 30 + localNameLength + localExtraLength;
    if (
      start + compressed > central ||
      !data
        .subarray(local + 30, local + 30 + localNameLength)
        .equals(nameBytes) ||
      data.readUInt16LE(local + 6) !== flags ||
      data.readUInt16LE(local + 8) !== method
    )
      throw new Error('KML_ZIP_HEADER_MISMATCH');
    if (
      !(flags & 8) &&
      (data.readUInt32LE(local + 14) !== crc ||
        data.readUInt32LE(local + 18) !== compressed ||
        data.readUInt32LE(local + 22) !== size)
    )
      throw new Error('KML_ZIP_HEADER_MISMATCH');
    entries.push({
      name,
      local,
      start,
      end: start + compressed,
      size,
      crc,
      method,
    });
    at = next;
  }
  if (at !== end) throw new Error('KML_ZIP_INVALID');
  const ordered = [...entries].sort((a, b) => a.local - b.local);
  if (
    ordered.some(
      (entry, index) => index > 0 && ordered[index - 1].end > entry.local,
    )
  )
    throw new Error('KML_ZIP_OVERLAPPING_MEMBERS');
  const files = new Map<string, string>();
  for (const entry of entries.filter((item) => /\.kml$/i.test(item.name))) {
    let output: Uint8Array;
    try {
      output =
        entry.method === 0
          ? data.subarray(entry.start, entry.end)
          : inflateRawSync(data.subarray(entry.start, entry.end), {
              maxOutputLength: Math.max(1, entry.size),
            });
    } catch (error) {
      if ((error as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE')
        throw new Error('KML_ZIP_EXPANDED_LIMIT');
      throw new Error('KML_ZIP_DECOMPRESSION_FAILED');
    }
    if (output.byteLength !== entry.size)
      throw new Error('KML_ZIP_SIZE_MISMATCH');
    if (crc32(output) !== entry.crc) throw new Error('KML_ZIP_CRC_MISMATCH');
    files.set(
      entry.name,
      new TextDecoder('utf-8', { fatal: true }).decode(output),
    );
  }
  return files;
}

function plainText(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (entity) => {
      const named: Record<string, string> = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&apos;': "'",
      };
      if (named[entity]) return named[entity];
      const point = parseInt(
        entity.slice(entity[2]?.toLowerCase() === 'x' ? 3 : 2, -1),
        entity[2]?.toLowerCase() === 'x' ? 16 : 10,
      );
      return Number.isFinite(point) &&
        point > 0 &&
        point <= 0x10ffff &&
        !(point >= 0xd800 && point <= 0xdfff)
        ? String.fromCodePoint(point)
        : entity;
    })
    .replace(/\s+/g, ' ')
    .trim();
}
const canonical = (raw: Record<string, unknown>) =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(raw).sort(([a], [b]) => a.localeCompare(b)),
    ),
  );

export function recoveredKmlRows(sourceKey: string, bytes: Uint8Array) {
  const member = RECOVERED_KML_MEMBERS[sourceKey];
  if (!member) throw new Error('KML_SOURCE_REVIEW_REQUIRED');
  if (bytes.length < 4 || bytes[0] !== 80 || bytes[1] !== 75)
    throw new Error('KML_INVALID_BODY');
  const files = zipKml(bytes);
  const xml = files.get(member);
  if (!xml) throw new Error('KML_ZIP_MEMBER_MISSING');
  for (const [name, body] of files) {
    if (
      /<!(?:DOCTYPE|ENTITY)\b/i.test(body) ||
      !/<(?:\w+:)?kml\b/i.test(body) ||
      !/<\/(?:\w+:)?kml\s*>\s*$/i.test(body)
    )
      throw new Error('KML_INVALID_BODY');
    if (name !== member && /<(?:\w+:)?Placemark\b/i.test(body))
      throw new Error('KML_ZIP_AMBIGUOUS_FEATURES');
  }
  const matches = [
    ...xml.matchAll(
      /<(?:\w+:)?Placemark\b[^>]*>([\s\S]*?)<\/(?:\w+:)?Placemark\s*>/gi,
    ),
  ];
  if (!matches.length) throw new Error('KML_FEATURES_MISSING');
  if (matches.length > 20000) throw new Error('KML_ROW_LIMIT');
  if (matches.length !== [...xml.matchAll(/<(?:\w+:)?Placemark\b/gi)].length)
    throw new Error('KML_INVALID_BODY');
  const unique = new Map<
    string,
    { externalId: string; raw: Record<string, unknown>; qualityFlags: string[] }
  >();
  for (const match of matches) {
    const block = match[1],
      raw: Record<string, unknown> = Object.create(null);
    const name = block.match(
      /<(?:\w+:)?name\b[^>]*>([\s\S]*?)<\/(?:\w+:)?name>/i,
    )?.[1];
    if (name) raw.name = plainText(name);
    for (const field of block.matchAll(
      /<(?:\w+:)?SimpleData\b[^>]*name=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/(?:\w+:)?SimpleData>/gi,
    )) {
      const key = plainText(field[1]),
        value = plainText(field[2]);
      if (Object.prototype.hasOwnProperty.call(raw, key) && raw[key] !== value)
        throw new Error('KML_FIELD_COLLISION');
      raw[key] = value;
    }
    const description = block.match(
      /<(?:\w+:)?description\b[^>]*>([\s\S]*?)<\/(?:\w+:)?description>/i,
    )?.[1];
    if (description) raw.description = plainText(description);
    const externalId = String(raw.MODAT_ID || '').trim();
    if (!/^\d+$/.test(externalId)) throw new Error('KML_IDENTITY_MISSING');
    const previous = unique.get(externalId);
    if (previous && canonical(previous.raw) !== canonical(raw))
      throw new Error('KML_IDENTITY_COLLISION');
    unique.set(externalId, {
      externalId,
      raw,
      qualityFlags: ['CONTEXT_ONLY', 'SOURCE_RIGHTS_REVIEW_REQUIRED'],
    });
  }
  const rows = [...unique.values()].sort((a, b) =>
    a.externalId.localeCompare(b.externalId),
  );
  const snapshot = createHash('sha256')
    .update(sourceKey + '\n' + rows.map((row) => canonical(row.raw)).join('\n'))
    .digest('hex');
  return { rows, snapshot };
}
