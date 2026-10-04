/** No error caught yet. */
const NONE: unique symbol = Symbol('none');

/** The message of the error that carries more than one failure of a bulk end. */
const MESSAGE = 'Spell system: a cast threw after another; `error` is the first, `suppressed` the later ones.';

/**
 * What the casts of one bulk end (a caster's casts cancelled, or answering an interrupt) threw so far: the first error,
 * which surfaces, and the later ones suppressed behind it. Each cast runs on whatever the ones before it threw.
 */
export class Thrown {
  /** The first error; `NONE` while nothing threw. */
  #first: unknown = NONE;

  /** The later errors, newest outermost (`SuppressedError` chains); `NONE` while at most one threw. */
  #later: unknown = NONE;

  /** Keeps an error: the first as it is, each later one joined to the suppressed chain. */
  keep(error: unknown): void {
    if (this.#first === NONE) {
      this.#first = error;
    } else {
      this.#later = this.#later === NONE ? error : new SuppressedError(error, this.#later, MESSAGE);
    }
  }

  /**
   * Throws what was kept, if anything: the one error as it is, or a `SuppressedError` whose `error` is the first and
   * whose `suppressed` holds the later ones.
   */
  rethrow(): void {
    if (this.#first === NONE) {
      return;
    }

    throw this.#later === NONE ? this.#first : new SuppressedError(this.#first, this.#later, MESSAGE);
  }
}
