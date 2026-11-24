"use strict";
// Dumb display rasterizer. All geometry (dx, sx, sy, sh, dy, dh) arrives precomputed from MongoDB.
// This file must contain no Math, no trigonometry and no multiplication/division operators.

const canvas = document.getElementById("screen");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;
ctx.font = "bold 14px monospace";

const wallImgs = {};
const spriteImgs = {};
const hudImgs = {};

const msEl = document.getElementById("ms");
const fpsEl = document.getElementById("fps");
const tickEl = document.getElementById("tick");
const statusEl = document.getElementById("status");

function loadAll(dict, urls) {
  const jobs = [];
  for (const key of Object.keys(urls)) {
    const img = new Image();
    dict[key] = img;
    jobs.push(new Promise((resolve) => { img.onload = resolve; img.src = urls[key]; }));
  }
  return Promise.all(jobs);
}

// BEGIN RENDER
function render(frame) {
  ctx.fillStyle = "#343434";
  ctx.fillRect(0, 0, 320, 84);
  ctx.fillStyle = "#4c4c4c";
  ctx.fillRect(0, 84, 320, 84);

  for (const col of frame.columns) {
    if (col.dh > 0) {
      ctx.drawImage(wallImgs[col.tex], col.sx, col.sy, 1, col.sh, col.dx, col.dy, 2, col.dh);
      ctx.fillStyle = "rgba(0,0,0," + col.shade + ")";
      ctx.fillRect(col.dx, col.dy, 2, col.dh);
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

  ctx.drawImage(hudImgs.STBAR, 0, 168);
  ctx.drawImage(hudImgs[hud.faceSprite], 143, 169);
  ctx.fillStyle = "#e0b030";
  ctx.textAlign = "right";
  ctx.fillText(String(hud.ammo), 44, 187);
  ctx.fillText(hud.hp + "%", 100, 187);
  ctx.fillText(String(hud.kills), 138, 187);
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
  frames = 0;
}, 1000);

function connect() {
  ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host);
  ws.onopen = () => { statusEl.textContent = "live"; sendKeys(); };
  ws.onclose = () => { statusEl.textContent = "disconnected, retrying..."; setTimeout(connect, 1000); };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    frames += 1;
    render(msg.frame);
    latestAvgMs = msg.mongodAvgMs.toFixed(1);
    tickEl.textContent = String(msg.frame.tick);
  };
}

fetch("/api/assets")
  .then((r) => r.json())
  .then((assets) => Promise.all([
    loadAll(wallImgs, assets.wallTextures),
    loadAll(spriteImgs, assets.sprites),
    loadAll(hudImgs, assets.hud),
  ]))
  .then(connect);
canvas.focus();
