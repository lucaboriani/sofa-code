// ─── Overlay (bindu.html L11-24, 39-44) ──────────────────────────────────────

export function makeOverlay(): HTMLElement {
  const root = document.createElement('div');
  root.setAttribute('data-bindu-overlay', '');
  root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2;';

  const title = document.createElement('div');
  title.textContent = 'Bindu · The Origin';
  title.style.cssText =
    'position:absolute;top:26px;left:50%;transform:translateX(-50%);' +
    "font-family:'Georgia',serif;font-size:12px;letter-spacing:.35em;" +
    'color:rgba(255,255,255,.14);text-transform:uppercase;white-space:nowrap;';

  const ui = document.createElement('div');
  ui.style.cssText =
    'position:absolute;bottom:26px;left:50%;transform:translateX(-50%);' +
    "display:flex;gap:26px;font-family:'Georgia',serif;font-size:10px;" +
    'letter-spacing:.22em;color:rgba(255,255,255,.22);text-transform:uppercase;';
  const gunas: [string, string][] = [
    ['Tamas', 'background:#111;border:1px solid #444'],
    ['Rajas', 'background:#c03020'],
    ['Sattva', 'background:rgba(255,255,255,.82)']
  ];
  for (const [label, dotStyle] of gunas) {
    const guna = document.createElement('div');
    guna.style.cssText = 'display:flex;align-items:center;gap:7px;';
    const dot = document.createElement('div');
    dot.style.cssText = `width:5px;height:5px;border-radius:50%;${dotStyle}`;
    guna.appendChild(dot);
    guna.appendChild(document.createTextNode(label));
    ui.appendChild(guna);
  }

  root.appendChild(title);
  root.appendChild(ui);
  return root;
}
