import type { AuraApplication, AuraId, AuraSystem } from '../auras/index.ts';
import { NO_SOURCE } from '../auras/index.ts';
import type { Random } from '../core/index.ts';
import type { CueBuffer, CuePlace } from '../cues/index.ts';
import type { ProcSystem } from '../procs/index.ts';
import type { SpellClock, SpellId, SpellSystem } from '../spells/index.ts';
import type { WorldQuery } from '../world/index.ts';
import type { AreaTriggerHost } from './area-host.ts';
import type { AreaTriggerTypes } from './area-types.ts';
import type { AreaTriggerRegistry } from './define-area-triggers.ts';
import type { AreaTriggerEvents } from './events.ts';

/** Throws for a service an operation needs but the system was not given. */
export const missing = (what: string): never => {
  throw new RangeError(`This area trigger system has no ${what}.`);
};

/** The application an owner aura lands with, reused. */
export class OwnerAuraApplication implements AuraApplication {
  aura: AuraId;
  source = NO_SOURCE;

  constructor(aura: AuraId) {
    this.aura = aura;
  }
}

/** Where an area trigger's cues sit: at its position, credited to its owner. */
export class AreaPlace implements CuePlace {
  owner = 0;
  entity = 0;
  x = 0;
  z = 0;
}

/** What an engine is built from: the resolved options and tables of a system. */
export interface AreaEngineParts<G extends AreaTriggerTypes> {
  /** The kinds. */
  readonly registry: AreaTriggerRegistry<G>;

  /** The spell system, whose casts area triggers belong to. */
  readonly spells: SpellSystem<G>;

  /** The aura system owner auras land through. */
  readonly auras: AuraSystem<G>;

  /** The proc system hooks' procs run through, or a function returning it. */
  readonly procs: ProcSystem<G> | (() => ProcSystem<G>);

  /** The world. */
  readonly world: WorldQuery<G['bearer']>;

  /** The clock. */
  readonly clock: SpellClock;

  /** The host. */
  readonly host: AreaTriggerHost<G> & G['host'];

  /** The system's own stream. */
  readonly random: Random | undefined;

  /** The host's named streams, keyed by an area trigger's key. */
  readonly streams: ((stream: G['stream'], key: readonly number[]) => Random) | undefined;

  /** The events. */
  readonly events: AreaTriggerEvents<G> | undefined;

  /** The cue buffer. */
  readonly cues: CueBuffer | undefined;

  /** Each kind's owner aura; `undefined` for none. */
  readonly ownerAuras: readonly (AuraId | undefined)[];

  /** The kinds each tick slot steps, in kind order. */
  readonly slotKinds: readonly (readonly number[])[];

  /** Each kind's binding bits (what its bound makes of its owner leaving or going down). */
  readonly bindings: Uint8Array;

  /** Each kind's mask of the owner's interrupts it waits out (`bound.pausedBy`); 0 for none. */
  readonly pauseMasks: Int32Array;

  /** Each kind's own spell, for a kind that casts. */
  readonly casterSpells: readonly (SpellId | undefined)[];

  /** Each kind's auras' ids, by aura index. */
  readonly areaAuras: readonly (readonly AuraId[] | undefined)[];

  /** Makes the game's fields of a pooled area trigger. */
  readonly createExt: () => G['areaExt'];

  /** Clears the game's fields as an area trigger's slot goes back to the pool. */
  readonly resetExt: ((ext: G['areaExt']) => void) | undefined;
}
