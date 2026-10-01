import { type ScaledSnapshot, snapshotScaled } from '../modifiers/index.ts';

/** An area's own reusable snapshot when its cast can refresh its stats. */
export class CapturedStats {
  readonly stats: Record<string, unknown> = {};
  readonly scaled: Record<string, number | ScaledSnapshot> = {};

  constructor() {
    Object.setPrototypeOf(this.stats, null);
    Object.setPrototypeOf(this.scaled, null);
  }

  /** Copies the numeric stats and freezes each scaled value's caster view. */
  take(stats: Readonly<Record<string, unknown>>, scaled: Readonly<Record<string, number | ScaledSnapshot>>): void {
    for (const key of Object.keys(this.stats)) {
      if (!Object.hasOwn(stats, key)) {
        Reflect.deleteProperty(this.stats, key);
      }
    }

    Object.assign(this.stats, stats);

    for (const key of Object.keys(this.scaled)) {
      if (!Object.hasOwn(scaled, key)) {
        Reflect.deleteProperty(this.scaled, key);
      }
    }

    for (const key of Object.keys(scaled)) {
      const value = scaled[key];
      const previous = this.scaled[key];

      if (value !== undefined) {
        this.scaled[key] =
          typeof value === 'number'
            ? value
            : snapshotScaled(
                value.value,
                value.caster,
                value.rank,
                typeof previous === 'object' ? previous : undefined
              );
      }
    }
  }

  /** Drops references a function-valued stat definition might have returned. */
  clear(): void {
    for (const key of Object.keys(this.stats)) {
      this.stats[key] = undefined;
    }
  }
}
