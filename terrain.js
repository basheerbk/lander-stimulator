// terrain.js — Shared lunar surface height + crater field (physics + rendering)

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** @type {{ x: number, z: number, r: number, depth: number, rim: number }[]} */
export const CRATERS = (() => {
  const rng = mulberry32(0x6d6f6f6e);
  const list = [];
  for (let i = 0; i < 18; i++) {
    list.push({
      x:     rng() * 5000 - 2500,
      z:     rng() * 360 - 180,
      r:     28 + rng() * 85,
      depth: 2.0 + rng() * 7,
      rim:   0.8 + rng() * 2.2,
    });
  }
  return list;
})();

function baseHills(x) {
  let h = 0;
  h += Math.sin(x * 0.008)       * 18;
  h += Math.sin(x * 0.023 + 1.2) * 8;
  h += Math.sin(x * 0.05  + 2.5) * 3;
  return h;
}

function craterShape(dist, crater) {
  if (dist > crater.r * 1.35) return 0;
  const t = dist / crater.r;
  if (t < 0.78) {
    const bowl = 1 - (t / 0.78) ** 2;
    return -bowl * crater.depth;
  }
  if (t < 1.15) {
    const rimT = (t - 0.78) / 0.37;
    return crater.rim * Math.sin(rimT * Math.PI);
  }
  return 0;
}

/** Full 3D height at world (x, z) — used for terrain mesh */
export function groundHeightAtXZ(x, z) {
  let h = baseHills(x);
  for (const c of CRATERS) {
    const dx = x - c.x;
    const dz = z - c.z;
    h += craterShape(Math.sqrt(dx * dx + dz * dz), c);
  }
  return h;
}

/** Side-view physics height along the flight plane (z ≈ 0) */
export function groundHeightAt(x) {
  return groundHeightAtXZ(x, 0);
}
