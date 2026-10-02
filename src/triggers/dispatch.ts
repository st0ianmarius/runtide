// Hot path: every heard event walks its bearers' auras here, so the loops are indexed.
/* oxlint-disable typescript/prefer-for-of */
import { type ActiveAura, type AuraSystem, NO_SOURCE } from '../auras/index.ts';
import { toId } from '../core/ids.ts';
import type { EventKind, Random } from '../core/index.ts';
import type { ProcOrigin, ProcSystem } from '../procs/index.ts';
import type { CompiledTrigger, TriggerCheck, TriggerConditions, TriggerTables } from './compile.ts';
import type { TriggerEvent } from './events.ts';
import type { TriggerId } from './trigger-id.ts';
import type { TriggerTypes } from './trigger-types.ts';

/**
 * What a trigger policy (a game's chance or cooldown rule) is told about the trigger it decides for. It is reused
 * between calls, so a policy reads it while it runs and never keeps it.
 */
export interface TriggerContext<G extends TriggerTypes> {
  /** The trigger's id. */
  readonly trigger: TriggerId;

  /** The aura it lives on. */
  readonly aura: ActiveAura<G>;

  /** Its index in that aura's `triggers`. */
  readonly index: number;

  /** Its owner: the aura's bearer. */
  readonly owner: G['bearer'];

  /** The unit the event is about (the owner, unless the trigger hears its party). */
  readonly eventUnit: G['bearer'];

  /** The event kind answered. */
  readonly event: EventKind<unknown>;

  /** The event's payload, reused by the bus: read it, never keep it. */
  readonly payload: unknown;
}

/** What dispatch runs with. */
export interface DispatchParts<G extends TriggerTypes, Host> {
  /** The aura system. */
  readonly auras: AuraSystem<G>;

  /** The proc system. */
  readonly procs: ProcSystem<G>;

  /** The compiled triggers. */
  readonly tables: TriggerTables<G, Host>;

  /** The game conditions. */
  readonly conditions: TriggerConditions<G, Host> | undefined;

  /** The triggers' own stream. */
  readonly random: Random | undefined;

  /** A game's own chance rule. */
  readonly rollChance: ((chance: number, ctx: TriggerContext<G>) => boolean) | undefined;

  /** A game's own cooldown length. */
  readonly cooldownSeconds: ((icd: number, ctx: TriggerContext<G>) => number) | undefined;
}

/**
 * One nesting level of dispatch, reused: the event answered, one bearer's gathered triggers, the trigger deciding (what
 * a policy reads), and the origin of the procs it runs. Answers within one level never overlap: a nested event takes
 * the next level.
 */
class DispatchFrame<G extends TriggerTypes, Host> implements TriggerContext<G>, ProcOrigin<G> {
  event: EventKind<unknown>;

  /** The index of the trigger event answered, in the order the game declared its events: what triggers are found by. */
  slot = 0;

  payload: unknown;
  eventUnit: G['bearer'];
  owner: G['bearer'];

  /** The event's other unit, which the procs reach as `other`; `undefined` for an event with none. */
  other: G['bearer'] | undefined = undefined;

  trigger: TriggerId = toId<'triggers'>(0);
  index = 0;
  source = NO_SOURCE;
  readonly gathered: CompiledTrigger<G, Host>[] = [];
  readonly holders: ActiveAura<G>[] = [];
  readonly handles: number[] = [];

  /** How many entries of the gather lists are this answer's: the lists are overwritten, never shrunk. */
  count = 0;

  /** The party members heard, copied before any answers, so procs that change the party change no one's turn. */
  readonly members: (G['bearer'] | undefined)[] = [];
  #aura: ActiveAura<G> | undefined = undefined;

  constructor(event: TriggerEvent<G>, payload: unknown, unit: G['bearer']) {
    this.event = event.kind;
    this.payload = payload;
    this.eventUnit = unit;
    this.owner = unit;
  }

  /** The procs act for the owner. */
  get self(): G['bearer'] {
    return this.owner;
  }

