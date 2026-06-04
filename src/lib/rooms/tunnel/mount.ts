import type { RoomMount } from '@/lib/webgl/types';
import { createContext } from '@/lib/webgl/context';
import { compileShader, linkProgram, getUniforms } from '@/lib/webgl/shaders';
import { observeResize } from '@/lib/webgl/resize';
import { createRafLoop } from '@/lib/webgl/raf';
import { sharedState } from './state';
import { VS_SRC, buildFragSrc } from './shaders';

const MARCH_STEPS = { preview: 24, full: 48 } as const;

// Max pixel buffer size — allocated once at mount to avoid per-frame allocation.
// Sized for 6 rows at max likely width (4096px).
const MAX_PIXEL_BUF_BYTES = 4096 * 6 * 4;

export const mount: RoomMount = (canvas, opts) => {
  // ── WebGL2 context ──────────────────────────────────────────────────────────
  const gl = createContext(canvas, {
    version: 2,
    antialias: false,
    alpha: false,
    depth: false,
  }) as WebGL2RenderingContext;

  // Verify we actually got WebGL2 — createContext may fall back to WebGL1.
  // Guard with typeof check so test environments without WebGL2RenderingContext
  // global (e.g. jsdom) can still exercise mount/teardown paths.
  if (typeof WebGL2RenderingContext !== 'undefined' && !(gl instanceof WebGL2RenderingContext)) {
    throw new Error('WebGL2 required for tunnel');
  }

  // ── AbortController for shared teardown ────────────────────────────────────
  const ac = new AbortController();
  if (opts.signal) {
    opts.signal.addEventListener('abort', () => ac.abort(), { once: true });
  }

  // ── Compile shaders ─────────────────────────────────────────────────────────
  const marchSteps = MARCH_STEPS[opts.quality];
  const vs = compileShader(gl, gl.VERTEX_SHADER, VS_SRC);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, buildFragSrc(marchSteps));
  const program = linkProgram(gl, vs, fs);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  gl.useProgram(program);

  const uniforms = getUniforms(gl, program, ['uRes', 'uTime'] as const);

  // ── Pixel readback buffer — allocated once ─────────────────────────────────
  // 6 rows (3 floor + 3 ceiling): used by audio subsystem to sample bright pixels.
  // We allocate enough for any reasonable canvas width; actual width capped by MAX.
  const pixelBuf = new Uint8Array(MAX_PIXEL_BUF_BYTES);

  // ── Resolution tracking ────────────────────────────────────────────────────
  let RW = 1;
  let RH = 1;

  const stopResize = observeResize(canvas, () => {
    RW = canvas.width;
    RH = canvas.height;
    gl.viewport(0, 0, RW, RH);
  });

  // Initial dimensions from observeResize call.
  RW = canvas.width || 1;
  RH = canvas.height || 1;

  // ── Drag-to-speed pointer state ────────────────────────────────────────────
  let speed = 3.5;
  let dragActive = false;
  let dragY0 = 0;

  const onDown = (e: PointerEvent): void => {
    dragActive = true;
    dragY0 = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  };

  const onMove = (e: PointerEvent): void => {
    if (!dragActive) return;
    speed -= (e.clientY - dragY0) * 0.03;
    speed = Math.max(-12, Math.min(18, speed));
    dragY0 = e.clientY;
  };

  const onUp = (_e: PointerEvent): void => {
    dragActive = false;
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  // ── Camera time accumulator ────────────────────────────────────────────────
  let camTime = 0;

  // ── Render loop ────────────────────────────────────────────────────────────
  const loop = createRafLoop((dtMs: number) => {
    const dt = dtMs * 0.001;
    camTime += speed * dt;

    // ── Update shared audio state (read by createAudio tick) ─────────────────
    sharedState.speed   = speed;
    sharedState.camTime = camTime;

    // Re-bind the program every tick — defensive against any caller that
    // changes the GL state between frames (e.g. another room mounting on
    // the same context during view transitions).
    gl.useProgram(program);
    gl.uniform2f(uniforms.uRes, RW, RH);
    gl.uniform1f(uniforms.uTime, camTime);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // ── Pixel readback for audio-reactive line drone ───────────────────────
    // Read 3 floor rows + 3 ceiling rows into the pre-allocated buffer.
    // Each row is RW pixels × 4 bytes. Buffer is sized for MAX_PIXEL_BUF_BYTES.
    const rowBytes = RW * 4;
    if (rowBytes * 6 <= MAX_PIXEL_BUF_BYTES) {
      const y0 = Math.floor(RH * 0.05);
      const y1 = Math.floor(RH * 0.10);
      const y2 = Math.floor(RH * 0.16);
      gl.readPixels(0, y0, RW, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixelBuf, 0);
      gl.readPixels(0, y1, RW, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixelBuf, rowBytes);
      gl.readPixels(0, y2, RW, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixelBuf, rowBytes * 2);

      const c0 = Math.floor(RH * 0.84);
      const c1 = Math.floor(RH * 0.90);
      const c2 = Math.floor(RH * 0.95);
      gl.readPixels(0, c0, RW, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixelBuf, rowBytes * 3);
      gl.readPixels(0, c1, RW, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixelBuf, rowBytes * 4);
      gl.readPixels(0, c2, RW, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixelBuf, rowBytes * 5);

      // Count BRIGHT pixels above a threshold across 3 floor rows and 3 ceiling
      // rows. Dark tile fill is ~5–18, perspective grid/curve lines are ~40–120
      // — threshold at 35 isolates the lines from the floor. Average brightness
      // (used previously) stays near-zero even when curves are clearly visible
      // because the bright pixels are sparse.
      const totalPx = (rowBytes / 4) * 3;
      let floorBright = 0;
      for (let i = 0; i < rowBytes * 3; i += 4) {
        if (pixelBuf[i] > 35) floorBright++;
      }
      let ceilBright = 0;
      for (let i = rowBytes * 3; i < rowBytes * 6; i += 4) {
        if (pixelBuf[i] > 35) ceilBright++;
      }
      // 8% line coverage on floor → full intensity (matches original); ceiling
      // lines are typically denser so normalise to 15%.
      sharedState.floorBrightness = Math.min(1, floorBright / totalPx / 0.08);
      sharedState.ceilingBrightness = Math.min(1, ceilBright / totalPx / 0.15);
    }
  }, ac.signal);

  if (!opts.startPaused) loop.start();

  // ── Teardown ───────────────────────────────────────────────────────────────
  return {
    teardown: (): void => {
      ac.abort();
      loop.stop();
      stopResize();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      try { gl.deleteProgram(program); } catch { /* idempotent */ }
    },
    pause: (): void => loop.stop(),
    resume: (): void => loop.start()
  };
};
