// Hot path (§I.4.2, §I.5.4): the fold reads stacks through here, so the loops are indexed.
/* oxlint-disable typescript/prefer-for-of */
import { type Bitset, createBitset } from '../core/index.ts';
import type { ActiveAura, AuraItem } from './active-aura.ts';
import type { AuraTypes } from './aura-types.ts';

/**
 * What an aura bearer's aura state holds (§I.5.4): its auras in a small inline list sorted by aura id (registry
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
  changes = 0;
  readonly #activeWhile: readonly (((bearer: G['bearer']) => boolean) | undefined)[];

  constructor(
    clocks: number,
    options: {
      readonly isSilent: boolean;
      readonly activeWhile: readonly (((bearer: G['bearer']) => boolean) | undefined)[];
    },
  ) {
    this.clocks = new Float64Array(clocks);
    this.isSilent = options.isSilent;
    this.#activeWhile = options.activeWhile;
  }

  get list(): readonly ActiveAura[] {
    return this.items;
  }

  /** The stacks of `id` summed over its instances, or 0 while its `activeWhile` says its modifiers do not count. */
  stacksFor(bearer: G['bearer'], id: number): number {
    const items = this.items;
    let stacks = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      if (item?.id === id) {
        stacks += item.stacks;
      }
    }

    const activeWhile = stacks > 0 ? this.#activeWhile[id] : undefined;

    return activeWhile === undefined || activeWhile(bearer) ? stacks : 0;
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
 * The stacks a bearer holds of an aura, summed over its instances, or 0 while the aura's `activeWhile` says its
 * modifiers do not count: the stacks report a modifier system reads its aura gates through
 * (`createModifierSystem({ …, stacks: auraStacks })`), so an aura's modifiers count exactly while it is held.
 */
export const auraStacks = (bearer: AuraBearer, gate: number): number =>
  setOf<AuraTypes>(bearer).stacksFor(bearer, gate);

/**
 * The auras a bearer holds, in registry order: the held report a modifier system walks its aura gates through
 * (`createModifierSystem({ …, stacks: auraStacks, held: auraGates })`), so a stat read costs what the bearer holds,
 * not what the registry defines.
 */
export const auraGates = (bearer: AuraBearer): readonly ActiveAura[] => setOf<AuraTypes>(bearer).items;