  /** The aura of the trigger deciding. */
  get aura(): ActiveAura<G> {
    if (this.#aura === undefined) {
      throw new Error('No trigger is deciding in this dispatch frame.');
    }

    return this.#aura;
  }

  /** Takes a new event, forgetting the last trigger. */
  answer(event: TriggerEvent<G>, payload: unknown, unit: G['bearer']): void {
    this.event = event.kind;
    this.payload = payload;
    this.eventUnit = unit;
    this.owner = unit;
    this.other = event.other?.(payload);
    this.#aura = undefined;
  }

  /** Makes a trigger (its id and index) on an aura the one deciding. */
  hold(trigger: TriggerId, index: number, aura: ActiveAura<G>): void {
    this.trigger = trigger;
    this.index = index;
    this.#aura = aura;
  }
}

/** One draw on the triggers' own stream. */
const roll = (random: Random | undefined): number => {
  if (random === undefined) {
    throw new TypeError('A trigger with a chance below 1 needs the trigger system to have a random stream.');
  }

  return random();
};

/** Whether a condition holds for a frame's owner, against the event's other unit when it has one. */
const testsOwner = <G extends TriggerTypes, Host>(
  conditions: TriggerConditions<G, Host>,
  check: TriggerCheck<G, Host>,
  frame: DispatchFrame<G, Host>
): boolean => {
  const { other } = frame;

  return (
    check.test?.(conditions.host(frame.owner), check.arg, other === undefined ? undefined : conditions.host(other)) ===
    true
  );
};

/** Whether every `when` entry holds, in order: filters on the payload, conditions on the owner. */
const passes = <G extends TriggerTypes, Host>(
  parts: DispatchParts<G, Host>,
  trigger: CompiledTrigger<G, Host>,
  frame: DispatchFrame<G, Host>
): boolean => {
  const { checks } = trigger;

  for (let i = 0; i < checks.length; i++) {
    const check = checks[i];

    if (check === undefined) {
      continue;
    }

    const holds =
      check.test === undefined
        ? check.spec?.test(frame.payload, check.arg) === true
        : parts.conditions !== undefined && testsOwner(parts.conditions, check, frame);

    if (!holds) {
      return false;
    }
  }

  return true;
};

/** Whether a trigger's chance lets it fire: its odds, or its rule read now and clamped, rolled only below 1. */
const isLucky = <G extends TriggerTypes, Host>(
  parts: DispatchParts<G, Host>,
  trigger: CompiledTrigger<G, Host>,
  frame: DispatchFrame<G, Host>
): boolean => {
  const chance = typeof trigger.chance === 'number' ? trigger.chance : Math.min(1, Math.max(0, trigger.chance(frame)));

  // No draw outside (0, 1), as a proc's chance: a chance read as 0 (or NaN) must not shift the stream.
  if (!(chance > 0)) {
    return false;
  }

  return chance >= 1 || (parts.rollChance?.(chance, frame) ?? roll(parts.random) < chance);
};

/**
 * Fires one gathered trigger whose aura is still on its owner: its conditions, then whether its cooldown is running,
 * then its chance (rolled only below 1), then its cooldown starts, then its procs run for the owner. One too deep for
 * its procs to run (the proc system's depth cap) has its list dropped as it would be, rolling no chance and starting no
 * cooldown, so the next time it fires within the cap it is not held back.
 */
const fire = <G extends TriggerTypes, Host>(
  parts: DispatchParts<G, Host>,
  trigger: CompiledTrigger<G, Host>,
  frame: DispatchFrame<G, Host>
): void => {
  const { auras, procs } = parts;
  const { cooldown } = trigger;

  if (!passes(parts, trigger, frame) || (cooldown !== undefined && auras.has(frame.owner, cooldown))) {
    return;
  }

  // Too deep: the list goes to the proc system all the same, which drops it and counts the drop.
  if (!procs.canRun) {
    procs.run(trigger.procs, frame);

    return;
  }

  if (!isLucky(parts, trigger, frame)) {
    return;
  }

  const source = procs.host.idOf?.(frame.owner) ?? NO_SOURCE;

  if (cooldown !== undefined) {
    auras.apply(frame.owner, {
      aura: cooldown,
      duration: parts.cooldownSeconds?.(trigger.icd, frame),
      source
    });
  }

  frame.source = source;
  procs.run(trigger.procs, frame);
};

