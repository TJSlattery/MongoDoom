import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

/** Remove comments and blank out string/template literals so only real code tokens remain. */
export function stripJs(src) {
  let out = "";
  for (let i = 0; i < src.length; ) {
    const c = src[i], n = src[i + 1];
    if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && n === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const q = c; i++;
      while (i < src.length && src[i] !== q) i += src[i] === "\\" ? 2 : 1;
      i++; out += '""'; continue;
    }
    out += c; i++;
  }
  return out;
}

const BANNED_WORDS = /\b(Math|sin|cos|tan|atan2|sqrt|hypot|perpDist|zBuffer)\b/;
const WORLD_STATE = /\b(player|enemies|worldX|worldY)\b|\.sort\s*\(/;

export function violations(code) {
  const found = [];
  if (BANNED_WORDS.test(code)) found.push(`banned identifier ${code.match(BANNED_WORDS)[0]}`);
  if (WORLD_STATE.test(code)) found.push(`world state ${code.match(WORLD_STATE)[0]}`);
  if (/[*/]/.test(code)) found.push("multiplication/division operator");
  return found;
}

test("lint rules catch violations (negative controls)", () => {
  assert.ok(violations(stripJs("const a = Math.floor(1);")).length > 0);
  assert.ok(violations(stripJs("const a = b * 2;")).length > 0);
  assert.ok(violations(stripJs("const a = b / 2;")).length > 0);
  assert.ok(violations(stripJs("x = Math\n.max(1,2)")).length > 0);
  assert.ok(violations(stripJs("sprites.sort((a, b) => a.d)")).length > 0);
  assert.ok(violations(stripJs("const z = perpDist;")).length > 0);
  // allowed: banned text only inside comments / strings
  assert.deepEqual(violations(stripJs('// Math * /\n/* sin / cos */ const u = "/api/x * Math";')), []);
});

test("public/ contains no Math, trig, world state, or * / operators", () => {
  const files = fs.readdirSync(publicDir).filter((f) => /\.(js|html)$/.test(f));
  assert.ok(files.includes("client.js") && files.includes("index.html"));
  for (const f of files) {
    const text = fs.readFileSync(path.join(publicDir, f), "utf8");
    if (f.endsWith(".js")) {
      assert.deepEqual(violations(stripJs(text)), [], `${f} violates the zero-math contract`);
    } else {
      assert.ok(!BANNED_WORDS.test(text), `${f}: ${text.match(BANNED_WORDS)?.[0]}`);
      const inline = [...text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter(([, attrs, body]) => !/\bsrc=/.test(attrs) || body.trim());
      assert.equal(inline.length, 0, "no inline script bodies in index.html");
    }
  }
});

test("client render() is loop-only painting of precomputed strips", () => {
  const src = fs.readFileSync(path.join(publicDir, "client.js"), "utf8");
  const region = src.slice(src.indexOf("// BEGIN RENDER"), src.indexOf("// END RENDER"));
  assert.ok(region.length > 100, "render region markers present");
  assert.ok(region.includes("for (const col of frame.columns)"));
  assert.ok(region.includes("for (const sp of frame.sprites)") && region.includes("for (const st of sp.strips)"));
  assert.ok(region.includes("drawImage(wallImgs[col.tex], col.sx, col.sy, 1, col.sh, col.dx, col.dy, 2, col.dh)"));
  assert.ok(region.includes("drawImage(spriteImgs[sp.frame], st.sx, st.sy, 1, st.sh, st.dx, st.dy, 2, st.dh)"));
});
