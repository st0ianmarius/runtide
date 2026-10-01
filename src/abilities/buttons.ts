import type { AuraId, AuraSystem, AuraTagId } from '../auras/index.ts';
import { toId } from '../core/ids.ts';
import { ownValue } from '../core/records.ts';
import { type ButtonActivation, isButton, type SpellId, type SpellSystem } from '../spells/index.ts';
import type { AbilityTypes } from './ability-types.ts';

/**
 * A button spell's activation, resolved against the aura table when the ability system is built: tags and auras as
 * ids, so firing reads no names.
 */
export interface CompiledButton<G extends AbilityTypes> {
  /** The activation data, for its motion hooks. */
  readonly def: ButtonActivation<G>;

  /** Whether a press commits only once its cast is admitted (`commitsOn: 'cast'`). */
  readonly commitsOnCast: boolean;

  /** The aura its cost spends, or −1 for none. */
  readonly costAura: number;

  /** The stacks its cost spends. */
  readonly costStacks: number;

  /** The tags the caster must hold. */
  readonly requires: readonly AuraTagId[];

  /** The tags the caster may not hold. */
  readonly blockedBy: readonly AuraTagId[];

  /** The tags whose auras it removes. */
  readonly resets: readonly AuraTagId[];

  /** The tags whose auras it removes before it lands its own. */
  readonly clears: readonly AuraTagId[];

  /** The aura it toggles off when held, or −1 for none. */
  readonly toggle: number;

  /** The auras it lands, in order. */
  readonly applies: readonly AuraId[];
}

/** What compiling one spell's button reads: the aura table, and the spell for messages. */
interface Compiling<G extends AbilityTypes> {
  readonly auras: AuraSystem<G>;
  readonly what: string;
}

/** A tag's id from its name, or a clear error naming the spell. */
const tagOf = <G extends AbilityTypes>(state: Compiling<G>, name: G['tag']): AuraTagId => {
  const ids: Readonly<Record<string, AuraTagId | undefined>> = state.auras.tags.id;
  const id = ownValue(ids, name);

  if (id === undefined) {
    throw new RangeError(`${state.what}: there is no aura tag named ${name}.`);
  }

  return id;
};

/** The tag ids of a list of names. */
const tagsOf = <G extends AbilityTypes>(state: Compiling<G>, names: readonly G['tag'][] | undefined): AuraTagId[] =>
  (names ?? []).map((name) => tagOf(state, name));

/** Throws unless an aura id names a live aura. */
const checkAura = <G extends AbilityTypes>(state: Compiling<G>, aura: string | AuraId): AuraId =>
  liveAura(state.auras.registry, aura, state.what);

/** An aura reference (its name, or its id) as a live aura's id, or a clear error naming what refers to it. */
const liveAura = (
  registry: {
    readonly id: Readonly<Record<string, AuraId | undefined>>;
    readonly size: number;
    readonly isRetired: (id: AuraId) => boolean;
  },
  aura: string | AuraId,
  what: string
): AuraId => {
  const id = typeof aura === 'string' ? ownValue(registry.id, aura) : aura;

  if (id === undefined || !Number.isInteger(id) || id < 0 || id >= registry.size || registry.isRetired(id)) {
    throw new RangeError(`${what}: ${aura} is not a live aura.`);
  }

  return id;
};

/** Compiles one button spell's activation. */
const compileButton = <G extends AbilityTypes>(state: Compiling<G>, def: ButtonActivation<G>): CompiledButton<G> => {
  const { cost } = def;

  return Object.freeze({
    def,
    commitsOnCast: def.commitsOn === 'cast',
    costAura: cost === undefined ? -1 : checkAura(state, cost.aura),
    costStacks: cost?.stacks ?? 1,
    requires: Object.freeze(tagsOf(state, def.requires)),
    blockedBy: Object.freeze(tagsOf(state, def.blockedBy)),
    resets: Object.freeze(tagsOf(state, def.resets)),
    clears: Object.freeze(tagsOf(state, def.clears)),
    toggle: def.toggle === undefined ? -1 : checkAura(state, def.toggle),
    applies: Object.freeze((def.applies ?? []).map((aura) => checkAura(state, aura)))
  });
};

/**
 * Compiles every button spell of a registry, by spell id (`undefined` for any other spell or a
 * retired one), checked at load: every tag and aura it names must exist.
 */
export const compileButtons = <G extends AbilityTypes>(
  spells: SpellSystem<G>,
  auras: AuraSystem<G>
): readonly (CompiledButton<G> | undefined)[] =>
  Array.from({ length: spells.registry.size }, (_unused, index) => {
    const { registry } = spells;
    const id: SpellId = toId<'spells'>(index);

    if (registry.isRetired(id)) {
      return undefined;
    }

    const { activation } = registry.get(id);
    const state = { auras, what: `spell ${registry.name(id)}` };

    return isButton<G>(activation) ? compileButton(state, activation) : undefined;
  });
