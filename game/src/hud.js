// hud.js — everything drawn on top of the world: the flight instruments, the
// mission panel, the guidance arrow, the centre messages, and the title,
// pause, crash and debrief screens. All canvas 2D, all lit like a cockpit.

import { clamp, formatClock, formatFeet, formatHeading, formatKnots, wrapAngleDeg } from './util.js';
import { STALL_KNOTS } from './plane.js';

const PANEL = 'rgba(8, 16, 24, 0.62)';
const PANEL_BORDER = 'rgba(140, 220, 255, 0.35)';
const TEXT = '#dff3ff';
const DIM = '#9dc4d8';
const GOLD = '#ffcf3f';
const GREEN = '#39d353';
const RED = '#ff5a4e';

function panel(ctx, x, y, w, h, radius = 10) {
  ctx.fillStyle = PANEL;
  ctx.strokeStyle = PANEL_BORDER;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.fill();
  ctx.stroke();
}

function litText(ctx, text, x, y, font, colour = TEXT, align = 'left') {
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.shadowColor = colour;
  ctx.shadowBlur = 8;
  ctx.fillStyle = colour;
  ctx.fillText(text, x, y);
  ctx.shadowBlur = 0;
}

export class Hud {
  constructor() {
    this.message = null; // { text, colour, until }
    this.titleCards = []; // mission card rects for mouse clicks
    this.selectedMission = 0;
  }

  flash(text, colour, seconds, time) {
    this.message = { text, colour, until: time + seconds };
  }

