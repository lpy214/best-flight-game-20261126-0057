// missions.js — the three sorties. Same valley, three different days and
// three different jobs: a gentle ring run, a timed mail delivery that ends
// on the runway, and a night storm pass with gusts and tight fuel.
//
// A mission is: a name and briefing, a sky theme, a ring course, fuel and a
// time limit, and whether the sortie ends with a landing.

import { buildRingCourse } from './rings.js';

export const SKY_THEMES = {
  day: {
    sky: [[0, '#6fb1e8'], [0.45, '#a8d0f0'], [0.72, '#d8e9f2'], [1, '#eef3e8']],
    sun: [0.55, 0.62, -0.55],
    sunCore: '#fff6cf',
    sunGlow: 'rgba(255, 236, 160, 0.55)',
    cloud: 'rgba(255,255,255,0.92)',
    night: false,
  },
  dusk: {
    sky: [[0, '#3d5a8a'], [0.4, '#c98a5a'], [0.68, '#e8b478'], [1, '#f2d8a8']],
    sun: [-0.6, 0.18, -0.6],
    sunCore: '#ffdf9e',
    sunGlow: 'rgba(255, 170, 90, 0.6)',
    cloud: 'rgba(255, 214, 170, 0.85)',
    night: false,
  },
  storm: {
    sky: [[0, '#101828'], [0.45, '#2c3a52'], [0.72, '#5a6a80'], [1, '#8a94a4']],
    sun: [0.4, 0.3, -0.7],
    sunCore: '#d8e2ee',
    sunGlow: 'rgba(180, 195, 220, 0.35)',
    cloud: 'rgba(70, 80, 100, 0.9)',
    night: true,
  },
};

export const MISSIONS = [
  {
    id: 'first-light',
    name: 'First Light Run',
    tagline: 'Eight rings down the valley, then home to the strip.',
    briefing:
      'A calm morning over Greywater Valley. Fly the eight gold rings in order, mind your fuel, and put the Kestrel down on runway 36 when the course is done.',
    theme: SKY_THEMES.day,
    fuel: 100,
    timeLimit: 420,
    requiresLanding: true,
    gust: 0,
    rings: buildRingCourse(101, 8, 0, 400, 220, { turn: 26, spacing: 520 }),
    par: 200,
  },
  {
    id: 'valley-mail',
    name: 'Valley Mail',
    tagline: 'Six rings, one parcel, and a clock that will not wait.',
    briefing:
      'The mail run to Millbrook, at golden hour. Six rings against a 4-minute clock, then a landing on runway 36. Throttle discipline beats full power: fuel is tight.',
    theme: SKY_THEMES.dusk,
    fuel: 78,
    timeLimit: 240,
    requiresLanding: true,
    gust: 1.5,
    rings: buildRingCourse(207, 6, 0, 400, 200, { turn: 34, spacing: 560 }),
    par: 165,
  },
  {
    id: 'storm-pass',
    name: 'Storm Pass',
    tagline: 'Ten rings in the dark, with the wind shoving you sideways.',
    briefing:
      'A night crossing in bad weather. Ten rings, gusting crosswinds, and a fuel gauge that falls faster than you would like. Land it, and the valley is yours.',
    theme: SKY_THEMES.storm,
    fuel: 70,
    timeLimit: 330,
    requiresLanding: true,
    gust: 4,
    rings: buildRingCourse(313, 10, 0, 400, 260, { turn: 30, spacing: 500 }),
    par: 230,
  },
];

export function missionById(id) {
  return MISSIONS.find((m) => m.id === id) ?? MISSIONS[0];
}
