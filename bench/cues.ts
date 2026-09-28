import {
  createByteReader,
  createByteWriter,
  createCueBuffer,
  createNumberWriter,
  decodeCues,
  defineCue,
  defineCues,
  encodeCues,
  fireCue,
  setCuePath,
} from '../src/cues/index.ts';

/** A combat-shaped cue table: impacts and numbers on units, a cast on its caster, a chain between points. */
const CUES = defineCues({
  impact: defineCue({
    anchor: 'entity',
    params: { strength: { kind: 'uint8', default: 1 }, isCrit: { kind: 'uint8' }, facing: { kind: 'angle' } },
  }),
  number: defineCue({ anchor: 'entity', audience: 'owner', params: { amount: { kind: 'fixed', scale: 10 } } }),
  cast: defineCue({
    anchor: 'self',
    params: {
      radius: { kind: 'fixed', scale: 100, default: 1 },
      facing: { kind: 'angle' },
      duration: { kind: 'fixed', scale: 1000 },
    },
  }),
  chain: defineCue({ anchor: 'target', params: { links: { kind: 'vec2[]' } } }),
});

/** How many cues one bench tick fires: 120 impacts, 60 numbers, 15 casts and 5 four-link chains. */
const PER_TICK = 200;

/** Where each bench tick's cues go. */
const OUT = createCueBuffer(CUES);

/** The reused writers. */
const BYTES = createByteWriter();
const NUMBERS = createNumberWriter();

/** The buffer a client decodes into. */
const INTO = createCueBuffer(CUES);

/** A reused place, moved for each cue. */
const PLACE = { owner: 7, entity: 0, x: 0, z: 0 };

/** Reused specs, their params written for each cue, as a spell's hooks would return them. */
const IMPACT = { cue: CUES.id.impact, params: { strength: 1, isCrit: 0, facing: 0 } };
const NUMBER = { cue: CUES.id.number, params: { amount: 0 } };
const CAST = { cue: CUES.id.cast, params: { radius: 2.5, facing: 0, duration: 0.8 } };

const LINKS = [
  { x: 1, z: 1 },
  { x: 3.5, z: 2 },
  { x: 6, z: -1.25 },
  { x: 8, z: 0 },
];

const CHAIN = { cue: CUES.id.chain, params: { links: LINKS } };

/** The params' slots, resolved at load. */
const P = CUES.params;

/** What the bench tasks produced, so nothing is optimised away. */
export const cueCounter = { bytes: 0, numbers: 0, decoded: 0 };

/** Moves the reused place to cue `i` of a tick. */
const placeAt = (i: number): void => {
  PLACE.entity = 100 + (i % 50);
  PLACE.x = (i * 0.37) % 40;
  PLACE.z = (i * 0.91) % 40;
};

/** Fires one tick's cues from specs (the authoring path: `fireCue`, names resolved at load). */
const fireSpecs = (): void => {
  OUT.clear();

  for (let i = 0; i < PER_TICK; i++) {
    placeAt(i);

    if (i < 120) {
      IMPACT.params.isCrit = i % 7 === 0 ? 1 : 0;
      IMPACT.params.facing = i * 0.05;
      fireCue(OUT, IMPACT, PLACE);
    } else if (i < 180) {
      NUMBER.params.amount = 12.5 + i;
      fireCue(OUT, NUMBER, PLACE);
    } else if (i < 195) {
      CAST.params.facing = i * 0.1;
      fireCue(OUT, CAST, PLACE);
    } else {
      fireCue(OUT, CHAIN, PLACE);
    }
  }
};

/** The cue a slot-emitted tick fires `i`th: impacts, then numbers, then chains. */
const cueAt = (i: number) => {
  if (i < 120) {
    return CUES.id.impact;
  }

  return i < 195 ? CUES.id.number : CUES.id.chain;
};

/** Emits one tick's cues by slot (the hot path: `emit` and typed slots, no spec). */
const emitSlots = (): void => {
  OUT.clear();

  for (let i = 0; i < PER_TICK; i++) {
    const cue = cueAt(i);
    const event = OUT.emit(cue);

    placeAt(i);
    event.owner = PLACE.owner;
    event.entity = PLACE.entity;
    event.x = PLACE.x;
    event.z = PLACE.z;

    if (cue === CUES.id.impact) {
      event.values[P.impact.facing] = i * 0.05;
    } else if (cue === CUES.id.number) {
      event.values[P.number.amount] = 12.5 + i;
    } else {
      setCuePath(event, P.chain.links, LINKS);
    }
  }
};

/** A tick fired from specs and encoded as bytes. */
const specsToBytes = (): void => {
  fireSpecs();
  BYTES.reset();
  encodeCues(OUT, BYTES);
  cueCounter.bytes += BYTES.length;
};

/** A tick emitted by slot and encoded as numbers. */
const slotsToNumbers = (): void => {
  emitSlots();
  NUMBERS.reset();
  encodeCues(OUT, NUMBERS);
  cueCounter.numbers += NUMBERS.length;
};

fireSpecs();
BYTES.reset();
encodeCues(OUT, BYTES);

/** One tick's bytes, encoded once, for the decode task. */
const TICK_BYTES = BYTES.bytes().slice();

/** A client decoding one tick's bytes. */
const decodeTick = (): void => {
  INTO.clear();
  cueCounter.decoded += decodeCues(createByteReader(TICK_BYTES), INTO);
};

/** The size of one bench tick on the wire, in bytes: what the baseline reports beside the times. */
export const CUE_TICK_BYTES = TICK_BYTES.length;

/** The F6 benchmark tasks, and how many operations each call of its function is (one tick). */
export const CUE_TASKS: readonly (readonly [string, () => void, number])[] = [
  ['cues: fire 200 specs + encode bytes (tick)', specsToBytes, PER_TICK],
  ['cues: emit 200 by slot + encode numbers (tick)', slotsToNumbers, PER_TICK],
  ['cues: decode 200 events from bytes (tick)', decodeTick, PER_TICK],
];
