// util.js — small math and deterministic-random helpers shared by the whole game.
// Everything here is plain arithmetic; no library, no network, no state outside the helpers.

export const TAU = Math.PI * 2;

export function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Smoothstep 0..1 for eased blends (terrain shading, camera moves).
export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function degToRad(degrees) {
  return (degrees * Math.PI) / 180;
}

export function radToDeg(radians) {
  return (radians * 180) / Math.PI;
}

// Wrap an angle in degrees to (-180, 180].
export function wrapAngleDeg(angle) {
  let a = angle % 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  return a;
}

// Shortest signed turn from `from` to `to`, in degrees.
export function angleDeltaDeg(from, to) {
  return wrapAngleDeg(to - from);
}

// Mulberry32: a tiny deterministic PRNG so the valley, rings and weather look the
// same on every load for a given seed (screenshots stay reproducible).
export function makeRng(seed) {
  let state = seed >>> 0;
  return function next() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministic 2D value noise: a smooth, repeatable bump field in [-1, 1].
// Built from a hashed lattice with cosine interpolation; cheap enough to call
// per terrain sample.
function latticeHash(ix, iz, seed) {
  let h = (ix * 374761393 + iz * 668265263 + seed * 974634211) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (((h ^ (h >>> 16)) >>> 0) % 100000) / 50000 - 1;
}

export function valueNoise2D(x, z, seed) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = (1 - Math.cos(fx * Math.PI)) / 2;
  const sz = (1 - Math.cos(fz * Math.PI)) / 2;
  const a = latticeHash(ix, iz, seed);
  const b = latticeHash(ix + 1, iz, seed);
  const c = latticeHash(ix, iz + 1, seed);
  const d = latticeHash(ix + 1, iz + 1, seed);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sz);
}

// Two octaves of value noise, still in roughly [-1, 1].
export function fbm2D(x, z, seed) {
  return valueNoise2D(x, z, seed) * 0.65 + valueNoise2D(x * 2.13 + 7.7, z * 2.13 + 3.1, seed + 5) * 0.35;
}

// Format helpers for the HUD.
export function formatKnots(speed) {
  return String(Math.round(speed));
}

export function formatFeet(altitude) {
  return String(Math.round(altitude)).padStart(4, '0');
}

export function formatHeading(headingDeg) {
  const h = Math.round(((headingDeg % 360) + 360) % 360);
  return String(h).padStart(3, '0');
}

export function formatClock(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m + ':' + String(s).padStart(2, '0');
}
