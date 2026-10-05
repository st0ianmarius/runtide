/**
 * The game assembler: `createGame` builds every system from its own options in the order they need each other, binds
 * every late edge, keeps a memory world in step with the units and checks the wiring; the `Game` it returns documents
 * the tick loop the game runs, and folds (`digest`) and audits (`audit`) the whole game.
 *
 * The client's half: `createMirror` builds, from the same spec, the prediction mirror a client runs for its own unit
 * (the aura, spell and ability systems a press needs, its bearers silent, checked by `checkPredicted` at build), and
 * runs the reconcile loop: `step` once per input it sends, `receive` once per snapshot. The server's half writes those
 * snapshots (`createSnapshotWriter`: the client's bearer's aura views and header, the key of the last input it consumed,
 * the tick's cues that reach it), and both sides compare their wire tables at the handshake (`wireOf`, `compareWire`).
 * `createMirror` documents the whole client contract, the motion contract included.
 */

export { createGame } from './create-game.ts';
export { type Game } from './game.ts';
export { createMirror } from './mirror.ts';

export {
  type Mirror,
  type MirrorBearerParts,
  type MirrorOptions,
  type MirrorPress,
  type MirrorRefusal,
  type Unconfirmed
} from './mirror-types.ts';

export {
  createSnapshot,
  createSnapshotWriter,
  type MirrorSnapshot,
  type SnapshotSource,
  type SnapshotWriter
} from './snapshot.ts';

export {
  type GameAreasSpec,
  type GameAurasSpec,
  type GameBus,
  type GameDamageSpec,
  type GameProcKinds,
  type GameProcsSpec,
  type GameRecords,
  type GameSpec,
  type GameSpellsSpec,
  type GameTypes,
  type GameUnitsSpec,
  type GameWorldSpec,
  type UnitDamageMember,
  type WorldBody
} from './spec.ts';

export { compareWire, type GameWire, wireOf, type WireSystems } from './wire.ts';
