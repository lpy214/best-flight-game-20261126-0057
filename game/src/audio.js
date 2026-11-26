// audio.js — every sound in the game is synthesised live with WebAudio.
// No audio files, no network: an engine drone, wind, a ring chime, a touchdown
// thump and a crash rumble, all built from oscillators and filtered noise.

export class GameAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.engineOsc = null;
    this.engineGain = null;
    this.windSource = null;
    this.windGain = null;
    this.windFilter = null;
    this.enabled = true;
    this.started = false;
  }

  // Browsers require a user gesture before audio may start; call from the first
  // key press or click. Safe to call repeatedly.
  ensureStarted() {
    if (this.started) {
      if (this.context && this.context.state === 'suspended') this.context.resume();
      return;
    }
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.context.destination);

      // Engine: two detuned sawtooth oscillators through a low-pass filter.
      this.engineOsc = this.context.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.value = 55;
      const engineOsc2 = this.context.createOscillator();
      engineOsc2.type = 'sawtooth';
      engineOsc2.frequency.value = 55 * 1.5;
      const engineFilter = this.context.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 420;
      this.engineGain = this.context.createGain();
      this.engineGain.gain.value = 0.0;
      this.engineOsc.connect(engineFilter);
      engineOsc2.connect(engineFilter);
      engineFilter.connect(this.engineGain);
      this.engineGain.connect(this.master);
      this.engineOsc.start();
      engineOsc2.start();
      this.engineOsc2 = engineOsc2;

      // Wind: looped white noise through a band-pass filter.
      const bufferLength = this.context.sampleRate * 2;
      const buffer = this.context.createBuffer(1, bufferLength, this.context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferLength; i++) data[i] = Math.random() * 2 - 1;
      this.windSource = this.context.createBufferSource();
      this.windSource.buffer = buffer;
      this.windSource.loop = true;
      this.windFilter = this.context.createBiquadFilter();
      this.windFilter.type = 'bandpass';
      this.windFilter.frequency.value = 700;
      this.windFilter.Q.value = 0.6;
      this.windGain = this.context.createGain();
      this.windGain.gain.value = 0.0;
      this.windSource.connect(this.windFilter);
      this.windFilter.connect(this.windGain);
      this.windGain.connect(this.master);
      this.windSource.start();

      this.started = true;
    } catch {
      // Audio is decoration; a failure here must never stop the game.
      this.context = null;
    }
  }

  // Called every frame while flying: engine pitch follows throttle, wind volume
  // follows airspeed.
  updateFlight(throttle, speedKnots, flying) {
    if (!this.started || !this.context) return;
    const t = this.context.currentTime;
    const engineLevel = this.enabled && flying ? 0.05 + throttle * 0.06 : 0.0;
    this.engineGain.gain.setTargetAtTime(engineLevel, t, 0.1);
    const freq = 48 + throttle * 55 + speedKnots * 0.12;
    this.engineOsc.frequency.setTargetAtTime(freq, t, 0.1);
    this.engineOsc2.frequency.setTargetAtTime(freq * 1.494, t, 0.1);
    const windLevel = this.enabled && flying ? Math.min(0.14, speedKnots * 0.0009) : 0.0;
    this.windGain.gain.setTargetAtTime(windLevel, t, 0.15);
    this.windFilter.frequency.setTargetAtTime(500 + speedKnots * 4, t, 0.15);
  }

  // Short two-note chime when the plane passes a ring.
  ringChime() {
    if (!this.started || !this.enabled) return;
    const t = this.context.currentTime;
    [880, 1318.5].forEach((freq, index) => {
      const osc = this.context.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const gain = this.context.createGain();
      const start = t + index * 0.09;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.22, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(start);
      osc.stop(start + 0.55);
    });
  }

  // Low thump for a touchdown.
  touchdown() {
    if (!this.started || !this.enabled) return;
    const t = this.context.currentTime;
    const osc = this.context.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.18);
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.3);
  }

  // Noise burst plus a falling tone for a crash.
  crash() {
    if (!this.started || !this.enabled) return;
    const t = this.context.currentTime;
    const length = this.context.sampleRate * 0.7;
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500;
    const gain = this.context.createGain();
    gain.gain.value = 0.5;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start(t);
  }

  // Single click for menu moves.
  click() {
    if (!this.started || !this.enabled) return;
    const t = this.context.currentTime;
    const osc = this.context.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 660;
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.08, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.08);
  }

  toggleMuted() {
    this.enabled = !this.enabled;
    if (this.master) this.master.gain.value = this.enabled ? 0.5 : 0.0;
    return this.enabled;
  }
}
