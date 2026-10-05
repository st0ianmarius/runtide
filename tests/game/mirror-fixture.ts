import { defineSlots } from '../../src/abilities/index.ts';
import { type AiProcs, defineTimers, NO_BRAIN } from '../../src/ai/index.ts';
import type { AreaTriggerTypes } from '../../src/area-triggers/index.ts';
import { type AuraClock, defineAura, defineAuras, defineAuraTags } from '../../src/auras/index.ts';
import { toId } from '../../src/core/ids.ts';
import { createBitset, createClock, type SimClock } from '../../src/core/index.ts';
import { createCueBuffer, type CueBuffer, defineCue, defineCues } from '../../src/cues/index.ts';
import { type Blow, type DamageProcs, defineDamageKinds, type Force } from '../../src/damage/index.ts';
import {
  createGame,
  createMirror,
  createSnapshot,
  createSnapshotWriter,
  type Game,
  type GameSpec,
  type Mirror,
  type MirrorOptions,
  type MirrorSnapshot
} from '../../src/game/index.ts';
import type { MutableVec2, Vec2 } from '../../src/math/index.ts';
import { defineStats } from '../../src/modifiers/index.ts';
import { CORE_PROCS, createProcRegistry, type Proc } from '../../src/procs/index.ts';
import type { ScriptTypes } from '../../src/scripts/index.ts';
import { defineSpells, type SpellId, type SpellProcs } from '../../src/spells/index.ts';
import { defineUnits, defineUnitStates, defineUnitTags, Unit, type UnitProcs } from '../../src/units/index.ts';

/** The prediction test game's types: one hero with two button slots, auras on a world and a motion clock. */
export interface MirrorGame extends ScriptTypes, AreaTriggerTypes {
  /** A unit. */
  readonly bearer: Unit<MirrorGame>;

  /** The framework's procs. */
  readonly proc: Proc<MirrorGame>;

  /** No triggers. */
  readonly trigger: never;

  /** Health only. */
  readonly stat: 'maxHealth';

  /** No conditions. */
  readonly condition: never;

  /** No value kinds. */
  readonly valueKind: never;

  /** Bases, then auras. */
  readonly source: 'base' | 'auras';

  /** A stun. */
  readonly tag: 'stun';

  /** The world clock, and the motion clock a client steps once per input. */
  readonly clock: 'world' | 'motion';

  /** The lifecycle's states. */
  readonly state: 'dead' | 'despawned';

  /** The framework's blow. */
  readonly blow: Blow<MirrorGame>;

  /** The framework's force. */
  readonly force: Force<MirrorGame>;

  /** No aura data. */
  readonly data: undefined;

  /** No aura fields. */
  readonly ext: undefined;

  /** No payloads. */
  readonly payload: undefined;

  /** Open aura names. */
  readonly auraName: string;

  /** Open cue names. */
  readonly cueName: string;

  /** No resources. */
  readonly resource: never;

  /** No streams. */
  readonly stream: never;

  /** No game services. */
  readonly host: object;

  /** Every system's kinds. */
  readonly gameProc: AiProcs<MirrorGame> | DamageProcs<MirrorGame> | SpellProcs<MirrorGame> | UnitProcs<MirrorGame>;

  /** One damage kind. */
  readonly damageKind: 'physical';

  /** A blow's spell is a spell id. */
  readonly spell: SpellId;

  /** No blow fields. */
  readonly blowExt: undefined;

  /** Open spell names. */
  readonly spellName: string;

  /** No spell tags. */
  readonly spellTag: never;

  /** No input. */
  readonly input: undefined;

  /** A stun. */
  readonly interrupt: 'stun';

  /** No game activation kinds. */
  readonly gameActivation: never;

  /** No cast fields. */
  readonly castExt: undefined;

  /** No spell data. */
  readonly spellData: undefined;

  /** A dodge and a skill. */
  readonly slot: 'dodge' | 'skill';

