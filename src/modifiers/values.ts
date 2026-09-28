import { createRegistry, type Id, type Registry } from '../core/index.ts';
import { recordOf } from '../core/records.ts';

/** The id of a value kind the game registered: its position in the game's value table. */
export type ValueId = Id<'values'>;

/**
 * A game-supplied value read (§II.6 M3): a number from the read's host and the modifier's numeric argument, such as
 * `byMissingHealth(max)` giving `1 + max × (1 − hp / maxHp)`. It must be deterministic.
 */
export type ValueRead<Host> = (host: Host, arg: number) => number;

/** A registered value kind: its read. */
export interface ValueDef<Host> {
  /** The number a modifier of this kind lands with, before stacking. */
  readonly read: ValueRead<Host>;
}

/** The game's value table: a registry of value reads with dense ids. */
export type ValueTable<Name extends string = string, Host = never> = Registry<
  'values',
  Extract<Name, string>,
  ValueDef<Host>,
  never,
  never
>;

/**
 * Registers the game's value kinds, which a modifier's value can name (`hostValue('missingHealth', 0.5)`) so that it is
 * still data the client can explain, while its number comes from the bearer's state at each read.
 */
export const defineValues = <Host, const Name extends string>(
  reads: Readonly<Record<Name, ValueRead<Host>>>,
): ValueTable<Name, Host> => {
  const names = Object.keys(reads).filter((key): key is Name => Object.hasOwn(reads, key));

  return createRegistry<Readonly<Record<Name, ValueDef<Host>>>, 'values'>(
    recordOf(names, (name) => ({ read: reads[name] })),
    { kind: 'values' },
  );
};
