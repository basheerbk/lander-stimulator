// audio.js — Synthesized Web Audio for iLab Moon (no external files)
// All sounds created from oscillators and noise via AudioContext.
// AudioContext is created lazily on first user gesture to comply with browser autoplay policy.

let ctx = null;

// Engine sound nodes — persistent while game runs
let engineGainNode = null;
let engineOscNode  = null;
let engineNoiseNode = null;
let engineFilterNode = null;
let engineRumbleNode = null;

// Initialise AudioContext once per session (called on first keydown)
export function initAudio() {
  if (ctx) return;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    buildEngineNodes();
  } catch (e) {
    // Audio not available — all functions become no-ops
    ctx = null;
  }
}

// ─── Engine noise (continuous, throttle-driven) ───────────────────────────────

function buildEngineNodes() {
  if (!ctx) return;

  // Master gain for the engine channel — throttle controls this
  engineGainNode = ctx.createGain();
  engineGainNode.gain.value = 0;
  engineGainNode.connect(ctx.destination);

  // Sub-rumble oscillator — low frequency vibration
  engineRumbleNode = ctx.createOscillator();
  engineRumbleNode.type = 'sawtooth';
  engineRumbleNode.frequency.value = 48;

  const rumbleGain = ctx.createGain();
  rumbleGain.gain.value = 0.15;
  engineRumbleNode.connect(rumbleGain);
  rumbleGain.connect(engineGainNode);
  engineRumbleNode.start();

  // White noise source — models turbulent combustion gas
  const noiseBuffer = makeNoiseBuffer(ctx, 1.0);
  engineNoiseNode = ctx.createBufferSource();
  engineNoiseNode.buffer = noiseBuffer;
  engineNoiseNode.loop   = true;

  // Band-pass filter to shape noise into rocket hiss
  engineFilterNode = ctx.createBiquadFilter();
  engineFilterNode.type = 'bandpass';
  engineFilterNode.frequency.value = 220;
  engineFilterNode.Q.value = 1.4;

  engineNoiseNode.connect(engineFilterNode);
  engineFilterNode.connect(engineGainNode);
  engineNoiseNode.start();

  // High-pass crackle layer — mimics combustion instability
  const crackleBuffer = makeNoiseBuffer(ctx, 0.5);
  const crackleSource = ctx.createBufferSource();
  crackleSource.buffer = crackleBuffer;
  crackleSource.loop   = true;

  const crackleFilter = ctx.createBiquadFilter();
  crackleFilter.type = 'highpass';
  crackleFilter.frequency.value = 900;

  const crackleGain = ctx.createGain();
  crackleGain.gain.value = 0.08;

  crackleSource.connect(crackleFilter);
  crackleFilter.connect(crackleGain);
  crackleGain.connect(engineGainNode);
  crackleSource.start();
}

// Set engine throttle 0→1 every frame — drives gain + filter frequency
export function setEngineThrottle(throttle) {
  if (!ctx || !engineGainNode) return;
  const t = ctx.currentTime;
  // Gain: 0 at idle, peaks at ~0.28 with full throttle
  engineGainNode.gain.setTargetAtTime(throttle * 0.28, t, 0.04);
  // Filter sweeps up with throttle — higher throttle = brighter hiss
  if (engineFilterNode) {
    engineFilterNode.frequency.setTargetAtTime(180 + throttle * 220, t, 0.06);
  }
  // Rumble pitch scales slightly with throttle
  if (engineRumbleNode) {
    engineRumbleNode.frequency.setTargetAtTime(44 + throttle * 18, t, 0.06);
  }
}

// ─── RCS puff ─────────────────────────────────────────────────────────────────

let lastRCSTime = 0;

export function playRCS() {
  if (!ctx) return;
  // Rate-limit so rapid rotations don't spam bursts
  if (ctx.currentTime - lastRCSTime < 0.08) return;
  lastRCSTime = ctx.currentTime;

  // Short band-pass noise burst
  const buf    = makeNoiseBuffer(ctx, 0.06);
  const source = ctx.createBufferSource();
  source.buffer = buf;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 1200;
  filter.Q.value = 2.0;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.06, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.08);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  source.start();
}

// ─── Low fuel beep ────────────────────────────────────────────────────────────

export function playLowFuelBeep() {
  if (!ctx) return;
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = 880;
  gain.gain.setValueAtTime(0.12, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.18);

  // Second beep
  const osc2  = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.type = 'sine';
  osc2.frequency.value = 660;
  gain2.gain.setValueAtTime(0.10, ctx.currentTime + 0.22);
  gain2.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.38);
  osc2.connect(gain2);
  gain2.connect(ctx.destination);
  osc2.start(ctx.currentTime + 0.22);
  osc2.stop(ctx.currentTime + 0.38);
}

// ─── Touchdown thud ───────────────────────────────────────────────────────────

export function playTouchdown() {
  if (!ctx) return;
  // Sub-bass thud
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(80, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(25, ctx.currentTime + 0.22);
  gain.gain.setValueAtTime(0.5, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.28);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.28);

  // Metal impact click — short noise burst
  const buf    = makeNoiseBuffer(ctx, 0.04);
  const source = ctx.createBufferSource();
  source.buffer = buf;
  const filt = ctx.createBiquadFilter();
  filt.type = 'highpass';
  filt.frequency.value = 600;
  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(0.15, ctx.currentTime);
  g2.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.05);
  source.connect(filt);
  filt.connect(g2);
  g2.connect(ctx.destination);
  source.start();

  // Success tone
  setTimeout(() => {
    if (!ctx) return;
    const t = ctx.currentTime;
    [440, 550, 660].forEach((freq, i) => {
      const o  = ctx.createOscillator();
      const gn = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      gn.gain.setValueAtTime(0.08, t + i * 0.12);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.12 + 0.2);
      o.connect(gn);
      gn.connect(ctx.destination);
      o.start(t + i * 0.12);
      o.stop(t + i * 0.12 + 0.2);
    });
  }, 350);
}

// ─── Crash ────────────────────────────────────────────────────────────────────

export function playCrash() {
  if (!ctx) return;

  // Rip engine audio down immediately
  if (engineGainNode) {
    engineGainNode.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
  }

  // Impact noise — full-bandwidth, decaying
  const buf    = makeNoiseBuffer(ctx, 0.6);
  const source = ctx.createBufferSource();
  source.buffer = buf;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(4000, ctx.currentTime);
  filter.frequency.exponentialRampToValueAtTime(150, ctx.currentTime + 0.5);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.55, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.55);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  source.start();

  // Descending pitch "boom"
  const osc  = ctx.createOscillator();
  const gOsc = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(180, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(18, ctx.currentTime + 0.6);
  gOsc.gain.setValueAtTime(0.35, ctx.currentTime);
  gOsc.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.65);

  const crashFilter = ctx.createBiquadFilter();
  crashFilter.type = 'lowpass';
  crashFilter.frequency.value = 800;

  osc.connect(crashFilter);
  crashFilter.connect(gOsc);
  gOsc.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.65);
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function makeNoiseBuffer(ctx, durationSeconds) {
  const sampleRate = ctx.sampleRate;
  const length     = Math.max(1, Math.ceil(sampleRate * durationSeconds));
  const buffer     = ctx.createBuffer(1, length, sampleRate);
  const data       = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}
