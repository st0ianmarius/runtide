import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { PressRefusal } from '../../src/abilities/index.ts';
import { TOMBSTONE } from '../../src/core/index.ts';
import type { Vec2 } from '../../src/math/index.ts';
import { type AbilityGame, auraNamed, CUES, type Hero, makeAbilityGame, spell } from '../helpers/ability-game.ts';

const release = (): undefined => undefined;

describe('a press, edge cases', () => {
  it('finds button spells by id past a retired spell', () => {
    const game = makeAbilityGame({
      roll: spell({ activation: { kind: 'button' }, release }),
      swing: spell({ activation: { kind: 'trigger' }, release }),
      old: TOMBSTONE,
      zap: spell({ activation: { kind: 'trigger' }, release }),
      dash: spell({ activation: { kind: 'button' }, release })
    });

    const hero = game.hero(1);
    const { abilities } = game;
    const { dodge, skill } = abilities.slots.id;

    abilities.equip(hero, dodge, game.id.dash);
    assert.equal(abilities.tryActivate(hero, abilities.bit(dodge)), abilities.bit(dodge));
    assert.throws(() => {
      abilities.equip(hero, skill, game.id.zap);
    }, /not a live button spell/);
  });

  it('keeps the outer press’s input and key for its later slots when a hook presses for another bearer', () => {
    const seen: { pet?: Hero; inputs: (Vec2 | undefined)[] } = { inputs: [] };

    const game = makeAbilityGame({
      command: spell({
        activation: { kind: 'button' },

        release: () => {
          if (seen.pet !== undefined) {
            game.abilities.tryActivate(seen.pet, game.abilities.bit(game.abilities.slots.id.dodge), { key: 99 });
          }

          return undefined;
        }
      }),
      bolt: spell({
        activation: { kind: 'button' },

        cues: {
          cast: ({ input }) => {
            seen.inputs.push(input);

            return { cue: CUES.id.swish };
          }
        },

        release
      }),
      petDash: spell({ activation: { kind: 'button' }, release })
    });

    const hero = game.hero(1);
    const { abilities, cues } = game;
    const { dodge, skill } = abilities.slots.id;

    seen.pet = game.hero(2);
    abilities.equip(hero, dodge, game.id.command);
    abilities.equip(hero, skill, game.id.bolt);
    abilities.equip(seen.pet, dodge, game.id.petDash);
    abilities.tryActivate(hero, abilities.bit(dodge) | abilities.bit(skill), { key: 7, input: { x: 3, z: 4 } });
    assert.deepEqual(seen.inputs, [{ x: 3, z: 4 }]);
    assert.deepEqual(
      Array.from({ length: cues.count }, (_unused, i) => cues.events[i]?.key),
      [7]
    );
  });

  it('gives an outer hook its own context, input and rank back after a press it made for another bearer', () => {
    const seen: { pet?: Hero; lines: string[] } = { lines: [] };

    const order = (pet: Hero | undefined): void => {
      if (pet !== undefined) {
        game.abilities.tryActivate(pet, game.abilities.bit(game.abilities.slots.id.dodge), { input: { x: 9, z: 9 } });
      }
    };

    const game = makeAbilityGame({
      command: spell({
        ranks: 3,
        activation: {
          kind: 'button',

          checkCast: () => {
            order(seen.pet);

            return true;
          },

          activate: (ctx) => {
            order(seen.pet);
            seen.lines.push(`${ctx.bearer.id} ${ctx.input?.x} rank ${ctx.rank}`);
          }
        },
        release
      }),
      petDash: spell({ activation: { kind: 'button' }, release })
    });

    const hero = game.hero(1);
    const { abilities } = game;

    seen.pet = game.hero(2);
    abilities.equip(hero, abilities.slots.id.dodge, { spell: game.id.command, rank: 3 });
    abilities.equip(seen.pet, abilities.slots.id.dodge, game.id.petDash);
    abilities.tryActivate(hero, abilities.bit(abilities.slots.id.dodge), { input: { x: 3, z: 4 } });
    assert.deepEqual(seen.lines, ['1 3 rank 3']);
  });

  it('decides a spell an earlier slot’s hook equipped mid-press by its own rules before it fires', () => {
    const game = makeAbilityGame({
      swap: spell({
        activation: {
          kind: 'button',

          activate: ({ bearer }) => {
            game.abilities.equip(bearer, game.abilities.slots.id.skill, game.id.nuke);
          }
        },
        release
      }),
      bolt: spell({ activation: { kind: 'button' }, release }),
      nuke: spell({ activation: { kind: 'button', requires: ['stance'] }, release })
    });

    const hero = game.hero(1);
    const { abilities } = game;
    const { dodge, skill } = abilities.slots.id;
    const refusals: (PressRefusal<AbilityGame> | undefined)[] = [];

    abilities.equip(hero, dodge, game.id.swap);
    abilities.equip(hero, skill, game.id.bolt);
    assert.equal(
      abilities.tryActivate(hero, abilities.bit(dodge) | abilities.bit(skill), { refusals }),
      abilities.bit(dodge)
    );
    assert.deepEqual(refusals.slice(0, 2), [undefined, 'requires']);
  });

  it('asks a toggle’s rules again when an earlier slot took the toggle off', () => {
    const game = makeAbilityGame({
      root: spell({ activation: { kind: 'button', clears: ['stance'], applies: ['root'] }, release }),
      form: spell({ activation: { kind: 'button', toggle: 'stance', blockedBy: ['rooted'] }, release })
    });

    const hero = game.hero(1);
    const { abilities, auras } = game;
    const { dodge, skill } = abilities.slots.id;
    const refusals: (PressRefusal<AbilityGame> | undefined)[] = [];

    abilities.equip(hero, dodge, game.id.root);
    abilities.equip(hero, skill, game.id.form);
    auras.apply(hero, auraNamed('stance'));
    assert.equal(
      abilities.tryActivate(hero, abilities.bit(dodge) | abilities.bit(skill), { refusals }),
      abilities.bit(dodge)
    );
    assert.equal(refusals[skill], 'blocked');
    assert.equal(auras.has(hero, auraNamed('stance')), false);
  });

  it('clears the refusals of an empty press', () => {
    const game = makeAbilityGame({
      roll: spell({ activation: { kind: 'button' }, cooldown: { aura: 'dodgeCooldown', seconds: 2 }, release })
    });

    const hero = game.hero(1);
    const { abilities } = game;
    const { dodge } = abilities.slots.id;
    const refusals: (PressRefusal<AbilityGame> | undefined)[] = [];

    abilities.equip(hero, dodge, game.id.roll);
    abilities.tryActivate(hero, abilities.bit(dodge));
    abilities.tryActivate(hero, abilities.bit(dodge), { refusals });
    assert.equal(refusals[dodge], 'cooldown');
    abilities.tryActivate(hero, 0, { refusals });
    assert.equal(refusals[dodge], undefined);
  });

  it('reads a toggle aura for the mirror, and explains frozen lists', () => {
    const game = makeAbilityGame({
      form: spell({ activation: { kind: 'button', toggle: 'stance', applies: ['stance'] }, release })
    });

    const explained = game.abilities.explain(game.id.form);

    assert.deepEqual(game.abilities.mirrorReads.auras, [auraNamed('stance')]);
    assert.ok(explained !== undefined && Object.isFrozen(explained.applies));
  });
});
