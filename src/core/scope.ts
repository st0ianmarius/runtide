/**
 * A captured scope: who owns what is emitted, what hits are credited to, and whether the world is acting. The spell
 * system captures one at a cast and restores it when a delayed proc lands (§II.3.10).
 */
export interface ScopeFrame<Owner, Source> {
  /** The unit that owns what is emitted and whose stats apply. */
  readonly owner: Owner;

  /** What hits dealt now are credited to (a damage source id). */
  readonly source: Source;

  /** Whether the world is acting: what is emitted belongs to nobody. */
  readonly isWorld: boolean;
}

/**
 * The owner, damage source and world context of the simulation (§II.3.10). Every wrap is re-entrant (it restores what
 * it replaced, even when the wrapped function throws) and idempotent (re-entering the scope already in force changes
 * nothing and costs no save and restore).
 */
export interface Scope<Owner, Source> {
  /** The current owner. */
  readonly owner: Owner;

  /** The current damage source. */
  readonly source: Source;

  /** Whether a world scope is open. */
  readonly isWorld: boolean;

  /** The owner stamped on what is emitted now: the owner, or `undefined` inside a world scope. */
  readonly eventOwner: Owner | undefined;

  /** Runs `fn` as `owner`, lifting a world scope for its call, and returns its result. */
  readonly withOwner: <Result>(owner: Owner, fn: () => Result) => Result;

  /** Runs `fn` with hits credited to `source`, and returns its result. */
  readonly withSource: <Result>(source: Source, fn: () => Result) => Result;

  /** Runs `fn` as the world: what it emits belongs to nobody, until a `withOwner` inside it. */
  readonly asWorld: <Result>(fn: () => Result) => Result;

  /** The scope in force now, as a frame to restore later. */
  readonly capture: () => ScopeFrame<Owner, Source>;

  /** Runs `fn` inside a captured frame (owner, source and world together), and returns its result. */
  readonly within: <Result>(frame: ScopeFrame<Owner, Source>, fn: () => Result) => Result;
}

/** Creates a scope with its starting owner and source, outside any world scope. */
export const createScope = <Owner, Source>(
  initial: Pick<ScopeFrame<Owner, Source>, 'owner' | 'source'>,
): Scope<Owner, Source> => {
  let { owner, source } = initial;
  let isWorld = false;

  const within = <Result>(frame: ScopeFrame<Owner, Source>, fn: () => Result): Result => {
    if (frame.owner === owner && frame.source === source && frame.isWorld === isWorld) {
      return fn();
    }

    const saved = { owner, source, isWorld };

    ({ owner, source, isWorld } = frame);

    try {
      return fn();
    } finally {
      ({ owner, source, isWorld } = saved);
    }
  };

  return {
    get owner() {
      return owner;
    },

    get source() {
      return source;
    },

    get isWorld() {
      return isWorld;
    },

    get eventOwner() {
      return isWorld ? undefined : owner;
    },

    withOwner: (next, fn) => (next === owner && !isWorld ? fn() : within({ owner: next, source, isWorld: false }, fn)),
    withSource: (next, fn) => (next === source ? fn() : within({ owner, source: next, isWorld }, fn)),
    asWorld: (fn) => (isWorld ? fn() : within({ owner, source, isWorld: true }, fn)),
    capture: () => ({ owner, source, isWorld }),
    within,
  };
};
