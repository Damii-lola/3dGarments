/**
 * What a garment's size chart can have a column for, and what this app can read.
 *
 * A column is one number per size: the finished garment's own measurement.
 *
 * Only the seven things below come off a clip with a tape, a width or the head
 * ruler, so only those can decide which size to buy. Everything else a shop
 * prints — body length, sleeve from centre back, cuff opening — is welcome in
 * the chart and is shown to the shopper beside the row they were given, but it
 * is never compared with a body: that would be holding a number this app did not
 * read against a number it did, and calling the result a fit.
 *
 * One list, imported by the browser and the server, because a picker that offered
 * a measurement the engine cannot produce would be a picker that lies.
 */
export const MEASURES = [
  { id: 'chest', label: 'Chest or bust' },
  { id: 'waist', label: 'Waist' },
  { id: 'hips', label: 'Hips or seat' },
  { id: 'shoulder', label: 'Shoulder width' },
  { id: 'neck', label: 'Neck' },
  { id: 'arm', label: 'Upper arm' },
  { id: 'height', label: 'Height' },
];

const BY_ID = new Map(MEASURES.map((m) => [m.id, m]));

/**
 * The field on the measured body a chart column is compared with.
 *
 * `bust` is the older spelling of the same torso tape the engine reports as
 * `chest`: a chart typed with a bust column and one typed with a chest column
 * are asking about the same measurement. Null means "not a measurement this app
 * reads", which makes the column informational — carried and shown, never scored.
 */
export function measureField(id) {
  if (id === 'bust') return 'chest';
  return BY_ID.has(id) ? id : null;
}
