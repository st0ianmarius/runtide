// Hot path: a mirror pushes one input per motion step and shifts the acknowledged ones per snapshot; nothing allocates
// once the ring has grown to the inputs in flight.

/**
 * The inputs a prediction mirror stepped that the server has not acknowledged yet, oldest first: each one's key, press
 * mask and input, for a replay. A ring that doubles when full.
 */
export class InputRing<Input> {
  #keys: number[] = [];
  #masks: number[] = [];
  #inputs: (Input | undefined)[] = [];
  #head = 0;
  #size = 0;

  /** How many inputs it holds. */
  get size(): number {
    return this.#size;
  }

  /** The key of the `index`th oldest input. */
  keyAt(index: number): number {
    return this.#keys[this.#slot(index)] ?? 0;
  }

  /** The press mask of the `index`th oldest input. */
  maskAt(index: number): number {
    return this.#masks[this.#slot(index)] ?? 0;
  }

  /** The input of the `index`th oldest input. */
  inputAt(index: number): Input | undefined {
    return this.#inputs[this.#slot(index)];
  }

  /** Appends an input as the newest. */
  push(key: number, mask: number, input: Input | undefined): void {
    if (this.#size === this.#keys.length) {
      this.#grow();
    }

    const slot = this.#slot(this.#size);

    this.#keys[slot] = key;
    this.#masks[slot] = mask;
    this.#inputs[slot] = input;
    this.#size += 1;
  }

  /** Drops the oldest input. */
  shift(): void {
    if (this.#size === 0) {
      return;
    }

    this.#inputs[this.#head] = undefined;
    this.#head = (this.#head + 1) % this.#keys.length;
    this.#size -= 1;
  }

  /** The ring slot of the `index`th oldest input. */
  #slot(index: number): number {
    return (this.#head + index) % Math.max(1, this.#keys.length);
  }

  /** Doubles the ring (to 16 the first time), keeping its inputs oldest first from slot 0. */
  #grow(): void {
    const capacity = Math.max(16, this.#keys.length * 2);
    const keys: number[] = [];
    const masks: number[] = [];
    const inputs: (Input | undefined)[] = [];

    for (let i = 0; i < capacity; i++) {
      const isHeld = i < this.#size;

      keys.push(isHeld ? this.keyAt(i) : 0);
      masks.push(isHeld ? this.maskAt(i) : 0);
      inputs.push(isHeld ? this.inputAt(i) : undefined);
    }

    this.#keys = keys;
    this.#masks = masks;
    this.#inputs = inputs;
    this.#head = 0;
  }
}
