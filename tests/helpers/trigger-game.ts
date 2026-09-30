import {
  type AuraBearer,
  type AuraDef,
  type AuraEvent,
  type AuraId,
  type AuraRegistry,
  type AuraState,
  type AuraSystem,
  createAuraEvent,
  createAuraSystem,
  defineAura,
  defineAuras,
  defineAuraTags,
} from '../../src/auras/index.ts';
import { defineConditions } from '../../src/conditions/index.ts';
import { createBus, type Random } from '../../src/core/index.ts';
import {
  CORE_PROCS,
  createProcRegistry,
  createProcSystem,
  defineProcKind,
  type Proc,
  type ProcContext,
  type ProcHost,
  procOutcome,
  type ProcShape,
  type ProcSystem,
  type ProcSystemOptions,
  type ProcTarget,
} from '../../src/procs/index.ts';
import {
  auraTriggerEvent,
  type CooldownName,
  type CooldownOptions,
  createTriggerSystem,
  type TriggerDef,
  type TriggerEvent,
  triggerEvent,
  type TriggerSystem,
  type TriggerSystemOptions,
  type TriggerTypes,
  withTriggerCooldowns,
} from '../../src/triggers/index.ts';

/** A test unit: an id, some health, and its auras. */
export interface Unit extends AuraBearer {
  /** Its entity id. */
  readonly id: number;

  /** Its health, which `strike` procs take. */
  hp: number;

  /** Its auras. */
  readonly auras: AuraState;
}

/** The test game's own proc kind: a strike that takes health and reports a kill. */
export interface StrikeProc extends ProcShape {
  /** The discriminant. */
  readonly kind: 'strike';

  /** The health it takes. */
  readonly amount: number;

  /** Where it lands. */
  readonly to?: ProcTarget<Game>;
}

/** The test game's own host services. */
interface GameHost {
  /** Everything the procs did, as lines. */
  readonly log: string[];
}

/** The test game's types. */
export interface Game extends TriggerTypes {
  /** A test unit. */
  readonly bearer: Unit;

  /** The game's procs. */
  readonly proc: Proc<Game>;

  /** The game's triggers. */
  readonly trigger: TriggerDef<Game>;

  /** One stat. */
  readonly stat: 'power';

  /** One condition. */
  readonly condition: 'healthBelow';

  /** No value kinds. */
  readonly valueKind: never;

  /** One source. */
  readonly source: 'auras';

  /** The test tags. */
  readonly tag: 'magic' | 'curse' | 'cooldown';

  /** One clock. */
  readonly clock: 'world';

  /** No states. */
  readonly state: never;

  /** A blow is a number. */
  readonly blow: number;

  /** A force is a number. */
  readonly force: number;

  /** No game data. */
  readonly data: undefined;

  /** No game fields. */
  readonly ext: undefined;

  /** A payload is a number. */
  readonly payload: number;

  /** Aura names are open strings. */
  readonly auraName: string;

  /** Two resources. */
  readonly resource: 'gold' | 'shards';

  /** One named stream. */
  readonly stream: 'loot';

  /** The game's host. */
  readonly host: GameHost;

  /** The game's own kind. */
  readonly gameProc: StrikeProc;

  /** Three trigger events. */
  readonly event: 'hit' | 'kill' | 'aura';

  /** The filters the events carry. */
  readonly filter: 'minAmount' | 'isCrit' | 'aura' | 'change';
}

/** A hit: who struck whom, how hard. */
export interface HitEvent {
  /** Who struck: the unit the event is about. */
  attacker: Unit | undefined;

  /** Who was struck. */
  target: Unit | undefined;

  /** How hard. */
  amount: number;

  /** Whether it was a critical hit. */
  isCrit: boolean;
}

/** A kill: who killed whom. */
export interface KillEvent {
  /** Who killed: the unit the event is about. */
  killer: Unit | undefined;

  /** Who died. */
  victim: Unit | undefined;
}

/** `defineAura` fixed to the test types. */
export const aura = defineAura<Game>;

