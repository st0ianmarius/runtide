/** Whether `record` has an own property for every key, which narrows it to a record over exactly those keys. */
const hasEvery = <Key extends string, Value>(
  record: Readonly<Record<string, Value>>,
  keys: readonly Key[],
): record is Readonly<Record<Key, Value>> => keys.every((key) => Object.hasOwn(record, key));

/** Builds a frozen record with one entry per key, in key order, each value made by `value`. */
export const recordOf = <Key extends string, Value>(
  keys: readonly Key[],
  value: (key: Key) => Value,
): Readonly<Record<Key, Value>> => {
  const record = Object.freeze(Object.fromEntries(keys.map((key) => [key, value(key)])));

  if (!hasEvery(record, keys)) {
    throw new Error('A record lost a key while it was built.');
  }

  return record;
};

/** Whether a value is a plain object literal or array (what a definition is made of), not a class instance. */
const isPlainData = (value: object): boolean => {
  const prototype: unknown = Object.getPrototypeOf(value);

  return Array.isArray(value) || prototype === Object.prototype || prototype === null;
};

/**
 * Freezes a definition and every plain object and array inside it, so a hook or a system that writes to shared data
 * fails at once in development. Functions, typed arrays and class instances are left as they are.
 */
export const deepFreeze = (value: unknown): void => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value) || !isPlainData(value)) {
    return;
  }

  Object.freeze(value);

  for (const key of Reflect.ownKeys(value)) {
    const child: unknown = Reflect.get(value, key);

    deepFreeze(child);
  }
};
