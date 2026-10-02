/** What cleanup steps threw so far: the first error, and the later ones suppressed behind it. */
export interface Caught {
  /** The first error, which surfaces. */
  readonly first: unknown;

  /** The later errors, newest outermost (`SuppressedError` chains); `NONE` while only the first threw. */
  later: unknown;
}

/** No later error. */
const NONE: unique symbol = Symbol('none');

/** The message of the error that carries more than one cleanup failure. */
const MESSAGE = 'Unit system: a cleanup step threw after another; `error` is the first, `suppressed` the later ones.';

/**
 * Keeps an error a cleanup step threw, every step running on: the first is kept as it is, each later one joins the
 * suppressed chain. Returns what was caught, made at the first error (a cleanup that throws nothing makes nothing).
 */
export const caught = (before: Caught | undefined, error: unknown): Caught => {
  if (before === undefined) {
    return { first: error, later: NONE };
  }

  before.later = before.later === NONE ? error : new SuppressedError(error, before.later, MESSAGE);

  return before;
};

/**
 * Throws what cleanup steps threw, if anything: the one error as it is, or a `SuppressedError` whose `error` is the
 * first and whose `suppressed` holds the later ones (the newest outermost).
 */
export const rethrow = (errors: Caught | undefined): void => {
  if (errors === undefined) {
    return;
  }

  throw errors.later === NONE ? errors.first : new SuppressedError(errors.first, errors.later, MESSAGE);
};
