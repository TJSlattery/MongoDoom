// Downloads the shareware DOOM1.WAD into ./assets. No-op if it is already there.
// The WAD is id Software's freely distributable shareware data; this project does not modify it.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dest = path.join(root, "assets", "DOOM1.WAD");
const EXPECTED_SIZE = 4196020; // the shareware v1.9 WAD

// A zip of the shareware release (contains DOOM1.WAD). Replace with any mirror you trust.
const ZIP_URL = "https://archive.org/download/DoomsharewareEpisode/doom.ZIP";

/** Extract one named file from an in-memory zip (central directory walk + raw inflate; no dependencies). */
export function extractFromZip(zip, wanted) {
  let eocd = zip.length - 22;
  while (eocd >= 0 && zip.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("not a zip file");
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = zip.readUInt16LE(p + 10);
    const csize = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.toString("utf8", p + 46, p + 46 + nameLen);
    if (name.toUpperCase() === wanted) {
      const dataStart = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const raw = zip.subarray(dataStart, dataStart + csize);
      return method === 0 ? raw : zlib.inflateRawSync(raw);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`${wanted} not found in zip`);
}

export async function fetchWad() {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1_000_000) {
    console.log(`fetch-wad: ${path.relative(root, dest)} already present, skipping`);
    return dest;
  }
  console.log(`fetch-wad: downloading ${ZIP_URL}`);
  let wad;
  try {
    const res = await fetch(ZIP_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    wad = extractFromZip(Buffer.from(await res.arrayBuffer()), "DOOM1.WAD");
  } catch (e) {
    throw new Error(
      `Could not download DOOM1.WAD (${e.message}).\n` +
        `Place the shareware DOOM1.WAD (${EXPECTED_SIZE} bytes) at assets/DOOM1.WAD and run again.`
    );
  }
  if (wad.toString("ascii", 0, 4) !== "IWAD" || wad.length !== EXPECTED_SIZE) {
    throw new Error("Downloaded file is not the shareware DOOM1.WAD (unexpected size or header).");
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, wad);
  console.log(`fetch-wad: saved ${path.relative(root, dest)}`);
  return dest;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  fetchWad().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
