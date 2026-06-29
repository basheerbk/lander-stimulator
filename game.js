// game.js — Lunar landing simulation: physics, flight systems, and telemetry for iLab Moon Day.
import { initScene, syncScene, triggerScreenShake } from './scene.js';
import { initAudio, setEngineThrottle, playRCS, playTouchdown, playCrash, playLowFuelBeep } from './audio.js';
import { initMap, drawMap } from './map.js';
import { initControllerUI, getControllerState } from './controller.js';
import { groundHeightAt } from './terrain.js';
import { LEG_SPAN, LEG_DROP, BELL_DROP, footpadClearance, contactPoints } from './lander.js';
import {
  initAssistPanel,
  applyStabilizer,
  guidanceAccel,
  descentThrottle,
  anyAssistActive,
  assists,
  activeAssistLabels,
} from './assists.js';

export { groundHeightAt };

// ─── Physics constants ────────────────────────────────────────────────────────

const MOON_G     = 1.62;       // m/s²
const DT         = 1 / 120;
const MAX_DT     = 0.05;

const THRUST     = 4500;       // N — a bit more margin for final descent
const DRY_MASS   = 1200;       // kg
const FUEL_MASS  = 800;        // kg
const FUEL_BURN  = 14;         // kg/s at full throttle
const ROT_SPEED  = 2.1;        // rad/s — easier to level out

const SAFE_VY    = 4.0;        // m/s max vertical touchdown speed
const SAFE_VX    = 2.8;        // m/s max horizontal drift
const SAFE_ANGLE = 22;          // degrees max tilt

// ─── State ────────────────────────────────────────────────────────────────────

const keys = { up: false, left: false, right: false };
let simState = 'active'; // 'active' | 'landed' | 'ended'

let particles  = []; // exhaust: { x, y, vx, vy, life, maxLife, size }
let dust       = []; // regolith
let rcsPuffsL  = []; // RCS left thruster
let rcsPuffsR  = []; // RCS right thruster

// Variable throttle: ramps 0→1 while held, drops quickly when released
let throttleLevel = 0;
const THROTTLE_UP   = 1 / 0.22;
const THROTTLE_DOWN = 1 / 0.35; // slower bleed — easier to hover on thrust pulses

let lowFuelBeeped = false;
let wasThrusting  = false;

const rocket = {
  x: 0, y: 600,
  vx: 0, vy: 0,
  angle: 0,
  fuel: FUEL_MASS,
};

function totalMass()   { return DRY_MASS + rocket.fuel; }

function getInput() {
  const pad = getControllerState();
  const kbThrust  = keys.up ? 1 : 0;
  const kbRotate  = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  if (pad.connected) {
    return {
      thrust: Math.max(kbThrust, pad.thrust),
      rotate: Math.abs(pad.rotate) > 0.12 ? pad.rotate : kbRotate,
      analog: true,
    };
  }
  return { thrust: kbThrust, rotate: kbRotate, analog: false };
}

function isThrusting() {
  return throttleLevel > 0.05 && rocket.fuel > 0 && simState === 'active';
}

