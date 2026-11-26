// terrain.js — the valley the game flies over, and the camera that shows it.
//
// The valley is a precomputed heightfield (20 m cells over a 6 km by 8 km
// playable bowl): rolling farmland, a winding river, a lake, forested hills,
// a mountain wall on both sides, a small town, and a flattened airfield with
// a runway. Colours are baked into a small palette at load time, so the
// per-frame renderer only reads numbers.
//
// Rendering is a classic voxel-space walk: for each screen column a ray steps
// from far to near, sampling the terrain height, and each newly-visible strip
// is painted. No library, no WebGL, no network — plain canvas 2D.

import { clamp, fbm2D, lerp, makeRng, smoothstep, valueNoise2D } from './util.js';

export const CELL = 20; // metres per heightfield cell
export const GRID_X0 = -3000;
export const GRID_Z0 = -4000;
export const GRID_NX = 300; // 300 * 20 = 6000 m wide
export const GRID_NZ = 400; // 400 * 20 = 8000 m deep

export const WATER_LEVEL = 4;
export const RUNWAY = { x: 0, z: 0, halfWidth: 20, halfLength: 450, height: 14 };

const SEED = 20261126;

function riverCentreX(z) {
  return 420 * Math.sin(z * 0.00035) + 180 * Math.sin(z * 0.0011 + 2.0);
}

function roadCentreX(z) {
  return 700 + 120 * Math.sin(z * 0.0006 + 1.2);
}

function distToRunwayRect(x, z) {
  const dx = Math.max(Math.abs(x - RUNWAY.x) - RUNWAY.halfWidth, 0);
  const dz = Math.max(Math.abs(z - RUNWAY.z) - RUNWAY.halfLength, 0);
  return Math.hypot(dx, dz);
}

// True terrain height in metres at world (x, z).
export function terrainHeightAt(x, z) {
  // The valley floor undulates gently; real hills only grow away from the
  // river, and the mountain wall closes both sides of the valley.
  const gentle = fbm2D(x * 0.0012, z * 0.0012, 11) * 55;
  const detail = fbm2D(x * 0.004, z * 0.004, 23) * 12;
  const hilliness = smoothstep(500, 1500, Math.abs(x - riverCentreX(z)));
  const hills = fbm2D(x * 0.0012 + 40, z * 0.0012 + 40, 13) * 190 * hilliness;
  const wall = smoothstep(1500, 2800, Math.abs(x)) * 460;
  let height = gentle + detail + 60 + hills + wall;

  // Carve the river valley down to the water (a narrower carve keeps the
  // river a river, not a sea).
  const riverDist = Math.abs(x - riverCentreX(z));
  const carve = smoothstep(50, 260, riverDist);
  height = lerp(2, height, carve);

  // A lake in the south-west.
  const lakeDist = Math.hypot(x + 900, z + 2600);
  height = lerp(2, height, smoothstep(120, 420, lakeDist));

  // Flatten the airfield and the town.
  height = lerp(RUNWAY.height, height, smoothstep(120, 520, distToRunwayRect(x, z)));
  const townDist = Math.hypot(x - 1000, z - 1500);
  height = lerp(42, height, smoothstep(150, 420, townDist));
  return height;
}

function hash2(ix, iz, seed) {
  let h = (ix * 374761393 + iz * 668265263 + seed * 974634211) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (((h ^ (h >>> 16)) >>> 0) % 1000) / 1000;
}

// A small palette of terrain colours; the colour grid stores palette indices.
const PALETTE = [
  '#2e6f9e', // 0 deep water
  '#3d84b5', // 1 shallow water
  '#c2a878', // 2 sand
  '#7fae4e', // 3 meadow
  '#6a9c3f', // 4 pasture
  '#a8a04a', // 5 wheat field
  '#8fae3e', // 6 crop green
  '#b5893c', // 7 stubble field
  '#4e7a35', // 8 forest
  '#3c6130', // 9 deep forest
  '#8a7a5a', // 10 rock
  '#6f6a66', // 11 dark rock
  '#e8eef2', // 12 snow
  '#3a3f45', // 13 asphalt
  '#e8e8e0', // 14 runway paint
  '#9aa0a6', // 15 concrete
  '#b5673a', // 16 terracotta roof
  '#5a6a7a', // 17 slate roof
  '#7a7a72', // 18 town street
  '#4a4a42', // 19 road
];

