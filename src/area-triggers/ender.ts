import { dropAreaAuras } from './area-auras.ts';
import type { EndReason } from './area-def.ts';
import type { AreaTrigger } from './area-trigger.ts';
import type { AreaTriggerTypes } from './area-types.ts';
import type { AreaEngine } from './engine.ts';
import { catchIn, deliver, recordHit } from './hits.ts';
import { closeLedgers } from './ledgers.ts';
import { unlinkKind } from './order.ts';

/** Its landing as it expires: the units in its shape, handed to `onLand` (and its cast, when it says). */
const land = <G extends AreaTriggerTypes>(engine: AreaEngine<G>, area: AreaTrigger<G>): void => {
  const def = engine.registry.get(area.kind);

  if (def.onLand === undefined && def.land === undefined) {
    return;
  }

  const hit = engine.catcher.take(area, def.land, engine.registry.hooks.onLand[area.kind]);

  try {
    catchIn(engine, hit, area.shape);
    recordHit(engine, hit);
    deliver(engine, hit);
  } finally {
    engine.catcher.give(hit);
  }
};

/** Runs one end hook of an area trigger, with the reusable proc list. */
const runEndHook = <G extends AreaTriggerTypes>(
  engine: AreaEngine<G>,
  area: AreaTrigger<G>,
  reason: EndReason<G>
): void => {
  const { hooks } = engine.registry;
  const onExpire = hooks.onExpire[area.kind];
  const onEnd = hooks.onEnd[area.kind];
  const list = engine.takeList();

  try {
    if (reason === 'expired') {
      land(engine, area);
    }

    if (reason === 'expired' && onExpire !== undefined) {
      engine.run(area, onExpire(area, list), list);
      list.clear();
    }

    engine.fire(area, engine.registry.get(area.kind).cues?.end?.(area, reason));

    if (onEnd !== undefined) {
      engine.run(area, onEnd(area, reason, list), list);
    }
  } finally {
    engine.giveList(list);
  }
};

/**
 * Ends an area trigger: its landing and `onExpire` for an expiry, its end cue (none when the cue answers none),
 * `onEnd` with the reason; then it leaves the tick order and its kind's list, the end event is raised, its owner aura
 * comes off when it was the last of its kind, its cast is let go and its record goes back to the pool once no step,
 * walk or hook holds records. Ending one that is already ending does nothing.
 */
export const endArea = <G extends AreaTriggerTypes>(
  engine: AreaEngine<G>,
  area: AreaTrigger<G>,
  reason: EndReason<G>
): void => {
  if (area.isEnding) {
    return;
  }

  area.isEnding = true;
  engine.hold();

  // Each step that runs game code is followed by the rest in a `finally`: a hook or listener that throws still leaves
  // the trigger ended, out of its lists, its auras off and its record freed, since a second end would do nothing.
  try {
    runEndHook(engine, area, reason);
  } finally {
    try {
      dropAreaAuras(engine, area);
    } finally {
      closeLedgers(engine, area);
      unlinkKind(engine, area);
      engine.count(area.owner, area.kind, -1);

      try {
        engine.release(area, reason);
      } finally {
        engine.spells.unretain(area.castHandle);
        engine.free(area);
        engine.unhold();
      }
    }
  }
};
