import type { CastSeconds } from './activation.ts';
import type { CastStages } from './cast-request.ts';
import type { Cast } from './cast.ts';
import type { CastStage } from './spell-def.ts';
import type { SpellTypes } from './spell-types.ts';

/** Checks one optional duration override before a cast is admitted. */
const checkOverride = (stage: string, seconds: number | undefined): void => {
  if (seconds !== undefined && !(seconds >= 0 && Number.isFinite(seconds))) {
    throw new RangeError(`A cast's ${stage} override must last a finite number of seconds from 0; got ${seconds}.`);
  }
};

/** Checks every supplied per-cast stage duration. */
export const checkStages = (stages: CastStages | undefined): void => {
  checkOverride('windup', stages?.windup);
  checkOverride('channel', stages?.channel);
  checkOverride('recover', stages?.recover);
};

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
