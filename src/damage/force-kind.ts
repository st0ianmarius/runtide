import type { Vec2 } from '../math/index.ts';
import { PROC_SKIPPED, type ProcContext, type ProcKindDef, type ProcOutcome } from '../procs/index.ts';
import type { DamageTypes, ForceKind } from './damage-types.ts';
import type { Force, ForceSpec } from './force.ts';
import type { ForceProc } from './procs.ts';

/** The spec a force proc fills, reused for every one, since the force pipeline copies it at once. */
class ProcForceSpec<G extends DamageTypes> implements ForceSpec<G> {
  target: G['bearer'];
  strength = 0;
  kind: ForceKind<G> = 'push';
  attacker: G['bearer'] | undefined = undefined;
  source: number | undefined = undefined;
  from: Vec2 | undefined = undefined;
  direction: Vec2 | undefined = undefined;

  constructor(target: G['bearer']) {
    this.target = target;
  }
}

/**
 * The `force` kind: a push, pull or knock through the force pipeline on the unit it lands on, caused by
 * the list's self and credited to its source. Checks its strength at load.
 */
export const forceKind = <G extends DamageTypes>(
  force: (spec: ForceSpec<G>) => Force<G>,
): ProcKindDef<ForceProc<G>, G> => {
  let spec: ProcForceSpec<G> | undefined;

  return {
    targetOf: (proc) => proc.to,

    apply: (proc: ForceProc<G>, ctx: ProcContext<G>, target: G['bearer'] | undefined): ProcOutcome => {
      if (target === undefined) {
        return PROC_SKIPPED;
      }

      spec ??= new ProcForceSpec<G>(target);
      spec.target = target;
      spec.strength = proc.strength;
      spec.kind = proc.force;
      spec.attacker = ctx.self;
      spec.source = ctx.source;
      spec.from = proc.from;
      spec.direction = proc.direction;

      return force(spec);
    },

    prepare: (proc) => {
      if (!(proc.strength > 0) || !Number.isFinite(proc.strength)) {
        throw new RangeError(`a ${proc.force} proc's strength is a finite number above 0; got ${proc.strength}.`);
      }

      return proc;
    },

    explain: (proc) => ({ values: { strength: proc.strength } }),
  };
};
