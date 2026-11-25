import { createHash, createPrivateKey, createPublicKey, createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { deflateRawSync } from 'node:zlib';

const DIST_DIR = 'dist';
const OUT_DIR = 'release';

function crc32(buf: Buffer): number {
  let c: number;
  let crc = 0xffffffff;

  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }

  return (crc ^ 0xffffffff) >>> 0;
}

async function collectFiles(dir: string, root = dir): Promise<{ name: string; data: Buffer }[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: { name: string; data: Buffer }[] = [];

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(full, root)));
    } else if (entry.isFile()) {
      const name = relative(root, full).replace(/\\/g, '/');
      files.push({ name, data: await readFile(full) });
    }
  }

  return files.sort((a, b) => a.name.localeCompare(b.name));
}

function buildZip(files: { name: string; data: Buffer }[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8');
    const compressed = deflateRawSync(file.data);
    const crc = crc32(file.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    localParts.push(local, nameBuf, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);

    centralParts.push(central, nameBuf);
    offset += local.length + nameBuf.length + compressed.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

function encodeVarint(value: number): Buffer {
  const bytes: number[] = [];
  let v = value >>> 0;

  while (v >= 0x80) {
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }

  bytes.push(v);
  return Buffer.from(bytes);
}

function encodeLengthDelimited(fieldNumber: number, payload: Buffer): Buffer {
  const tag = encodeVarint((fieldNumber << 3) | 2);
  const len = encodeVarint(payload.length);
  return Buffer.concat([tag, len, payload]);
}

function loadSigningKey(): KeyObject {
  const pem = process.env.CRX_PRIVATE_KEY?.trim();
  if (pem) return createPrivateKey(pem);

  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return privateKey;
}

function crxIdToExtensionId(crxId: Buffer): string {
  let id = '';
  for (const byte of crxId) {
    id += String.fromCharCode(97 + ((byte >> 4) & 0x0f));
    id += String.fromCharCode(97 + (byte & 0x0f));
  }

  return id;
}

function buildCrx3(zipBuffer: Buffer, privateKey: KeyObject): { crx: Buffer; extensionId: string } {
  const publicKeyDer = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  const crxId = createHash('sha256').update(publicKeyDer).digest().subarray(0, 16);
  const signedHeaderData = encodeLengthDelimited(1, crxId);

  const signedHeaderSize = Buffer.alloc(4);
  signedHeaderSize.writeUInt32LE(signedHeaderData.length, 0);

  const signer = createSign('RSA-SHA256');
  signer.update(Buffer.from('CRX3 SignedData\x00', 'ascii'));
  signer.update(signedHeaderSize);
  signer.update(signedHeaderData);
  signer.update(zipBuffer);
  const signature = signer.sign(privateKey);

  const keyProof = Buffer.concat([
    encodeLengthDelimited(1, publicKeyDer),
    encodeLengthDelimited(2, signature),
  ]);

  const header = Buffer.concat([
    encodeLengthDelimited(2, keyProof),
    encodeLengthDelimited(10000, signedHeaderData),
  ]);

  const prelude = Buffer.alloc(12);
  prelude.write('Cr24', 0, 'ascii');
  prelude.writeUInt32LE(3, 4);
  prelude.writeUInt32LE(header.length, 8);

  return {
    crx: Buffer.concat([prelude, header, zipBuffer]),
    extensionId: crxIdToExtensionId(crxId),
  };
}

function buildUpdatesXml(extensionId: string, version: string, crxUrl: string): string {
  return `<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='${extensionId}'>
    <updatecheck codebase='${crxUrl}' version='${version}' />
  </app>
</gupdate>
`;
}

const pkg = JSON.parse(await readFile('package.json', 'utf8')) as { version: string };
const versionLabel = (process.env.RELEASE_TAG || `v${pkg.version}`).replace(/^v/, '');
const repo = process.env.GITHUB_REPOSITORY || 'circles-00/pr-tracker';

await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(OUT_DIR, { recursive: true });

const signingKey = loadSigningKey();
const publicKeyBase64 = createPublicKey(signingKey).export({ type: 'spki', format: 'der' }).toString('base64');

const files = await collectFiles(DIST_DIR);
if (process.env.CRX_PRIVATE_KEY?.trim()) {
  const manifestFile = files.find((f) => f.name === 'manifest.json');
  if (manifestFile) {
    const manifest = JSON.parse(manifestFile.data.toString('utf8')) as Record<string, unknown>;
    manifest.key = publicKeyBase64;
    manifestFile.data = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }
}

const zipBuffer = buildZip(files);
const { crx: crxBuffer, extensionId } = buildCrx3(zipBuffer, signingKey);

const zipPath = join(OUT_DIR, `pr-tracker-v${versionLabel}.zip`);
const crxPath = join(OUT_DIR, `pr-tracker-v${versionLabel}.crx`);
const crxDownloadUrl = `https://github.com/${repo}/releases/download/v${versionLabel}/pr-tracker-v${versionLabel}.crx`;
const updatesXml = buildUpdatesXml(extensionId, pkg.version, crxDownloadUrl);

await Promise.all([
  writeFile(zipPath, zipBuffer),
  writeFile(crxPath, crxBuffer),
  writeFile('updates.xml', updatesXml),
]);
console.log(
  `Packaged ${zipPath} (${zipBuffer.length} bytes), ${crxPath} (${crxBuffer.length} bytes), updates.xml (appid=${extensionId})`,
);
