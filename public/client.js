"use strict";
// Dumb display rasterizer. All geometry (dx, sx, sy, sh, dy, dh) arrives precomputed from MongoDB.
// This file must contain no Math, no trigonometry and no multiplication/division operators.

const canvas = document.getElementById("screen");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;
ctx.font = "bold 14px monospace";

const wallImgs = {};
const flatImgs = {};
const skyImg = new Image();
const spriteImgs = {};
const hudImgs = {};

const msEl = document.getElementById("ms");
const fpsEl = document.getElementById("fps");
const tickEl = document.getElementById("tick");
const statusEl = document.getElementById("status");
const jsonEl = document.getElementById("json");
const jsonPause = document.getElementById("jsonPause");
const jsonCopy = document.getElementById("jsonCopy");
let lastMsg = null;
let jsonPaused = false;

// Shorten long lists so the inspector stays readable; the copy button still gives the full message.
function shorten(key, value) {
  if (Array.isArray(value) && value.length > 3 && key !== "t") {
    const note = "... " + value.length + " items in total, first 2 shown";
    return [value[0], value[1], note];
  }
  if (Array.isArray(value) && key === "t" && value.length > 6) {
    return value.slice(0, 6).concat("... " + value.length + " texels");
  }
  return value;
}

function loadAll(dict, urls) {
  const jobs = [];
  for (const key of Object.keys(urls)) {
    const img = new Image();
    dict[key] = img;
    jobs.push(new Promise((resolve) => { img.onload = resolve; img.src = urls[key]; }));
  }
  return Promise.all(jobs);
}

// Lookup tables built with counters (the rasterizer contract forbids multiplication/division in this file):
// texOff[t] is the byte offset of packed flat texel t, rowOff[y] / colOff[x] the byte offsets of a layer pixel.
const texOff = [];
const rowOff = [];
const colOff = [];
const texU = [];
const texV = [];
let acc = 0;
for (let t = 0; t < 4096; t++) {
  texOff.push(acc);
  acc += 4;
}
acc = 0;
for (let y = 0; y < 168; y++) {
  rowOff.push(acc);
  acc += 1280;
}
acc = 0;
for (let x = 0; x < 320; x++) {
  colOff.push(acc);
  acc += 4;
}
for (let v = 0; v < 64; v++) {
  for (let u = 0; u < 64; u++) {
    texU.push(u);
    texV.push(v);
  }
}

// Floor/ceiling texels are written into one ImageData layer (one drawImage instead of ~16k tiny ones).
const layerCanvas = document.createElement("canvas");
layerCanvas.width = 320;
layerCanvas.height = 168;
const layerCtx = layerCanvas.getContext("2d");
const layer = layerCtx.createImageData(320, 168);
const flatPix = {};

function readFlat(img) {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  return g.getImageData(0, 0, 64, 64).data;
}

// BEGIN RENDER
// Depth fades are fixed gradients (no per-frame numbers): dark at the horizon, clear near the viewer.
const fadeCeil = ctx.createLinearGradient(0, 0, 0, 84);
fadeCeil.addColorStop(0, "rgba(0,0,0,0.05)");
fadeCeil.addColorStop(1, "rgba(0,0,0,0.6)");
const fadeFloor = ctx.createLinearGradient(0, 84, 0, 168);
fadeFloor.addColorStop(0, "rgba(0,0,0,0.65)");
fadeFloor.addColorStop(1, "rgba(0,0,0,0)");

function render(frame) {
  ctx.fillStyle = "#343434";
  ctx.fillRect(0, 0, 320, 84);
  ctx.fillStyle = "#4c4c4c";
  ctx.fillRect(0, 84, 320, 84);

  layer.data.fill(0);
  for (const col of frame.columns) {
    for (const fl of col.f) {
      ctx.fillStyle = fl.c;
      ctx.fillRect(col.dx, fl.dy, 2, fl.dh);
      if (fl.fl > 0) {
        const pix = flatPix[fl.fl];
        const left = colOff[col.dx];
        let y = fl.dy;
        for (const t of fl.t) {
          const s = texOff[t];
          for (let k = 0; k < frame.rh; k++) {
            const o = rowOff[y + k] + left;
            layer.data[o] = pix[s];
            layer.data[o + 1] = pix[s + 1];
            layer.data[o + 2] = pix[s + 2];
            layer.data[o + 3] = 255;
            layer.data[o + 4] = pix[s];
            layer.data[o + 5] = pix[s + 1];
            layer.data[o + 6] = pix[s + 2];
            layer.data[o + 7] = 255;
          }
          y += frame.rh;
        }
      }
    }
  }
  layerCtx.putImageData(layer, 0, 0);
  ctx.drawImage(layerCanvas, 0, 0);

  for (const col of frame.columns) {
    for (const fl of col.f) {
      if (fl.ld > 0) {
        ctx.fillStyle = "rgba(0,0,0," + fl.ld + ")";
        ctx.fillRect(col.dx, fl.dy, 2, fl.dh);
      }
    }
  }
  ctx.fillStyle = fadeCeil;
  ctx.fillRect(0, 0, 320, 84);
  ctx.fillStyle = fadeFloor;
  ctx.fillRect(0, 84, 320, 84);

  // sky: t = [source column, source row, source height] of the 256x128 sky image
  for (const col of frame.columns) {
    for (const fl of col.f) {
      if (fl.fl < 0) {
        ctx.drawImage(skyImg, fl.t[0], fl.t[1], 1, fl.t[2], col.dx, fl.dy, 2, fl.dh);
      }
    }
  }

  for (const col of frame.columns) {
    for (const w of col.w) {
      ctx.drawImage(wallImgs[w.tex], w.sx, w.sy, 1, w.sh, col.dx, w.dy, 2, w.dh);
      ctx.fillStyle = "rgba(0,0,0," + w.shade + ")";
      ctx.fillRect(col.dx, w.dy, 2, w.dh);
    }
  }

  for (const sp of frame.sprites) {
    for (const st of sp.strips) {
      ctx.drawImage(spriteImgs[sp.frame], st.sx, st.sy, 1, st.sh, st.dx, st.dy, 2, st.dh);
    }
  }

  const hud = frame.hud;
  ctx.drawImage(spriteImgs[hud.weaponSprite], hud.weaponDx, hud.weaponDy);
  ctx.fillStyle = hud.screenFlashRgba;
  ctx.fillRect(0, 0, 320, 168);

  // status bar: every patch and digit comes with its position from MongoDB
  for (const d of hud.draw) {
    ctx.drawImage(hudImgs[d.s], d.x, d.y);
  }
  // end-of-level screen: text lines and their positions come from MongoDB
  if (hud.end.length > 0) {
    ctx.fillStyle = "rgba(0,0,0,0.75)";
    ctx.fillRect(0, 0, 320, 168);
    ctx.fillStyle = "#e0b030";
    ctx.textAlign = "center";
    for (const line of hud.end) {
      ctx.fillText(line.s, 160, line.y);
    }
  }
  if (hud.hp <= 0) {
    ctx.fillStyle = "#ff3030";
    ctx.textAlign = "center";
    ctx.fillText("YOU DIED - PRESS R", 160, 84);
  }
}
// END RENDER