export class Terrain {
  constructor() {
    this.heights = new Float32Array(GRID_NX * GRID_NZ);
    this.colours = new Uint8Array(GRID_NX * GRID_NZ);
    this.palette = PALETTE;
    this.buildGrid();
    this.buildTrees();
    this.buildBuildings();
    this.clouds = this.buildClouds();
  }

  buildGrid() {
    // Sample at cell centres, so the colour and the height of a cell describe
    // the same patch of ground (a corner sample would bias narrow features —
    // the runway's edge — to one side of the strip).
    for (let iz = 0; iz < GRID_NZ; iz++) {
      const z = GRID_Z0 + (iz + 0.5) * CELL;
      for (let ix = 0; ix < GRID_NX; ix++) {
        const x = GRID_X0 + (ix + 0.5) * CELL;
        const h = terrainHeightAt(x, z);
        const index = iz * GRID_NX + ix;
        this.heights[index] = h;
        this.colours[index] = this.colourFor(x, z, h);
      }
    }
  }

  colourFor(x, z, h) {
    // Runway asphalt, paint and threshold bars. The strip itself is asphalt;
    // the markings (centreline, edges, threshold bars) are drawn as projected
    // quads by drawRunwayMarkings, because they are narrower than a grid cell.
    const inRunway = Math.abs(x - RUNWAY.x) <= RUNWAY.halfWidth && Math.abs(z - RUNWAY.z) <= RUNWAY.halfLength;
    if (inRunway) return 13;
    // Apron and taxiway beside the runway.
    if (Math.abs(x - 70) < 60 && Math.abs(z - 100) < 140) return 15;
    if (Math.abs(x - 45) < 6 && Math.abs(z - 500) < 500) return 15;

    // Water only where the river or the lake actually runs: the noise floor
    // dips below sea level in odd hollows, and those stay dry fields.
    const riverDist = Math.abs(x - riverCentreX(z));
    const lakeDist = Math.hypot(x + 900, z + 2600);
    if (h < WATER_LEVEL && (riverDist < 260 || lakeDist < 430)) return 0;
    if (h < 7 && riverDist < 120) return 2;
    if (h < 7 && lakeDist < 420) return 2;

    // Town: roofs in blocks, streets between them.
    const townDist = Math.hypot(x - 1000, z - 1500);
    if (townDist < 330) {
      const bx = Math.floor((x - 700) / 46);
      const bz = Math.floor((z - 1200) / 46);
      const street = (Math.abs(x - 1000) % 92) < 10 || (Math.abs(z - 1500) % 92) < 10;
      if (street) return 18;
      return hash2(bx, bz, 7) < 0.5 ? 16 : 17;
    }

    // Road from the town to the airfield.
    if (Math.abs(x - roadCentreX(z)) < 7 && z > -600 && z < 1600) return 19;

    // Forest on the mid slopes.
    const forest = fbm2D(x * 0.003, z * 0.003, 31);
    if (forest > 0.28 && h > 60 && h < 320) return forest > 0.45 ? 9 : 8;

    // Snow and rock on the high ground.
    if (h > 520) return 12;
    if (h > 380) return valueNoise2D(x * 0.01, z * 0.01, 5) > 0 ? 10 : 11;

    // Farmland patchwork in the valley floor.
    const patchX = Math.floor(x / 180);
    const patchZ = Math.floor(z / 180);
    const patch = hash2(patchX, patchZ, 3);
    const variation = valueNoise2D(x * 0.008, z * 0.008, 9) * 0.5 + 0.5;
    if (patch < 0.22) return variation > 0.5 ? 5 : 7;
    if (patch < 0.45) return variation > 0.5 ? 6 : 3;
    return variation > 0.5 ? 3 : 4;
  }

  buildTrees() {
    const rng = makeRng(99);
    this.trees = [];
    for (let i = 0; i < 1600; i++) {
      const x = GRID_X0 + rng() * 6000;
      const z = GRID_Z0 + rng() * 8000;
      const h = terrainHeightAt(x, z);
      const forest = fbm2D(x * 0.003, z * 0.003, 31);
      if (forest > 0.28 && h > 60 && h < 320) {
        this.trees.push({ x, z, h, size: 9 + rng() * 9 });
      }
    }
  }

