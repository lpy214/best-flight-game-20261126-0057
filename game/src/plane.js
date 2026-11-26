// plane.js — the Kestrel K-4 courier plane: arcade flight physics and the
// chase-view drawing of the aircraft itself.
//
// The model is deliberately forgiving: throttle sets a target speed, banking
// turns the plane, pitch trades speed for height, and below the stall speed
// the nose drops. Landings need the runway, a gentle descent and wings level;
// anything else that meets the ground is a crash.

import { angleDeltaDeg, clamp, degToRad, lerp } from './util.js';
import { RUNWAY, terrainHeightAt } from './terrain.js';

export const STALL_KNOTS = 58;
export const MAX_SPEED_KNOTS = 205;
export const KNOTS_TO_MS = 0.514444;

export class Plane {
  constructor() {
    this.reset();
  }

  reset() {
    // On the runway threshold, facing north down the strip.
    this.x = 0;
    this.z = RUNWAY.z + RUNWAY.halfLength - 40;
    this.altitude = RUNWAY.height + 1.5;
    this.heading = 0;
    this.pitch = 0;
    this.roll = 0;
    this.speed = 0;
    this.throttle = 0;
    this.fuel = 100;
    this.damage = 0;
    this.verticalSpeed = 0;
    this.onGround = true;
    this.landed = false;
    this.propAngle = 0;
    this.groundSpeedAtTouchdown = 0;
  }

  // Place the plane mid-air for a staged scene (used by screenshots).
  place(x, z, altitude, heading, speed, throttle) {
    this.x = x;
    this.z = z;
    this.altitude = altitude;
    this.heading = heading;
    this.pitch = 0;
    this.roll = 0;
    this.speed = speed;
    this.throttle = throttle;
    this.onGround = false;
    this.landed = false;
    this.verticalSpeed = 0;
  }

  groundHeight() {
    return terrainHeightAt(this.x, this.z);
  }

