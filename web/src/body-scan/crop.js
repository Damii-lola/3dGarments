/**
 * A small crop picker. Shows one frame of the video and lets the user drag a
 * rectangle over their body (plus corner handles to resize). The rectangle is
 * reported in normalised 0-1 coordinates so it can be applied to every frame.
 *
 * Pointer events cover mouse, pen and touch in one code path.
 */

const MIN = 0.12; // smallest crop, as a fraction of the frame
const DEFAULT = { x: 0.08, y: 0.02, w: 0.84, h: 0.96 };

const clamp01 = (v) => Math.min(1, Math.max(0, v));

export function createCropper({ stage, box }) {
  let rect = { ...DEFAULT };
  let drag = null;

  function render() {
    box.style.left = `${rect.x * 100}%`;
    box.style.top = `${rect.y * 100}%`;
    box.style.width = `${rect.w * 100}%`;
    box.style.height = `${rect.h * 100}%`;
  }

  function pointFromEvent(e) {
    const r = stage.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  }

  function onDown(e) {
    const handle = e.target.dataset?.handle || (e.target === box ? 'move' : null);
    if (!handle) return;
    e.preventDefault();
    try { box.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    drag = { handle, start: pointFromEvent(e), base: { ...rect } };
  }

  function onMove(e) {
    if (!drag) return;
    const p = pointFromEvent(e);
    const dx = p.x - drag.start.x;
    const dy = p.y - drag.start.y;
    const b = drag.base;
    let { x, y, w, h } = b;

    if (drag.handle === 'move') {
      x = Math.min(clamp01(b.x + dx), 1 - w);
      y = Math.min(clamp01(b.y + dy), 1 - h);
    } else {
      let left = b.x;
      let top = b.y;
      let right = b.x + b.w;
      let bottom = b.y + b.h;
      if (drag.handle.includes('w')) left = clamp01(b.x + dx);
      if (drag.handle.includes('e')) right = clamp01(b.x + b.w + dx);
      if (drag.handle.includes('n')) top = clamp01(b.y + dy);
      if (drag.handle.includes('s')) bottom = clamp01(b.y + b.h + dy);

      if (right - left < MIN) {
        if (drag.handle.includes('w')) left = right - MIN; else right = left + MIN;
      }
      if (bottom - top < MIN) {
        if (drag.handle.includes('n')) top = bottom - MIN; else bottom = top + MIN;
      }
      x = left;
      y = top;
      w = right - left;
      h = bottom - top;
    }

    rect = { x, y, w, h };
    render();
  }

  function onUp(e) {
    if (!drag) return;
    try { box.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    drag = null;
  }

  box.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);

  render();

  return {
    getRect: () => ({ ...rect }),
    isDefault: () => (
      Math.abs(rect.x - DEFAULT.x) < 0.01 &&
      Math.abs(rect.y - DEFAULT.y) < 0.01 &&
      Math.abs(rect.w - DEFAULT.w) < 0.01 &&
      Math.abs(rect.h - DEFAULT.h) < 0.01
    ),
    reset() {
      rect = { ...DEFAULT };
      render();
    },
  };
}