  buildBuildings() {
    // Boxes: hangars and the tower at the airfield, a church and houses in town.
    this.buildings = [
      { x: 80, z: 40, w: 46, d: 34, h: 16, top: '#8a8f96', side: '#6a6f76', front: '#7d828a' },
      { x: 80, z: 120, w: 46, d: 34, h: 16, top: '#8a8f96', side: '#6a6f76', front: '#7d828a' },
      { x: 80, z: -40, w: 36, d: 28, h: 13, top: '#9aa0a6', side: '#767b82', front: '#878c94' },
      { x: -70, z: 180, w: 14, d: 14, h: 34, top: '#c8ccd2', side: '#7d828a', front: '#9297a0' },
      { x: 1000, z: 1500, w: 18, d: 26, h: 42, top: '#b5673a', side: '#8a4a28', front: '#a05a32' },
      { x: 880, z: 1380, w: 22, d: 18, h: 12, top: '#5a6a7a', side: '#46525e', front: '#525f6d' },
      { x: 1120, z: 1620, w: 22, d: 18, h: 12, top: '#b5673a', side: '#8a4a28', front: '#a05a32' },
      { x: 940, z: 1680, w: 20, d: 16, h: 11, top: '#5a6a7a', side: '#46525e', front: '#525f6d' },
    ];
    for (const b of this.buildings) b.ground = terrainHeightAt(b.x, b.z);
  }

  buildClouds() {
    const rng = makeRng(7);
    const clouds = [];
    for (let i = 0; i < 16; i++) {
      clouds.push({
        x: GRID_X0 + rng() * 6000,
        z: GRID_Z0 + rng() * 8000,
        y: 950 + rng() * 450,
        scale: 120 + rng() * 180,
        drift: 2 + rng() * 4,
      });
    }
    return clouds;
  }

