/**
 * Exact checks for the note filter.
 *
 * The rule this pins down: a note may report what the clip could not show, and
 * may never tell the viewer how to stand. Both halves live in the same sentence
 * often enough ("your feet were not in shot, so nothing that needs the floor
 * could be read. Keep your whole body in frame.") that the filter has to be
 * judged on the two lists below rather than on taste.
 *
 * Run: node scripts/notes-check.mjs
 */
import { HIDDEN_NOTES, showNote } from '../src/body-scan/notes.js';

let passed = 0;
const failures = [];

function check(name, got, want) {
  if (Object.is(got, want)) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}  got ${got}  want ${want}`);
  }
}

/** Every note the engine writes today, plus the ones the browser writes. */
const INFORMATIONAL = [
  'Your arms were not clear of your sides in any frame, so the tape could not pass around your body.',
  'Your arm was not held clear of your body in any frame, so no tape could be taken around a limb.',
  'One reading came out impossible for a human body in every frame that showed it, so it was left out rather than guessed.',
  'A girth read outside the plausible range and has been clamped - treat it as the least reliable number here.',
  'Your feet were not in shot, so nothing that needs the floor could be read.',
  'Your proportions read as an unusual head-to-body ratio, so the scale was corrected by 8%.',
  'You did not say who this video was for, so the size was picked from the body proportions alone.',
  'Size S chest/bust may be snug.',
  'Size M is read from your front width alone, across 9 frames - no frame turned far enough to show body depth - so it could sit one size either way.',
  'No size was given: this clip did not show a straight-on front view with the arms clear of the sides.',
  'Only 4 usable frames came out of the video.',
  'Your height read 3 in apart between frames, so it is the least certain number here.',
  'The frames turned far enough to show body depth (1 in profile, 5 at three-quarter) were averaged in, so the depth is measured rather than assumed.',
];

/** Coaching, as it was written before this filter existed. */
const COACHING = [
  'Your feet were not in shot, so nothing that needs the floor could be read. Keep your whole body in frame.',
  'Your arms were not clear of your sides in any frame — hold them a little clear for the truest numbers.',
  'The frames came out of the video. — a slower turn gives a steadier estimate.',
  'Your height read 3 in apart between frames — film from further back so a bad frame cannot drag it.',
  'Your proportions read as an unusual head-to-body ratio, so the scale was corrected by 8%. — stand straight while it does.',
  'This clip did not show a clean profile, so the depth was modelled rather than measured. Turn slowly through a full profile.',
  'Some of your girths were modelled from the survey rather than measured. — stand straight.',
  'Keep your whole body in frame and turn slowly.',
  'Hold your arms clear of your sides.',
  'Step back until your whole body is in the frame.',
  'Try again with more light.',
  'Stand facing the camera.',
];

console.log('\n== the note filter ==');
check('a note filter exists', HIDDEN_NOTES.length > 0, true);
for (const note of INFORMATIONAL) {
  check(`shown: ${note.slice(0, 60)}...`, showNote(note), true);
}
for (const note of COACHING) {
  check(`hidden: ${note.slice(0, 60)}...`, showNote(note), false);
}
check('the bare feet note survives the belt that ate it before', showNote('Your feet were not in shot, so nothing that needs the floor could be read.'), true);

console.log(`\n${failures.length ? `FAILURES - ${passed} passed, ${failures.length} failed` : `ALL GOOD - ${passed} passed, 0 failed`}`);
process.exit(failures.length ? 1 : 0);
