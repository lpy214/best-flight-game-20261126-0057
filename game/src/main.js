// main.js — boot, the game loop and the state machine.
//
// States: title → flying ⇄ paused → crashed | complete. The loop is a fixed
// rAF tick with a clamped delta; rendering is sky → terrain → objects →
// rings → shadow → plane → HUD. A `?shot=` query freezes the game in a
// staged scene for screenshots (see shots.js).

import { GameAudio } from './audio.js';
import { GameInput } from './input.js';
import { Hud } from './hud.js';
import { MISSIONS, missionById } from './missions.js';
import { Plane } from './plane.js';
import { RingCourse } from './rings.js';
import { parseShotQuery, stageShot } from './shots.js';
import { Terrain } from './terrain.js';
import { clamp, degToRad, makeRng } from './util.js';

const WIDTH = 1280;
const HEIGHT = 720;
const FOV = 74;

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.input = new GameInput(canvas);
    this.audio = new GameAudio();
    this.hud = new Hud();
    this.terrain = new Terrain();
    this.plane = new Plane();
    this.state = 'title';
    this.selectedMission = 0;
    this.mission = MISSIONS[0];
    this.course = new RingCourse(this.mission.rings);
    this.score = 0;
    this.elapsed = 0;
    this.timeLeft = this.mission.timeLimit;
    this.stats = null;
    this.crashReason = '';
    this.time = 0;
    this.frozen = false;
    this.windPhase = 0;
    this.bestScore = 0;
    this.rng = makeRng(20261126);

    canvas.addEventListener('click', (event) => this.onClick(event));
    this.lastFrame = performance.now();
    requestAnimationFrame((now) => this.tick(now));
  }

  startMission(mission, keepPlane = false) {
    this.mission = mission;
    this.course = new RingCourse(mission.rings);
    this.score = 0;
    this.elapsed = 0;
    this.timeLeft = mission.timeLimit;
    this.stats = null;
    this.crashReason = '';
    if (!keepPlane) this.plane.reset();
    this.plane.fuel = mission.fuel;
    this.plane.damage = 0;
    this.state = 'flying';
  }

  onClick(event) {
    this.audio.ensureStarted();
    if (this.state !== 'title') return;
    const rect = this.canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * WIDTH;
    const y = ((event.clientY - rect.top) / rect.height) * HEIGHT;
    for (const card of this.hud.titleCards) {
      if (x >= card.x && x <= card.x + card.w && y >= card.y && y <= card.y + card.h) {
        this.audio.click();
        this.startMission(MISSIONS[card.index]);
        return;
      }
    }
  }

  // Crosswind gusts for the storm mission: a slow wandering push.
  windGust() {
    if (this.mission.gust <= 0) return 0;
    this.windPhase += 0.016;
    return Math.sin(this.windPhase * 0.9) * this.mission.gust + Math.sin(this.windPhase * 2.7) * this.mission.gust * 0.4;
  }

  tick(now) {
    const rawDt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    const dt = this.frozen ? 0 : clamp(rawDt, 0, 0.05);
    if (!this.frozen) this.time += dt;
    this.update(dt);
    this.render();
    this.input.endFrame();
    requestAnimationFrame((next) => this.tick(next));
  }

  update(dt) {
    const input = this.input;
    if (input.wasPressed('KeyM')) this.audio.toggleMuted();

    if (this.state === 'title') {
      if (input.wasPressed('Digit1') || input.wasPressed('Numpad1')) this.selectedMission = 0;
      if (input.wasPressed('Digit2') || input.wasPressed('Numpad2')) this.selectedMission = 1;
      if (input.wasPressed('Digit3') || input.wasPressed('Numpad3')) this.selectedMission = 2;
      if (input.wasPressed('ArrowLeft')) this.selectedMission = (this.selectedMission + 2) % 3;
      if (input.wasPressed('ArrowRight')) this.selectedMission = (this.selectedMission + 1) % 3;
      if (input.wasPressed('Enter') || input.wasPressed('Space')) {
        this.audio.ensureStarted();
        this.audio.click();
        this.startMission(MISSIONS[this.selectedMission]);
      }
      // The title backdrop drifts gently over the valley.
      if (!this.frozen) {
        this.plane.heading += dt * 1.2;
      }
      return;
    }

    if (this.state === 'paused') {
      if (input.wasPressed('KeyP')) this.state = 'flying';
      if (input.wasPressed('KeyR')) this.startMission(this.mission);
      if (input.wasPressed('Escape')) this.state = 'title';
      return;
    }

    if (this.state === 'crashed' || this.state === 'complete') {
      if (input.wasPressed('KeyR')) this.startMission(this.mission);
      if (input.wasPressed('Escape')) {
        this.state = 'title';
        this.selectedMission = 0;
      }
      if (input.wasPressed('Digit1')) this.startMission(MISSIONS[0]);
      if (input.wasPressed('Digit2')) this.startMission(MISSIONS[1]);
      if (input.wasPressed('Digit3')) this.startMission(MISSIONS[2]);
      return;
    }

    // Flying.
    if (input.wasPressed('KeyP') || input.wasPressed('Escape')) {
      this.state = 'paused';
      return;
    }
    if (input.wasPressed('Enter')) this.audio.ensureStarted();
    if (input.mouseDown || input.wasPressed('Space')) this.audio.ensureStarted();

    const steer = input.steering();
    // Space is the airbrake: it pulls the throttle back while held.
    if (input.held('Space')) this.plane.throttle = Math.max(0, this.plane.throttle - dt * 1.2);
    this.plane.throttle = clamp(this.plane.throttle + input.throttleDelta() * dt * 1.4, 0, 1);

    const prevX = this.plane.x;
    const prevY = this.plane.altitude;
    const prevZ = this.plane.z;
    const result = this.plane.update(steer, dt, this.windGust());
    this.elapsed += dt;
    this.timeLeft = Math.max(0, this.mission.timeLimit - this.elapsed);

    const passed = this.course.checkPass(prevX, prevY, prevZ, this.plane, this.time);
    if (passed) {
      this.score += 100;
      this.hud.flash(`RING ${passed.index + 1}  +100`, '#ffcf3f', 1.6, this.time);
      this.audio.ringChime();
    }

    if (this.timeLeft <= 0) {
      this.crashReason = 'Out of time — the mail never arrived.';
      this.state = 'crashed';
      this.audio.crash();
      return;
    }
    if (this.plane.fuel <= 0 && this.plane.altitude <= this.plane.groundHeight() + 2 && !this.plane.onRunway()) {
      this.crashReason = 'Out of fuel, down in the fields.';
      this.state = 'crashed';
      this.audio.crash();
      return;
    }
    if (result === 'crashed') {
      this.crashReason = this.plane.damage >= 100
        ? 'The Kestrel came apart on the hillside.'
        : 'Terrain strike — the valley wins this round.';
      this.state = 'crashed';
      this.audio.crash();
      return;
    }
    if (result === 'landed') {
      this.audio.touchdown();
      if (this.course.complete || !this.mission.requiresLanding) {
        this.finishSortie();
      } else {
        this.hud.flash('LANDED — BUT THE COURSE IS NOT DONE', '#ffcf3f', 2.5, this.time);
        // A premature landing ends the sortie as a scratch, not a crash.
        this.crashReason = 'Landed early with rings still to fly.';
        this.state = 'crashed';
      }
      return;
    }
    this.audio.updateFlight(this.plane.throttle, this.plane.speed, true);
  }

  finishSortie() {
    const landingBonus = this.plane.groundSpeedAtTouchdown < 60 ? 250 : this.plane.groundSpeedAtTouchdown < 80 ? 150 : 80;
    const timeBonus = Math.round(this.timeLeft * 2);
    const damagePenalty = Math.round(this.plane.damage * 2);
    this.score += landingBonus + timeBonus - damagePenalty;
    this.bestScore = Math.max(this.bestScore, this.score);
    const quality =
      this.plane.groundSpeedAtTouchdown < 60
        ? 'Smooth — greased it'
        : this.plane.groundSpeedAtTouchdown < 80
          ? 'Firm, but on the strip'
          : 'A hard arrival';
    this.stats = {
      missionName: this.mission.name,
      rings: this.course.passedCount,
      totalRings: this.course.totalCount,
      time: this.elapsed,
      landingQuality: quality,
      damage: this.plane.damage,
      fuel: this.plane.fuel,
      score: this.score,
    };
    this.state = 'complete';
    this.audio.ringChime();
  }

  render() {
    const ctx = this.ctx;
    const cam = this.plane.camera(WIDTH, HEIGHT, FOV);
    this.plane._lastCam = cam;
    this.terrain.drawSky(ctx, WIDTH, HEIGHT, cam, this.mission.theme, this.time);
    this.terrain.drawTerrain(ctx, WIDTH, HEIGHT, cam);
    this.terrain.drawRunwayMarkings(ctx, cam);
    this.terrain.drawObjects(ctx, cam);
    this.course.draw(ctx, this.terrain, cam, this.time);
    this.plane.drawShadow(ctx, this.terrain);
    this.plane.draw(ctx, WIDTH, HEIGHT, this.time);

    if (this.state === 'title') {
      this.hud.drawTitle(ctx, WIDTH, HEIGHT, MISSIONS, this.selectedMission);
    } else if (this.state === 'paused') {
      this.hud.drawFlight(ctx, WIDTH, HEIGHT, this, this.time);
      this.hud.drawPause(ctx, WIDTH, HEIGHT);
    } else if (this.state === 'crashed') {
      this.hud.drawFlight(ctx, WIDTH, HEIGHT, this, this.time);
      this.hud.drawCrash(ctx, WIDTH, HEIGHT, this.crashReason, this.score);
    } else if (this.state === 'complete') {
      this.hud.drawFlight(ctx, WIDTH, HEIGHT, this, this.time);
      this.hud.drawComplete(ctx, WIDTH, HEIGHT, this.stats);
    } else {
      this.hud.drawFlight(ctx, WIDTH, HEIGHT, this, this.time);
    }
  }
}

function boot() {
  const canvas = document.getElementById('game');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  // The fallback line is only for browsers without JavaScript; hide it now
  // that the game has loaded, so it never sits on top of the HUD.
  const fallback = document.getElementById('fallback');
  if (fallback) fallback.style.display = 'none';
  const game = new Game(canvas);
  const shot = parseShotQuery(window.location.search);
  if (shot) {
    // Staged screenshots render one frozen frame of the real game.
    stageShot(game, shot.shot);
    game.render();
  }
  window.__game = game;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
