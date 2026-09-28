import { isRunOut } from '../core/index.ts';
import type { CastOptions, SpellId } from '../spells/index.ts';
import type { AreaTrigger } from './area-trigger.ts';
import type { AreaTriggerTypes } from './area-types.ts';
import type { AreaCaster } from './delivery-def.ts';
import type { AreaEngine } from './engine.ts';

/** The options an area trigger casts with, reused: the cast order reads them before any hook runs. */
export class AreaCastOptions<G extends AreaTriggerTypes> implements CastOptions<G> {
  input: G['input'] | undefined = undefined;
  rank = 1;
  variant = 0;
  source: number | undefined = undefined;
}

/** The seconds between an area trigger's casts, read from it for a function. */
export const castSecondsOf = <G extends AreaTriggerTypes>(caster: AreaCaster<G>, area: AreaTrigger<G>): number => {
  const seconds = typeof caster.seconds === 'function' ? caster.seconds(area) : caster.seconds;

  if (!(Number.isFinite(seconds) && seconds > 0)) {
    throw new RangeError(`An area trigger casts every finite number of seconds above 0; got ${seconds}.`);
  }

  return seconds;
};

/** Resolves a kind's spell against the spell registry at load. */
export const casterSpellOf = <G extends AreaTriggerTypes>(
  engine: { readonly spells: { readonly registry: AreaEngine<G>['spells']['registry'] } },
  caster: AreaCaster<G> | undefined,
  name: string,
): SpellId | undefined => {
  if (caster === undefined) {
    return undefined;
  }

  const { registry } = engine.spells;
  const ids: Readonly<Record<string, SpellId | undefined>> = registry.id;
  const id = typeof caster.spell === 'string' ? ids[caster.spell] : caster.spell;

  if (id === undefined || id < 0 || id >= registry.size || registry.isRetired(id)) {
    throw new RangeError(`Area trigger ${name}: it casts ${caster.spell}, which is not a live spell.`);
  }

  return id;
};

/**
 * Counts an area trigger's cast clock down by `dt` (§II.3.4: the sentry), and casts its spell once it ran out, as its
 * owner, at its cast's rank, credited to its source, with it current (what the cast spawns is its child); the leftover
 * carries to the next cast, and a clock still behind starts again.
 */
export const stepCaster = <G extends AreaTriggerTypes>(
  engine: AreaEngine<G>,
  area: AreaTrigger<G>,
  dt: number,
): void => {
  const caster = engine.registry.get(area.kind).caster;
  const spell = engine.casterSpells[area.kind];

  if (caster === undefined || spell === undefined) {
    return;
  }

  area.castBeat -= dt;

  if (!isRunOut(area.castBeat, engine.clock.countdown)) {
    return;
  }

  const options = engine.castOptions;
  const outer = engine.current;

  options.input = caster.input?.(area);
  options.rank = area.rank;
  options.source = area.source;
  engine.current = area;

  try {
    engine.spells.cast(area.owner, spell, options);
  } finally {
    engine.current = outer;
    options.input = undefined;
  }

  const seconds = castSecondsOf(caster, area);

  area.castBeat += seconds;

  if (isRunOut(area.castBeat, engine.clock.countdown)) {
    area.castBeat = seconds;
  }
};
