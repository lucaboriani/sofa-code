const DEFAULT_DPR_CAP = 2;

export function observeResize(
  canvas: HTMLCanvasElement,
  onResize?: (cssW: number, cssH: number) => void,
  dprCap = DEFAULT_DPR_CAP
): () => void {
  const apply = (): void => {
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    const cssW = canvas.clientWidth || 1;
    const cssH = canvas.clientHeight || 1;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    onResize?.(cssW, cssH);
  };
  apply();
  const ro = new ResizeObserver(apply);
  ro.observe(canvas);
  return () => ro.disconnect();
}