// ---- input: key bits (1 fwd, 2 back, 4 strafe-left, 8 strafe-right, 16 turn-left, 32 turn-right, 64 shoot, 128 use)
const KEY_BITS = {
  KeyW: 1, ArrowUp: 1, KeyS: 2, ArrowDown: 2, KeyA: 4, KeyD: 8,
  ArrowLeft: 16, KeyQ: 16, ArrowRight: 32, Period: 32, Space: 64, KeyE: 128,
};
let keys = 0;
let ws = null;

function sendKeys() {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ k: keys }));
}
function setBit(bit, down) {
  const before = keys;
  if (down) keys |= bit; else keys &= ~bit;
  if (keys !== before) sendKeys();
}
function resetGame() {
  fetch("/api/reset", { method: "POST" });
}

window.addEventListener("keydown", (e) => {
  if (e.code === "KeyR" && !e.repeat) resetGame();
  const bit = KEY_BITS[e.code];
  if (bit) { e.preventDefault(); setBit(bit, true); }
});
window.addEventListener("keyup", (e) => {
  const bit = KEY_BITS[e.code];
  if (bit) setBit(bit, false);
});
window.addEventListener("blur", () => { keys = 0; sendKeys(); });
canvas.addEventListener("mousedown", (e) => { e.preventDefault(); setBit(64, true); });
window.addEventListener("mouseup", () => setBit(64, false));
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

jsonPause.addEventListener("click", () => {
  jsonPaused = !jsonPaused;
  jsonPause.textContent = jsonPaused ? "resume" : "pause";
});
jsonCopy.addEventListener("click", () => {
  if (lastMsg) {
    navigator.clipboard.writeText(JSON.stringify(lastMsg, null, 1));
    jsonCopy.textContent = "copied";
    setTimeout(() => { jsonCopy.textContent = "copy full JSON"; }, 1000);
  }
});

document.addEventListener("click", (e) => {
  const text = e.target.getAttribute && e.target.getAttribute("data-copy");
  if (text) {
    navigator.clipboard.writeText(text);
    e.target.textContent = "copied";
    setTimeout(() => { e.target.textContent = "copy"; }, 1000);
  }
});

// FPS: count frames, publish and reset once a second (no division needed)
let frames = 0;
let latestAvgMs = "-";
setInterval(() => {
  fpsEl.textContent = String(frames);
  msEl.textContent = latestAvgMs;
  if (lastMsg && !jsonPaused && jsonEl.offsetParent !== null) {
    jsonEl.textContent = JSON.stringify(lastMsg, shorten, 1);
  }
  frames = 0;
}, 1000);

function connect() {
  ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host);
  ws.onopen = () => { statusEl.textContent = "live"; sendKeys(); };
  ws.onclose = () => { statusEl.textContent = "disconnected, retrying..."; setTimeout(connect, 1000); };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    frames += 1;
    lastMsg = msg;
    render(msg.frame);
    latestAvgMs = msg.mongodAvgMs.toFixed(1);
    tickEl.textContent = String(msg.frame.tick);
  };
}

fetch("/api/assets")
  .then((r) => r.json())
  .then((assets) => Promise.all([
    loadAll(wallImgs, assets.wallTextures),
    loadAll(flatImgs, assets.flats).then(() => {
      for (const key of Object.keys(flatImgs)) {
        flatPix[key] = readFlat(flatImgs[key]);
      }
    }),
    new Promise((resolve) => { skyImg.onload = resolve; skyImg.src = assets.sky; }),
    loadAll(spriteImgs, assets.sprites),
    loadAll(hudImgs, assets.hud),
  ]))
  .then(connect);
canvas.focus();
