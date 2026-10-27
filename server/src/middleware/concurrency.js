/**
 * A hard cap on how many requests of one kind may be in flight at once.
 *
 * Rate limits count *requests*; they do nothing about twenty different
 * addresses arriving together, and an upload route holds memory and CPU until
 * its body is parsed. This is the second half of the pair: the limit is
 * per-address, this is per-process. It sits before multer so a rejected request
 * never reaches the disk.
 *
 * `release` is bound to both finish and close, because a client that hangs up
 * mid-upload fires close without finish; a slot that is only released on finish
 * would leak until the process restarts.
 */
export function capConcurrency(limit, message = 'Busy — try again in a moment.') {
  const max = Math.max(1, Number(limit) || 1);
  let inFlight = 0;
  return function cap(_req, res, next) {
    if (inFlight >= max) {
      res.set('Retry-After', '30');
      return res.status(503).json({ error: message });
    }
    inFlight += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      inFlight -= 1;
    };
    res.on('finish', release);
    res.on('close', release);
    next();
  };
}