  heightAt(x, z) {
    const fx = (x - GRID_X0) / CELL - 0.5;
    const fz = (z - GRID_Z0) / CELL - 0.5;
    const ix = clamp(Math.floor(fx), 0, GRID_NX - 2);
    const iz = clamp(Math.floor(fz), 0, GRID_NZ - 2);
    const tx = clamp(fx - ix, 0, 1);
    const tz = clamp(fz - iz, 0, 1);
    const i00 = iz * GRID_NX + ix;
    const h00 = this.heights[i00];
    const h10 = this.heights[i00 + 1];
    const h01 = this.heights[i00 + GRID_NX];
    const h11 = this.heights[i00 + GRID_NX + 1];
    return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz);
  }

  colourIndexAt(x, z) {
    const ix = clamp(Math.floor((x - GRID_X0) / CELL), 0, GRID_NX - 1);
    const iz = clamp(Math.floor((z - GRID_Z0) / CELL), 0, GRID_NZ - 1);
    return this.colours[iz * GRID_NX + ix];
  }

  // Project a world point through the camera basis; returns screen coords and depth.
  project(px, py, pz, cam) {
    const dx = px - cam.x;
    const dy = py - cam.y;
    const dz = pz - cam.z;
    const depth = dx * cam.fx + dy * cam.fy + dz * cam.fz;
    if (depth < 8) return null;
    const rx = dx * cam.rx + dy * cam.ry + dz * cam.rz;
    const uy = dx * cam.ux + dy * cam.uy + dz * cam.uz;
    return {
      x: cam.cx + (rx / depth) * cam.focal,
      y: cam.cy - (uy / depth) * cam.focal,
      depth,
    };
  }

  // Draw the sky gradient, sun and clouds for the mission's time of day.
  drawSky(ctx, width, height, cam, theme, time) {
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    for (const stop of theme.sky) grad.addColorStop(stop[0], stop[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // Sun: a fixed direction per theme, projected far away.
    const sunDir = theme.sun;
    const sunPoint = this.project(
      cam.x + sunDir[0] * 6000, cam.y + sunDir[1] * 6000, cam.z + sunDir[2] * 6000, cam,
    );
    if (sunPoint && sunPoint.y > -120 && sunPoint.y < height * 0.7) {
      const glow = ctx.createRadialGradient(sunPoint.x, sunPoint.y, 4, sunPoint.x, sunPoint.y, 150);
      glow.addColorStop(0, theme.sunCore);
      glow.addColorStop(0.25, theme.sunGlow);
      glow.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(sunPoint.x - 160, sunPoint.y - 160, 320, 320);
      ctx.fillStyle = theme.sunCore;
      ctx.beginPath();
      ctx.arc(sunPoint.x, sunPoint.y, 26, 0, Math.PI * 2);
      ctx.fill();
    }

    // Clouds drift slowly with the wind.
    for (const cloud of this.clouds) {
      const cx = cloud.x + time * cloud.drift;
      const p = this.project(cx, cloud.y, cloud.z, cam);
      if (!p || p.y < -80 || p.y > height * 0.75) continue;
      const s = (cloud.scale * cam.focal) / p.depth;
      if (s < 8) continue;
      ctx.fillStyle = theme.cloud;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, s, s * 0.32, 0, 0, Math.PI * 2);
      ctx.ellipse(p.x - s * 0.55, p.y + s * 0.06, s * 0.6, s * 0.22, 0, 0, Math.PI * 2);
      ctx.ellipse(p.x + s * 0.55, p.y + s * 0.06, s * 0.6, s * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // The voxel walk: paint the terrain column by column, far to near.
  drawTerrain(ctx, width, height, cam) {
    const stepX = 2;
    const cols = Math.ceil(width / stepX);
    const yBuffer = new Float32Array(cols);
    const tanHalf = Math.tan((cam.fov / 2) * Math.PI / 180);

    for (let c = 0; c < cols; c++) {
      const sx = c * stepX;
      const nx = (sx / width) * 2 - 1;
      // Horizontal ray direction for this column.
      let dirX = cam.fx + cam.rx * nx * tanHalf;
      let dirZ = cam.fz + cam.rz * nx * tanHalf;
      const len = Math.hypot(dirX, dirZ) || 1;
      dirX /= len;
      dirZ /= len;
      // Horizon for this column: a far point at camera height.
      const farX = cam.x + dirX * 3000;
      const farZ = cam.z + dirZ * 3000;
      const far = this.project(farX, cam.y, farZ, cam);
      yBuffer[c] = far ? far.y : cam.cy;

      let t = 2400;
      while (t > 8) {
        const px = cam.x + dirX * t;
        const pz = cam.z + dirZ * t;
        if (px > GRID_X0 && px < GRID_X0 + GRID_NX * CELL && pz > GRID_Z0 && pz < GRID_Z0 + GRID_NZ * CELL) {
          const h = this.heightAt(px, pz);
          const p = this.project(px, h, pz, cam);
          if (p && p.y > yBuffer[c] && p.y < height + 40) {
            const bottom = Math.min(p.y, height);
            ctx.fillStyle = this.palette[this.colourIndexAt(px, pz)];
            ctx.fillRect(sx, yBuffer[c], stepX, bottom - yBuffer[c]);
            yBuffer[c] = p.y;
          }
        }
        t *= 0.965;
      }
    }
  }

  // Runway markings as projected quads: the centreline dashes, the edge
  // lines and the threshold bars are only a few metres wide — narrower than
  // a terrain cell — so they are drawn here, on the strip, instead of being
  // baked into the colour grid.
  drawRunwayMarkings(ctx, cam) {
    const quad = (corners) => {
      const pts = corners.map(([x, y, z]) => this.project(x, y, z, cam));
      if (pts.some((p) => p === null)) return;
      if (pts.some((p) => p.depth > 2600)) return;
      ctx.fillStyle = '#e8e8e0';
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.fill();
    };
    const y = RUNWAY.height + 0.4;
    // Centreline dashes: 30 m of paint, 30 m of gap, down the strip.
    for (let along = 0; along < RUNWAY.halfLength * 2; along += 60) {
      const z0 = RUNWAY.z - RUNWAY.halfLength + along + 5;
      const z1 = z0 + 30;
      quad([[-1.2, y, z0], [1.2, y, z0], [1.2, y, z1], [-1.2, y, z1]]);
    }
    // Edge lines, the full length of the strip.
    for (const side of [-1, 1]) {
      const x0 = RUNWAY.x + side * 19.5;
      const x1 = RUNWAY.x + side * 18.5;
      quad([[x0, y, RUNWAY.z - RUNWAY.halfLength], [x1, y, RUNWAY.z - RUNWAY.halfLength],
            [x1, y, RUNWAY.z + RUNWAY.halfLength], [x0, y, RUNWAY.z + RUNWAY.halfLength]]);
    }
    // Threshold bars at both ends: eight white bars across the strip.
    for (const end of [-1, 1]) {
      const z0 = RUNWAY.z + end * RUNWAY.halfLength - (end > 0 ? 24 : 0);
      const z1 = z0 + 24;
      for (let i = 0; i < 8; i++) {
        const x0 = RUNWAY.x - 18 + i * 5;
        quad([[x0, y, z0], [x0 + 3, y, z0], [x0 + 3, y, z1], [x0, y, z1]]);
      }
    }
  }

  // Cheap line-of-sight test: sample the terrain at a few points along the
  // ray from the camera to the object; if the ground rises above the ray,
  // a hill hides the object. Keeps trees and buildings from showing through.
  hasLineOfSight(cam, x, y, z) {
    for (const t of [0.35, 0.6, 0.85]) {
      const mx = cam.x + (x - cam.x) * t;
      const mz = cam.z + (z - cam.z) * t;
      if (mx < GRID_X0 || mx > GRID_X0 + GRID_NX * CELL || mz < GRID_Z0 || mz > GRID_Z0 + GRID_NZ * CELL) continue;
      const rayY = cam.y + (y - cam.y) * t;
      if (this.heightAt(mx, mz) > rayY + 4) return false;
    }
    return true;
  }

  // Boxes (hangars, tower, church) and trees, painter-sorted far to near.
  drawObjects(ctx, cam) {
    const items = [];
    for (const b of this.buildings) {
      const dx = b.x - cam.x;
      const dz = b.z - cam.z;
      const depth = dx * cam.fx + dz * cam.fz;
      if (depth > 30 && depth < 3200 && this.hasLineOfSight(cam, b.x, b.ground + b.h, b.z)) {
        items.push({ kind: 'box', depth, b });
      }
    }
    for (const tree of this.trees) {
      const dx = tree.x - cam.x;
      const dz = tree.z - cam.z;
      const depth = dx * cam.fx + dz * cam.fz;
      if (depth > 25 && depth < 1100 && this.hasLineOfSight(cam, tree.x, tree.h + tree.size, tree.z)) {
        items.push({ kind: 'tree', depth, tree });
      }
    }
    items.sort((a, b) => b.depth - a.depth);
    // Cap the draw count so a dense forest never stalls a frame.
    for (const item of items.slice(0, 320)) {
      if (item.kind === 'box') this.drawBox(ctx, item.b, cam);
      else this.drawTree(ctx, item.tree, cam);
    }
  }

  drawBox(ctx, b, cam) {
    const hw = b.w / 2;
    const hd = b.d / 2;
    const base = b.ground;
    const top = base + b.h;
    const corners = [
      [b.x - hw, base, b.z - hd], [b.x + hw, base, b.z - hd],
      [b.x + hw, base, b.z + hd], [b.x - hw, base, b.z + hd],
      [b.x - hw, top, b.z - hd], [b.x + hw, top, b.z - hd],
      [b.x + hw, top, b.z + hd], [b.x - hw, top, b.z + hd],
    ].map(([x, y, z]) => this.project(x, y, z, cam));
    if (corners.some((p) => p === null)) return;
    const poly = (indices, fill) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(corners[indices[0]].x, corners[indices[0]].y);
      for (let i = 1; i < indices.length; i++) ctx.lineTo(corners[indices[i]].x, corners[indices[i]].y);
      ctx.closePath();
      ctx.fill();
    };
    // Roof, then the two faces that can face the camera.
    poly([4, 5, 6, 7], b.top);
    const facingSouth = cam.z > b.z;
    const facingEast = cam.x > b.x;
    if (facingSouth) poly([3, 2, 6, 7], b.front);
    else poly([1, 0, 4, 5], b.side);
    if (facingEast) poly([2, 1, 5, 6], b.side);
    else poly([0, 3, 7, 4], b.front);
  }

  drawTree(ctx, tree, cam) {
    const p = this.project(tree.x, tree.h, tree.z, cam);
    if (!p) return;
    const size = (tree.size * cam.focal) / p.depth;
    if (size < 2.5) return;
    ctx.fillStyle = '#2f4d24';
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - size * 1.6);
    ctx.lineTo(p.x - size * 0.55, p.y);
    ctx.lineTo(p.x + size * 0.55, p.y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#3c6130';
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - size * 2.4);
    ctx.lineTo(p.x - size * 0.4, p.y - size * 0.9);
    ctx.lineTo(p.x + size * 0.4, p.y - size * 0.9);
    ctx.closePath();
    ctx.fill();
  }
}
