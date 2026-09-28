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

/** A scope's state: a class for fast properties, its functions arrow fields so they work detached. */
class ScopeState<Owner, Source> implements Scope<Owner, Source> {
  #owner: Owner;
  #source: Source;
  #isWorld = false;

  constructor(owner: Owner, source: Source) {
    this.#owner = owner;
    this.#source = source;
  }

  get owner(): Owner {
    return this.#owner;
  }

  get source(): Source {
    return this.#source;
  }

  get isWorld(): boolean {
    return this.#isWorld;
  }

  get eventOwner(): Owner | undefined {
    return this.#isWorld ? undefined : this.#owner;
  }

  readonly within = <Result>(frame: ScopeFrame<Owner, Source>, fn: () => Result): Result => {
    const owner = this.#owner;
    const source = this.#source;
    const isWorld = this.#isWorld;

    if (frame.owner === owner && frame.source === source && frame.isWorld === isWorld) {
      return fn();
    }

    this.#owner = frame.owner;
    this.#source = frame.source;
    this.#isWorld = frame.isWorld;

    try {
      return fn();
    } finally {
      this.#owner = owner;
      this.#source = source;
      this.#isWorld = isWorld;
    }
  };

  readonly withOwner = <Result>(next: Owner, fn: () => Result): Result =>
    next === this.#owner && !this.#isWorld
      ? fn()
      : this.within({ owner: next, source: this.#source, isWorld: false }, fn);

  readonly withSource = <Result>(next: Source, fn: () => Result): Result =>
    next === this.#source ? fn() : this.within({ owner: this.#owner, source: next, isWorld: this.#isWorld }, fn);

  readonly asWorld = <Result>(fn: () => Result): Result =>
    this.#isWorld ? fn() : this.within({ owner: this.#owner, source: this.#source, isWorld: true }, fn);

  readonly capture = (): ScopeFrame<Owner, Source> => ({
    owner: this.#owner,
    source: this.#source,
    isWorld: this.#isWorld,
  });
}

/** Creates a scope with its starting owner and source, outside any world scope. */
export const createScope = <Owner, Source>(
  initial: Pick<ScopeFrame<Owner, Source>, 'owner' | 'source'>,
): Scope<Owner, Source> => new ScopeState(initial.owner, initial.source);
