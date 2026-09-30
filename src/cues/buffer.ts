import type { CueRegistry, CueTable } from './define-cues.ts';
import { type CueEvent, CueRecord } from './event.ts';
import type { CueId } from './ids.ts';

/**
 * A tick's cue events, in firing order: what the simulation emits into and the encoder reads. Its
 * events are pooled: `clear` keeps every record for the next tick, so a steady-state tick allocates none (`created`
 * counts them). A server clears it once the tick's events are encoded; a client decodes into one of its own.
 */
export interface CueBuffer<Table extends CueTable = CueTable> {
  /** The cue registry its events belong to. */
  readonly registry: CueRegistry<Table>;

  /** How many events it holds: `events[0]` to `events[count - 1]`, in firing order. */
  readonly count: number;

  /** How many event records it has ever made. */
  readonly created: number;

  /** Its events, valid up to `count`; the records past it are kept for reuse. */
  readonly events: readonly CueEvent[];

  /**
   * Appends an event of a cue and returns it, fresh: nobody's (`NO_ENTITY`), at the origin, no key, every param at its
   * default. The caller writes its placement and params into it (`fireCue` does both from a spec). Throws for an id
   * outside the registry or retired.
   */
  readonly emit: (cue: CueId) => CueEvent;

  /** Forgets every event, keeping the records. */
  readonly clear: () => void;
}

/** A cue buffer's state: a class for fast properties, its functions arrow fields so they work detached. */
class CueEvents<Table extends CueTable> implements CueBuffer<Table> {
  readonly registry: CueRegistry<Table>;
  readonly #records: CueRecord[] = [];
  #count = 0;

  constructor(registry: CueRegistry<Table>) {
    this.registry = registry;
  }

  get count(): number {
    return this.#count;
  }

  get created(): number {
    return this.#records.length;
  }

  get events(): readonly CueEvent[] {
    return this.#records;
  }

  readonly emit = (cue: CueId): CueEvent => {
    const schema = this.registry.schemas[cue];

    if (schema === undefined) {
      throw new RangeError(`Cue ${cue} is not a live cue id.`);
    }

    const record = this.#records[this.#count] ?? new CueRecord(cue, this.registry.slots);

    this.#records[this.#count] = record;
    this.#count += 1;
    record.reset(cue, schema);

    return record;
  };

  readonly clear = (): void => {
    this.#count = 0;
  };
}

/** Creates an empty cue buffer over a cue registry. */
export const createCueBuffer = <Table extends CueTable>(registry: CueRegistry<Table>): CueBuffer<Table> =>
  new CueEvents(registry);
