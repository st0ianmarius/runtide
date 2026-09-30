import type { AuraId, AuraSystem, AuraTagId } from '../auras/index.ts';
import { type CompiledScaled, compileScaled, type StatTable } from '../modifiers/index.ts';
import {
  type ButtonActivation,
  type ButtonSeconds,
  isButton,
  type SpellId,
  type SpellRegistry,
} from '../spells/index.ts';
import type { AbilityTypes } from './ability-types.ts';

/**
 * A button spell's activation, resolved against the aura and stat tables when the ability system is built: tags as
 * ids, its cooldown compiled, so firing reads no names.
 */
export interface CompiledButton<G extends AbilityTypes> {
  /** The activation data, for its motion hooks. */
  readonly def: ButtonActivation<G>;

  /** Its cooldown: seconds, a compiled scaled value, a function of the caster, or none. */
  readonly cooldown: number | CompiledScaled | ButtonSeconds<G> | undefined;

  /** Whether the cooldown starts only once the cast was not refused (`startsOn: 'cast'`). */
  readonly isCastCooldown: boolean;

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

  /** The auras it lands, in order. */
  readonly applies: readonly AuraId[];
}

/** What compiling one spell's button reads: the tables, and the spell for messages. */
interface Compiling<G extends AbilityTypes> {
  readonly auras: AuraSystem<G>;
  readonly stats: StatTable<G['stat']> | undefined;
  readonly what: string;
}

/** A tag's id from its name, or a clear error naming the spell. */
const tagOf = <G extends AbilityTypes>(state: Compiling<G>, name: G['tag']): AuraTagId => {
  const ids: Readonly<Record<string, AuraTagId | undefined>> = state.auras.tags.id;
  const id = ids[name];

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
export const liveAura = (
  registry: {
    readonly id: Readonly<Record<string, AuraId | undefined>>;
    readonly size: number;
    readonly isRetired: (id: AuraId) => boolean;
  },
  aura: string | AuraId,
  what: string,
): AuraId => {
  const id = typeof aura === 'string' ? registry.id[aura] : aura;

  if (id === undefined || !Number.isInteger(id) || id < 0 || id >= registry.size || registry.isRetired(id)) {
    throw new RangeError(`${what}: ${aura} is not a live aura.`);
  }

  return id;
};

/** A button's cooldown, compiled: a number or function as it is, a scaled value against the stat table. */
const cooldownOf = <G extends AbilityTypes>(
  state: Compiling<G>,
  def: ButtonActivation<G>,
  ranks: number,
): CompiledButton<G>['cooldown'] => {
  const { cooldown } = def;

  if (cooldown === undefined || typeof cooldown === 'number' || typeof cooldown === 'function') {
    return cooldown;
  }

  if (state.stats === undefined) {
    throw new RangeError(`${state.what}: a scaled cooldown needs the spell registry's stat table.`);
  }

  return compileScaled(state.stats, cooldown, { ranks, what: `${state.what}, cooldown`, allowsTarget: false });
};

/** Compiles one button spell's activation. */
const compileButton = <G extends AbilityTypes>(
  state: Compiling<G>,
  def: ButtonActivation<G>,
  ranks: number,
): CompiledButton<G> => {
  const { cost } = def;

  return Object.freeze({
    def,
    cooldown: cooldownOf(state, def, ranks),
    isCastCooldown: def.startsOn === 'cast',
    costAura: cost === undefined ? -1 : checkAura(state, cost.aura),
    costStacks: cost?.stacks ?? 1,
    requires: tagsOf(state, def.requires),
    blockedBy: tagsOf(state, def.blockedBy),
    resets: tagsOf(state, def.resets),
    applies: (def.applies ?? []).map((aura) => checkAura(state, aura)),
  });
};

/**
 * Compiles every button spell of a registry, by spell id (`undefined` for any other spell or a
 * retired one), checked at load: every tag, aura and stat it names must exist, and a scaled cooldown's per-rank lists
 * must match the spell's ranks.
 */
export const compileButtons = <G extends AbilityTypes>(
  registry: SpellRegistry<G>,
  auras: AuraSystem<G>,
): readonly (CompiledButton<G> | undefined)[] =>
  registry.ids.map((id: SpellId) => {
    if (registry.isRetired(id)) {
      return undefined;
    }

    const { activation } = registry.get(id);
    const state = { auras, stats: registry.stats, what: `spell ${registry.name(id)}` };

    return isButton<G>(activation) ? compileButton(state, activation, registry.columns.ranks[id] ?? 1) : undefined;
  });
