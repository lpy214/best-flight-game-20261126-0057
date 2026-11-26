// rings.js — the glowing course rings: generation, pass detection and drawing.
//
// A ring is a hoop in the sky with a centre, an altitude and a radius. The
// next ring in the course glows gold; the ones after it are pale cyan; a
// passed ring turns green and fades. Passing means crossing the ring's plane
// inside its radius — the plane's track is checked against the ring's normal,
// so flying around a ring never counts.

import { degToRad } from './util.js';

export class RingCourse {
  constructor(rings) {
    this.rings = rings.map((ring, index) => ({
      x: ring.x,
      y: ring.y,
      z: ring.z,
      radius: ring.radius,
      index,
      passed: false,
      passTime: 0,
      // Normal: the direction of travel into the ring, from the previous ring.
      nx: 0,
      ny: 0,
      nz: -1,
    }));
    for (let i = 0; i < this.rings.length; i++) {
      const ring = this.rings[i];
      const prev = i === 0 ? { x: ring.x, y: ring.y, z: ring.z + 600 } : this.rings[i - 1];
      const dx = ring.x - prev.x;
      const dy = ring.y - prev.y;
      const dz = ring.z - prev.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      ring.nx = dx / len;
      ring.ny = dy / len;
      ring.nz = dz / len;
    }
    this.nextIndex = 0;
  }

  get next() {
    return this.nextIndex < this.rings.length ? this.rings[this.nextIndex] : null;
  }

  get passedCount() {
    return this.nextIndex;
  }

  get totalCount() {
    return this.rings.length;
  }

  get complete() {
    return this.nextIndex >= this.rings.length;
  }

  reset() {
    for (const ring of this.rings) {
      ring.passed = false;
      ring.passTime = 0;
    }
    this.nextIndex = 0;
  }

  // Check the plane's step from its previous position to its new one.
  // Returns the ring just passed, or null.
  checkPass(prevX, prevY, prevZ, plane, time) {
    const ring = this.next;
    if (!ring) return null;
    const before = (prevX - ring.x) * ring.nx + (prevY - ring.y) * ring.ny + (prevZ - ring.z) * ring.nz;
    const after = (plane.x - ring.x) * ring.nx + (plane.altitude - ring.y) * ring.ny + (plane.z - ring.z) * ring.nz;
    if (before <= 0 && after > 0) {
      // Where the track crossed the ring's plane.
      const t = before / (before - after);
      const crossX = prevX + (plane.x - prevX) * t;
      const crossY = prevY + (plane.altitude - prevY) * t;
      const crossZ = prevZ + (plane.z - prevZ) * t;
      const miss = Math.hypot(crossX - ring.x, crossY - ring.y, crossZ - ring.z);
      if (miss <= ring.radius) {
        ring.passed = true;
        ring.passTime = time;
        this.nextIndex++;
        return ring;
      }
    }
    return null;
  }

  // Bearing and distance to the next ring, for the HUD arrow.
  guidance(plane) {
    const ring = this.next;
    if (!ring) return null;
    const dx = ring.x - plane.x;
    const dz = ring.z - plane.z;
    const distance = Math.hypot(dx, dz);
    const bearing = (Math.atan2(dx, -dz) * 180) / Math.PI;
    return { bearing, distance, altitudeDiff: ring.y - plane.altitude };
  }

  draw(ctx, terrain, cam, time) {
    const sorted = [...this.rings].sort((a, b) => {
      const da = (a.x - cam.x) * cam.fx + (a.z - cam.z) * cam.fz;
      const db = (b.x - cam.x) * cam.fx + (b.z - cam.z) * cam.fz;
      return db - da;
    });
    for (const ring of sorted) {
      const p = terrain.project(ring.x, ring.y, ring.z, cam);
      if (!p) continue;
      const radiusPx = (ring.radius * cam.focal) / p.depth;
      if (radiusPx < 4 || radiusPx > 3000) continue;
      const age = ring.passed ? time - ring.passTime : 0;
      const fade = ring.passed ? Math.max(0, 1 - age * 0.25) : 1;
      if (fade <= 0) continue;
      const isNext = ring === this.next;
      const colour = ring.passed ? '#39d353' : isNext ? '#ffcf3f' : '#7fd4ff';
      const pulse = isNext ? 1 + Math.sin(time * 4) * 0.06 : 1;
      const r = radiusPx * pulse;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.lineWidth = Math.max(3, r * 0.09);
      ctx.strokeStyle = colour;
      ctx.shadowColor = colour;
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.lineWidth = Math.max(1.5, r * 0.02);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 0.86, 0, Math.PI * 2);
      ctx.stroke();
      // A small beacon light on top of the next ring, and its number.
      if (isNext) {
        ctx.fillStyle = '#ffcf3f';
        ctx.beginPath();
        ctx.arc(p.x, p.y - r, Math.max(4, r * 0.08), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = colour;
      ctx.font = `bold ${Math.max(14, Math.min(30, r * 0.4))}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(ring.index + 1), p.x, p.y);
      ctx.restore();
    }
  }
}

// Build a course of rings along a wandering valley path: start near the
// runway, snake down the valley, climb over the ridge, and come home.
export function buildRingCourse(seed, count, startX, startZ, startAlt, options) {
  const rings = [];
  let x = startX;
  let z = startZ;
  let alt = startAlt;
  let heading = 0; // north
  const turn = options.turn ?? 26;
  const spacing = options.spacing ?? 520;
  const rngState = { value: seed };
  const rand = () => {
    rngState.value = (rngState.value * 1664525 + 1013904223) >>> 0;
    return rngState.value / 4294967296;
  };
  for (let i = 0; i < count; i++) {
    heading += (rand() - 0.5) * 2 * turn;
    // Keep the course inside the valley walls.
    if (x > 1100) heading = 25 + rand() * 20;
    if (x < -1100) heading = -25 - rand() * 20;
    if (z < -3400) heading = 155 + rand() * 40;
    if (z > 3200) heading = -20 + rand() * 40;
    const rad = degToRad(heading);
    x += Math.sin(rad) * spacing;
    z -= Math.cos(rad) * spacing;
    alt = Math.max(90, Math.min(560, alt + (rand() - 0.5) * 160));
    rings.push({ x: Math.round(x), y: Math.round(alt), z: Math.round(z), radius: 42 });
  }
  return rings;
}
