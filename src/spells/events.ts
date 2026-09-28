import type { EventKind } from '../core/index.ts';
import type { ProcBus } from '../procs/index.ts';
import type { TriggerEvent, TriggerTypes } from '../triggers/index.ts';
import type { SpellRegistry } from './define-spells.ts';
import type { CastOutcome, SpellContext, SpellHit } from './spell-def.ts';
import type { SpellTypes } from './spell-types.ts';

/**
 * The payload of a spell event (§II.3.7): the cast, and what the moment adds (a hit, an outcome). Reused between
 * raises, so a listener reads it while it runs and never keeps it.
 */
export interface SpellEvent<G extends SpellTypes> {
  /** The cast; set on every raise. */
  cast: SpellContext<G> | undefined;

  /** What a delivery caught, for a hit; `undefined` otherwise. */
  hit: SpellHit<G> | undefined;

  /** How the cast ended, for an end; `undefined` otherwise. */
  outcome: CastOutcome | undefined;
}

/** Makes an empty spell event payload: the factory a game registers its spell events on its bus with. */
export const createSpellEvent = <G extends SpellTypes>(): SpellEvent<G> => ({
  cast: undefined,
  hit: undefined,
  outcome: undefined,
});

/**
 * The bus and the event kinds the spell system raises (§II.3.7, §I.5.6 hatch 7): generic kinds a game maps its own
 * trigger events onto. Each is optional, and raised only when something hears it, after the moment's hook ran.
 */
export interface SpellEvents<G extends SpellTypes> {
  /** The bus. */
  readonly bus: ProcBus;

  /** A cast started (its windup began, or it released at once), after `begin`. */
  readonly start?: EventKind<SpellEvent<G>>;

  /** A cast's payload went out, after `release` (the plan's `spellCast`). */
  readonly release?: EventKind<SpellEvent<G>>;

  /** A delivery of a cast caught units (`spells.hit`), after `onHit`. */
  readonly hit?: EventKind<SpellEvent<G>>;

  /** A cast ended, after `onEnd` and after its cast aura left the caster. */
  readonly end?: EventKind<SpellEvent<G>>;
}

/** The outcomes, in the code order an `outcome` filter's argument resolves to. */
export const CAST_OUTCOMES: readonly CastOutcome[] = Object.freeze(['released', 'cancelled', 'broken', 'blocked']);

/** Resolves an outcome's name to its code. */
const outcomeCode = (name: string): number => {
  const names: readonly string[] = CAST_OUTCOMES;
  const code = names.indexOf(name);

  if (code < 0) {
    throw new RangeError(`unknown cast outcome ${name}.`);
  }

  return code;
};

/** Resolves a name to its id in one of a spell registry's tables. */
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
 * A spell event kind as a trigger event (§II.3.7): about the cast's caster, with the filters `spell` (by name or id),
 * `tag` (a spell tag, by name or id) and `outcome` (by name, for an end). A trigger names them in `when`: an aura that
 * answers every fire spell its bearer casts, or the spell's own cast aura that answers its own hits.
 */
export const spellTriggerEvent = <G extends SpellTypes & TriggerTypes>(
  kind: EventKind<SpellEvent<G>>,
  spells: SpellRegistry<G>,
): TriggerEvent<G> =>
  Object.freeze({
    kind,
    unit: (event: SpellEvent<G>) => event.cast?.caster,

    filters: Object.freeze({
      spell: {
        test: (event: SpellEvent<G>, id: number) => event.cast?.spell === id,
        resolve: codeIn(spells.id, 'spell'),
      },

      tag: {
        test: (event: SpellEvent<G>, tag: number) =>
          event.cast !== undefined && spells.tagSets[event.cast.spell]?.has(tag) === true,

        resolve: codeIn(spells.tags.id, 'spell tag'),
      },

      outcome: {
        test: (event: SpellEvent<G>, code: number) => event.outcome === CAST_OUTCOMES[code],
        resolve: outcomeCode,
      },
    }),
  });
