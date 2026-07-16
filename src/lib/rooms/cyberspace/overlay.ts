// ─── HUD overlay (neuromancer-cyberspace.html #hud, corner telemetry + data
// floaters) ────────────────────────────────────────────────────────────────
// Full quality only. Corner text, formatting and cadence are kept verbatim —
// the room's identity, same principle as the Italian in `neural` or the
// Sanskrit in `sri-yantra`. The source's own title/hint/audio-button chrome
// is NOT ported — the room page header and the shared AudioPrompt replace it.

export interface HudFields {
  jackPoint: string; depth: string; status: string;
  throughput: string; iceStatus: string;
  vector: string; nearest: string;
}

export interface FloaterTarget { name: string; isCore: boolean; x: number; y: number; visible: boolean; }

const FLOATERS_PER_GROUP = 6;

function hex(len: number): string {
  const chars = '0123456789ABCDEF';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * 16)];
  return s;
}

function dataLines(name: string, isCore: boolean): string[] {
  if (isCore) {
    return [
      'CORE ARRAY // UNCLASSIFIED',
      `CIPHER ${hex(4)}-${hex(4)}-${hex(4)}`,
      `SIZE ${800 + Math.floor(Math.random() * 400)} PB`,
      `ICE DENSITY ${60 + Math.floor(Math.random() * 35)}%`,
      `TRACE ${Math.random() < 0.5 ? 'inactive' : 'building'}`
    ];
  }
  return [
    `${name.toUpperCase()} ARRAY`,
    `CHKSUM ${hex(4)}-${hex(4)}`,
    `SIZE ${1 + Math.floor(Math.random() * 900)} TB`,
    `CIPHER RSA-${1024 * (1 + Math.floor(Math.random() * 3))}`,
    `LATENCY ${4 + Math.floor(Math.random() * 40)}ms`
  ];
}