function normalizeAngle(a) {
  while (a >  Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// ─── Simulation reset ─────────────────────────────────────────────────────────

function resetSimulation() {
  const sim = !anyAssistActive();
  rocket.x     = sim ? (-90 - Math.random() * 80) : (-60 - Math.random() * 50);
  rocket.y     = sim ? (520 + Math.random() * 140) : (580 + Math.random() * 120);
  rocket.vx    = sim ? (3 + Math.random() * 5) : (1.5 + Math.random() * 2.5);
  rocket.vy    = sim ? -(1.5 + Math.random() * 2.5) : -(0.8 + Math.random() * 1.8);
  rocket.angle = sim ? ((Math.random() - 0.5) * 0.32) : ((Math.random() - 0.5) * 0.12);
  rocket.fuel  = FUEL_MASS;
  particles    = [];
  dust         = [];
  rcsPuffsL    = [];
  rcsPuffsR    = [];
  throttleLevel = 0;
  lowFuelBeeped = false;
  simState    = 'active';
  document.getElementById('overlay').classList.add('hidden');
  document.getElementById('overlay-summary').textContent = '';
  document.getElementById('message').textContent = sim
    ? 'Full simulation — Apollo-style manual powered descent. Real Moon gravity, no flight automation.'
    : 'Guided demo — hold ↑ near 11 m gear alt, then ease down. Altitude = footpad height.';
}

// ─── Physics update ───────────────────────────────────────────────────────────

function updatePhysics() {
  if (simState !== 'active') return;

  // Rotation (RCS) — pilot input, then optional attitude stabilizer
  const inp = getInput();
  if (Math.abs(inp.rotate) > 0.12) {
    rocket.angle += inp.rotate * ROT_SPEED * DT;
    if (inp.rotate < -0.12) { spawnRCS('left');  playRCS(); }
    if (inp.rotate >  0.12) { spawnRCS('right'); playRCS(); }
  }
  const stabSide = applyStabilizer(rocket, inp.rotate);
  if (stabSide && Math.random() < 0.12) {
    spawnRCS(stabSide);
    playRCS();
  }
  rocket.angle = normalizeAngle(rocket.angle);

  // Manual throttle ramp (keyboard / joystick)
  let manualThr = throttleLevel;
  if (inp.analog) {
    manualThr = inp.thrust > 0.05 ? inp.thrust : 0;
  } else if (inp.thrust > 0.05 && rocket.fuel > 0) {
    manualThr = Math.min(1, manualThr + THROTTLE_UP * DT);
  } else {
    manualThr = Math.max(0, manualThr - THROTTLE_DOWN * DT);
  }

  const mass = totalMass();
  const gearAlt = footpadClearance(rocket, groundHeightAt);
  const autoThr = descentThrottle(gearAlt, rocket, mass, MOON_G, THRUST, inp.thrust > 0.05);
  if (autoThr !== null) {
    throttleLevel = inp.thrust > 0.05 ? manualThr : autoThr;
  } else {
    throttleLevel = manualThr;
  }

  // Thrust sound gating
  const nowThrusting = isThrusting();
  setEngineThrottle(throttleLevel);
  wasThrusting = nowThrusting;

  // Main engine force
  let ax = 0, ay = -MOON_G;
  ax += guidanceAccel(rocket.vx);

  if (throttleLevel > 0.01 && rocket.fuel > 0) {
    const burn  = Math.min(FUEL_BURN * throttleLevel * DT, rocket.fuel);
    rocket.fuel -= burn;
    const force = THRUST * (burn / (FUEL_BURN * DT));
    ax += (Math.sin(rocket.angle) * force) / mass;
    ay += (Math.cos(rocket.angle) * force) / mass;

    // Exhaust particles — always a little fire at low throttle, more as throttle rises
    const ex = rocket.x - Math.sin(rocket.angle) * 11;
    const ey = rocket.y - Math.cos(rocket.angle) * 11;
    const spawnChance = 0.35 + throttleLevel * 0.65;
    if (Math.random() < spawnChance) {
      const count = 2 + Math.round(throttleLevel * 4);
      for (let i = 0; i < count; i++) {
        const maxLife = 0.28 + Math.random() * 0.32 + throttleLevel * 0.12;
        particles.push({
          x: ex + (Math.random() - 0.5) * (1.5 + throttleLevel * 2),
          y: ey + (Math.random() - 0.5) * (1.5 + throttleLevel * 2),
          vx: rocket.vx - Math.sin(rocket.angle) * (28 + Math.random() * 48 * throttleLevel) + (Math.random() - 0.5) * 10,
          vy: rocket.vy - Math.cos(rocket.angle) * (28 + Math.random() * 48 * throttleLevel) + (Math.random() - 0.5) * 10,
          life:    maxLife,
          maxLife: maxLife,
          size:    1.8 + Math.random() * 2.2 + throttleLevel * 1.2,
        });
      }
    }
  }

  // Low fuel warning
  const fuelPct = (rocket.fuel / FUEL_MASS) * 100;
  if (fuelPct < 20 && !lowFuelBeeped) {
    playLowFuelBeep();
    lowFuelBeeped = true;
  }
  if (fuelPct > 25) lowFuelBeeped = false;

  // Integrate
  rocket.vx += ax * DT;
  rocket.vy += ay * DT;
  rocket.x  += rocket.vx * DT;
  rocket.y  += rocket.vy * DT;

  // ── Ground collision ──────────────────────────────────────────────────────
  // Three contact points that match the 3D mesh geometry:
  //   Left footpad:  local ( LEG_SPAN, -LEG_DROP)
  //   Right footpad: local (-LEG_SPAN, -LEG_DROP)
  //   Engine bell:   local (0, -BELL_DROP)
  //
  // World transform: w = rocket.pos + local_x * right + local_y * up
  //   right = ( cosA, sinA),  up = (-sinA, cosA)   (angle=0 → straight up)
  const { lfx, lfy, rfx, rfy, bex, bey } = contactPoints(rocket);

  const groundL    = groundHeightAt(lfx);
  const groundR    = groundHeightAt(rfx);
  const groundBell = groundHeightAt(bex);

  const clearL    = lfy - groundL;
  const clearR    = rfy - groundR;
  const clearBell = bey - groundBell;
  const minClear  = Math.min(clearL, clearR, clearBell);
  const feetDown  = clearL <= 0 && clearR <= 0;

  if (minClear <= 0) {
    rocket.y -= minClear;

    // Bell or one foot grazing — bump and keep flying; only footpads count as touchdown
    if (!feetDown) {
      rocket.vy *= 0.45;
      rocket.vx *= 0.92;
      return;
    }

    const impactVy    = -rocket.vy;
    const impactVx    = Math.abs(rocket.vx);
    const impactAngle = Math.abs(rocket.angle * 180 / Math.PI);
    const groundHere  = Math.min(groundL, groundR);

    rocket.vy  = 0;
    rocket.vx *= 0.2;

    const soft   = impactVy <= SAFE_VY;
    const steady = impactVx <= SAFE_VX && impactAngle <= SAFE_ANGLE;

    if (soft && steady) {
      const analysis = analyzeLanding(impactVy, impactVx, impactAngle);
      const systems  = activeAssistLabels();
      const sysNote  = systems.length
        ? `Flight systems: ${systems.join(', ')}`
        : 'Full manual descent — no automation';
      endSimulation(true,
        `Touchdown at ${rocket.x.toFixed(0)} m · descent ${impactVy.toFixed(1)} m/s · drift ${impactVx.toFixed(1)} m/s.`,
        `${analysis.summary}\n${sysNote}`);
      playTouchdown();
      spawnDust(rocket.x, groundHere, 55);
    } else {
      let reason = 'Touchdown outside safe operating limits.';
      if (impactVy > SAFE_VY)       reason = `Descent rate too high — ${impactVy.toFixed(1)} m/s (limit ${SAFE_VY} m/s).`;
      else if (impactVx > SAFE_VX)  reason = `Lateral drift too high — ${impactVx.toFixed(1)} m/s (limit ${SAFE_VX} m/s).`;
      else if (impactAngle > SAFE_ANGLE) reason = `Vehicle attitude unstable — ${impactAngle.toFixed(0)}° (limit ${SAFE_ANGLE}°).`;
      endSimulation(false, reason, null);
      playCrash();
      triggerScreenShake(Math.min(1, impactVy / 12));
    }
  }

  if (rocket.y < -120) endSimulation(false, 'Lost surface contact — descent below terrain.', null);
}

// ─── RCS particle spawning ────────────────────────────────────────────────────

function spawnRCS(side) {
  // Small lateral burst perpendicular to the rocket axis, from the top of the vessel
  const sinA = Math.sin(rocket.angle), cosA = Math.cos(rocket.angle);
  const offset = side === 'left' ? 1 : -1;

  // RCS fires from the side of the ascent module (~8m up from center)
  const px = rocket.x + offset * cosA * 3.5 - sinA * 8;
  const py = rocket.y + offset * sinA * 3.5 + cosA * 8;

  const arr = side === 'left' ? rcsPuffsL : rcsPuffsR;
  for (let i = 0; i < 2; i++) {
    const maxLife = 0.18 + Math.random() * 0.12;
    arr.push({
      x: px + (Math.random() - 0.5) * 1.5,
      y: py + (Math.random() - 0.5) * 1.5,
      vx: rocket.vx + offset * cosA * (12 + Math.random() * 8) + (Math.random() - 0.5) * 4,
      vy: rocket.vy + offset * sinA * (12 + Math.random() * 8) + (Math.random() - 0.5) * 4,
      life:    maxLife,
      maxLife: maxLife,
      size:    1,
    });
  }
}

function spawnDust(cx, cy, count) {
  for (let i = 0; i < count; i++) {
    dust.push({
      x:    cx + (Math.random() - 0.5) * 55,
      y:    cy,
      vx:   (Math.random() - 0.5) * 15,
      vy:   Math.random() * 9 + 2,
      life: 2.0 + Math.random() * 0.8,
      maxLife: 2.8,
      size: 2.5 + Math.random() * 4.5,
    });
  }
}

// ─── Particle physics ─────────────────────────────────────────────────────────

function updateParticles() {
  function step(arr, grav, minY) {
    let w = 0;
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i];
      p.x    += p.vx * DT;
      p.y    += p.vy * DT;
      p.vy   -= grav * DT;
      p.life -= DT;
      if (p.life > 0 && p.y >= minY) arr[w++] = p;
    }
    arr.length = w;
  }
  step(particles, MOON_G * 0.07, -Infinity); // exhaust barely affected by gravity
  step(dust,      MOON_G,        0);         // regolith follows full moon gravity
  step(rcsPuffsL, MOON_G * 0.05, -Infinity);
  step(rcsPuffsR, MOON_G * 0.05, -Infinity);
}