/** The one test clock: a step of 0.125 s, due at exactly zero. */
export const CLOCKS = { world: { dt: 0.125 } } as const;

/** The test tags. */
export const TAGS = defineAuraTags(['magic', 'curse', 'cooldown']);

/** The test condition: health below a share of 100. */
export const CONDITIONS = defineConditions({ healthBelow: (unit: Unit, share) => unit.hp < 100 * share });

/** The test game's `strike` kind: takes health, logs it, and reports a kill at 0. */
export const STRIKE = defineProcKind<StrikeProc, Game>({
  targetOf: (proc) => proc.to,

  apply: (proc, ctx, target) => {
    if (target === undefined) {
      return undefined;
    }

    target.hp -= proc.amount;
    ctx.host.log.push(`strike ${proc.amount}@${target.id}`);

    return procOutcome('landed', { amount: proc.amount, hasKilled: target.hp <= 0 });
  },

  explain: (proc) => ({ values: { amount: proc.amount } }),
});

/**
 * A copy of `value` with some fields replaced, keeping its type: how the tests build the invalid definitions that the
 * types refuse, to prove the load-time checks.
 */
export const invalid = <Value extends object>(value: Value, patch: Readonly<Record<string, unknown>>): Value => {
  const copy = { ...value };

  return Object.assign(copy, patch);
};

/** The value, which the test expects to be there; throws when it is not. */
export const defined = <Value>(value: Value | undefined): Value => {
  if (value === undefined) {
    throw new Error('Expected a value.');
  }

  return value;
};

/** A random source that returns the listed draws in turn (then 0.5) and counts them. */
export const scripted = (draws: readonly number[] = []): Random & { readonly count: () => number } => {
  let index = 0;

  return Object.assign(
    (): number => {
      const draw = draws[index] ?? 0.5;

      index += 1;

      return draw;
    },
    { count: () => index },
  );
};

/** A proc that logs a label when it runs (a named `run`). */
export const mark = (label: string, chance?: number): Proc<Game> => ({
  kind: 'run',
  hatch: 'mark',

  fn: (ctx: ProcContext<Game>) => {
    ctx.host.log.push(`${label}@${ctx.self.id}`);
  },

  ...(chance === undefined ? {} : { chance }),
});

/** Overrides of a test game's options. */
export interface GameOptions {
  /** The cooldown auras' options. */
  readonly cooldowns?: CooldownOptions<Game>;

  /** The bus's depth cap. */
  readonly busDepth?: number;

  /** Proc system overrides. */
  readonly procs?: Partial<Omit<ProcSystemOptions<Game>, 'kinds' | 'auras' | 'host'>>;

  /** Trigger system overrides. */
  readonly triggers?: Partial<Omit<TriggerSystemOptions<Game, Unit>, 'auras' | 'procs' | 'bus' | 'events'>>;
}

/** The bus of the test game: hits, kills and aura changes. */
const makeBus = (depth: number | undefined) =>
  createBus(
    {
      hit: (): HitEvent => ({ attacker: undefined, target: undefined, amount: 0, isCrit: false }),
      kill: (): KillEvent => ({ killer: undefined, victim: undefined }),
      aura: (): AuraEvent<Game> => createAuraEvent<Game>(),
    },
    depth === undefined ? {} : { maxDepth: depth },
  );

/** The test game's bus. */
type TestBus = ReturnType<typeof makeBus>;

/** Where a test hit lands and how hard. */
interface HitOptions {
  /** Who is struck. */
  readonly target?: Unit;

  /** How hard; 10 when absent. */
  readonly amount?: number;

  /** Whether it is a critical hit. */
  readonly isCrit?: boolean;
}

/** A small test game, as `makeGame` builds it. */
export interface TestGame<Name extends string> {
  /** Its bus: hits, kills and aura changes. */
  readonly bus: TestBus;

  /** Its aura system. */
  readonly auras: AuraSystem<Game>;

  /** Its proc system. */
  readonly procs: ProcSystem<Game>;

  /** Its trigger system. */
  readonly triggers: TriggerSystem;

