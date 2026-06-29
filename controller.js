// controller.js — ESP32 DIY mission console bridge (WebSocket)
//
// The physical console sends JSON over WiFi, e.g.:
//   { "thrust": 0.0–1.0, "rotate": -1.0–1.0 }
//
// thrust  → main engine (joystick Y or throttle pot)
// rotate  → RCS rotation (joystick X or L/R buttons)

const STORAGE_KEY = 'ilabMoonControllerIP';
const WS_PORT     = 81;
const RECONNECT_MS  = 2500;

let ws            = null;
let connected     = false;
let lastPacketMs  = 0;
let state         = { thrust: 0, rotate: 0 };

let onStatusChange = null;

export function getControllerState() {
  // Stale link guard — if no packet in 500 ms, treat as disconnected input
  const alive = connected && (performance.now() - lastPacketMs < 500);
  return {
    connected: alive,
    thrust:    alive ? state.thrust : 0,
    rotate:    alive ? state.rotate : 0,
  };
}

export function getSavedIP() {
  return localStorage.getItem(STORAGE_KEY) || '';
}

export function connect(ip) {
  const host = (ip || '').trim();
  if (!host) return disconnect();

  localStorage.setItem(STORAGE_KEY, host);
  disconnect();

  const url = `ws://${host}:${WS_PORT}/`;
  try {
    ws = new WebSocket(url);
  } catch (e) {
    setStatus(false, 'Invalid address');
    return;
  }

  ws.onopen = () => {
    connected = true;
    lastPacketMs = performance.now();
    setStatus(true, `Console linked · ${host}`);
  };

  ws.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      state.thrust = clamp01(data.thrust ?? data.up ?? 0);
      if (typeof data.rotate === 'number') {
        state.rotate = clamp(data.rotate, -1, 1);
      } else {
        // Digital fallback from firmware buttons
        const l = data.left  ? 1 : 0;
        const r = data.right ? 1 : 0;
        state.rotate = r - l;
      }
      lastPacketMs = performance.now();
    } catch (_) { /* ignore malformed frames */ }
  };

  ws.onclose = () => {
    setStatus(false, 'Console offline — using keyboard');
    scheduleReconnect(host);
  };

  ws.onerror = () => {
    setStatus(false, 'Connection failed — check IP & WiFi');
  };
}

export function disconnect() {
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
  connected = false;
  state = { thrust: 0, rotate: 0 };
}

export function setStatusCallback(fn) {
  onStatusChange = fn;
}

function setStatus(isConnected, message) {
  connected = isConnected;
  if (onStatusChange) onStatusChange(isConnected, message);
}

let reconnectTimer = null;

function scheduleReconnect(host) {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    if (!connected && getSavedIP() === host) connect(host);
  }, RECONNECT_MS);
}

function clamp01(v) { return Math.max(0, Math.min(1, Number(v) || 0)); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, Number(v) || 0)); }

// ─── UI wiring ────────────────────────────────────────────────────────────────

export function initControllerUI() {
  const panel   = document.getElementById('controller-panel');
  const ipInput = document.getElementById('controller-ip');
  const connectBtn = document.getElementById('controller-connect');
  const statusEl  = document.getElementById('controller-status');
  const dotEl     = document.getElementById('controller-dot');

  if (!panel) return;

  ipInput.value = getSavedIP();

  setStatusCallback((isConnected, msg) => {
    if (statusEl) statusEl.textContent = msg;
    if (dotEl) {
      dotEl.className = 'controller-dot ' + (isConnected ? 'online' : 'offline');
    }
  });

  connectBtn.addEventListener('click', () => {
    const ip = ipInput.value.trim();
    if (ip) connect(ip);
    else disconnect();
  });

  ipInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') connectBtn.click();
  });

  // Auto-reconnect if IP was saved from a previous session
  if (getSavedIP()) connect(getSavedIP());
}
