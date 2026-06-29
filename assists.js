// assists.js — Optional flight systems for guided demo vs full lunar simulation

export const assists = {
  stabilizer: true,
  guidance:   true,
  descent:    true,
};

const STAB_GAIN   = 3.2;
const GUIDE_GAIN  = 0.55;
const DESC_ALT_ON = 280;

export function initAssistPanel() {
  const panel = document.getElementById('assist-panel');
  if (!panel) return;

  const bind = (id, key) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.checked = assists[key];
    el.addEventListener('change', () => {
      assists[key] = el.checked;
      updateAssistModeLabel();
    });
  };

  bind('assist-stab', 'stabilizer');
  bind('assist-guid', 'guidance');
  bind('assist-desc', 'descent');

  document.getElementById('assist-preset-train')?.addEventListener('click', () => {
    setAssists(true, true, true);
  });
  document.getElementById('assist-preset-sim')?.addEventListener('click', () => {
    setAssists(false, false, false);
  });

  updateAssistModeLabel();
}

function setAssists(stab, guid, desc) {
  assists.stabilizer = stab;
  assists.guidance   = guid;
  assists.descent    = desc;
  document.getElementById('assist-stab').checked = stab;
  document.getElementById('assist-guid').checked = guid;
  document.getElementById('assist-desc').checked = desc;
  updateAssistModeLabel();
}

function updateAssistModeLabel() {
  const mode = document.getElementById('assist-mode');
  if (!mode) return;
  const allOff = !assists.stabilizer && !assists.guidance && !assists.descent;
  const allOn  = assists.stabilizer && assists.guidance && assists.descent;
  mode.textContent = allOff ? 'FULL SIM' : allOn ? 'GUIDED' : 'CUSTOM';
  mode.className   = 'assist-mode ' + (allOff ? 'sim' : allOn ? 'guided' : 'custom');
}

export function activeAssistLabels() {
  const labels = [];
  if (assists.stabilizer) labels.push('Attitude Stabilizer');
  if (assists.guidance)   labels.push('Auto Guidance');
  if (assists.descent)    labels.push('Descent Control');
  return labels;
}

export function applyStabilizer(rocket, rotateInput) {
  if (!assists.stabilizer || Math.abs(rotateInput) > 0.12) return null;
  const corr = -rocket.angle * STAB_GAIN * (1 / 120);
  if (Math.abs(corr) < 0.00008) return null;
  rocket.angle += corr;
  return corr > 0 ? 'right' : 'left';
}

export function guidanceAccel(vx) {
  if (!assists.guidance) return 0;
  return -vx * GUIDE_GAIN;
}

/**
 * Descent throttle from gear altitude (footpad height).
 * When pilot holds thrust, returns null — manual hover/landing.
 */
export function descentThrottle(gearAlt, rocket, mass, moonG, thrust, pilotThrusting) {
  if (!assists.descent || rocket.fuel <= 0 || pilotThrusting) return null;
  if (gearAlt > DESC_ALT_ON) return null;

  const hover = (mass * moonG) / thrust;
  const vy = -rocket.vy;

  // Hold band ~8–18 m gear alt (Apollo low gate) — hover, then walk down
  if (gearAlt > 8 && gearAlt <= 18 && Math.abs(vy) < 1.2) {
    const thr = hover + (vy - 0) * 0.14;
    return Math.max(0, Math.min(1, thr));
  }

  const targetSink = gearAlt > 120 ? 1.4
    : gearAlt > 50  ? 0.9
    : gearAlt > 18  ? 0.5
    : gearAlt > 8   ? 0.2
    : 0.12;

  const err = vy - targetSink;
  const thr = hover + err * 0.12;
  return Math.max(0, Math.min(1, thr));
}

export function anyAssistActive() {
  return assists.stabilizer || assists.guidance || assists.descent;
}