export function makeOverlay(): {
  root: HTMLElement;
  updateHud(fields: HudFields): void;
  updateFloater(group: 0 | 1, target: FloaterTarget | null, dt: number): void;
} {
  const root = document.createElement('div');
  root.setAttribute('data-cyberspace-overlay', '');
  // inset 56px (not 0) so every absolutely-positioned child below sits clear
  // of the room page's own chrome (back link + title top, info toggle
  // bottom-right) without each corner needing its own offset.
  root.style.cssText = 'position:fixed;inset:56px;pointer-events:none;z-index:6;font-family:monospace;color:#4a9298;text-shadow:0 0 3px rgba(74,146,152,0.5);';

  // On narrow/mobile viewports, drop the more decorative telemetry lines
  // (JACK POINT, DEPTH, THROUGHPUT, VECTOR) and keep only the fields that
  // reflect real state (STATUS, ICE STATUS, NEAREST ARRAY) — checked once,
  // matching the one-time matchMedia pattern used for reduced-motion checks
  // elsewhere in the project.
  const compact = matchMedia('(max-width: 600px)').matches;

  // max-width caps each corner at under half the viewport so opposite
  // corners (tl/tr, bl/br) can never collide — on narrow/mobile viewports
  // long lines (e.g. "THROUGHPUT 80.3 Tb/s") wrap instead of overflowing
  // into the other corner's text.
  function corner(cls: string): HTMLElement {
    const el = document.createElement('div');
    el.style.cssText = `position:absolute;${cls}max-width:42vw;font-size:10px;letter-spacing:0.12em;line-height:1.6;opacity:0.75;`;
    root.appendChild(el);
    return el;
  }
  const tl = corner('top:16px;left:16px;');
  const tr = corner('top:16px;right:16px;text-align:right;');
  const bl = corner('bottom:16px;left:16px;');
  const br = corner('bottom:16px;right:16px;text-align:right;');

  const bracketStyle = 'position:absolute;width:22px;height:22px;border:1px solid rgba(93,247,255,0.5);';
  const nw = document.createElement('div'); nw.style.cssText = bracketStyle + 'top:44px;left:44px;border-right:none;border-bottom:none;';
  const ne = document.createElement('div'); ne.style.cssText = bracketStyle + 'top:44px;right:44px;border-left:none;border-bottom:none;';
  const sw = document.createElement('div'); sw.style.cssText = bracketStyle + 'bottom:44px;left:44px;border-right:none;border-top:none;';
  const se = document.createElement('div'); se.style.cssText = bracketStyle + 'bottom:44px;right:44px;border-left:none;border-top:none;';
  root.append(nw, ne, sw, se);

  const crosshair = document.createElement('div');
  crosshair.style.cssText = 'position:absolute;top:50%;left:50%;width:18px;height:18px;margin:-9px 0 0 -9px;';
  const hLine = document.createElement('div');
  hLine.style.cssText = 'position:absolute;top:50%;left:0;right:0;height:1px;margin-top:-0.5px;background:rgba(111,176,181,0.55);';
  const vLine = document.createElement('div');
  vLine.style.cssText = 'position:absolute;left:50%;top:0;bottom:0;width:1px;margin-left:-0.5px;background:rgba(111,176,181,0.55);';
  crosshair.append(hLine, vLine);
  root.appendChild(crosshair);

  function updateHud(f: HudFields): void {
    tl.innerHTML = compact
      ? `<div>STATUS <span style="color:#6fb0b5">${f.status}</span></div>`
      : `<div>JACK POINT <span style="color:#6fb0b5">${f.jackPoint}</span></div><div>DEPTH <span style="color:#6fb0b5">${f.depth}</span> m</div><div>STATUS <span style="color:#6fb0b5">${f.status}</span></div>`;
    tr.innerHTML = compact
      ? `<div>ICE STATUS <span style="color:#6fb0b5">${f.iceStatus}</span></div>`
      : `<div>THROUGHPUT <span style="color:#6fb0b5">${f.throughput}</span> Tb/s</div><div>ICE STATUS <span style="color:#6fb0b5">${f.iceStatus}</span></div>`;
    bl.innerHTML = compact ? '' : `<div>VECTOR <span style="color:#6fb0b5">${f.vector}</span></div>`;
    br.innerHTML = `<div>NEAREST ARRAY <span style="color:#6fb0b5">${f.nearest}</span></div>`;
  }

  interface FloaterEl { el: HTMLElement; group: 0 | 1; angle: number; speed: number; radius: number; vBias: number; dir: number; }
  const floaters: FloaterEl[] = [];
  for (let i = 0; i < FLOATERS_PER_GROUP * 2; i++) {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;top:0;left:0;font-size:9px;letter-spacing:0.06em;white-space:nowrap;color:#d8fbff;background:rgba(0,10,14,0.35);padding:2px 5px;border:1px solid rgba(216,251,255,0.15);opacity:0;transition:opacity 0.4s ease;';
    root.appendChild(el);
    floaters.push({
      el, group: i < FLOATERS_PER_GROUP ? 0 : 1,
      angle: ((i % FLOATERS_PER_GROUP) / FLOATERS_PER_GROUP) * Math.PI * 2,
      speed: 0.25 + Math.random() * 0.35, radius: 46 + Math.random() * 60,
      vBias: (Math.random() * 2 - 1) * 30, dir: Math.random() < 0.5 ? -1 : 1
    });
  }

  function updateFloater(group: 0 | 1, target: FloaterTarget | null, dt: number): void {
    const members = floaters.filter(f => f.group === group);
    if (!target || !target.visible) { members.forEach(f => { f.el.style.opacity = '0'; }); return; }
    members.forEach((f, k) => {
      f.angle += dt * f.speed * f.dir;
      const ox = Math.cos(f.angle) * f.radius;
      const oy = Math.sin(f.angle) * f.radius * 0.5 + f.vBias;
      f.el.style.transform = `translate(${target.x + ox}px, ${target.y + oy}px)`;
      f.el.style.opacity = '0.85';
      if (!f.el.textContent || Math.random() < 0.01) {
        const lines = dataLines(target.name, target.isCore);
        f.el.textContent = lines[k % lines.length];
      }
    });
  }

  return { root, updateHud, updateFloater };
}
