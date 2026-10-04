/**
 * The game assembler: `createGame` builds every system from its own options in the order they need each other, binds
 * every late edge, keeps a memory world in step with the units and checks the wiring; the `Game` it returns documents
 * the tick loop the game runs, and folds (`digest`) and audits (`audit`) the whole game.
 */

export { createGame } from './create-game.ts';
export { type Game } from './game.ts';

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
