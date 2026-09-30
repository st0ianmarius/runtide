// Hot path: the fold reads stacks through here, so the loops are indexed.
/* oxlint-disable typescript/prefer-for-of */
import { type Bitset, createBitset } from '../core/index.ts';
import type { ActiveAura, AuraItem } from './active-aura.ts';
import type { AuraTypes } from './aura-types.ts';

/**
 * What an aura bearer's aura state holds: its auras in a small inline list sorted by aura id (registry
 * order, then application order), the tag bitset they grant, a step count per clock, and a change counter. Only its
 * system changes it; everything else reads it.
 */
export interface AuraState {
  /** The active auras, in registry order, then application order among instances of one aura. */
  readonly list: readonly ActiveAura[];

  /** The tags the active auras grant, as a bitset over tag ids. Read it; never change it. */
  readonly tags: Bitset;

  /** How many steps the bearer has taken on each clock, by clock id: what aura stamps count against. */
  readonly clocks: ArrayLike<number>;

  /**
   * Rises on every change to the list (an application, a refresh, a stack or value change, a removal, an expiry):
   * the bearer's dirty flag, which a reader compares with the count it last saw.
   */
  readonly changes: number;

  /** Whether it runs no hooks and raises no events (a preview or a prediction copy of a bearer). */
  readonly isSilent: boolean;

  /**
   * The serials handed out on this bearer so far: an instance of its own (`independent`, `perSource`) takes the next.
   * Counted per bearer, so a prediction mirror seeded with it hands out the serials the server does.
   */
  readonly serials: number;
}

/** Anything auras land on: a unit, or anything else that holds an aura state made by an aura system. */
export interface AuraBearer {
  /** Its auras, made by `auras.createState()` and changed only by that system. */
  readonly auras: AuraState;
}

/** The one aura state implementation. */
export class AuraSet<G extends AuraTypes> implements AuraState {
  readonly items: AuraItem<G>[] = [];
  readonly tags = createBitset();
  readonly clocks: Float64Array;
  readonly isSilent: boolean;

  /**
   * By clock, a count no aura on it runs out before: at or below the earliest end stamp, so a tick whose count is below
   * it has nothing to expire. Lowered as ends are set, made exact again as a tick walks the list.
   */
  readonly due: Float64Array;

  /** By clock, how many of its auras beat on it: a tick of a clock with none and nothing due does nothing. */
  readonly beats: Int32Array;

  /**
   * How many of its auras fall in each of 32 buckets by id (`id & 31`): a bucket at 0 answers "not held" at once, the
   * usual answer for a cooldown asked every press.
   */
  readonly buckets = new Uint16Array(32);

  changes = 0;
  serials = 0;

  constructor(clocks: number, isSilent: boolean) {
    this.clocks = new Float64Array(clocks);
    this.due = new Float64Array(clocks).fill(Number.POSITIVE_INFINITY);
    this.beats = new Int32Array(clocks);
    this.isSilent = isSilent;
  }

  /** Lowers its clock's due count to an aura's end stamp, if that is earlier. */
  noteEnd(item: AuraItem<G>): void {
    if (item.end < (this.due[item.clock] ?? 0)) {
      this.due[item.clock] = item.end;
    }
  }

  /** Whether any clock's count has reached its due count: an aura may have run out. */
  isAnyDue(): boolean {
    const { clocks, due } = this;

    for (let clock = 0; clock < clocks.length; clock++) {
      if ((clocks[clock] ?? 0) >= (due[clock] ?? 0)) {
        return true;
      }
    }

    return false;
  }

  get list(): readonly ActiveAura[] {
    return this.items;
  }

  /** The first instance of `id`, or `undefined`. */
  find(id: number): AuraItem<G> | undefined {
    if (this.buckets[id & 31] === 0) {
      return undefined;
    }

    const items = this.items;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      if (item?.id === id) {
        return item;
      }
    }

    return undefined;
  }

  /** The stacks of `id` summed over its instances. */
  stacksFor(id: number): number {
    if (this.buckets[id & 31] === 0) {
      return 0;
    }

    const items = this.items;
    let stacks = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      if (item?.id === id) {
        stacks += item.stacks;
      }
    }

    return stacks;
  }
}

/** Whether a public state is one of this module's. `G` is named only by the result, as `sheetOf` does. */
const isSet = <G extends AuraTypes>(state: AuraState): state is AuraSet<G> => state instanceof AuraSet;

/** The set behind a bearer's public state, refusing one made elsewhere. */
export const setOf = <G extends AuraTypes>(bearer: AuraBearer): AuraSet<G> => {
  const state = bearer.auras;

  if (!isSet<G>(state)) {
    throw new TypeError('An aura state must come from an aura system (auras.createState()).');
  }

  return state;
};

/**
 * The stacks a bearer holds of an aura, summed over its instances: the stacks report a modifier system reads its aura
 * gates through (`createModifierSystem({ …, stacks: auraStacks })`), so an aura's modifiers count exactly while it is
 * held.
 */
export const auraStacks = (bearer: AuraBearer, gate: number): number => setOf<AuraTypes>(bearer).stacksFor(gate);

/**
 * The auras a bearer holds, in registry order: the held report a modifier system walks its aura gates through
 * (`createModifierSystem({ …, stacks: auraStacks, held: auraGates })`), so a stat read costs what the bearer holds,
 * not what the registry defines.
 */
export const auraGates = (bearer: AuraBearer): readonly ActiveAura[] => setOf<AuraTypes>(bearer).items;
