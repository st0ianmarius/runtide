import type { EventKind } from '../core/index.ts';
import type { ProcBus } from '../procs/index.ts';
import type { TriggerEvent, TriggerTypes } from '../triggers/index.ts';
import type { AreaTriggerContext, EndReason } from './area-def.ts';
import type { AreaTriggerTypes } from './area-types.ts';
import type { AreaTriggerRegistry } from './define-area-triggers.ts';

/**
 * The payload of an area trigger event (§II.3.7): the area trigger, and why it ended for an end. Reused between
 * raises, so a listener reads it while it runs and never keeps it.
 */
export interface AreaTriggerEvent<G extends AreaTriggerTypes> {
  /** The area trigger; set on every raise. */
  areaTrigger: AreaTriggerContext<G> | undefined;

  /** Why it ended, for an end; `undefined` otherwise. */
  reason: EndReason<G> | undefined;
}

/** Makes an empty area trigger event payload: the factory a game registers its area trigger events on its bus with. */
export const createAreaTriggerEvent = <G extends AreaTriggerTypes>(): AreaTriggerEvent<G> => ({
  areaTrigger: undefined,
  reason: undefined,
});

/**
 * The bus and the event kinds the area trigger system raises (§II.3.7: `areaTriggerSpawned`, and `areaTriggerExpired`
 * widened to every end), which a game maps its trigger events onto. Each is optional, and raised only when something
 * hears it.
 */
export interface AreaTriggerEvents<G extends AreaTriggerTypes> {
  /** The bus. */
  readonly bus: ProcBus;

  /** An area trigger spawned, after its `init`. */
  readonly spawned?: EventKind<AreaTriggerEvent<G>>;

  /** An area trigger ended, whatever the reason, after `onEnd` and after its owner aura came off. */
  readonly ended?: EventKind<AreaTriggerEvent<G>>;
}

/** The framework's end reasons, in code order; an area trigger registry's `endReasons` add the game's after them. */
export const END_REASONS: readonly EndReason[] = Object.freeze([
  'expired',
  'spent',
  'self',
  'bound',
  'replaced',
  'source-gone',
]);

/** Resolves a name to its code in a list or a table, throwing for an unknown one. */
const codeIn =
  (ids: Readonly<Record<string, number | undefined>>, what: string) =>
  (name: string): number => {
    const id = ids[name];

    if (id === undefined) {
      throw new RangeError(`unknown ${what} ${name}.`);
    }

    return id;
  };

/**
 * An area trigger event kind as a trigger event (§II.3.7): about the area trigger's owner, with the filters `kind` (an
 * area trigger kind, by name or id), `tag` (an area trigger tag, by name or id) and `reason` (by name, for an end). An
 * aura answers every pool its bearer leaves ("when a Tempest dissipates, cast Chain Lightning from its eye").
 */
export const areaTriggerEvent = <G extends AreaTriggerTypes & TriggerTypes>(
  kind: EventKind<AreaTriggerEvent<G>>,
  registry: AreaTriggerRegistry<G>,
): TriggerEvent<G> =>
  Object.freeze({
    kind,
    unit: (event: AreaTriggerEvent<G>) => event.areaTrigger?.owner,

    filters: Object.freeze({
      kind: {
        test: (event: AreaTriggerEvent<G>, id: number) => event.areaTrigger?.kind === id,
        resolve: codeIn(registry.id, 'area trigger kind'),
      },

      tag: {
        test: (event: AreaTriggerEvent<G>, tag: number) =>
          event.areaTrigger !== undefined && registry.tagSets[event.areaTrigger.kind]?.has(tag) === true,

        resolve: codeIn(registry.tags.id, 'area trigger tag'),
      },

      reason: {
        test: (event: AreaTriggerEvent<G>, code: number) => event.reason === registry.endReasons[code],
        resolve: codeIn(registry.reasonCodes, 'end reason'),
      },
    }),
  });
