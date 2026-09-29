import type { AuraId, AuraSystem } from '../auras/index.ts';
import { type ActivationRegistry, CORE_ACTIVATIONS } from './activation.ts';
import { planOf } from './cast-plan.ts';
import type { SpellRegistry } from './define-spells.ts';
import { SpellEngine } from './engine.ts';
import { OPEN_WORLD } from './mirror.ts';
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

/** The most interrupts the spells may name: each pauses by a bit of its own, above the manual pause's. */
const MAX_INTERRUPTS = 30;

/** The pause bit of every interrupt a spell's timeline names, in the order the registry first names them. */
const interruptBitsOf = <G extends SpellTypes>(registry: SpellRegistry<G>): ReadonlyMap<string, number> => {
  const names = new Set(registry.defs.flatMap((def) => Object.keys(def?.timeline?.interrupts ?? {})));

  if (names.size > MAX_INTERRUPTS) {
    throw new RangeError(`The spells name ${names.size} interrupts; at most ${MAX_INTERRUPTS} can pause a cast.`);
  }

  return new Map([...names].map((name, index) => [name, 2 ** (index + 1)]));
};

/** Builds the engine over the options, every table resolved. */
export const engineOf = <G extends SpellTypes>(options: SpellSystemOptions<G>): SpellEngine<G> => {
  const { registry } = options;

  checkCues(options);

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
    plans: registry.defs.map((def) => (def === undefined ? undefined : planOf(def, registry.activations))),
    castAuras: registry.defs.map((def, id) => castAuraOf(options.auras, def, registry.names[id] ?? '')),
    boxes: new StatsBoxes(registry.compiled),
    baseView: baseView(registry.stats),
    interruptBits: interruptBitsOf(registry),
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
