import { createRegistry, type Id, type Registry } from '../core/index.ts';
import { recordOf } from '../core/records.ts';

/** The id of a condition the game registered: its position in the game's condition table. */
export type ConditionId = Id<'conditions'>;

/**
 * A game-supplied condition test: whether it holds for the read's host (the bearer's state and world,
 * as the game shapes them) with the condition's numeric argument. It must be deterministic; it may ask the world
 * lazily, since it runs only when what waits on it would otherwise count.
 */
export type ConditionTest<Host> = (host: Host, arg: number) => boolean;

/** A condition with its flags: what `defineConditions` takes in place of a bare test. */
export interface ConditionSpec<Host> {
  /** Whether the condition holds for a host and an argument. */
  readonly test: ConditionTest<Host>;

  /**
   * Whether a prediction mirror may evaluate it: it reads only what the mirror has (the bearer's
   * synced state, its predicted auras). False when absent.
   */
  readonly mirrorSafe?: boolean;

  /**
   * Whether it asks the world (a query, a line of sight), which costs more than reading the bearer: in `all` and `any`
   * it is tested after the tests that do not (lazy world conditions). False when absent.
   */
  readonly world?: boolean;
}

/** A registered condition: its test and flags. */
export interface ConditionDef<Host> {
  /** Whether the condition holds for a host and an argument. */
  readonly test: ConditionTest<Host>;

  /** Whether a prediction mirror may evaluate it. */
  readonly isMirrorSafe: boolean;

  /** Whether it asks the world. */
  readonly isWorld: boolean;
}

/** The game's condition table: a registry of tests with dense ids. The framework bakes in no condition of its own. */
export type ConditionTable<Name extends string = string, Host = never> = Registry<
  'conditions',
  Extract<Name, string>,
  ConditionDef<Host>,
  never
>;

/** A condition's definition from a bare test or a spec with flags. */
const defOf = <Host>(spec: ConditionTest<Host> | ConditionSpec<Host>): ConditionDef<Host> =>
  typeof spec === 'function'
    ? { test: spec, isMirrorSafe: false, isWorld: false }
    : { test: spec.test, isMirrorSafe: spec.mirrorSafe === true, isWorld: spec.world === true };

/**
 * Registers the game's condition tests: `defineConditions({ healthBelow: (host, share) => host.hp < host.maxHp *
 * share, inSight: { test: …, world: true } })`. Conditions name them (`{ is: 'healthBelow', arg: 0.4 }`) and compose
 * them (`all`, `any`, `not`); a read evaluates them every time and never caches a result, since what they read
 * (health, the world) changes without the reader knowing.
 */
export const defineConditions = <Host, const Name extends string>(
  tests: Readonly<Record<Name, ConditionTest<Host> | ConditionSpec<Host>>>,
): ConditionTable<Name, Host> => {
  const names = Object.keys(tests).filter((key): key is Name => Object.hasOwn(tests, key));

  return createRegistry<Readonly<Record<Name, ConditionDef<Host>>>, 'conditions'>(
    recordOf(names, (name) => defOf(tests[name])),
    { kind: 'conditions' },
  );
};