// ─── Landing telemetry ────────────────────────────────────────────────────────

function analyzeLanding(vy, vx, angleDeg) {
  const speedPts  = Math.max(0, 25 - vy * 5);
  const driftPts  = Math.max(0, 25 - vx * 7);
  const anglePts  = Math.max(0, 20 - angleDeg * 0.7);
  const fuelPts   = (rocket.fuel / FUEL_MASS) * 30;
  const total     = Math.round(speedPts + driftPts + anglePts + fuelPts);
  let rating = 'Unsafe';
  if (total >= 90)      rating = 'Nominal';
  else if (total >= 75) rating = 'Acceptable';
  else if (total >= 55) rating = 'Marginal';
  else if (total >= 35) rating = 'Hard';
  const summary = `Landing assessment: ${rating} · telemetry ${total}/100 · fuel ${((rocket.fuel / FUEL_MASS) * 100).toFixed(0)}% remaining`;
  return { total, rating, summary };
}

// ─── Simulation end ───────────────────────────────────────────────────────────

function endSimulation(success, msg, summary) {
  simState = success ? 'landed' : 'ended';
  document.getElementById('overlay-title').textContent = success
    ? 'Touchdown Confirmed'
    : 'Hard Landing';
  document.getElementById('overlay-body').textContent  = msg;
  document.getElementById('overlay-summary').textContent = summary || '';
  document.getElementById('overlay').classList.remove('hidden');
}