  /** Open unit names. */
  readonly unitName: string;

  /** A hero. */
  readonly unitTag: 'hero';

  /** A stunned state. */
  readonly unitState: 'stunned';

  /** No unit fields. */
  readonly unitExt: undefined;

  /** One timer. */
  readonly timerName: 'pick';

  /** Open script names. */
  readonly scriptName: string;

  /** No script events. */
  readonly scriptEvents: object;

  /** Open area names. */
  readonly areaTriggerName: string;

  /** No area tags. */
  readonly areaTag: never;

  /** No area input. */
  readonly areaInput: undefined;

  /** No area fields. */
  readonly areaExt: undefined;

  /** No end reasons of the game's. */
  readonly endReason: never;
}

/** The test stats. */
const STATS = defineStats({ maxHealth: { base: 100, kind: 'flat' } });

/** The test aura tags. */
const TAGS = defineAuraTags(['stun']);

const aura = defineAura<MirrorGame>;

/**
 * The test auras, all predicted: a stun (world clock), the dodge's cooldown and dash (motion clock), the bolt's
 * cooldown (world clock, the default).
 */
export const AURAS = defineAuras<MirrorGame, 'stun' | 'dodgeCooldown' | 'dash' | 'boltCooldown'>({
  stun: aura({ duration: 1, tags: ['stun'], predicted: true }),
  dodgeCooldown: aura({ duration: 1, clock: 'motion', predicted: true }),
  dash: aura({ duration: 0.5, clock: 'motion', predicted: true }),
  boltCooldown: aura({ duration: 1, predicted: true })
});

/** The test cues: the two predicted cast cues, and a bolt's start cue, which the server alone fires. */
export const CUES = defineCues({
  swish: defineCue({ anchor: 'self', isPredicted: true }),
  zap: defineCue({ anchor: 'self', isPredicted: true }),
  thud: defineCue({ anchor: 'self' })
});

/** The test slots. */
const SLOTS = defineSlots(['dodge', 'skill']);

/** Each body's place along x, keyed by bearer object (a mirror's twins share the unit's id); a bearer without one has none. */
export const BODIES = new WeakMap<Unit<MirrorGame>, { x: number }>();

/** How far a dodge carries its bearer's body. */
export const DODGE = 2;

/** The test spells: a dodge (1 s cooldown on the motion clock, lands a dash), a bolt (2 s cooldown, blocked by a stun). */
const SPELLS = defineSpells<MirrorGame, 'dodge' | 'bolt'>({
  dodge: {
    activation: {
      kind: 'button',
      applies: ['dash'],

      activate: ({ bearer }) => {
        const body = BODIES.get(bearer);

        if (body !== undefined) {
          body.x += DODGE;
        }
      }
    },
    cooldown: { aura: 'dodgeCooldown', seconds: 1 },
    cues: { cast: () => ({ cue: CUES.id.swish }) },
    release: () => undefined
  },
  bolt: {
    activation: { kind: 'button', blockedBy: ['stun'] },
    cooldown: { aura: 'boltCooldown', seconds: 2 },
    cues: { cast: () => ({ cue: CUES.id.zap }), start: () => ({ cue: CUES.id.thud }) },
    release: () => undefined
  }
});

/** The test templates: a hero. */
const TEMPLATES = defineUnits<MirrorGame, 'hero'>(
  { hero: { stats: { maxHealth: 100 }, tags: ['hero'] } },
  { stats: STATS, tags: defineUnitTags(['hero']) }
);

/** The hero stands at the origin. */
const positionOf = (_unit: Unit<MirrorGame>, out: MutableVec2): Vec2 => {
  out.x = 0;
  out.z = 0;

  return out;
};

/** The order the test spec declares its aura clocks in: the world first (its default) unless said otherwise. */
export type ClockOrder = 'world-first' | 'motion-first';

/** The aura clocks over a world and a motion clock, in an order. */
const clocksOf = (order: ClockOrder, world: SimClock, motion: SimClock): Record<MirrorGame['clock'], AuraClock> =>
  order === 'world-first' ? { world, motion } : { motion, world };

