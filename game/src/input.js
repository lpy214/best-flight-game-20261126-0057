// input.js — keyboard and mouse input, normalised to one control surface.
// The plane answers to either: arrows / WASD fly it, the mouse steers it by
// position, the wheel (or Shift / Ctrl) works the throttle. Every key the game
// uses is listed here so the help screen and this file never drift apart.

export class GameInput {
  constructor(canvas) {
    this.canvas = canvas;
    // Held keys, by KeyboardEvent.code.
    this.keys = new Set();
    // Keys pressed since the last frame was consumed (edge-triggered actions).
    this.pressed = new Set();
    // Mouse position in canvas pixels, and whether the pointer is over the game.
    this.mouseX = canvas.width / 2;
    this.mouseY = canvas.height / 2;
    this.mouseInside = false;
    this.mouseDown = false;
    // Wheel steps accumulated since the last frame.
    this.wheelDelta = 0;

    window.addEventListener('keydown', (event) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) {
        event.preventDefault();
      }
      if (!event.repeat) this.pressed.add(event.code);
      this.keys.add(event.code);
    });
    window.addEventListener('keyup', (event) => {
      this.keys.delete(event.code);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
    });

    canvas.addEventListener('mousemove', (event) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      this.mouseX = (event.clientX - rect.left) * scaleX;
      this.mouseY = (event.clientY - rect.top) * scaleY;
      this.mouseInside = true;
    });
    canvas.addEventListener('mouseleave', () => {
      this.mouseInside = false;
    });
    canvas.addEventListener('mousedown', (event) => {
      if (event.button === 0) this.mouseDown = true;
    });
    window.addEventListener('mouseup', () => {
      this.mouseDown = false;
    });
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.wheelDelta += event.deltaY;
    }, { passive: false });
  }

  held(code) {
    return this.keys.has(code);
  }

  // True once, on the frame the key went down.
  wasPressed(code) {
    return this.pressed.has(code);
  }

  // Steering: -1..1 for roll (left/right) and pitch (up/down), merging keyboard
  // and mouse. Mouse steers toward the pointer's offset from screen centre;
  // keyboard adds on top. A dead zone near centre keeps the plane steady.
  steering() {
    let roll = 0;
    let pitch = 0;
    if (this.held('ArrowLeft') || this.held('KeyA')) roll -= 1;
    if (this.held('ArrowRight') || this.held('KeyD')) roll += 1;
    if (this.held('ArrowUp') || this.held('KeyW')) pitch -= 1;
    if (this.held('ArrowDown') || this.held('KeyS')) pitch += 1;

    if (this.mouseInside) {
      const nx = (this.mouseX - this.canvas.width / 2) / (this.canvas.width / 2);
      const ny = (this.mouseY - this.canvas.height / 2) / (this.canvas.height / 2);
      const dead = 0.08;
      const mouseRoll = Math.abs(nx) < dead ? 0 : (Math.abs(nx) - dead) / (1 - dead) * Math.sign(nx);
      const mousePitch = Math.abs(ny) < dead ? 0 : (Math.abs(ny) - dead) / (1 - dead) * Math.sign(ny);
      // Mouse wins over keys when it is clearly off-centre.
      if (Math.abs(mouseRoll) > 0.12) roll = mouseRoll;
      if (Math.abs(mousePitch) > 0.12) pitch = mousePitch;
    }
    return { roll: Math.max(-1, Math.min(1, roll)), pitch: Math.max(-1, Math.min(1, pitch)) };
  }

  // Throttle change for this frame: wheel steps and Shift/Ctrl keys.
  throttleDelta() {
    let delta = 0;
    if (this.held('ShiftLeft') || this.held('ShiftRight')) delta += 0.9;
    if (this.held('ControlLeft') || this.held('ControlRight')) delta -= 0.9;
    if (this.wheelDelta !== 0) {
      delta += -this.wheelDelta / 240;
      this.wheelDelta = 0;
    }
    return delta;
  }

  // Call at the end of every frame so edge-triggered presses do not repeat.
  endFrame() {
    this.pressed.clear();
  }
}