  // One physics step. `steer` is { roll, pitch } in -1..1, `dt` seconds.
  // Returns 'flying' | 'crashed' | 'landed'.
  update(steer, dt, windGust) {
    this.propAngle += dt * (4 + this.throttle * 46 + this.speed * 0.12);

    if (this.landed) {
      // Rollout: bleed speed, keep the strip with gentle rudder.
      this.speed = Math.max(0, this.speed - 22 * dt);
      this.heading += steer.roll * 6 * dt * (this.speed / 60);
      const forward = degToRad(this.heading);
      this.x += Math.sin(forward) * this.speed * KNOTS_TO_MS * dt;
      this.z -= Math.cos(forward) * this.speed * KNOTS_TO_MS * dt;
      this.altitude = this.groundHeight() + 1.5;
      return 'landed';
    }

    // Throttle eases the speed toward its target; drag grows with the square.
    // Idle creeps at a slow taxi; full power tops out at 205 knots.
    const targetSpeed = 8 + this.throttle * (MAX_SPEED_KNOTS - 8);
    const drag = 0.35 + (this.speed / MAX_SPEED_KNOTS) * 0.5;
    this.speed += (targetSpeed - this.speed) * drag * dt;
    if (this.speed < 0) this.speed = 0;

    // Fuel burns with throttle; empty tanks mean a dead stick.
    this.fuel = Math.max(0, this.fuel - this.throttle * 0.16 * dt);
    if (this.fuel <= 0) this.throttle = Math.max(0, this.throttle - 0.5 * dt);

    if (this.onGround) {
      // Takeoff roll: stay on the ground, build speed, steer with the rudder.
      this.altitude = this.groundHeight() + 1.5;
      this.verticalSpeed = 0;
      this.heading += steer.roll * 5 * dt * clamp(this.speed / 60, 0, 1);
      const headingRad = degToRad(this.heading);
      this.x += Math.sin(headingRad) * this.speed * KNOTS_TO_MS * dt;
      this.z -= Math.cos(headingRad) * this.speed * KNOTS_TO_MS * dt;
      // Rotate when fast enough and the pilot pulls back.
      if (this.speed > 66 && steer.pitch < -0.25) {
        this.onGround = false;
        this.pitch = 4;
      }
      return 'flying';
    }

    // Roll and pitch ease toward what the pilot asks for.
    const rollTarget = steer.roll * 58;
    const pitchTarget = -steer.pitch * 24;
    const authority = clamp(this.speed / STALL_KNOTS, 0.25, 1);
    this.roll = lerp(this.roll, rollTarget, clamp(2.2 * authority * dt, 0, 1));
    this.pitch = lerp(this.pitch, pitchTarget, clamp(2.0 * authority * dt, 0, 1));

    // A bank turns the plane; a gust shoves it sideways a touch.
    const turnRate = -this.roll * 0.24 * clamp(this.speed / 100, 0.4, 1.6);
    this.heading += (turnRate + windGust * 0.6) * dt;
    if (this.heading > 180) this.heading -= 360;
    if (this.heading < -180) this.heading += 360;

    // Climb and sink: pitch sets the vertical speed, the stall steals lift.
    const speedMs = this.speed * KNOTS_TO_MS;
    let verticalMs = speedMs * Math.sin(degToRad(this.pitch));
    if (this.speed < STALL_KNOTS) {
      verticalMs -= (STALL_KNOTS - this.speed) * 0.22;
      this.pitch = lerp(this.pitch, -14, clamp(1.5 * dt, 0, 1));
    }
    // Ground effect over the runway cushions the last few metres.
    const heightAboveGround = this.altitude - this.groundHeight();
    if (heightAboveGround < 25 && this.onRunway()) verticalMs *= 0.55;
    this.verticalSpeed = verticalMs;
    this.altitude += verticalMs * dt;

    const headingRad = degToRad(this.heading);
    const forwardMs = speedMs * Math.cos(degToRad(this.pitch));
    this.x += Math.sin(headingRad) * forwardMs * dt;
    this.z -= Math.cos(headingRad) * forwardMs * dt;

    // Meeting the ground.
    const ground = this.groundHeight();
    if (this.altitude <= ground + 1.5) {
      this.altitude = ground + 1.5;
      const gentle = this.verticalSpeed > -6 && this.speed < 96 && Math.abs(this.roll) < 14;
      if (this.onRunway() && gentle) {
        this.onGround = true;
        this.landed = true;
        this.groundSpeedAtTouchdown = this.speed;
        return 'landed';
      }
      // A graze at low descent on a flat field bends the plane; anything
      // harder, or a hillside, ends the sortie.
      if (this.verticalSpeed > -4 && this.speed < 70 && !this.onRunway()) {
        this.damage += 34;
        this.speed *= 0.55;
        this.altitude = ground + 6;
        this.pitch = 6;
        if (this.damage >= 100) return 'crashed';
        return 'flying';
      }
      return 'crashed';
    }
    this.onGround = false;
    return 'flying';
  }

  onRunway() {
    return (
      Math.abs(this.x - RUNWAY.x) <= RUNWAY.halfWidth + 6 &&
      Math.abs(this.z - RUNWAY.z) <= RUNWAY.halfLength + 30
    );
  }

  // Chase camera: behind and above the plane, looking ahead past it.
  camera(width, height, fovDeg) {
    const headingRad = degToRad(this.heading);
    const pitchRad = degToRad(this.pitch);
    const fx = Math.sin(headingRad) * Math.cos(pitchRad);
    const fy = Math.sin(pitchRad);
    const fz = -Math.cos(headingRad) * Math.cos(pitchRad);
    const camX = this.x - fx * 15;
    const camY = this.altitude + 4.5 - fy * 15;
    const camZ = this.z - fz * 15;
    // Camera basis: forward, right, up.
    const fl = Math.hypot(fx, fy, fz) || 1;
    const nfx = fx / fl;
    const nfy = fy / fl;
    const nfz = fz / fl;
    let rx = -nfz;
    let ry = 0;
    let rz = nfx;
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl;
    ry /= rl;
    rz /= rl;
    const ux = ry * nfz - rz * nfy;
    const uy = rz * nfx - rx * nfz;
    const uz = rx * nfy - ry * nfx;
    return {
      x: camX,
      y: camY,
      z: camZ,
      fx: nfx,
      fy: nfy,
      fz: nfz,
      rx,
      ry,
      rz,
      ux,
      uy,
      uz,
      cx: width / 2,
      cy: height * 0.52,
      focal: width / 2 / Math.tan((fovDeg / 2) * Math.PI / 180),
      fov: fovDeg,
    };
  }