/** The prediction test spec, over its own clocks and cue buffer; the cue buffer is the server's. */
export const mirrorSpecOf = (order: ClockOrder = 'world-first'): GameSpec<MirrorGame> => {
  const clock = createClock({ dt: 0.25 });
  const motion = createClock({ dt: 0.25 });

  return {
    clock,
    auras: { registry: AURAS, tags: TAGS, clocks: clocksOf(order, clock, motion), states: ['dead', 'despawned'] },
    spells: { registry: SPELLS, host: { positionOf }, cues: createCueBuffer(CUES), interrupts: ['stun'] },
    ai: { timers: defineTimers(['pick']) },
    abilities: { slots: SLOTS },
    units: {
      registry: TEMPLATES,
      health: { stat: 'maxHealth' },
      states: defineUnitStates(TAGS, { stunned: { tags: ['stun'], blocks: ['act', 'move'], interrupt: 'stun' } })
    },
    damage: { kinds: defineDamageKinds({ physical: {} }), stats: STATS },
    procs: {
      kinds: (k) => createProcRegistry<MirrorGame>({ ...CORE_PROCS, ...k.damage, ...k.spells, ...k.units, ...k.ai }),
      host: {}
    }
  };
};

/**
 * The mirror's bearer: a client's copy of the hero, entity id `id`, over the mirror's states. The predicted twin gets a
 * body at the origin; the acked twin none, so its steps move nothing.
 */
export const heroBearer =
  (id: number): MirrorOptions<MirrorGame>['bearer'] =>
  (parts) => {
    const unit = new Unit<MirrorGame>({
      id,
      template: TEMPLATES.id.hero,
      side: 0,
      owner: undefined,
      isBound: false,
      base: STATS.columns.base,
      tags: TEMPLATES.tagSets[TEMPLATES.id.hero]?.clone() ?? createBitset(),
      auras: parts.auras,
      casts: parts.casts,
      loadout: parts.loadout,
      brain: NO_BRAIN,
      sheet: parts.sheet,
      ext: undefined
    });

    if (parts.role === 'predicted') {
      BODIES.set(unit, { x: 0 });
    }

    return unit;
  };

/** The server's tick for the hero: its clocks, its auras, then its press (when it consumed an input), then its casts. */
const serverTick = (server: Game<MirrorGame>, hero: Unit<MirrorGame>, consumed?: readonly [number, number]): void => {
  server.clock.step();
  server.auras.tickAll(hero);

  if (consumed !== undefined) {
    server.abilities?.tryActivate(hero, consumed[0], { key: consumed[1] });
  }

  server.spells.stepAuto(hero);
  server.spells.step(hero);

  for (let slot = 0; slot < server.spells.delayedSlots; slot++) {
    server.spells.stepDelayed(toId<'tickSlots'>(slot));
  }
};

/** One input of a scripted run: what it presses, whether the server never gets it, what the server does after it. */
interface Round {
  /** The slot it presses; none when absent. */
  readonly press?: MirrorGame['slot'];

  /** Whether the server never consumes it (it steps the hero without it). */
  readonly dropped?: boolean;

  /** What the server does after its tick (a stun the client cannot foresee). */
  readonly after?: (server: Game<MirrorGame>, hero: Unit<MirrorGame>) => void;
}

/** A server and a predicting client of its hero, linked with a latency. */
export interface Link {
  /** The server. */
  readonly server: Game<MirrorGame>;

  /** The server's hero. */
  readonly hero: Unit<MirrorGame>;

  /** The client's mirror of the hero. */
  readonly mirror: Mirror<MirrorGame>;

  /** Every cue the client played, in order, as `name#key`. */
  readonly played: string[];

  /** Every predicted cue the server never echoed, as `name#key`. */
  readonly unconfirmed: string[];

