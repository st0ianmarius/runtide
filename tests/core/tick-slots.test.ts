import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { defineTickSlots } from '../../src/core/index.ts';

describe('tick slots', () => {
  it('are a registry of the game slots, numbered in declaration order', () => {
    const slots = defineTickSlots(['movement', 'attack', 'creatures']);

    assert.deepEqual(slots.id, { movement: 0, attack: 1, creatures: 2 });
    assert.equal(slots.kind, 'tickSlots');
    assert.equal(slots.name(slots.id.attack), 'attack');
  });
});
