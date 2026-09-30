import { stepAreaAuras } from './area-auras.ts';
import type { AreaTrigger } from './area-trigger.ts';
import type { AreaTriggerTypes } from './area-types.ts';
import { ANCHOR_OWNER } from './define-area-triggers.ts';
import type { AreaPhase } from './delivery-def.ts';
import { endArea } from './ender.ts';
import type { AreaEngine } from './engine.ts';
import { catchAlong, deliver, recordHit } from './hits.ts';
import { stepPulses } from './pulses.ts';

/** The order of a frame's parts when a kind declares none. */
const DEFAULT_ORDER: readonly AreaPhase[] = Object.freeze(['move', 'contact', 'frame', 'pulses', 'auras']);

/** Places an area trigger's shape at its position and heading: its kind's shape, or what its shape function says. */
export const placeShape = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, area: AreaTrigger<G>): void => {
  const { shape } = engine.registry.get(area.kind);

  area.placer.place(typeof shape === 'function' ? shape(area) : shape, area.position, area.heading);
};

/** Runs its `frame` hook with the reusable proc list. */
const runFrame = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, area: AreaTrigger<G>, dt: number): void => {
  const hook = engine.registry.hooks.frame[area.kind];

  if (hook === undefined) {
    return;
  }

  const list = engine.takeList();

  try {
    engine.run(area, hook(area, dt, list), list);
  } finally {
    engine.giveList(list);
  }
};

/** Sweeps its body along this frame's move and hands what it reached to `onContact`. */
const runContact = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, area: AreaTrigger<G>): void => {
  const { contact } = engine.registry.get(area.kind);

  if (contact === undefined) {
    return;
  }

  const radius = typeof contact.radius === 'function' ? contact.radius(area) : contact.radius;
  const hit = engine.catcher.take(area, contact, engine.registry.hooks.onContact[area.kind]);

  try {
    catchAlong(engine, hit, radius);
    recordHit(engine, hit);

    if (hit.targets.length > 0) {
      deliver(engine, hit);
    }
  } finally {
    engine.catcher.give(hit);
  }
};

/** Runs one part of a frame, over the frame's time. */
const runPhase = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, area: AreaTrigger<G>, phase: AreaPhase): void => {
  const dt = area.frameTime;

  switch (phase) {
    case 'move':
      engine.registry.hooks.move[area.kind]?.(area, dt);
      placeShape(engine, area);
      break;
    case 'contact':
      runContact(engine, area);
      break;
    case 'frame':
      runFrame(engine, area, dt);
      break;
    case 'pulses':
      stepPulses(engine, area, dt);
      break;
    case 'auras':
      stepAreaAuras(engine, area);
      break;
  }
};

/**
 * One frame over `dt`: it ages, notes where it was, an owner-anchored one moves onto its owner, and it
 * places its shape, then runs its parts in its kind's order: `move` (placing its shape again), `contact`,
 * `frame`, `pulses` and `auras`. A hook that asked it to end ends it once that part is done.
 */
export const frame = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, area: AreaTrigger<G>, dt: number): void => {
  const { registry } = engine;

  area.age += dt;
  // Noted before an owner-anchored one follows its owner, so its contact sweeps the owner's move (a charge's hitbox).
  area.previous.x = area.position.x;
  area.previous.z = area.position.z;

  if (((registry.columns.flags[area.kind] ?? 0) & ANCHOR_OWNER) !== 0) {
    area.moveTo((engine.host.positionOf ?? engine.world.positionOf)(area.owner, engine.point));
  }

  placeShape(engine, area);

  const order = registry.get(area.kind).order ?? DEFAULT_ORDER;

  area.frameTime = dt;

  for (let i = 0; i < order.length && !area.isEnding; i++) {
    runPhase(engine, area, order[i] ?? 'frame');

    if (area.pending !== undefined && !area.isEnding) {
      endArea(engine, area, { reason: area.pending });
    }
  }
};
