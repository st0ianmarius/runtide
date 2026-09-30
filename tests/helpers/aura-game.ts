import {
  type AuraBearer,
  type AuraDef,
  type AuraHost,
  type AuraId,
  type AuraRegistry,
  type AuraState,
  type AuraSystem,
  type AuraSystemBase,
  type AuraTypes,
  createAuraSystem,
  defineAura,
  defineAuras,
  defineAuraTags
} from '../../src/auras/index.ts';

/** A test unit: an id, some health, and its auras. */
export interface Unit extends AuraBearer {
  /** Its entity id. */
  readonly id: number;

  /** Its health, which procs in the tests change. */
  hp: number;

  /** Its auras. */
  readonly auras: AuraState;
}

/** The game fields of a test aura: a snapshot captured on landing. */
interface TestExt {
  /** A number captured from the application's payload. */
  snapshot: number;
}

/** The test game's aura types. */
export interface TestAuras extends AuraTypes {
  /** A test unit. */
  readonly bearer: Unit;

  /** Procs are strings the host logs. */
  readonly proc: string;

  /** The test stats. */
  readonly stat: 'damage' | 'armor' | 'speed';

  /** No conditions. */
  readonly condition: never;

  /** No value kinds. */
  readonly valueKind: never;

  /** The test sources. */
  readonly source: 'base' | 'auras' | 'late';

  /** The test tags. */
  readonly tag: 'magic' | 'poison' | 'stun' | 'immune' | 'boon';

  /** Two clocks with exact binary steps. */
  readonly clock: 'world' | 'motion';

  /** Two bearer states. */
  readonly state: 'down' | 'dead';

  /** A blow is its damage. */
  readonly blow: number;

  /** A force is its strength. */
  readonly force: number;

  /** Game fields. */
  readonly ext: TestExt;

  /** A payload is a number. */
  readonly payload: number;
}

/** The step of both test clocks: an exact binary fraction, so every stamp is exact. */
const DT = 0.125;

/** The two test clocks, `world` then `motion`, both on `DT`. */
export const CLOCKS = { world: { dt: DT }, motion: { dt: DT } } as const;

/** The test tags. */
export const TAGS = defineAuraTags(['magic', 'poison', 'stun', 'immune', 'boon']);

/** `defineAura` fixed to the test types. */
export const aura = defineAura<TestAuras>;

/** Overrides of a test game's system options. */
export type GameOptions = Partial<Omit<AuraSystemBase<TestAuras>, 'registry' | 'tags'>>;

/** A small test game. */
export interface Game<Name extends string> {
  /** Its aura system. */
  readonly auras: AuraSystem<TestAuras>;

  /** The id of every aura, by name. */
  readonly id: Readonly<Record<Name, AuraId>>;

  /** Its aura registry. */
  readonly registry: AuraRegistry<TestAuras, Name>;

  /** Every proc the host ran, as `proc@unit`. */
  readonly log: string[];

  /** Makes a unit, silent or not. */
  readonly unit: (id?: number, isSilent?: boolean) => Unit;

  /** Ticks a unit's clock `n` times. */
  readonly run: (bearer: Unit, n: number, clock?: 'world' | 'motion') => void;
}

/**
 * A small test game over `defs`: its aura system with two clocks (`world`, `motion`) of step `DT`, two states, a
 * host that logs every proc as `proc@unit`, and a unit factory.
 */
export const makeGame = <const Name extends string>(
  defs: Readonly<Record<Name, AuraDef<TestAuras>>>,
  options: GameOptions = {}
): Game<Name> => {
  const registry = defineAuras(defs);
  const log: string[] = [];

  const host: AuraHost<TestAuras> = {
    run: (procs, ctx) => {
      for (const proc of procs) {
        log.push(`${proc}@${ctx.bearer.id}`);
      }
    }
  };

  const auras = createAuraSystem<TestAuras>({
    registry,
    tags: TAGS,
    clocks: CLOCKS,
    states: ['down', 'dead'],
    host,
    createExt: () => ({ snapshot: 0 }),

    resetExt: (ext) => {
      ext.snapshot = 0;
    },

    ...options
  });

  const unit = (id = 1, isSilent = false): Unit => ({
    id,
    hp: 100,
    auras: auras.createState({ isSilent })
  });

  const run = (bearer: Unit, n: number, clock: 'world' | 'motion' = 'world'): void => {
    for (let i = 0; i < n; i++) {
      auras.tick(bearer, clock);
    }
  };

  return { auras, id: registry.id, registry, log, unit, run };
};