  /** Its trigger events. */
  readonly events: Readonly<Record<Game['event'], TriggerEvent<Game>>>;

  /** Its aura registry, cooldown auras included. */
  readonly registry: AuraRegistry<Game, Name | CooldownName>;

  /** The id of every aura, by name. */
  readonly id: Readonly<Record<Name | CooldownName, AuraId>>;

  /** Everything the procs did, as lines. */
  readonly log: string[];

  /** The party, in order. */
  readonly party: readonly Unit[];

  /** Makes a unit, which joins the party. */
  readonly unit: (id: number) => Unit;

  /** Raises a hit by `attacker`. */
  readonly hit: (attacker: Unit, at?: HitOptions) => void;

  /** The host. */
  readonly host: ProcHost<Game> & GameHost;
}

/** The test bus's event kinds (every test game's bus numbers them the same: hit, kill, aura). */
export const KINDS = makeBus(undefined).kind;

/**
 * A small test game over `defs`: an aura system (one world clock of step 0.125 s), a proc system with the core kinds
 * and `strike`, and a trigger system over three events. Every unit made joins the one party, in order; unit `n` stands
 * at `(n, −n)`.
 */
export const makeGame = <const Name extends string>(
  defs: Readonly<Record<Name, AuraDef<Game>>>,
  options: GameOptions = {},
): TestGame<Name> => {
  const bus = makeBus(options.busDepth);
  const all = withTriggerCooldowns<Game, Name>(defs, { tags: ['cooldown'], ...options.cooldowns });
  const registry = defineAuras<Game, Name | CooldownName>(all.defs, { order: all.order });
  const log: string[] = [];
  const party: Unit[] = [];
  const holder: { procs?: ProcSystem<Game> } = {};

  const auras = createAuraSystem<Game>({
    registry,
    tags: TAGS,
    clocks: CLOCKS,
    events: { bus, changed: bus.kind.aura },
    host: { run: (procs, ctx) => holder.procs?.runAura(procs, ctx) },
  });

  const host: ProcHost<Game> & GameHost = {
    log,
    party: () => party,
    idOf: (unit) => unit.id,
    positionOf: (unit) => ({ x: unit.id, z: -unit.id }),

    grant: (unit, resource, amount) => {
      log.push(`grant ${resource}x${amount}@${unit.id}`);
    },
  };

  const procs = createProcSystem<Game>({
    kinds: createProcRegistry<Game>({ ...CORE_PROCS, strike: STRIKE }),
    auras,
    host,
    resources: ['gold', 'shards'],
    bus,
    ...options.procs,
  });

  holder.procs = procs;

  const events = {
    hit: triggerEvent<HitEvent, Game>(bus.kind.hit, {
      unit: (hit) => hit.attacker,

      filters: {
        minAmount: (hit, least) => hit.amount >= least,
        isCrit: (hit, wanted) => hit.isCrit === (wanted === 1),
      },
    }),
    kill: triggerEvent<KillEvent, Game>(bus.kind.kill, { unit: (kill) => kill.killer }),
    aura: auraTriggerEvent<Game>(bus.kind.aura),
  };

  const triggers: TriggerSystem = createTriggerSystem<Game, Unit>({
    auras,
    procs,
    bus,
    events,
    conditions: { table: CONDITIONS, host: (unit) => unit },
    ...options.triggers,
  });

  const unit = (id: number): Unit => {
    const made: Unit = { id, hp: 100, auras: auras.createState() };

    party.push(made);

    return made;
  };

  const hit = (
    attacker: Unit,
    at: { readonly target?: Unit; readonly amount?: number; readonly isCrit?: boolean } = {},
  ) => {
    const payload = bus.payload(bus.kind.hit);

    payload.attacker = attacker;
    payload.target = at.target;
    payload.amount = at.amount ?? 10;
    payload.isCrit = at.isCrit ?? false;
    bus.raise(bus.kind.hit, payload);
  };

  return { bus, auras, procs, triggers, events, registry, id: registry.id, log, party, unit, hit, host };
};