  // A vertical tape: ticks with numbers and a boxed current value.
  drawTape(ctx, x, y, height, value, unit, step, format, label) {
    const width = 74;
    panel(ctx, x, y, width, height, 8);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();
    const centre = y + height / 2;
    const pxPerUnit = height / (step * 8);
    const first = Math.floor((value - step * 4) / step) * step;
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let v = first; v <= value + step * 4; v += step) {
      const py = centre - (v - value) * pxPerUnit;
      if (py < y + 4 || py > y + height - 4) continue;
      const major = v % (step * 2) === 0;
      ctx.strokeStyle = major ? 'rgba(223,243,255,0.8)' : 'rgba(223,243,255,0.3)';
      ctx.lineWidth = major ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x + width - 14, py);
      ctx.lineTo(x + width - 4, py);
      ctx.stroke();
      if (major) {
        ctx.fillStyle = DIM;
        ctx.fillText(format(v), x + width - 18, py);
      }
    }
    ctx.restore();
    // Current value box.
    ctx.fillStyle = '#0d2733';
    ctx.strokeStyle = '#7fd4ff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x - 6, centre - 16, width + 12, 32, 6);
    ctx.fill();
    ctx.stroke();
    litText(ctx, format(value), x + width / 2, centre, 'bold 17px system-ui, sans-serif', '#ffffff', 'center');
    litText(ctx, label, x + width / 2, y + height + 12, '11px system-ui, sans-serif', DIM, 'center');
    ctx.fillStyle = DIM;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(unit, x + width / 2, centre + 26);
  }

  drawCompass(ctx, width, heading) {
    const y = 14;
    const height = 34;
    const centreX = width / 2;
    panel(ctx, centreX - 190, y, 380, height, 8);
    ctx.save();
    ctx.beginPath();
    ctx.rect(centreX - 190, y, 380, height);
    ctx.clip();
    const pxPerDeg = 3.2;
    const cardinals = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    for (let d = Math.floor(heading) - 60; d <= Math.floor(heading) + 60; d += 5) {
      const wrapped = ((d % 360) + 360) % 360;
      const px = centreX + (d - heading) * pxPerDeg;
      const major = wrapped % 15 === 0;
      ctx.strokeStyle = major ? 'rgba(223,243,255,0.9)' : 'rgba(223,243,255,0.35)';
      ctx.lineWidth = major ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(px, y + height - (major ? 12 : 7));
      ctx.lineTo(px, y + height - 2);
      ctx.stroke();
      if (wrapped % 45 === 0) {
        ctx.fillStyle = cardinals[wrapped] === 'N' ? GOLD : TEXT;
        ctx.font = 'bold 13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(cardinals[wrapped], px, y + 11);
      } else if (wrapped % 15 === 0) {
        ctx.fillStyle = DIM;
        ctx.font = '10px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(wrapped).padStart(3, '0'), px, y + 10);
      }
    }
    ctx.restore();
    // Centre caret and the digital heading.
    ctx.fillStyle = GOLD;
    ctx.beginPath();
    ctx.moveTo(centreX - 7, y + height - 2);
    ctx.lineTo(centreX + 7, y + height - 2);
    ctx.lineTo(centreX, y + height + 8);
    ctx.closePath();
    ctx.fill();
    litText(ctx, formatHeading(heading), centreX, y + height + 22, 'bold 15px system-ui, sans-serif', '#ffffff', 'center');
  }

  drawArtificialHorizon(ctx, x, y, radius, roll, pitch) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(x, y);
    ctx.rotate((-roll * Math.PI) / 180);
    const pitchPx = clamp(pitch, -30, 30) * (radius / 30);
    ctx.fillStyle = '#3f7fb5';
    ctx.fillRect(-radius, -radius + pitchPx, radius * 2, radius - pitchPx);
    ctx.fillStyle = '#7a5a34';
    ctx.fillRect(-radius, pitchPx, radius * 2, radius - pitchPx + 1);
    // Pitch ladder.
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 1.5;
    ctx.fillStyle = '#ffffff';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const p of [-20, -10, 10, 20]) {
      const py = pitchPx - p * (radius / 30);
      const w = p === 0 ? radius * 0.9 : radius * 0.5;
      ctx.beginPath();
      ctx.moveTo(-w, py);
      ctx.lineTo(w, py);
      ctx.stroke();
      ctx.fillText(String(Math.abs(p)), w + 4, py);
    }
    // Horizon line.
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-radius, pitchPx);
    ctx.lineTo(radius, pitchPx);
    ctx.stroke();
    ctx.restore();
    // Fixed wings and the bezel.
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - radius * 0.62, y);
    ctx.lineTo(x - radius * 0.18, y);
    ctx.moveTo(x + radius * 0.18, y);
    ctx.lineTo(x + radius * 0.62, y);
    ctx.stroke();
    ctx.fillStyle = GOLD;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = PANEL_BORDER;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
    litText(ctx, 'ATT', x, y + radius + 14, '11px system-ui, sans-serif', DIM, 'center');
  }

  drawBar(ctx, x, y, width, height, fraction, label, colour, valueText) {
    panel(ctx, x, y, width, height + 20, 8);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.roundRect(x + 8, y + 8, width - 16, height - 16, 4);
    ctx.fill();
    ctx.fillStyle = colour;
    const fillWidth = Math.max(0, (width - 16) * clamp(fraction, 0, 1));
    ctx.beginPath();
    ctx.roundRect(x + 8, y + 8, fillWidth, height - 16, 4);
    ctx.fill();
    litText(ctx, label, x + 10, y + height + 8, 'bold 11px system-ui, sans-serif', DIM);
    litText(ctx, valueText, x + width - 10, y + height + 8, 'bold 11px system-ui, sans-serif', TEXT, 'right');
  }

  // Full in-flight HUD.
  drawFlight(ctx, width, height, game, time) {
    const plane = game.plane;
    const mission = game.mission;
    const course = game.course;

    this.drawCompass(ctx, width, plane.heading);

    // Mission panel, top left.
    panel(ctx, 14, 14, 268, 108, 10);
    litText(ctx, mission.name.toUpperCase(), 28, 34, 'bold 16px system-ui, sans-serif', GOLD);
    litText(ctx, `RINGS  ${course.passedCount} / ${course.totalCount}`, 28, 60, '14px system-ui, sans-serif');
    litText(ctx, `TIME  ${formatClock(game.timeLeft)}`, 28, 82, '14px system-ui, sans-serif', game.timeLeft < 45 ? RED : TEXT);
    litText(ctx, `SCORE  ${game.score}`, 28, 104, '14px system-ui, sans-serif');

    // Tapes. Altitude is simulated in metres; the instruments read feet.
    this.drawTape(ctx, 14, height - 260, 200, plane.speed, 'KT', 10, formatKnots, 'AIRSPEED');
    this.drawTape(ctx, width - 88, height - 260, 200, plane.altitude * 3.28084, 'FT', 100, formatFeet, 'ALTITUDE');

    // Artificial horizon, bottom left next to the speed tape.
    this.drawArtificialHorizon(ctx, 150, height - 88, 52, plane.roll, plane.pitch);

    // Throttle, fuel and damage, bottom right.
    const barY = height - 118;
    this.drawBar(ctx, width - 300, barY, 200, 16, plane.throttle, 'THR', '#7fd4ff', Math.round(plane.throttle * 100) + '%');
    this.drawBar(ctx, width - 300, barY + 34, 200, 16, plane.fuel / 100, 'FUEL', plane.fuel < 25 ? RED : GREEN, Math.round(plane.fuel) + '%');
    this.drawBar(ctx, width - 300, barY + 68, 200, 16, plane.damage / 100, 'DMG', plane.damage > 60 ? RED : '#e8a13c', Math.round(plane.damage) + '%');

    // Vertical speed, above the altitude tape and clear of it, so a ring
    // passing by never sits on top of the text.
    const vs = plane.verticalSpeed * 196.85; // m/s to ft/min
    litText(ctx, `V/S ${vs >= 0 ? '+' : ''}${Math.round(vs)} FT/MIN`, width - 100, height - 274, '12px system-ui, sans-serif', DIM, 'right');

    // Guidance arrow to the next ring.
    const guide = course.guidance(plane);
    if (guide) {
      const rel = wrapAngleDeg(guide.bearing - plane.heading);
      const arrowY = 66;
      const arrowX = width / 2 + clamp(rel, -60, 60) * 5.2;
      ctx.save();
      ctx.translate(arrowX, arrowY);
      ctx.rotate(clamp(rel, -60, 60) * (Math.PI / 180) * 0.9);
      ctx.fillStyle = GOLD;
      ctx.shadowColor = GOLD;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(0, -16);
      ctx.lineTo(12, 10);
      ctx.lineTo(0, 4);
      ctx.lineTo(-12, 10);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      litText(
        ctx,
        `RING ${course.nextIndex + 1}  ${Math.round(guide.distance)} M  ${guide.altitudeDiff >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(guide.altitudeDiff * 3.28084))} FT`,
        width / 2,
        arrowY + 30,
        'bold 13px system-ui, sans-serif',
        GOLD,
        'center',
      );
    }

    // Stall and fuel warnings — only while actually flying.
    if (game.state === 'flying' && plane.speed < STALL_KNOTS && !plane.onGround) {
      litText(ctx, 'STALL — NOSE DOWN, ADD POWER', width / 2, height * 0.3, 'bold 20px system-ui, sans-serif', RED, 'center');
    } else if (game.state === 'flying' && plane.fuel < 20 && plane.fuel > 0) {
      litText(ctx, 'LOW FUEL', width / 2, height * 0.3, 'bold 20px system-ui, sans-serif', RED, 'center');
    }

    // Centre flash message.
    if (this.message && time < this.message.until) {
      const fade = clamp((this.message.until - time) / 0.5, 0, 1);
      ctx.save();
      ctx.globalAlpha = fade;
      litText(ctx, this.message.text, width / 2, height * 0.42, 'bold 30px system-ui, sans-serif', this.message.colour, 'center');
      ctx.restore();
    }
  }

  drawTitle(ctx, width, height, missions, selected) {
    this.selectedMission = selected;
    // Darken the world behind the menu.
    ctx.fillStyle = 'rgba(6, 14, 22, 0.55)';
    ctx.fillRect(0, 0, width, height);
    litText(ctx, 'RIDGELINE COURIER', width / 2, 108, 'bold 58px system-ui, sans-serif', '#ffffff', 'center');
    litText(ctx, 'A bush pilot’s day over Greywater Valley — rings, mail and weather.', width / 2, 152, '17px system-ui, sans-serif', DIM, 'center');

    const cardW = 330;
    const cardH = 168;
    const gap = 24;
    const totalW = cardW * 3 + gap * 2;
    const startX = (width - totalW) / 2;
    const cardY = 196;
    this.titleCards = [];
    missions.forEach((mission, index) => {
      const x = startX + index * (cardW + gap);
      const chosen = index === selected;
      ctx.fillStyle = chosen ? 'rgba(20, 48, 66, 0.92)' : 'rgba(10, 24, 34, 0.85)';
      ctx.strokeStyle = chosen ? GOLD : PANEL_BORDER;
      ctx.lineWidth = chosen ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.roundRect(x, cardY, cardW, cardH, 12);
      ctx.fill();
      ctx.stroke();
      litText(ctx, `${index + 1} · ${mission.name.toUpperCase()}`, x + 20, cardY + 32, 'bold 17px system-ui, sans-serif', chosen ? GOLD : TEXT);
      litText(ctx, mission.tagline, x + 20, cardY + 62, '13px system-ui, sans-serif', DIM);
      litText(ctx, `${mission.rings.length} rings`, x + 20, cardY + 94, '13px system-ui, sans-serif');
      litText(ctx, `Fuel ${mission.fuel}% · ${formatClock(mission.timeLimit)}`, x + 20, cardY + 118, '13px system-ui, sans-serif');
      litText(ctx, mission.requiresLanding ? 'Ends with a landing' : 'Ends at the last ring', x + 20, cardY + 142, '13px system-ui, sans-serif', DIM);
      this.titleCards.push({ x, y: cardY, w: cardW, h: cardH, index });
    });

    litText(ctx, 'Click a sortie, or press 1–3 and Enter to fly.', width / 2, cardY + cardH + 44, '15px system-ui, sans-serif', TEXT, 'center');
    litText(ctx, 'FLY  mouse or ← → ↑ ↓  ·  THROTTLE  wheel or Shift / Ctrl  ·  BRAKE  Space  ·  PAUSE  P  ·  SOUND  M', width / 2, cardY + cardH + 76, '13px system-ui, sans-serif', DIM, 'center');
    litText(ctx, 'Land gently on runway 36 — wings level, slow, and on the strip.', width / 2, cardY + cardH + 104, '13px system-ui, sans-serif', DIM, 'center');
  }

  drawPause(ctx, width, height) {
    ctx.fillStyle = 'rgba(6, 14, 22, 0.6)';
    ctx.fillRect(0, 0, width, height);
    litText(ctx, 'PAUSED', width / 2, height / 2 - 20, 'bold 44px system-ui, sans-serif', '#ffffff', 'center');
    litText(ctx, 'Press P to keep flying · R to restart the sortie · Esc for the menu', width / 2, height / 2 + 30, '15px system-ui, sans-serif', DIM, 'center');
  }

  drawCrash(ctx, width, height, reason, score) {
    ctx.fillStyle = 'rgba(20, 6, 6, 0.62)';
    ctx.fillRect(0, 0, width, height);
    litText(ctx, 'CRASHED', width / 2, height / 2 - 60, 'bold 48px system-ui, sans-serif', RED, 'center');
    litText(ctx, reason, width / 2, height / 2 - 12, '17px system-ui, sans-serif', TEXT, 'center');
    litText(ctx, `Score ${score}`, width / 2, height / 2 + 22, '16px system-ui, sans-serif', DIM, 'center');
    litText(ctx, 'Press R to fly the sortie again · Esc for the menu', width / 2, height / 2 + 62, '15px system-ui, sans-serif', TEXT, 'center');
  }

  drawComplete(ctx, width, height, stats) {
    ctx.fillStyle = 'rgba(6, 20, 12, 0.6)';
    ctx.fillRect(0, 0, width, height);
    litText(ctx, 'SORTIE COMPLETE', width / 2, height / 2 - 110, 'bold 44px system-ui, sans-serif', GREEN, 'center');
    litText(ctx, stats.missionName, width / 2, height / 2 - 66, '18px system-ui, sans-serif', GOLD, 'center');
    const rows = [
      ['Rings flown', `${stats.rings} / ${stats.totalRings}`],
      ['Time', formatClock(stats.time)],
      ['Landing', stats.landingQuality],
      ['Damage', `${Math.round(stats.damage)}%`],
      ['Fuel left', `${Math.round(stats.fuel)}%`],
    ];
    rows.forEach(([label, value], i) => {
      const y = height / 2 - 24 + i * 28;
      litText(ctx, label, width / 2 - 130, y, '15px system-ui, sans-serif', DIM);
      litText(ctx, value, width / 2 + 130, y, 'bold 15px system-ui, sans-serif', TEXT, 'right');
    });
    litText(ctx, `SCORE  ${stats.score}`, width / 2, height / 2 + 132, 'bold 28px system-ui, sans-serif', '#ffffff', 'center');
    litText(ctx, 'Press R to fly it again · Esc for the menu · 1–3 for another sortie', width / 2, height / 2 + 172, '15px system-ui, sans-serif', TEXT, 'center');
  }
}
