export class HttpError extends Error {
  /**
   * `expose` marks a message that is safe to show a shopper even on a 5xx. The
   * error handler hides 5xx text in production because it is usually plumbing
   * ("fetch failed"): but "the measuring service has used its daily allowance"
   * is the answer, and hiding it behind "Internal error" sends everyone
   * looking for a bug that is not there.
   */
  constructor(status, message, details, { expose = false } = {}) {
    super(message);
    this.status = status;
    this.details = details;
    this.expose = expose;
  }
}

/** Wrap async route handlers so rejections reach the error middleware. */
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
