/**
 * Trim the LENGTH of a recorded clip.
 *
 * Two range sliders (Start / End) + a highlighted span over the video player.
 * Moving a slider scrubs the preview so you can see where you're cutting.
 * Everything is kept in seconds internally and reported as 0-1 fractions so the
 * frame extractor can sample only the kept part.
 */
export function createTrimmer({ video, startInput, endInput, fill, onChange }) {
  let duration = 0;
  let start = 0; // seconds
  let end = 0;   // seconds

  const minSpan = () => Math.min(1, duration);
  const toSec = (pct) => (Number(pct) / 100) * duration;
  const toPct = (sec) => (duration ? (sec / duration) * 100 : 0);

  function scrub(t) {
    try { video.currentTime = Math.max(0, Math.min(duration, t)); } catch { /* ignore */ }
  }

  function paint() {
    fill.style.left = `${toPct(start)}%`;
    fill.style.width = `${Math.max(0, toPct(end) - toPct(start))}%`;
    onChange?.({ start, end, duration });
  }

  function syncInputs() {
    startInput.value = String(toPct(start));
    endInput.value = String(toPct(end));
  }

  function onStart() {
    start = Math.min(Math.max(0, toSec(startInput.value)), Math.max(0, end - minSpan()));
    syncInputs();
    paint();
    scrub(start);
  }

  function onEnd() {
    end = Math.max(Math.min(duration, toSec(endInput.value)), Math.min(duration, start + minSpan()));
    syncInputs();
    paint();
    scrub(end);
  }

  startInput.addEventListener('input', onStart);
  endInput.addEventListener('input', onEnd);

  return {
    /** Call once the clip's duration is known. Defaults to the first 30s. */
    load(seconds) {
      duration = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
      start = 0;
      end = duration ? Math.min(duration, 30) : 0;
      syncInputs();
      paint();
    },
    /**
     * The kept span, as fractions of the whole clip (what the canvas paths
     * want) and as seconds (what the server wants). Handing the fractions to
     * the server read "0.0s to 1.0s" for every clip, so eight frames were taken
     * out of the first second of the turn instead of across it — one angle,
     * eight times.
     */
    getSpan() {
      if (!duration) return { from: 0, to: 1, fromSec: 0, toSec: 0, duration: 0 };
      return { from: start / duration, to: end / duration, fromSec: start, toSec: end, duration };
    },
  };
}
