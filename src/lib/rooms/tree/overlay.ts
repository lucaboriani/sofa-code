// ─── Overlay (tree-silhouette.html L11-29) ───────────────────────────────────
// The drawing hint + the "Pulisci" restart button, full mode only.

export function makeOverlay(onRestart: () => void): { root: HTMLElement; hint: HTMLElement } {
  const root = document.createElement('div');
  root.setAttribute('data-tree-overlay', '');
  root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2;';

  const hint = document.createElement('div');
  hint.textContent = 'Disegna la direzione del tronco';
  hint.style.cssText =
    'position:absolute;bottom:40px;left:50%;transform:translateX(-50%);' +
    'color:rgba(255,255,255,.28);font-size:12px;letter-spacing:.35em;' +
    "text-transform:uppercase;font-family:Georgia,serif;transition:opacity 1s;";

  const restart = document.createElement('button');
  restart.innerHTML = '&#8635; Pulisci';
  restart.style.cssText =
    'position:absolute;top:28px;right:32px;background:none;pointer-events:auto;' +
    'border:1px solid rgba(255,255,255,.15);color:rgba(255,255,255,.35);' +
    'font-size:10px;letter-spacing:.25em;text-transform:uppercase;' +
    "padding:8px 18px;cursor:pointer;transition:all .3s;font-family:Georgia,serif;";
  restart.addEventListener('mouseenter', () => {
    restart.style.borderColor = 'rgba(255,255,255,.5)';
    restart.style.color = 'rgba(255,255,255,.8)';
  });
  restart.addEventListener('mouseleave', () => {
    restart.style.borderColor = 'rgba(255,255,255,.15)';
    restart.style.color = 'rgba(255,255,255,.35)';
  });
  restart.addEventListener('click', onRestart);

  root.appendChild(hint);
  root.appendChild(restart);
  return { root, hint };
}
