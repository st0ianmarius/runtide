import { createRegistry, type Id, type Registry } from '../core/index.ts';
import { recordOf } from '../core/records.ts';

/** The id of a condition the game registered: its position in the game's condition table. */
export type ConditionId = Id<'conditions'>;

/**
 * A game-supplied condition test (§I.5.6 hatch 5): whether it holds for the read's host (the bearer's state and world,
 * as the game shapes them) with the condition's numeric argument. It must be deterministic; it may ask the world
 * lazily, since it runs only when a modifier waiting on it is otherwise live.
 */
export type ConditionTest<Host> = (host: Host, arg: number) => boolean;

/** A registered condition: its test. */
export interface ConditionDef<Host> {
  /** Whether the condition holds for a host and an argument. */
  readonly test: ConditionTest<Host>;
}

/** The game's condition table: a registry of tests with dense ids. The framework bakes in no condition of its own. */
export type ConditionTable<Name extends string = string, Host = never> = Registry<
  'conditions',
  Extract<Name, string>,
  ConditionDef<Host>,
  never,
  never
>;

/**
 * Registers the game's condition tests: `defineConditions({ healthBelow: (host, share) => host.hp < host.maxHp *
 * share })`. Modifiers name them (`when: { is: 'healthBelow', arg: 0.4 }`); a read evaluates them every time and never
 * caches a result, since what they read (health, the world) changes without the sheet knowing (§I.5.4).
 */
export const defineConditions = <Host, const Name extends string>(
  tests: Readonly<Record<Name, ConditionTest<Host>>>,
): ConditionTable<Name, Host> => {
  const names = Object.keys(tests).filter((key): key is Name => Object.hasOwn(tests, key));

  return createRegistry<Readonly<Record<Name, ConditionDef<Host>>>, 'conditions'>(
    recordOf(names, (name) => ({ test: tests[name] })),
    { kind: 'conditions' },
  );
};
