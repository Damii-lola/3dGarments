/**
 * Which of the engine's notes reach the screen.
 *
 * The catalogue is the whole answer, so the running commentary the engine also
 * produces is mostly not shown: a lot of it is written for whoever reads the
 * API, not for the person looking at their own waistline. Some of it is kept,
 * because it says which number was too ambiguous to give.
 *
 * What is never shown is capture coaching. The clip is already recorded by the
 * time this list is on screen, so a line telling somebody how to stand next time
 * cannot be acted on — it is the app telling them off for a take they cannot
 * change, and the missing row already says the same thing without the scolding.
 *
 * That distinction is the whole reason this is a list of patterns rather than a
 * list of phrases. A pattern like /in shot/ would also swallow "your feet were
 * not in shot, so nothing that needs the floor could be read", which is the
 * disclosure, and the point of showing notes at all. So the patterns below match
 * imperatives — a verb telling the viewer to do something — and leave the half
 * of the sentence that reports back alone.
 */
export const HIDDEN_NOTES = [
  // Written for the API reader.
  /^read against the /i,
  /^clothing\b/i,
  /subtracted from the body estimate/i,
  /^depth came from/i,
  /measurement sheet/i,

  // Capture coaching: the instruction, never the finding.
  /\b(film|record|shoot) (again|it|from|sooner|closer|further)\b/i,
  /\btry again\b/i,
  /\bnext time\b/i,
  /\b(keep|hold) (your |the )?(whole |entire )?(body|person|head|arms?|feet|legs)\b[^.]*\bin (shot|frame|view)\b/i,
  /\bkeep still\b/i,
  /\bstand (still|straight|facing)\b/i,
  /\bturn (slowly|more slowly)\b/i,
  /\ba slower turn\b/i,
  /\bstep (back|closer|further)\b/i,
  /\bhold (them|your arms?|the arms?)\b[^.]*\bclear\b/i,

  // The phrasing the on-device measurement pass used to emit, which is written
  // by the browser and arrives inside the payload rather than from this file.
  /a little clear|truest numbers|pause at the side/i,
];

/** True when a note is fit to show. */
export function showNote(note) {
  return !HIDDEN_NOTES.some((re) => re.test(note));
}
