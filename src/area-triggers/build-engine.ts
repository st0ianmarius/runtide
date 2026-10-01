import type { AuraId, AuraSystem } from '../auras/index.ts';
import { ownValue } from '../core/records.ts';
import type { AnyAreaTriggerDef } from './area-def.ts';
import type { AreaTriggerTypes } from './area-types.ts';
import type { AreaTriggerRegistry } from './define-area-triggers.ts';
import { AreaEngine } from './engine.ts';
import { runContact } from './frame.ts';
import type { AreaTriggerSystemOptions } from './system-options.ts';

/** Whether `undefined` is the game's `areaExt`: true exactly when the options could leave `createExt` out. */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters
const isNoExt = <G extends AreaTriggerTypes>(value: undefined): value is undefined & G['areaExt'] =>
  value === undefined;

/** The ext factory: the game's, or `undefined` for a game whose `areaExt` admits it. */
const extFactory = <G extends AreaTriggerTypes>(options: AreaTriggerSystemOptions<G>): (() => G['areaExt']) => {
  const create: (() => G['areaExt']) | undefined = options.createExt;

  return (
    create ??
    ((): G['areaExt'] => {
      const none = undefined;

      if (!isNoExt<G>(none)) {
        throw new TypeError('This area trigger system needs createExt.');
      }

      return none;
    })
  );
};

/** Resolves a kind's owner aura against the aura registry at load: a live aura that lasts while the kind lives. */
const ownerAuraOf = <G extends AreaTriggerTypes>(
  auras: AuraSystem<G>,
  def: AnyAreaTriggerDef<G> | undefined,
  name: string
): AuraId | undefined => {
  const aura = def?.ownerAura;

  if (aura === undefined) {
    return undefined;
  }

  const ids: Readonly<Record<string, AuraId | undefined>> = auras.registry.id;
  const id = typeof aura === 'string' ? ownValue(ids, aura) : aura;

  if (id === undefined || id < 0 || id >= auras.registry.size || auras.registry.isRetired(id)) {
    throw new RangeError(`Area trigger ${name}: its owner aura ${aura} is not a live aura.`);
  }

  if (auras.registry.get(id).duration !== 'infinite') {
    throw new RangeError(
      `Area trigger ${name}: its owner aura lasts while the kind lives, so its duration is 'infinite'.`
    );
  }

  return id;
};

/** Resolves a kind's area auras against the aura registry at load. */
const areaAurasOf = <G extends AreaTriggerTypes>(
  auras: AuraSystem<G>,
  def: AnyAreaTriggerDef<G> | undefined,
  name: string
): readonly AuraId[] | undefined => {
  const ids: Readonly<Record<string, AuraId | undefined>> = auras.registry.id;

  return def?.auras?.map((spec) => {
    const id = typeof spec.aura === 'string' ? ownValue(ids, spec.aura) : spec.aura;

    if (id === undefined || id < 0 || id >= auras.registry.size || auras.registry.isRetired(id)) {
      throw new RangeError(`Area trigger ${name}: its area aura ${spec.aura} is not a live aura.`);
    }

    return id;
  });
};

/** The kinds each slot steps, in kind order; throws for a kind whose slot the game did not declare. */
const slotKindsOf = <G extends AreaTriggerTypes>(
  registry: AreaTriggerRegistry<G>,
  slots: number
): readonly (readonly number[])[] => {
  const kinds: number[][] = Array.from({ length: slots }, () => []);

  for (const id of registry.ids) {
    const slot = registry.columns.slot[id] ?? 0;

    if (slot >= slots) {
      throw new RangeError(`Area trigger ${registry.name(id)}: its tick slot ${slot} is not one of the ${slots}.`);
    }

    kinds[slot]?.push(id);
  }

  return Object.freeze(kinds.map((list) => Object.freeze(list)));
};

/** Checks at load that kinds with cues have a buffer to fire into. */
const checkCues = <G extends AreaTriggerTypes>(options: AreaTriggerSystemOptions<G>): void => {
  const { registry } = options;
  const cued = registry.ids.find((id) => registry.defs[id]?.cues !== undefined);

  if (cued !== undefined && options.cues === undefined) {
    throw new RangeError(`Area trigger ${registry.name(cued)} has cues, so the system needs cues.`);
  }
};

/** Builds the engine over the options, every table resolved. */
export const areaEngineOf = <G extends AreaTriggerTypes>(options: AreaTriggerSystemOptions<G>): AreaEngine<G> => {
  const { registry } = options;

  checkCues(options);

  const engine = new AreaEngine<G>({
    registry,
    spells: options.spells,
    auras: options.auras,
    procs: options.procs,
    world: options.world,
    clock: options.clock,
    host: options.host,
    random: options.random,
    streams: options.streams,
    events: options.events,
    cues: options.cues,
    ownerAuras: registry.defs.map((def, id) => ownerAuraOf(options.auras, def, registry.names[id] ?? '')),
    slotKinds: slotKindsOf(registry, options.slots?.size ?? 1),
    areaAuras: registry.defs.map((def, id) => areaAurasOf(options.auras, def, registry.names[id] ?? '')),
    createExt: extFactory(options),
    resetExt: options.resetExt
  });

  engine.contactAlong = (area) => {
    runContact(engine, area);
  };

  return engine;
};
