// Downloads DOOM1.WAD (shareware) into ./assets, falling back to Freedoom. No-op if the WAD is present.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dest = path.join(root, "assets", "DOOM1.WAD");

const SOURCES = [
  "https://distro.ibiblio.org/slitaz/sources/packages/d/doom1.wad",
  "https://github.com/freedoom/freedoom/releases/download/v0.13.0/freedoom-0.13.0.zip",
];

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function fetchWad() {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1_000_000) {
    console.log(`fetch-wad: ${path.relative(root, dest)} already present, skipping`);
    return dest;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const buf = await download(SOURCES[0]).catch((e) => {
    console.warn(`fetch-wad: shareware mirror failed (${e.message})`);
    return null;
  });
  if (buf && buf.toString("ascii", 0, 4) === "IWAD") {
    fs.writeFileSync(dest, buf);
    return dest;
  }
  throw new Error(
    "Could not download DOOM1.WAD. Place it at assets/DOOM1.WAD manually " +
      `(Freedoom fallback: ${SOURCES[1]} -> extract freedoom1.wad and rename).`
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  fetchWad().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
