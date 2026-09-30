/**
 * Cues: what the simulation asks the client to show, as ids and numbers only. A registry
 * (`defineCues`) gives each cue a dense id and a schema of numeric params with declared defaults and quantisation; a
 * buffer (`createCueBuffer`) collects a tick's pooled events in firing order; the wire encoding (`encodeCues`,
 * `decodeCues`) carries each event's id, placement and only the params that differ from their defaults, as bytes or as a
 * plain number array. Nothing in the engine reads a cue, and what one looks and sounds like is the client's.
 */

export { createCueBuffer, type CueBuffer } from './buffer.ts';

export {
  type CueAnchor,
  type CueAngleParam,
  type CueAudience,
  type CueDef,
  type CueEntityParam,
  type CueF32Param,
  type CueFixedParam,
  type CueIdParam,
  type CueIntParam,
  type CueParamDef,
  type CueParamKind,
  type CueParamValue,
  type CueUint8Param,
  type CueVec2ListParam,
  type CueVec2Param,
  defineCue,
} from './cue-def.ts';

export {
  type CueColumn,
  type CueName,
  type CueRegistry,
  type CueRegistryOptions,
  type CueTable,
  defineCues,
} from './define-cues.ts';

export { decodeCue, decodeCueParams, decodeCues, encodeCue, encodeCueParams, encodeCues } from './encode.ts';
export { type CueEvent, cuePath, NO_ENTITY, setCuePath } from './event.ts';
export type { CueId, CueIdOf, CueParam } from './ids.ts';
export { createCueEchoes, type CueEchoes, cueReaches, type CueRecipient } from './route.ts';
export type { CueSchema } from './schema.ts';
export { checkCueSpec, type CuePlace, type CueSpec, type CueSpecOf, fireCue } from './spec.ts';

export {
  type ByteWriter,
  createByteReader,
  createByteWriter,
  createNumberReader,
  createNumberWriter,
  type CueReader,
  type CueWriter,
  type NumberWriter,
} from './wire.ts';
