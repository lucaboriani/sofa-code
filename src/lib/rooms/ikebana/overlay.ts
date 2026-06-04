// ─── Overlay (ikebana.html L11-27, 32-33) ───────────────────────────────────

export function makeOverlay(): { root: HTMLElement; hint: HTMLElement } {
  const root = document.createElement('div');
  root.setAttribute('data-ikebana-overlay', '');
  root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2;';

  const kanji = document.createElement('div');
  kanji.textContent = '天　人　地';
  // top moved 36px → 96px to clear the app's back button; rest verbatim
  kanji.style.cssText =
    "position:absolute;top:96px;left:44px;" +
    "font-family:'Hiragino Mincho ProN','Yu Mincho','MS Mincho',serif;" +
    'font-size:12px;letter-spacing:0.35em;color:rgba(210,185,140,0.28);' +
    'writing-mode:vertical-rl;text-orientation:upright;user-select:none;';

  const hint = document.createElement('div');
  hint.textContent = 'doppio tap — nuovo ikebana';
  hint.style.cssText =
    'position:absolute;bottom:28px;left:50%;transform:translateX(-50%);' +
    "font-family:'Hiragino Mincho ProN','Yu Mincho',Georgia,serif;" +
    'font-size:10px;letter-spacing:0.45em;color:rgba(210,185,140,0.18);' +
    'user-select:none;transition:opacity 2s;white-space:nowrap;';

  root.appendChild(kanji);
  root.appendChild(hint);
  return { root, hint };
}