// ─── HUD update ───────────────────────────────────────────────────────────────

function updateHUD() {
  const alt      = footpadClearance(rocket, groundHeightAt);
  const vy       = -rocket.vy;
  const vx       = rocket.vx;
  const deg      = rocket.angle * 180 / Math.PI;
  const fuelPct  = (rocket.fuel / FUEL_MASS) * 100;
  const thrPct   = throttleLevel * 100;

  function set(id, val, cls) {
    const el = document.getElementById(id);
    el.textContent = val;
    el.className   = cls || '';
  }

  set('alt',      alt.toFixed(0),             alt < 3 ? 'danger' : alt < 15 ? 'warn' : '');
  set('vspeed',   vy.toFixed(1),              vy > SAFE_VY ? 'danger' : vy > SAFE_VY * 0.6 ? 'warn' : 'good');
  set('hspeed',   Math.abs(vx).toFixed(1),    Math.abs(vx) > SAFE_VX ? 'danger' : '');
  set('angle',    deg.toFixed(1),             Math.abs(deg) > SAFE_ANGLE ? 'danger' : '');
  set('fuel',     fuelPct.toFixed(0),         fuelPct < 20 ? 'danger' : fuelPct < 40 ? 'warn' : '');
  set('throttle', thrPct.toFixed(0),          thrPct < 5 ? '' : thrPct > 80 ? 'good' : 'warn');

  const pad = getControllerState();
  const ctrlEl = document.getElementById('input-source');
  if (ctrlEl) {
    ctrlEl.textContent = pad.connected ? 'CONSOLE' : 'KEYBOARD';
    ctrlEl.className   = 'input-source ' + (pad.connected ? 'console' : '');
  }

  const modeEl = document.getElementById('assist-mode');
  if (modeEl && simState === 'active') {
    const active = [];
    if (assists.stabilizer) active.push('STAB');
    if (assists.guidance)   active.push('GUID');
    if (assists.descent)    active.push('DESC');
    modeEl.title = active.length ? `Active: ${active.join(', ')}` : 'No assists — manual flight';
  }
}

