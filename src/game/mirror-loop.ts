// Hot path: `step` runs once per consumed input and `receive` once per snapshot, so the loops are indexed and the
// presses reused.
/* oxlint-disable typescript/prefer-for-of */
import type { AbilitySystem, Press } from '../abilities/index.ts';
import type { AuraSystem } from '../auras/index.ts';
import { createByteReader, type CueBuffer, type CueEchoes, decodeCue } from '../cues/index.ts';
import type { ModifierSystem } from '../modifiers/index.ts';
import type { PredictedReport } from '../prediction/index.ts';
import type { SpellSystem } from '../spells/index.ts';
import { InputRing } from './inputs.ts';
import type { Mirror, MirrorOptions, MirrorPress, Unconfirmed } from './mirror-types.ts';
import type { MirrorSnapshot } from './snapshot.ts';
import type { GameTypes } from './spec.ts';
import type { GameWire } from './wire.ts';

/** What a mirror is made of, built by `createMirror`. */
export interface MirrorParts<G extends GameTypes> {
  /** The predicted bearer. */
  readonly bearer: G['bearer'];

  /** The acknowledged bearer. */
  readonly acked: G['bearer'];

  /** The modifier system, if any. */
  readonly modifiers: Mirror<G>['modifiers'];

  /** The aura system. */
  readonly auras: AuraSystem<G>;

  /** The spell system. */
  readonly spells: SpellSystem<G>;

  /** The ability system. */
  readonly abilities: AbilitySystem<G>;

  /** The predicted cues, if any. */
  readonly cues: CueBuffer | undefined;

  /** The heard cues, if any. */
  readonly heard: CueBuffer | undefined;

  /** The echo ring, if any. */
  readonly echoes: CueEchoes | undefined;

  /** The build's predicted report. */
  readonly report: PredictedReport;

  /** The wire tables. */
  readonly wire: GameWire;

  /** The ticked clocks, in declared order. */
  readonly ticks: readonly G['clock'][];

  /** Resets the game's predicted motion state on a reseed, before the replay; none when absent. */
  readonly onReseed: MirrorOptions<G>['onReseed'];
}

/** The press a replay hands `tryActivate`, reused. */
class ReplayPress<G extends GameTypes> implements Press<G> {
  input: G['input'] | undefined = undefined;
  key: number | undefined = undefined;
}

/** A prediction mirror's state and its reconcile loop (`Mirror`). */
export class PredictionMirror<G extends GameTypes> implements Mirror<G> {
  readonly bearer: G['bearer'];
  readonly acked: G['bearer'];
  readonly modifiers: ModifierSystem<G['bearer'], G['stat'], G['condition'], G['valueKind'], G['source']> | undefined;
  readonly auras: AuraSystem<G>;
  readonly spells: SpellSystem<G>;
  readonly abilities: AbilitySystem<G>;
  readonly cues: CueBuffer | undefined;
  readonly heard: CueBuffer | undefined;
  readonly echoes: CueEchoes | undefined;
  readonly report: PredictedReport;
  readonly wire: GameWire;
  readonly ticks: readonly G['clock'][];
  #ack = 0;
  #lastKey = 0;
  #reseeds = 0;
  readonly #inputs = new InputRing<G['input']>();
  readonly #replay = new ReplayPress<G>();
  readonly #onReseed: MirrorOptions<G>['onReseed'];

  constructor(parts: MirrorParts<G>) {
    this.bearer = parts.bearer;
    this.acked = parts.acked;
    this.modifiers = parts.modifiers;
    this.auras = parts.auras;
    this.spells = parts.spells;
    this.abilities = parts.abilities;
    this.cues = parts.cues;
    this.heard = parts.heard;
    this.echoes = parts.echoes;
    this.report = parts.report;
    this.wire = parts.wire;
    this.ticks = parts.ticks;
    this.#onReseed = parts.onReseed;
  }

  get ack(): number {
    return this.#ack;
  }

  get lastKey(): number {
    return this.#lastKey;
  }

