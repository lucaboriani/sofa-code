// ─── Overlay (sri-yantra.html #phase-label + #ui) ────────────────────────────
// The ॐ phase label (top-center, updated each frame by mount) + the Regenerate
// button. Full mode only. The "Enable Sound" button is NOT ported — the app's
// AudioPrompt replaces it. z-index 6 sits above the room page chrome (z 5).

export function makeOverlay(onRegenerate: () => void): { root: HTMLElement; label: HTMLElement } {
  const root = document.createElement('div');
  root.setAttribute('data-yantra-overlay', '');
  root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:6;';

  const label = document.createElement('div');
  label.textContent = 'ॐ';
  label.style.cssText =
    'position:absolute;top:20px;left:50%;transform:translateX(-50%);' +
    'color:rgba(255,255,255,0.3);font-size:11px;letter-spacing:0.26em;' +
    'text-transform:uppercase;font-family:serif;';

  const regen = document.createElement('button');
  regen.innerHTML = '&#8635; Regenerate';
  regen.style.cssText =
    'position:absolute;bottom:24px;left:50%;transform:translateX(-50%);pointer-events:auto;' +
    'background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.2);' +
    'color:rgba(255,255,255,0.85);padding:9px 24px;border-radius:30px;cursor:pointer;' +
    'font-size:12px;letter-spacing:0.1em;font-family:serif;transition:background 0.2s;';
  regen.addEventListener('mouseenter', () => { regen.style.background = 'rgba(255,255,255,0.16)'; });
  regen.addEventListener('mouseleave', () => { regen.style.background = 'rgba(255,255,255,0.07)'; });
  regen.addEventListener('click', onRegenerate);

  root.appendChild(label);
  root.appendChild(regen);
  return { root, label };
}