// ─── Input ────────────────────────────────────────────────────────────────────

window.addEventListener('keydown', e => {
  if (e.code === 'ArrowUp'    || e.code === 'KeyW' || e.code === 'Space') { keys.up    = true; e.preventDefault(); }
  if (e.code === 'ArrowLeft'  || e.code === 'KeyA') keys.left  = true;
  if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.right = true;
  initAudio(); // lazy-init on first gesture
});
window.addEventListener('keyup', e => {
  if (e.code === 'ArrowUp'    || e.code === 'KeyW' || e.code === 'Space') keys.up    = false;
  if (e.code === 'ArrowLeft'  || e.code === 'KeyA') keys.left  = false;
  if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.right = false;
});

document.getElementById('restart-btn').addEventListener('click', () => {
  initAudio();
  resetSimulation();
});

// ─── Game loop ────────────────────────────────────────────────────────────────

let accumulator = 0;
let lastTime    = performance.now();

function loop(now) {
  const frameDt = Math.min((now - lastTime) / 1000, MAX_DT);
  lastTime = now;
  accumulator += frameDt;

  while (accumulator >= DT) {
    updatePhysics();
    updateParticles();
    accumulator -= DT;
  }

  updateHUD();
  drawMap(rocket, groundHeightAt);
  syncScene(rocket, particles, dust, rcsPuffsL, rcsPuffsR, throttleLevel, isThrusting());
  requestAnimationFrame(loop);
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function showError(msg) {
  const el = document.getElementById('message');
  if (el) { el.textContent = msg; el.style.color = '#ff5252'; }
  console.error(msg);
}

function init() {
  try {
    initScene(groundHeightAt);
    initMap();
    initControllerUI();
    initAssistPanel();
    resetSimulation();
    requestAnimationFrame(loop);
  } catch (e) {
    showError('Failed to start: ' + e.message);
  }
}

window.addEventListener('error', e => showError('Error: ' + (e.message || 'unknown')));
window.addEventListener('unhandledrejection', e => {
  showError('Load error: ' + (e.reason?.message || e.reason || 'module failed'));
});

init();
