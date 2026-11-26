// shots.js — staged scenes for the screenshots. Each shot is the real game
// in a real state (the same flight model, the same renderer), frozen in time
// so the frame is stable: title, mid-flight with a ring ahead, final
// approach to the runway, and a completed sortie.
//
// Usage: index.html?shot=title|flight|runway|complete&seed=7

import { MISSIONS } from './missions.js';
import { terrainHeightAt } from './terrain.js';

export function parseShotQuery(search) {
  const params = new URLSearchParams(search);
  const shot = params.get('shot');
  const seed = Number(params.get('seed') || '7');
  if (!shot) return null;
  return { shot, seed: Number.isFinite(seed) ? seed : 7 };
}

// Put the game into the staged state for the requested shot. Returns true
// when a shot was staged (the caller then renders one frozen frame).
export function stageShot(game, shotName) {
  const mission = MISSIONS[0];
  if (shotName === 'title') {
    game.selectedMission = 0;
    game.startMission(mission, true);
    // Park the camera over the valley for a scenic title backdrop.
    game.plane.place(0, 900, 420, 12, 120, 0.55);
    game.plane.roll = 8;
    game.state = 'title';
    game.frozen = true;
    return true;
  }
  if (shotName === 'flight') {
    game.startMission(mission, true);
    game.state = 'flying';
    const ground = terrainHeightAt(-60, 1400);
    game.plane.place(-60, 1400, ground + 230, -8, 148, 0.72);
    game.plane.roll = -14;
    game.plane.pitch = 2;
    // Put the next ring dead ahead, low and close, so the frame shows the
    // ring, the terrain and the lit instruments together.
    const ring = game.course.rings[0];
    ring.x = -40;
    ring.y = Math.round(ground + 215);
    ring.z = 950;
    game.course.rings[1].x = 120;
    game.course.rings[1].y = Math.round(ground + 260);
    game.course.rings[1].z = 420;
    game.score = 100;
    game.elapsed = 48; // timeLeft shows 6:12
    game.frozen = true;
    return true;
  }
  if (shotName === 'runway') {
    game.startMission(mission, true);
    game.state = 'flying';
    // On final: aligned with the strip, descending toward the runway.
    const ground = terrainHeightAt(6, 1000);
    game.plane.place(6, 1000, ground + 170, 2, 92, 0.28);
    game.plane.pitch = -4;
    game.plane.roll = 2;
    game.course.nextIndex = game.course.totalCount; // rings done: land it
    for (const ring of game.course.rings) {
      ring.passed = true;
      ring.passTime = -10; // faded out: the sky is clear for the approach
    }
    game.score = 800;
    game.elapsed = 119; // timeLeft shows 5:01
    game.frozen = true;
    return true;
  }
  if (shotName === 'complete') {
    game.startMission(mission, true);
    game.state = 'complete';
    game.plane.place(0, -100, 16, 0, 0, 0); // parked on the strip, valley ahead
    game.plane.landed = true;
    game.course.nextIndex = game.course.totalCount;
    game.score = 1240;
    game.elapsed = 187;
    game.timeLeft = 233;
    game.stats = {
      missionName: mission.name,
      rings: game.course.totalCount,
      totalRings: game.course.totalCount,
      time: 187,
      landingQuality: 'Smooth — greased it',
      damage: 4,
      fuel: 41,
      score: 1240,
    };
    game.frozen = true;
    return true;
  }
  return false;
}