  /** The last snapshot the client received. */
  readonly last: () => MirrorSnapshot | undefined;

  /** Runs the rounds, one input each, then delivers the snapshots still in flight. */
  readonly run: (rounds: readonly Round[]) => void;

  /** Called after each round with its key, once both sides stepped it and the client received what had arrived. */
  onRound?: (key: number) => void;
}

/** What a link is built with. */
export interface LinkOptions {
  /** How many inputs a snapshot takes to reach the client; 2 when absent. */
  readonly latency?: number;

  /** The clocks the mirror ticks; the world and motion clocks when absent. */
  readonly ticks?: readonly MirrorGame['clock'][];

  /** The mirror's `onReseed`; none when absent. */
  readonly onReseed?: MirrorOptions<MirrorGame>['onReseed'];
}

/** The cues of a buffer, as `name#key`, then clears it. */
const drain = (buffer: CueBuffer | undefined, into: string[]): void => {
  for (let i = 0; i < (buffer?.count ?? 0); i++) {
    const event = buffer?.events[i];

    if (event !== undefined) {
      into.push(`${CUES.name(event.cue)}#${event.key}`);
    }
  }

  buffer?.clear();
};

/**
 * A server and a predicting client built from one spec: the server consumes one input per tick (an input it never
 * gets is stepped without), writes the client's snapshot after each tick, and the client receives it `latency` inputs
 * later.
 */
export const makeLink = (options: LinkOptions = {}): Link => {
  const { latency = 2, ticks = ['world', 'motion'], onReseed } = options;
  const spec = mirrorSpecOf();
  const server = createGame(spec);
  const hero = server.units.spawn(TEMPLATES.id.hero, { side: 0 });

  const mirror = createMirror(spec, {
    bearer: heroBearer(hero.id),
    ticks,
    reads: { auras: [AURAS.id.dash] },
    ...(onReseed === undefined ? {} : { onReseed })
  });

  const writer = createSnapshotWriter<MirrorGame>(server.auras, { cues: spec.spells.cues, recipient: { id: hero.id } });
  const flight: MirrorSnapshot[] = [];
  const played: string[] = [];
  const unconfirmed: string[] = [];
  let ack = 0;
  let last: MirrorSnapshot | undefined;

  BODIES.set(hero, { x: 0 });

  server.abilities?.equip(hero, SLOTS.id.dodge, SPELLS.id.dodge);
  server.abilities?.equip(hero, SLOTS.id.skill, SPELLS.id.bolt);
  mirror.abilities.equip(mirror.bearer, SLOTS.id.dodge, SPELLS.id.dodge);
  mirror.abilities.equip(mirror.bearer, SLOTS.id.skill, SPELLS.id.bolt);

  const deliver = (): void => {
    const snapshot = flight.shift();

    if (snapshot !== undefined) {
      mirror.receive(snapshot, (cue, _owner, key) => unconfirmed.push(`${CUES.name(toId<'cues'>(cue))}#${key}`));
      drain(mirror.heard, played);
      last = snapshot;
    }
  };

  const link: Link = {
    server,
    hero,
    mirror,
    played,
    unconfirmed,
    last: () => last,

    run: (rounds) => {
      for (const [index, round] of rounds.entries()) {
        const key = index + 1;
        const mask = round.press === undefined ? 0 : mirror.abilities.bit(SLOTS.id[round.press]);

        mirror.step(mask, { key });
        drain(mirror.cues, played);
        serverTick(server, hero, round.dropped === true ? undefined : [mask, key]);
        ack = round.dropped === true ? ack : key;
        round.after?.(server, hero);

        const snapshot = writer.write(hero, ack, createSnapshot());

        snapshot.cues = snapshot.cues.slice();
        spec.spells.cues?.clear();
        flight.push(snapshot);

        if (flight.length > latency) {
          deliver();
        }

        link.onRound?.(key);
      }

      while (flight.length > 0) {
        deliver();
      }
    }
  };

  return link;
};