  get pending(): number {
    return this.#inputs.size;
  }

  get reseeds(): number {
    return this.#reseeds;
  }

  readonly step = (pressed: number, press: MirrorPress<G>): number => {
    const { key } = press;

    if (!(Number.isSafeInteger(key) && key > this.#lastKey)) {
      throw new RangeError(`A mirror steps inputs by increasing whole keys from 1: ${key} after ${this.#lastKey}.`);
    }

    const { cues, echoes } = this;
    const from = cues?.count ?? 0;
    const fired = this.#advance(this.bearer, pressed, press);

    for (let i = from; cues !== undefined && echoes !== undefined && i < cues.count; i++) {
      const event = cues.events[i];

      if (event !== undefined) {
        echoes.note(event);
      }
    }

    this.#inputs.push(key, pressed, press.input);
    this.#lastKey = key;

    return fired;
  };

  readonly receive = (snapshot: MirrorSnapshot, unconfirmed?: Unconfirmed): boolean => {
    const { ack } = snapshot;

    if (!Number.isSafeInteger(ack) || ack < 0 || ack > this.#lastKey) {
      throw new RangeError(`A snapshot acknowledges a key the mirror stepped (0 to ${this.#lastKey}); got ${ack}.`);
    }

    if (ack < this.#ack) {
      return false;
    }

    this.#hear(snapshot);

    // The cues the acknowledged bearer's steps and a replay fire again were played as they were first predicted.
    const mark = this.cues?.count ?? 0;
    const isReseeded = this.#reconcile(snapshot);

    this.cues?.truncate(mark);
    this.#ack = ack;
    this.echoes?.settle(ack, unconfirmed);

    return isReseeded;
  };

  /** Steps the acknowledged bearer up to the snapshot's ack, then reseeds and replays on a difference; whether it did. */
  #reconcile(snapshot: MirrorSnapshot): boolean {
    const { auras, acked, bearer } = this;
    const inputs = this.#inputs;

    while (inputs.size > 0 && inputs.keyAt(0) <= snapshot.ack) {
      this.#replayAt(acked, 0);
      inputs.shift();
    }

    if (auras.matchesSeed(acked, snapshot)) {
      return false;
    }

    auras.seed(acked, snapshot);
    auras.seed(bearer, snapshot);
    this.#onReseed?.(bearer, snapshot);

    for (let i = 0; i < inputs.size; i++) {
      this.#replayAt(bearer, i);
    }

    this.#reseeds += 1;

    return true;
  }

  /** Steps a bearer over the `index`th held input again. */
  #replayAt(bearer: G['bearer'], index: number): void {
    const inputs = this.#inputs;
    const press = this.#replay;

    press.key = inputs.keyAt(index);
    press.input = inputs.inputAt(index);

    try {
      this.#advance(bearer, inputs.maskAt(index), press);
    } finally {
      press.input = undefined;
    }
  }

  /** One motion step of a bearer: its ticked clocks in declared order, then the press. */
  #advance(bearer: G['bearer'], pressed: number, press: Press<G>): number {
    const { auras, ticks } = this;

    for (let i = 0; i < ticks.length; i++) {
      const clock = ticks[i];

      if (clock !== undefined) {
        auras.tick(bearer, clock);
      }
    }

    return this.abilities.tryActivate(bearer, pressed, press);
  }

  /** Reads a snapshot's cues into `heard`, dropping each echo of a predicted one. */
  #hear(snapshot: MirrorSnapshot): void {
    const { heard, echoes } = this;

    heard?.clear();

    if (snapshot.cues.length === 0) {
      return;
    }

    if (heard === undefined || echoes === undefined) {
      throw new RangeError('A snapshot carries cues to a mirror whose spec has none (spells.cues).');
    }

    const from = createByteReader(snapshot.cues);
    const count = from.uint();

    for (let i = 0; i < count; i++) {
      if (echoes.isEcho(decodeCue(from, heard))) {
        heard.truncate(heard.count - 1);
      }
    }
  }
}
