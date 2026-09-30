import type { CastSeconds } from './activation.ts';
import type { Cast } from './cast.ts';
import type { CastStage } from './spell-def.ts';
import type { SpellTypes } from './spell-types.ts';

/** Enters a stage: its seconds read now (a function reads the cast), its clock reset. Throws for bad seconds. */
export const enterStage = <G extends SpellTypes>(
  cast: Cast<G>,
  stage: Exclude<CastStage, 'ended'>,
  seconds: CastSeconds<G> | undefined
): void => {
  const value = typeof seconds === 'function' ? seconds(cast) : (seconds ?? 0);

  if (!(value >= 0) || !Number.isFinite(value)) {
    throw new RangeError(`A cast's ${stage} must last a finite number of seconds from 0; got ${value}.`);
  }

  cast.stage = stage;
  cast.stageSeconds = value;
  cast.remaining = value;
  cast.elapsed = 0;
};

/** A channel's beat seconds read from the cast: above 0, or 0 to beat every step. Throws for bad seconds. */
export const beatSeconds = <G extends SpellTypes>(cast: Cast<G>, every: CastSeconds<G> | undefined): number => {
  const value = typeof every === 'function' ? every(cast) : (every ?? 0);

  if (!(value > 0 && Number.isFinite(value)) && every !== undefined) {
    throw new RangeError(`A channel beats every finite number of seconds above 0; got ${value}.`);
  }

  return value;
};
