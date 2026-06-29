// lander.js — Lander geometry shared by physics, HUD, map, and flight systems

export const LEG_SPAN  = 4.67;
export const LEG_DROP  = 10.0;
export const BELL_DROP = 7.6;

/** Altitude of the lowest footpad above terrain (what the pilot should read). */
export function footpadClearance(rocket, groundFn) {
  const sinA = Math.sin(rocket.angle);
  const cosA = Math.cos(rocket.angle);

  const lfx = rocket.x + LEG_SPAN * cosA + LEG_DROP * sinA;
  const lfy = rocket.y + LEG_SPAN * sinA - LEG_DROP * cosA;
  const rfx = rocket.x - LEG_SPAN * cosA + LEG_DROP * sinA;
  const rfy = rocket.y - LEG_SPAN * sinA - LEG_DROP * cosA;

  const clearL = lfy - groundFn(lfx);
  const clearR = rfy - groundFn(rfx);
  return Math.max(0, Math.min(clearL, clearR));
}

export function contactPoints(rocket) {
  const sinA = Math.sin(rocket.angle);
  const cosA = Math.cos(rocket.angle);
  return {
    lfx: rocket.x + LEG_SPAN * cosA + LEG_DROP * sinA,
    lfy: rocket.y + LEG_SPAN * sinA - LEG_DROP * cosA,
    rfx: rocket.x - LEG_SPAN * cosA + LEG_DROP * sinA,
    rfy: rocket.y - LEG_SPAN * sinA - LEG_DROP * cosA,
    bex: rocket.x + BELL_DROP * sinA,
    bey: rocket.y - BELL_DROP * cosA,
  };
}