  // The plane's own shadow on the ground, so height reads at a glance.
  drawShadow(ctx, terrain) {
    const ground = this.groundHeight();
    const cam = this._lastCam;
    if (!cam) return;
    const p = terrain.project(this.x, ground + 0.6, this.z, cam);
    if (!p || p.depth < 10) return;
    const radius = clamp((26 * cam.focal) / p.depth, 2, 90);
    const fade = clamp(1 - (this.altitude - ground) / 500, 0.15, 0.7);
    ctx.fillStyle = `rgba(10, 20, 12, ${fade.toFixed(2)})`;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, radius, radius * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw the Kestrel from behind and slightly above, banking with the roll.
  // Screen-space: the plane sits just below centre, wings spanning the view.
  draw(ctx, width, height, time) {
    const cx = width / 2;
    const cy = height * 0.62;
    const scale = width / 1280;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(degToRad(this.roll) * 0.55);
    ctx.translate(0, -this.pitch * 1.6 * scale);
    ctx.scale(scale, scale);

    const wingSpan = 330;
    const bodyTop = -118;
    const bodyBottom = 96;

    // Soft shadow under the airframe so it sits in the sky, not on it.
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.ellipse(6, 30, 190, 96, 0, 0, Math.PI * 2);
    ctx.fill();

    // Main wings: long and nearly level, slight dihedral, tapered toward
    // the tips, with a cream stripe and a rivet line.
    const wing = (side) => {
      ctx.beginPath();
      ctx.moveTo(side * 16, -26);
      ctx.lineTo(side * wingSpan, -40);
      ctx.lineTo(side * wingSpan, -16);
      ctx.lineTo(side * 24, 8);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, -42, 0, 10);
      grad.addColorStop(0, '#d94f2b');
      grad.addColorStop(0.55, '#c24324');
      grad.addColorStop(1, '#932e18');
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = 'rgba(60,10,0,0.5)';
      ctx.lineWidth = 2;
      ctx.stroke();
      // Cream tip stripe and a rivet line.
      ctx.fillStyle = '#f2e3c2';
      ctx.beginPath();
      ctx.moveTo(side * (wingSpan - 34), -38);
      ctx.lineTo(side * wingSpan, -40);
      ctx.lineTo(side * wingSpan, -16);
      ctx.lineTo(side * (wingSpan - 34), -18);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(side * 60, -32);
      ctx.lineTo(side * (wingSpan - 40), -36);
      ctx.stroke();
    };
    wing(-1);
    wing(1);

    // Tailplane: small stabilisers hugging the top of the fuselage.
    ctx.fillStyle = '#a83620';
    ctx.beginPath();
    ctx.moveTo(-14, bodyTop + 26);
    ctx.lineTo(-92, bodyTop + 12);
    ctx.lineTo(-92, bodyTop + 26);
    ctx.lineTo(-14, bodyTop + 42);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(14, bodyTop + 26);
    ctx.lineTo(92, bodyTop + 12);
    ctx.lineTo(92, bodyTop + 26);
    ctx.lineTo(14, bodyTop + 42);
    ctx.closePath();
    ctx.fill();

    // Tail fin.
    ctx.fillStyle = '#b23a1f';
    ctx.beginPath();
    ctx.moveTo(-12, bodyTop + 34);
    ctx.lineTo(-17, bodyTop - 52);
    ctx.lineTo(5, bodyTop - 58);
    ctx.lineTo(13, bodyTop + 30);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#f2e3c2';
    ctx.beginPath();
    ctx.moveTo(-14, bodyTop - 30);
    ctx.lineTo(-16, bodyTop - 46);
    ctx.lineTo(3, bodyTop - 50);
    ctx.lineTo(5, bodyTop - 34);
    ctx.closePath();
    ctx.fill();

    // Fuselage: a long tapered body, cream belly, red spine.
    const fuselage = ctx.createLinearGradient(-30, 0, 30, 0);
    fuselage.addColorStop(0, '#8f2a16');
    fuselage.addColorStop(0.25, '#c24324');
    fuselage.addColorStop(0.55, '#d94f2b');
    fuselage.addColorStop(0.8, '#b23a1f');
    fuselage.addColorStop(1, '#7e2413');
    ctx.fillStyle = fuselage;
    ctx.beginPath();
    ctx.moveTo(-11, bodyTop + 18);
    ctx.quadraticCurveTo(-30, 10, -28, bodyBottom - 18);
    ctx.quadraticCurveTo(-24, bodyBottom + 8, 0, bodyBottom + 10);
    ctx.quadraticCurveTo(24, bodyBottom + 8, 28, bodyBottom - 18);
    ctx.quadraticCurveTo(30, 10, 11, bodyTop + 18);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(40,5,0,0.55)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Belly stripe and registration.
    ctx.fillStyle = '#f2e3c2';
    ctx.beginPath();
    ctx.moveTo(-25, 52);
    ctx.quadraticCurveTo(-21, bodyBottom + 2, 0, bodyBottom + 6);
    ctx.quadraticCurveTo(21, bodyBottom + 2, 25, 52);
    ctx.lineTo(18, 46);
    ctx.quadraticCurveTo(0, 66, -18, 46);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#2a0d05';
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N-K4', 0, 66);

    // Canopy glass, catching the light.
    ctx.fillStyle = '#bfe3ee';
    ctx.beginPath();
    ctx.moveTo(-11, bodyTop + 22);
    ctx.quadraticCurveTo(0, bodyTop + 4, 11, bodyTop + 22);
    ctx.quadraticCurveTo(9, bodyTop + 44, 0, bodyTop + 46);
    ctx.quadraticCurveTo(-9, bodyTop + 44, -11, bodyTop + 22);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.moveTo(-6, bodyTop + 18);
    ctx.lineTo(-1, bodyTop + 14);
    ctx.lineTo(2, bodyTop + 30);
    ctx.lineTo(-4, bodyTop + 32);
    ctx.closePath();
    ctx.fill();

    // Propeller: a translucent spinning disc at the nose (far end, top).
    const propY = bodyTop - 8;
    ctx.save();
    ctx.translate(0, propY);
    ctx.rotate(this.propAngle);
    const disc = ctx.createRadialGradient(0, 0, 2, 0, 0, 66);
    disc.addColorStop(0, 'rgba(220,220,220,0.10)');
    disc.addColorStop(0.7, 'rgba(200,200,200,0.18)');
    disc.addColorStop(1, 'rgba(200,200,200,0.05)');
    ctx.fillStyle = disc;
    ctx.beginPath();
    ctx.arc(0, 0, 66, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(40,30,25,0.85)';
    ctx.beginPath();
    ctx.ellipse(0, -40, 8, 30, 0, 0, Math.PI * 2);
    ctx.ellipse(0, 40, 8, 30, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // Spinner.
    ctx.fillStyle = '#f2e3c2';
    ctx.beginPath();
    ctx.arc(0, propY, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(40,5,0,0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Navigation lights: red left, green right, blinking white tail.
    const blink = Math.sin(time * 6) > 0;
    ctx.fillStyle = '#ff2d2d';
    ctx.beginPath();
    ctx.arc(-wingSpan + 6, -28, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2dff5e';
    ctx.beginPath();
    ctx.arc(wingSpan - 6, -28, 5, 0, Math.PI * 2);
    ctx.fill();
    if (blink) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, bodyTop - 56, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
