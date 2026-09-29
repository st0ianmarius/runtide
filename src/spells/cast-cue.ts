import { NO_SOURCE } from '../auras/index.ts';
import type { SpellEngine } from './engine.ts';
import { MirrorContext } from './mirror.ts';
import { missing } from './missing.ts';
import type { SpellId, SpellTypes } from './spell-types.ts';

/** An engine's mirror context, set for a caster, a spell and an input. */
const contextFor = <G extends SpellTypes>(
  engine: SpellEngine<G>,
  caster: G['bearer'],
  [spell, input]: readonly [SpellId, G['input'] | undefined],
): MirrorContext<G> => {
  const context = (engine.mirror ??= new MirrorContext<G>(engine.world, caster));

  context.bearer = caster;
  context.input = input;
  context.stats = engine.host.statsOf?.(caster, spell);
  context.dt = engine.clock.dt;

  return context;
};

/**
 * Fires a spell's mirror-safe cast cue (`SpellCues.cast`, §II.6 R2) on its caster, with a key: the server as a cast
 * starts, the predicting client at the press (`spells.predictCast`). Throws for a cue that is not predicted, whose
 * echo no client could drop. Returns whether a cue was fired.
 */
export const fireCastCue = <G extends SpellTypes>(
  engine: SpellEngine<G>,
  caster: G['bearer'],
  [spell, input, key]: readonly [SpellId, G['input'] | undefined, number],
): boolean => {
  const hook = engine.registry.defs[spell]?.cues?.cast;
  const context = hook === undefined ? undefined : contextFor(engine, caster, [spell, input]);
  const spec = context === undefined ? undefined : hook?.(context);

  if (context !== undefined) {
    context.input = undefined;
  }

  if (spec === undefined) {
    return false;
  }

  const cues = engine.cues ?? missing('a cue buffer');

  if (cues.registry.columns.isPredicted[spec.cue] !== 1) {
    throw new RangeError(`Spell ${engine.registry.name(spell)}'s cast cue must be a predicted cue.`);
  }

  const event = engine.fireOn(caster, engine.host.idOf?.(caster) ?? NO_SOURCE, spec);

  event.key = key;

  return true;
};
