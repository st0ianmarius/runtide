import type { Vec2 } from '../math/index.ts';
import { PROC_LANDED, PROC_REFUSED, PROC_SKIPPED, type ProcContext, type ProcKindDef } from '../procs/index.ts';
import type { CastHandle } from '../spells/index.ts';
import type { AreaTriggerId, AreaTriggerTypes } from './area-types.ts';
import type { AreaEngine } from './engine.ts';
import { NO_AREA_TRIGGER } from './ids.ts';
import type { AreaTriggerProcKinds, SpawnProc } from './procs.ts';
import { spawnArea, type SpawnSpec } from './spawner.ts';

/** The spec a `spawn` proc spawns with, reused: the spawn reads it before any hook runs. */
class ProcSpawnSpec<G extends AreaTriggerTypes> implements SpawnSpec<G> {
  owner: G['bearer'];
  at: Vec2 = { x: 0, z: 0 };
  heading = 0;
  input: G['areaInput'] | undefined = undefined;
  source: number | undefined = undefined;
  cast: CastHandle | undefined = undefined;
  now: number | undefined = undefined;
  shareState = false;

  constructor(owner: G['bearer']) {
    this.owner = owner;
  }
}

/** A kind's id from its name or id: checked live at load (`isChecked`), looked up by name when it applies. */
const kindIdOf = <G extends AreaTriggerTypes>(
  engine: AreaEngine<G>,
  areaTrigger: G['areaTriggerName'] | AreaTriggerId,
  isChecked: boolean,
): AreaTriggerId => {
  const { registry } = engine;

  if (typeof areaTrigger !== 'string') {
    const isLive = Number.isInteger(areaTrigger) && areaTrigger >= 0 && areaTrigger < registry.size;

    if (isChecked && (!isLive || registry.isRetired(areaTrigger))) {
      throw new RangeError(`${areaTrigger} is not a live area trigger kind.`);
    }

    return areaTrigger;
  }

  const ids: Readonly<Record<string, AreaTriggerId | undefined>> = registry.id;
  const id = ids[areaTrigger];

  if (id === undefined) {
    throw new RangeError(`unknown area trigger kind ${areaTrigger}.`);
  }

  return id;
};

/** Where a `spawn` proc spawns: its point, or the unit it landed on. */
const pointOf = <G extends AreaTriggerTypes>(
  engine: AreaEngine<G>,
  [proc, ctx]: readonly [SpawnProc<G>, ProcContext<G>],
  unit: G['bearer'],
): Vec2 => proc.atOf?.(ctx) ?? proc.at ?? (engine.host.positionOf ?? engine.world.positionOf)(unit);

/** The `spawn` kind: an area trigger owned by the list's self, at its point or on the unit it lands on. */
const spawnKind = <G extends AreaTriggerTypes>(engine: AreaEngine<G>): ProcKindDef<SpawnProc<G>, G> => {
  let spec: ProcSpawnSpec<G> | undefined = undefined;

  return {
    targetOf: (proc) => proc.to ?? 'self',

    apply: (proc, ctx, unit) => {
      if (unit === undefined) {
        return PROC_SKIPPED;
      }

      const request = (spec ??= new ProcSpawnSpec<G>(ctx.self));

      request.owner = ctx.self;
      request.at = pointOf(engine, [proc, ctx], unit);
      request.heading = proc.headingOf?.(ctx) ?? proc.heading ?? engine.current?.heading ?? 0;
      request.input = proc.inputOf === undefined ? proc.input : proc.inputOf(ctx);
      request.source = ctx.source;
      request.now = proc.now;
      request.shareState = proc.shareState === true;

      const handle = spawnArea(engine, kindIdOf(engine, proc.areaTrigger, false), request);

      request.input = undefined;

      return handle === NO_AREA_TRIGGER ? PROC_REFUSED : PROC_LANDED;
    },

    prepare: (proc) => ({ ...proc, areaTrigger: kindIdOf(engine, proc.areaTrigger, true) }),

    explain: (proc) => ({ values: { areaTrigger: kindIdOf(engine, proc.areaTrigger, false) } }),
  };
};

/** Builds the area trigger system's proc kinds over its engine. */
export const createAreaTriggerProcKinds = <G extends AreaTriggerTypes>(
  engine: AreaEngine<G>,
): AreaTriggerProcKinds<G> => Object.freeze({ spawn: spawnKind(engine) });
