// Hot path: a party's cues fire in a loop, so it is indexed.
/* oxlint-disable typescript/prefer-for-of */
import {
  checkCueSpec,
  type CueAnchor,
  type CueId,
  type CueParamValue,
  type CuePlace,
  type CueRegistry,
  type CueSpec,
  fireCue,
  NO_ENTITY
} from '../cues/index.ts';
import type { Vec2 } from '../math/index.ts';
import { checkTarget, missing, unitOf } from './apply.ts';
import type { CoreProcKind } from './core-procs.ts';
import { frameOf, type ProcFrame } from './frame.ts';
import type { CueProc } from './proc-data.ts';
import { PROC_LANDED, PROC_SKIPPED, type ProcOutcome, type ProcTypes } from './proc-types.ts';

/** The spec and place a frame's `cue` procs fire with, reused so a cue proc allocates nothing. */
export class CueFiring implements CueSpec, CuePlace {
  cue: CueId;
  anchor: CueAnchor = 'target';
  params: Readonly<Record<string, CueParamValue>> | undefined = undefined;
  at: Vec2 | undefined = undefined;
  owner = NO_ENTITY;
  entity = NO_ENTITY;
  x = 0;
  z = 0;

  constructor(cue: CueId) {
    this.cue = cue;
  }
}

/** The point a unit's position is read into, read at once. */
const POINT = { x: 0, z: 0 };

/** Fires the frame's firing on one unit (its position, unless the proc names a point); `self` cues are the unit's. */
const fireOn = <G extends ProcTypes>(frame: ProcFrame<G>, firing: CueFiring, unit: G['bearer']): void => {
  const id = frame.host.idOf?.(unit) ?? NO_ENTITY;

  if (firing.at === undefined) {
    const point = (frame.host.positionOf ?? missing('host.positionOf'))(unit, POINT);

    firing.x = point.x;
    firing.z = point.z;
  }

  firing.owner = firing.anchor === 'self' ? id : frame.source;
  firing.entity = id;
  fireCue(frame.cues ?? missing('cues'), firing, firing);
};

/** Throws for a predicted cue: a proc has no press key, so the client's echo ring would never drop the server's copy. */
const refusePredicted = (cues: CueRegistry, cue: CueId): void => {
  if (cues.columns.isPredicted[cue] === 1) {
    throw new RangeError(`cue ${cues.name(cue)} is predicted: a predicted cue is fired by its cast, not by a proc.`);
  }
};

/**
 * Fires a `cue` proc: on the self for a `self` cue, else on its `to` unit (each party member) or at its point. A
 * predicted cue throws here too, not only in `prepare`: a list an aura hook, a script, a spell hook or `procs.run`
 * returns at run time is never prepared.
 */
const applyCue = <G extends ProcTypes>(proc: CueProc<G>, frame: ProcFrame<G>): ProcOutcome => {
  const out = frame.cues ?? missing('cues');
  const cue = frame.resolve.cue(proc.cue);

  refusePredicted(out.registry, cue);

  const firing = (frame.firing ??= new CueFiring(cue));

  firing.cue = cue;
  firing.anchor = out.registry.anchorOf(cue);
  firing.params = proc.params;
  firing.at = proc.at;

  const on = firing.anchor === 'self' ? 'self' : (proc.to ?? 'target');

  if (on === 'party') {
    const members = (frame.host.party ?? missing('host.party'))(frame.self);

    for (let i = 0; i < members.length; i++) {
      const member = members[i];

      if (member !== undefined) {
        fireOn(frame, firing, member);
      }
    }

    return members.length === 0 ? PROC_SKIPPED : PROC_LANDED;
  }

  const unit = unitOf(frame, on);

  if (unit === undefined) {
    return PROC_SKIPPED;
  }

  fireOn(frame, firing, unit);

  return PROC_LANDED;
};

/**
 * Checks that a cue proc can be fired by a proc and placed by its anchor: not a predicted cue (a proc has no press key,
 * so the client's echo ring would never drop the server's copy), its `to` a target the runner knows.
 */
const checkPlacement = <G extends ProcTypes>(cues: CueRegistry, proc: CueProc<G>, cue: CueId): void => {
  const anchor = cues.anchorOf(cue);

  refusePredicted(cues, cue);
  checkTarget(proc.to);

  if (anchor === 'self' && (proc.to !== undefined || proc.at !== undefined)) {
    throw new RangeError(`cue ${cues.name(cue)} sits on the procs' self, so it takes no to or at.`);
  }

  if (anchor === 'entity' && proc.at !== undefined) {
    throw new RangeError(`cue ${cues.name(cue)} sits on a unit, so it takes no at.`);
  }
};

/**
 * The `cue` proc kind: presentation only, so it acts on no unit the runner resolves (a cue plays even on a unit
 * its list killed), and is checked at load against the system's cue registry (a predicted cue is refused: its cast
 * fires it, with the press key a proc does not have) and the host (a `party` cue needs `host.party`).
 */
export const CUE_KIND: CoreProcKind<'cue'> = {
  apply: (proc, ctx) => applyCue(proc, frameOf(ctx)),

  prepare: (proc, resolve) => {
    const cue = resolve.cue(proc.cue);
    const cues = resolve.cues();

    checkCueSpec(cues, { cue, ...(proc.params === undefined ? {} : { params: proc.params }) }, 'a cue proc');
    checkPlacement(cues, proc, cue);

    if (proc.to === 'party') {
      resolve.need('party');
    }

    return { ...proc, cue };
  },

  explain: (proc, resolve) => ({ values: { cue: resolve.cue(proc.cue) } })
};
