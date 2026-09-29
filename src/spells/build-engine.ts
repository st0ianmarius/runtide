import type { AuraId, AuraSystem } from '../auras/index.ts';
import { type ActivationRegistry, CORE_ACTIVATIONS, isAuto } from './activation.ts';
import { type CastPlan, planOf } from './cast-plan.ts';
import type { SpellRegistry } from './define-spells.ts';
import { SpellEngine } from './engine.ts';
import { OPEN_WORLD } from './mirror.ts';
import type { ReachPlan } from './reach.ts';
import type { AnySpellDef } from './spell-def.ts';
import type { SpellTypes } from './spell-types.ts';
import { baseView, StatsBoxes } from './stats-box.ts';
import type { SpellSystemOptions } from './system-options.ts';

/** Whether `undefined` is the game's `castExt`: true exactly when the options could leave `createExt` out. */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters
const isNoExt = <G extends SpellTypes>(value: undefined): value is undefined & G['castExt'] => value === undefined;

/** The ext factory: the game's, or `undefined` for a game whose `castExt` admits it. */
const extFactory = <G extends SpellTypes>(options: SpellSystemOptions<G>): (() => G['castExt']) => {
  const create: (() => G['castExt']) | undefined = options.createExt;

  return (
    create ??
    ((): G['castExt'] => {
      const none = undefined;

      if (!isNoExt<G>(none)) {
        throw new TypeError('This spell system needs createExt.');
      }

      return none;
    })
  );
};

/** Resolves a spell's cast aura against the aura registry at load: a live aura that lasts while the cast runs. */
const castAuraOf = <G extends SpellTypes>(
  auras: AuraSystem<G>,
  def: AnySpellDef<G> | undefined,
  name: string,
): AuraId | undefined => {
  const aura = def?.castAura;

  if (aura === undefined) {
    return undefined;
  }

  const ids: Readonly<Record<string, AuraId | undefined>> = auras.registry.id;
  const id = typeof aura === 'string' ? ids[aura] : aura;

  if (id === undefined || id < 0 || id >= auras.registry.size || auras.registry.isRetired(id)) {
    throw new RangeError(`Spell ${name}: its cast aura ${aura} is not a live aura.`);
  }

  if (auras.registry.get(id).duration !== 'infinite') {
    throw new RangeError(`Spell ${name}: its cast aura lasts while the cast runs, so its duration is 'infinite'.`);
  }

  return id;
};

/** Checks at load that spells with cues have a buffer to fire into and a host that places them. */
const checkCues = <G extends SpellTypes>(options: SpellSystemOptions<G>): void => {
  const { registry } = options;
  const cued = registry.ids.find((id) => registry.defs[id]?.cues !== undefined);

  if (cued !== undefined && (options.cues === undefined || options.host.positionOf === undefined)) {
    throw new RangeError(`Spell ${registry.name(cued)} has cues, so the system needs cues and host.positionOf.`);
  }
};

/** What a spell's reach needs of the system that it lacks, as a sentence; `undefined` when it lacks nothing. */
const reachLack = <G extends SpellTypes>(options: SpellSystemOptions<G>, reach: ReachPlan<G>): string | undefined => {
  const isPlaced = options.host.positionOf !== undefined;

  if ((reach.range !== undefined || reach.sight) && !isPlaced) {
    return 'has a range or needs sight, so the system needs host.positionOf';
  }

  return (reach.sight || reach.clearance > 0) && options.world === undefined
    ? 'tests sight or room, so the system needs a world'
    : undefined;
};

/** Checks at load that spells with reach rules have a host that places casters, and a world when they test it. */
const checkReach = <G extends SpellTypes>(
  options: SpellSystemOptions<G>,
  plans: readonly (CastPlan<G> | undefined)[],
): void => {
  for (const [id, plan] of plans.entries()) {
    const lack = plan?.reach === undefined ? undefined : reachLack(options, plan.reach);

    if (lack !== undefined) {
      throw new RangeError(`Spell ${options.registry.names[id] ?? ''} ${lack}.`);
    }
  }
};

/** The most interrupts a game may have: each pauses by a bit of its own, above the manual pause's. */
const MAX_INTERRUPTS = 30;

/**
 * The bit of every interrupt: those the game declares first, then those a spell's timeline names, in the order the
 * registry first names them.
 */
const interruptBitsOf = <G extends SpellTypes>(
  registry: SpellRegistry<G>,
  declared: readonly string[],
): ReadonlyMap<string, number> => {
  const names = new Set([...declared, ...registry.defs.flatMap((def) => Object.keys(def?.timeline?.interrupts ?? {}))]);

  if (names.size > MAX_INTERRUPTS) {
    throw new RangeError(`The game names ${names.size} interrupts; at most ${MAX_INTERRUPTS} can pause a cast.`);
  }

  return new Map([...names].map((name, index) => [name, 2 ** (index + 1)]));
};

/** 1 for each auto spell whose clock resets after the caster's other casts (§II.6 S3), by spell id. */
const resetsAfterCastOf = <G extends SpellTypes>(registry: SpellRegistry<G>): Uint8Array =>
  Uint8Array.from(registry.defs, (def) =>
    def !== undefined && isAuto(def.activation) && def.activation.afterCast === 'reset' ? 1 : 0,
  );

/** Builds the engine over the options, every table resolved. */
export const engineOf = <G extends SpellTypes>(options: SpellSystemOptions<G>): SpellEngine<G> => {
  const { registry } = options;

  const plans = registry.defs.map((def, id) =>
    def === undefined ? undefined : planOf(def, registry.activations, registry.names[id] ?? ''),
  );

  checkCues(options);
  checkReach(options, plans);

  return new SpellEngine<G>({
    registry,
    auras: options.auras,
    procs: options.procs,
    clock: options.clock,
    host: options.host,
    random: options.random,
    streams: options.streams,
    events: options.events,
    cues: options.cues,
    world: options.world ?? OPEN_WORLD,
    plans,
    castAuras: registry.defs.map((def, id) => castAuraOf(options.auras, def, registry.names[id] ?? '')),
    boxes: new StatsBoxes(registry.compiled),
    baseView: baseView(registry.stats),
    interruptBits: interruptBitsOf(registry, options.interrupts ?? []),
    resetsAfterCast: resetsAfterCastOf(registry),
    slots: options.slots?.size ?? 1,
    createExt: extFactory(options),
    resetExt: options.resetExt,
  });
};

/** The framework's activation kinds, by name. */
const CORE_KINDS: Readonly<Record<string, object | undefined>> = CORE_ACTIVATIONS;

/** The activation kinds that are not the framework's own of that name: the game's (§I.5.6 hatch 2). */
export const gameActivationsOf = <G extends SpellTypes>(activations: ActivationRegistry<G>): readonly string[] =>
  Object.freeze(activations.names.filter((name, id) => CORE_KINDS[name] !== activations.defs[id]));