/** Gathers one aura's triggers (its `party` ones only, for a listener), in authored order. */
const gatherFrom = <G extends TriggerTypes, Host>(
  frame: DispatchFrame<G, Host>,
  at: {
    readonly aura: ActiveAura<G>;
    readonly own: readonly CompiledTrigger<G, Host>[];
    readonly isListener: boolean;
  }
): void => {
  const { aura, own } = at;

  for (let j = 0; j < own.length; j++) {
    const trigger = own[j];

    if (trigger !== undefined && (!at.isListener || trigger.isParty)) {
      frame.gathered[frame.count] = trigger;
      frame.holders[frame.count] = aura;
      frame.handles[frame.count] = aura.handle;
      frame.count += 1;
    }
  }
};

/** Gathers one bearer's triggers answering the frame's event, in aura order then authored order, into the frame. */
const gather = <G extends TriggerTypes, Host>(
  parts: DispatchParts<G, Host>,
  frame: DispatchFrame<G, Host>,
  isListener: boolean
): void => {
  const { slot } = frame;
  const bits = (isListener ? parts.tables.partyAnswers : parts.tables.answers)[slot];
  const byAura = parts.tables.byEvent[slot] ?? [];
  const list = parts.auras.list(frame.owner);

  for (let i = 0; bits !== undefined && i < list.length; i++) {
    const aura = list[i];
    const own = aura !== undefined && bits.has(aura.id) ? byAura[aura.id] : undefined;

    if (aura !== undefined && own !== undefined) {
      gatherFrom(frame, { aura, own, isListener });
    }
  }
};

/** Gathers the owner's triggers answering the frame's event, then fires those whose aura is still on the owner. */
const answer = <G extends TriggerTypes, Host>(
  parts: DispatchParts<G, Host>,
  frame: DispatchFrame<G, Host>,
  isListener: boolean
): void => {
  const { gathered, holders, handles } = frame;

  frame.count = 0;
  gather(parts, frame, isListener);

  // Nested events answer on the next frame, so this frame's gathered entries stay as they are while they fire.
  for (let i = 0, count = frame.count; i < count; i++) {
    const trigger = gathered[i];
    const aura = holders[i];

    if (trigger !== undefined && aura?.isActive === true && aura.handle === handles[i]) {
      frame.hold(trigger.id, trigger.index, aura);
      fire(parts, trigger, frame);
    }
  }
};

/**
 * Builds the dispatcher: for an event, the triggers of the unit it is about, then each other party member's
 * `party` triggers in party order; within a bearer, its auras' triggers in aura order then authored order, gathered
 * into a scratch list before any runs, each running only while its aura is still on its bearer.
 */
export const createDispatcher = <G extends TriggerTypes, Host>(
  parts: DispatchParts<G, Host>
): ((slot: number, event: TriggerEvent<G>, payload: unknown) => void) => {
  const frames: DispatchFrame<G, Host>[] = [];
  let depth = 0;

  const party = (frame: DispatchFrame<G, Host>, unit: G['bearer']): void => {
    const { members } = frame;
    const heard = parts.procs.host.party?.(unit) ?? [];
    const count = heard.length;

    for (let i = 0; i < count; i++) {
      members[i] = heard[i];
    }

    for (let i = 0; i < count; i++) {
      const member = members[i];

      if (member !== undefined && member !== unit) {
        frame.owner = member;
        answer(parts, frame, true);
      }
    }
  };

  return (slot, event, payload) => {
    const unit = event.unit(payload);

    if (unit === undefined) {
      return;
    }

    const frame = frames[depth] ?? new DispatchFrame<G, Host>(event, payload, unit);

    frames[depth] = frame;
    frame.answer(event, payload, unit);
    frame.slot = slot;
    depth += 1;

    try {
      answer(parts, frame, false);

      if (parts.tables.partyAnswers[slot]?.isEmpty() === false) {
        party(frame, unit);
      }
    } finally {
      depth -= 1;
    }
  };
};
