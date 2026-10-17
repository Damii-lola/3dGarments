/**
 * Mark something of a known size on one frame, so the scale stops being an
 * estimate.
 *
 * The head ruler is the weakest link in the whole pipeline: every centimetre is
 * derived from an assumed 23.5 cm head, so a 4% error in the head moves every
 * measurement by 4%. A bank card held flat against the chest, marked by the
 * user, gives the scale directly and at the plane the widths are read from —
 * and the server weights it above the head, because someone who knows how big
 * the thing in their hand is beats a population average.
 *
 * A mark belongs to the frame it was made on and no other: the camera moves
 * during a turn, so a scale that was right a moment ago is not right now. That
 * is why the time goes up with it.
 */

/** The things worth marking, and how much a marked one can be trusted. */
const OBJECTS = {
  card: { what: 'a bank card', cm: 8.56, reliability: 0.85 },
  a4short: { what: 'an A4 sheet, short edge', cm: 21.0, reliability: 0.85 },
  a4long: { what: 'an A4 sheet, long edge', cm: 29.7, reliability: 0.85 },
  ruler: { what: 'a 30 cm ruler', cm: 30, reliability: 0.85 },
  door: { what: 'a standard door', cm: 203, reliability: 0.6 },
};

export function createCalibrator({ video, canvas, dotA, dotB, select, timeInput, stage, note, onChange }) {
  let marks = { a: { x: 0.3, y: 0.5 }, b: { x: 0.7, y: 0.5 } };
  let duration = 0;
  let aspect = 0.75;

  const chosen = () => OBJECTS[select.value] || null;

  function drawFrame() {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;
    if (canvas.width !== vw || canvas.height !== vh) {
      canvas.width = vw;
      canvas.height = vh;
    }
    aspect = vw / vh;
    canvas.getContext('2d').drawImage(video, 0, 0, vw, vh);
  }

  /** Publish the mark, or say what is missing. */
  function place() {
    dotA.style.left = `${marks.a.x * 100}%`;
    dotA.style.top = `${marks.a.y * 100}%`;
    dotB.style.left = `${marks.b.x * 100}%`;
    dotB.style.top = `${marks.b.y * 100}%`;

    const o = chosen();
    if (!o) {
      note.textContent = '';
      onChange?.(null);
      return;
    }
    // The same arithmetic the server does: across the frame in x, and in y
    // divided by the aspect, so a diagonal mark is measured as it appears.
    const span = Math.hypot(marks.b.x - marks.a.x, (marks.b.y - marks.a.y) / aspect);
    if (!(span > 0.02)) {
      note.textContent = 'Drag the two dots onto the two ends of whatever you are holding.';
      onChange?.(null);
      return;
    }
    const cmPerWidth = o.cm / span;
    if (cmPerWidth < 60 || cmPerWidth > 900) {
      note.textContent = `That would put the frame ${Math.round(cmPerWidth)} cm wide, which puts you nearer or further than any phone held at arm's length. Check the two ends.`;
      onChange?.(null);
      return;
    }
    note.textContent = `${o.what} spans ${(span * 100).toFixed(0)}% of the frame, so the frame is ${Math.round(cmPerWidth)} cm wide there.`;
    onChange?.({
      what: o.what,
      knownCm: o.cm,
      reliability: o.reliability,
      t: (Number(timeInput.value) / 100) * duration,
      a: { x: marks.a.x, y: marks.a.y },
      b: { x: marks.b.x, y: marks.b.y },
    });
  }

  function revealed() {
    const on = !!select.value;
    stage.hidden = !on;
    timeInput.parentElement.hidden = !on;
    if (on) { drawFrame(); place(); } else { note.textContent = ''; onChange?.(null); }
  }

  function drag(el, key) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      const move = (ev) => {
        const r = canvas.getBoundingClientRect();
        if (!r.width || !r.height) return;
        marks[key] = {
          x: Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)),
          y: Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)),
        };
        place();
      };
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
  }

  select.addEventListener('change', revealed);
  timeInput.addEventListener('input', () => {
    try { video.currentTime = (Number(timeInput.value) / 100) * duration; } catch { /* ignore */ }
  });
  // The picture only exists once the seek has landed.
  video.addEventListener('seeked', () => { drawFrame(); place(); });
  drag(dotA, 'a');
  drag(dotB, 'b');

  return {
    /** Call once the clip is loaded. */
    load(seconds) {
      duration = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
      timeInput.value = '0';
      revealed();
    },
    /** Forget the mark — used by Start over. */
    clear() {
      select.value = '';
      revealed();
    },
  };
}
