import type { AbilitySystem } from '../abilities/index.ts';
import type { AuraSystem } from '../auras/index.ts';
import type { CueRegistry } from '../cues/index.ts';
import { type WireTable, wireTableOf } from '../replication/index.ts';
import type { SpellSystem } from '../spells/index.ts';
import type { GameTypes } from './spec.ts';

/**
 * The wire tables a server and its prediction mirrors compare at the handshake: every id a snapshot or a press carries
 * is one of these, so two sides that differ on any of them would read each other's ids as something else.
 */
export interface GameWire {
  /** The aura registry's (aura views carry aura ids; each aura's signature folds its audience, prediction and clock). */
  readonly auras: WireTable;

  /** The aura clocks' in declared order (`auras.clockTable`): views and headers carry clock ids. */
  readonly auraClocks: WireTable;

  /** The spell registry's. */
  readonly spells: WireTable;

  /** The ability slots' (a press mask has one bit per slot); `undefined` for a game without abilities. */
  readonly slots: WireTable | undefined;

  /** The cue registry's (a snapshot's cue batch carries cue ids); `undefined` for a game without cues. */
  readonly cues: WireTable | undefined;
}

/** The systems a game's wire tables are read from: a `Game`, or a `Mirror`, with the cue registry its spells fire into. */
export interface WireSystems<G extends GameTypes> {
  /** The aura system. */
  readonly auras: Pick<AuraSystem<G>, 'registry' | 'clockTable'>;

  /** The spell system. */
  readonly spells: Pick<SpellSystem<G>, 'registry'>;

  /** The ability system, if any. */
  readonly abilities?: Pick<AbilitySystem<G>, 'slots'> | undefined;

  /** The cue registry (`GameSpec.spells.cues.registry`), if any. */
  readonly cues?: CueRegistry | undefined;
}

/** The wire tables of a game's systems: a server reads them from its `Game`, a mirror has its own (`Mirror.wire`). */
export const wireOf = <G extends GameTypes>(systems: WireSystems<G>): GameWire =>
  Object.freeze({
    auras: wireTableOf(systems.auras.registry),
    auraClocks: wireTableOf(systems.auras.clockTable),
    spells: wireTableOf(systems.spells.registry),
    slots: systems.abilities === undefined ? undefined : wireTableOf(systems.abilities.slots),
    cues: systems.cues === undefined ? undefined : wireTableOf(systems.cues)
  });

/** The tables a handshake compares, in a fixed order. */
const TABLES: readonly (keyof GameWire)[] = ['auras', 'auraClocks', 'spells', 'slots', 'cues'];

/**
 * The tables on which a server's and a client's wire differ (their checksums, or one side lacking a table the other
 * has), by name in a fixed order: empty when the handshake passes. A client whose clocks are declared in another order
 * differs on `auraClocks`.
 */
export const compareWire = (server: GameWire, client: GameWire): string[] =>
  TABLES.filter((table) => server[table]?.checksum !== client[table]?.checksum);
