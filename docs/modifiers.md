# Modifiers: game integration and API guide

The modifiers system turns a game's stat definitions and modifier lists into resolved numbers. It handles stat
registries, ordered sources, additions, multipliers, caps, conditions, scopes, stack gates, derived stats, rating
conversions, curves, scaled formulas, snapshots, explanations, and change watches. It works for heroes, creatures,
summons, or any other bearer a game supplies; it requires no renderer, transport, world implementation, or global clock.

This guide documents the implementation exported by [`runtide/modifiers`](../src/modifiers/index.ts), including the
contracts an agent needs to preserve when integrating it into a game. The game owns the stat names, units of measure,
numbers, conditions, source layout, scope ids, resource policies, presentation, and when reads happen.

## Contents

1. [Start here](#1-start-here)
2. [Minimal runnable integration](#2-minimal-runnable-integration)
3. [Concepts and ownership](#3-concepts-and-ownership)
4. [Declare the stat table](#4-declare-the-stat-table)
5. [Sources and the exact fold](#5-sources-and-the-exact-fold)
6. [Author and compile modifiers](#6-author-and-compile-modifiers)
7. [Host conditions and dynamic values](#7-host-conditions-and-dynamic-values)
8. [Scopes and partial reads](#8-scopes-and-partial-reads)
9. [Gates, stacks, shared lists, and previews](#9-gates-stacks-shared-lists-and-previews)
10. [Connect the aura system](#10-connect-the-aura-system)
11. [Derived stats and conversions](#11-derived-stats-and-conversions)
12. [Curve library](#12-curve-library)
13. [Scaled values](#13-scaled-values)
14. [Live views and snapshots](#14-live-views-and-snapshots)
15. [Structured explanations](#15-structured-explanations)
16. [Stat watches and resource policies](#16-stat-watches-and-resource-policies)
17. [Caching, allocation, and lifecycle](#17-caching-allocation-and-lifecycle)
18. [Integrate with the rest of a game](#18-integrate-with-the-rest-of-a-game)
19. [Validation and failure behavior](#19-validation-and-failure-behavior)
20. [Troubleshooting](#20-troubleshooting)
21. [Public API map](#21-public-api-map)
22. [Agent handoff and verification](#22-agent-handoff-and-verification)

## 1. Start here

For a first integration, follow this sequence:

1. Define one stat table and an ordered source table for the game.
2. Create one modifier system over those tables.
3. Compile content lists once when content is loaded.
4. Create one sheet per bearer and install its equipment, talents, and other owned lists with `setSource`.
5. Resolve by numeric stat id, passing a host for state-dependent content and a scope bitset for spell-dependent content.
6. If using auras, connect `auraStacks`, `auraGates`, and `auraRevision`; let the aura system register its shared lists.
7. Create reusable stat views for spell formulas and pipeline hosts.
8. Choose explicitly which effects read live stats and which keep snapshots.
9. Add watches where resolved stats change health, clocks, movement, or replicated values.

Only steps 1–5 are needed for a game with static equipment modifiers. Conditions, gates, conversions, and scaling are
optional and can be added as content needs them.

For consumer code, import public exports from `runtide/modifiers`, `runtide/conditions`, `runtide/core`, and,
when needed, `runtide/auras`. The runnable examples in this repository import those same systems through their
`src/*/index.ts` entry points so they work before a build. Replace those relative imports with package subpaths when
copying an example into another repository. `node:assert/strict` is only used to verify these examples; a game's runtime
does not need it.

The repository is private and is consumed from a local folder or a pinned git revision; see [the project README](../README.md).
Do not use paths to internal files such as `fold.ts` or `build-sheet.ts` as a consumer API.

## 2. Minimal runnable integration

Source: [`examples/modifiers-basic.ts`](examples/modifiers-basic.ts). This complete file resolves equipment and talent
bonuses, caps the result, and removes equipment by replacing its source with an empty list.

<!-- example: modifiers-basic.ts#full -->

```ts
import assert from 'node:assert/strict';

import { cap, createModifierSystem, defineSources, defineStats, mul, plus } from '../../src/modifiers/index.ts';

const stats = defineStats({
  attackDamage: { base: 60, kind: 'flat', min: 0 },
  moveSpeed: { base: 6, kind: 'flat', min: 0, max: 12 },
  damage: { base: 1, kind: 'multiplier', min: 0 }
});

const sources = defineSources(['base', 'gear', 'talents', 'auras']);
const modifiers = createModifierSystem({ stats, sources });
const sheet = modifiers.createSheet();

const boots = modifiers.compile([plus('moveSpeed', 1)], { what: 'boots' });
const training = modifiers.compile([mul('moveSpeed', 1.5), cap('moveSpeed', 10)], { what: 'training' });

modifiers.setSource(sheet, sources.id.gear, [boots]);
modifiers.setSource(sheet, sources.id.talents, [training]);

const speed = modifiers.resolve(sheet, stats.id.moveSpeed); // 10: (6 + 1) × 1.5, capped at 10.
const damage = modifiers.resolve(sheet, stats.id.attackDamage); // 60: no modifier changes this stat.

modifiers.setSource(sheet, sources.id.gear, []); // Remove every gear list from this sheet.

const unequippedSpeed = modifiers.resolve(sheet, stats.id.moveSpeed); // 9: 6 × 1.5.

assert.equal(speed, 10);
assert.equal(damage, 60);
assert.equal(unequippedSpeed, 9);
assert.equal(sheet.compiles, 2);
```

Notice that `setSource` takes an array of **compiled lists**, not an array of authored modifiers. A sheet starts empty
of lists but already resolves the stat table's bases and intrinsic derived terms.

## 3. Concepts and ownership

| Concept                     | Meaning                                                                               | Owner and lifetime                                    |
| --------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `StatDef` / `StatTable`     | Definitions, dense numeric ids, bases, neutral values, clamps, and stat relationships | Game content, normally defined once at startup        |
| `SourceTable`               | Names and their fixed fold positions                                                  | Game content, defined before compiling content        |
| `Modifier`                  | One authored stat operation with optional condition, scope, and stacking rule         | Immutable content data                                |
| `ModifierList`              | A validated compiled list, optionally waiting on a stack gate                         | Compiled once and reused by many sheets               |
| `ModifierSystem`            | Tables, compilation, shared gated lists, and the stat fold                            | One system for a compatible set of game tables        |
| `StatSheet`                 | A bearer's own lists at each source plus their compiled cache                         | One per bearer                                        |
| `Host`                      | Whatever game state conditions, value reads, and gates need                           | The game's bearer or a stable adapter for it          |
| `FoldRead<Host>`            | Host, scope set, source mask, and optional gate preview for one kind of read          | Reuse for a bearer and purpose                        |
| `StatView`                  | `total(stat)` and `base(stat)` for one side of a formula                              | Usually a retained live view, or an explicit snapshot |
| `Scaled` / `CompiledScaled` | An authored / compiled formula over caster and target stats                           | Content authored at load, evaluated when needed       |

**A source is a position, not a subsystem.** Names such as `gear`, `talents`, `auras`, or `stance` have no built-in
meaning. The system does not equip items, apply talent points, expire buffs, or decide which effects exclude one another.

**Stat kinds describe scaling interpretation.** A flat stat is a quantity. A multiplier stat is a value around a neutral
point whose bonus an `amp` term can share. Both kinds accept ordinary `add`, `mul`, and `min` modifiers. A flat chance
such as `critChance` can use fractions in `[0, 1]`; it does not have to be a multiplier stat because its UI shows a percent.

**Modifiers resolve numbers.** They do not automatically update current health, attack timers, physics, or a network
schema. Those integrations read resolved values or use a watch and apply the game's chosen policy.

## 4. Declare the stat table

Use `defineStats(defs, { curves? })`. Object key enumeration order determines dense `StatId` values. Author definitions
with stable, non-numeric names; numeric-looking JavaScript object keys have their own enumeration ordering. Treat ids as
belonging to the specific table that created them, and preserve registry compatibility separately when persisting or
replicating them.

| `StatDef` field | Required / default               | Meaning                                                                       |
| --------------- | -------------------------------- | ----------------------------------------------------------------------------- |
| `base`          | Required                         | Starting value before sources; may be infinite, never NaN                     |
| `kind`          | Required: `flat` or `multiplier` | Interpretation used by scaling terms and neutral defaults                     |
| `neutral`       | Flat: `0`; multiplier: `1`       | Reference point for `perStat` and `amp`; must be finite                       |
| `min`           | `-Infinity`                      | Final floor, after modifier caps                                              |
| `max`           | `Infinity`                       | Final ceiling, after modifier caps                                            |
| `curve`         | Absent                           | Named curve associated with this stat for inferred curve terms                |
| `derives`       | Absent                           | Add a share of another stat's positive gain over its table base               |
| `converts`      | Absent                           | Convert this stat's resolved total through a curve and add it to another stat |

The table exposes:

- `stats.id.attackDamage`: typed numeric id for a known name.
- `stats.ids`, `stats.names`, `stats.size`, `stats.get(id)`, and `stats.name(id)`: registry access.
- `stats.columns.base`, `.neutral`, `.min`, `.max`: `Float64Array` columns indexed by stat id.
- `stats.columns.isMultiplier`: a `Uint8Array` kind column.
- `stats.index`: the index used by the scaling compilers.
- `stats.curves`: named curves, empty by default.
- `stats.derivations`: compiled intrinsic relationships indexed by destination stat id.

Use `neutral` and `base` deliberately. A critical-damage stat can start at `base: 1.75` but retain `neutral: 1`.
`perStat` then measures a bonus of `0.75`; `derives` measures gain over `1.75`. A penetration multiplier starting at
zero can declare `neutral: 0`. These reference points are different contracts.

Do not mutate definitions or typed columns as a mechanism for changing a bearer's stats. The modifier system copies its
base and clamp columns at creation. Install a new source list for equipment, progression, or per-unit base differences.
If changing content tables themselves, rebuild the dependent systems under a game-owned reload procedure.

There is no integer stat kind or automatic rounding. A projectile-count or chain-count stat can resolve to a fraction.
The game decides how and where such values become integers.

Reference: [`stats.ts`](../src/modifiers/stats.ts), [`stat-id.ts`](../src/modifiers/stat-id.ts).

## 5. Sources and the exact fold

### 5.1 Declare stable source positions

`defineSources(['base', 'gear', 'talents', 'auras', 'stance'])` gives names numeric ids in that array's order. Declare
at most 32 sources because partial reads use one 32-bit mask. Reuse source ids from this table when calling the system.

Calling `setSource` in a different order does not change fold order. Inside a source, the sheet's own lists fold in the
order passed to `setSource`; modifiers within each list retain their authored order **within each operation category**.
Shared gated lists follow the sheet's own lists at that source, in ascending gate order.

`setSource(sheet, source, lists)` **replaces** that source's complete owned list set. It does not append. If gear already
contains a sword and boots, equipping a ring requires supplying all three lists in the game's stable slot order.
`setSource(sheet, source, [])` removes the owned lists there; shared lists at that source remain.

### 5.2 Fold stages

For one stat and one read, the implementation performs these stages:

1. Start from that stat's table `base`.
2. Add each eligible `add` entry, left to right in source/list/modifier order.
3. Add intrinsic derived terms: this stat's `derives` first, then incoming `converts` in the converting stats' id order.
4. Multiply the running result by each eligible `mul` entry, one at a time in source/list/modifier order.
5. Apply each eligible `min` entry as an upper cap. The lowest applicable cap wins.
6. Apply the stat definition's final `max`, then `min` clamp.

The mathematical summary is:

```text
value = table base
value += each live addition, in order
value += each derived/conversion contribution, in order
value *= each live multiplier, in order
value = min(value, each live modifier cap)
value = max(stat.min, min(stat.max, value))
```

All additions precede all multipliers, even if an addition comes from a later source. All modifier caps run after the
entire multiplier stage. A cap authored in an early source is not an intermediate clamp before later multipliers.
The final floor can raise a value above a modifier cap if that cap is below `stat.min`.

For example, an armor base of 10, an early `mul` of 2, a later `plus` of 5, and a cap of 25 resolve to 25:
`(10 + 5) × 2 = 30`, then cap to 25. Without the cap they resolve to 30, not 25.

### 5.3 Preserve floating-point order

Do not pre-multiply factors, regroup additions, sort content by name, or rearrange sources as a performance change.
For example, `(6.2 × 0.51) × 0.54` is `1.7074800000000003`, whereas `(6.2 × 0.54) × 0.51` is `1.70748` in the
tested runtime. The chosen left-to-right order is part of the gameplay result.

The system uses JavaScript numbers and `Float64Array`, not integer or fixed-point arithmetic. Game callbacks must be
deterministic. Power stacking and the stacking curve use exponentiation; the tests allow tolerance where `**` can differ
in its last bit between platforms. Fixed evaluation order does not make arbitrary game math platform-independent.

Reference: [`sources.ts`](../src/modifiers/sources.ts), [`fold.ts`](../src/modifiers/fold.ts),
[`fold-order.test.ts`](../tests/modifiers/fold-order.test.ts), [`fold.test.ts`](../tests/modifiers/fold.test.ts).

## 6. Author and compile modifiers

### 6.1 Operations and helper names

| Authoring helper              | Stored operation | Effect                                        |
| ----------------------------- | ---------------- | --------------------------------------------- |
| `plus(stat, value, options?)` | `add`            | Add a quantity to the base before multipliers |
| `mul(stat, value, options?)`  | `mul`            | Multiply the accumulated value                |
| `cap(stat, value, options?)`  | `min`            | Upper cap after all multipliers               |

`plus` is the modifier-addition helper. `add` is a **scaled-formula term** helper; they are different APIs.

A multiplier of `1.2` means multiply by 120%, which is a 20% increase. A multiplier of `0.8` means a 20% reduction.
Adding `0.2` to a multiplier stat whose current pre-multiplier value is 1 gives 1.2. Adding separate percentage bonuses
and multiplying separate factors produce different stacking rules; select the rule in content rather than using the
helpers interchangeably.

Each helper accepts the same optional fields:

- `when`: a condition expression from `runtide/conditions`.
- `scope`: a non-negative integer scope id reached by a read's bitset.
- `stacking`: `power` by default, or `linear` for gated multipliers.

Literal modifier objects use `stat`, `op`, `value`, and those optional fields. The helpers produce those objects;
they introduce no additional runtime behavior.

### 6.2 Values

| Value form                                    | What the fold reads                                                  |
| --------------------------------------------- | -------------------------------------------------------------------- |
| Number                                        | That number at one stack                                             |
| `perStat(otherStat, per, { neutral?, cap? })` | `per × (resolved otherStat − neutral)`, upper-capped before stacking |
| `hostValue(valueKind, arg = 0)`               | The registered value kind's `read(host, arg)` result at this read    |

`perStat` follows the other stat using the **same read**, including its source mask, scope set, host, and gate preview.
The default neutral is the followed stat's own neutral. Its cap limits this modifier's one-stack value, not the final
destination stat. It does not floor negative bonuses at zero.

A `perStat` used as the value of `mul` supplies the entire factor, not `1 + bonus`. A factor of zero really multiplies
by zero. Use a game value kind when your formula needs a different shape, and ensure callbacks do not recursively depend
on the stat currently being resolved.

### 6.3 Compile at load

Call `system.compile(authoredModifiers, { gate?, what? })` after creating the system and before using the content.
`what` identifies the owner in error messages, such as an item, talent, aura, or variant.

Compilation resolves stat, condition, and value-kind names to ids; checks operation, scope, gate, and number constraints;
and returns a frozen `ModifierList` with frozen compiled modifier records. Reuse that list for all bearers with the same
content. A list does not belong to a source until installed with `setSource` or `share`.

Keep compiled lists, sheets, and ids with their original compatible tables. The numeric brands distinguish kinds of id,
not separate games' registries. Do not rely on runtime checks to detect all cross-system mixing.

Reference: [`modifier.ts`](../src/modifiers/modifier.ts), [`compile-modifiers.ts`](../src/modifiers/compile-modifiers.ts),
[`build-sheet.ts`](../src/modifiers/build-sheet.ts).

## 7. Host conditions and dynamic values

Conditions and host values are registered in `runtide/conditions`, then supplied to `createModifierSystem` as
`conditions` and `values`. They are not exported from the modifiers subpath.

The host type is entirely game-owned. It can be the actual unit, or an adapter containing a unit and world queries.
Reuse a stable host for a sheet when enabling revision-based total caching.

The following setup comes from [`examples/modifiers-host.ts`](examples/modifiers-host.ts). Its full file contains the
imports and runs all assertions shown in this section and the following scope/gate sections.

<!-- example: modifiers-host.ts#host-setup -->

```ts
interface Hero {
  hp: number;
  maxHp: number;
  isStanding: boolean;
  readonly stacks: number[];
  readonly gates: { readonly id: number }[];
  revision: number;
}

const stats = defineStats({
  damage: { base: 1, kind: 'multiplier', min: 0 },
  armor: { base: 0, kind: 'flat' },
  moveSpeed: { base: 6, kind: 'flat', min: 0 },
  reach: { base: 1, kind: 'multiplier' },
  chainJumps: { base: 0, kind: 'flat' },
  maxHealth: { base: 100, kind: 'flat', min: 1 }
});

const sources = defineSources(['base', 'gear', 'talents', 'auras']);

const conditions = defineConditions({
  standing: { test: (hero: Hero) => hero.isStanding, mirrorSafe: true },
  healthBelow: { test: (hero: Hero, share) => hero.hp < hero.maxHp * share, mirrorSafe: true }
});

const values = defineValues({
  healthShare: { read: (hero: Hero) => hero.hp / hero.maxHp, mirrorSafe: true },
  missingHealthFactor: {
    read: (hero: Hero, per) => 1 + per * (1 - hero.hp / hero.maxHp),
    mirrorSafe: true
  }
});

const modifiers = createModifierSystem({
  stats,
  sources,
  conditions,
  values,
  stacks: (hero: Hero, gate) => hero.stacks[gate] ?? 0,
  held: (hero: Hero) => hero.gates,
  revision: (hero: Hero) => hero.revision
});

const hero: Hero = { hp: 100, maxHp: 100, isStanding: true, stacks: [], gates: [], revision: 0 };
const sheet = modifiers.createSheet();
const read: FoldRead<Hero> = { host: hero };
```

This sample requires positive `maxHp`; that is a game invariant, not a check performed by the modifier system.
`mirrorSafe: true` is a promise that a prediction mirror has every state field the callback reads. It does not replicate
those fields or enforce safe behavior by itself. Bare callback definitions default to not mirror-safe.

### 7.1 Condition language

| Expression                                                  | Meaning                                                         |
| ----------------------------------------------------------- | --------------------------------------------------------------- |
| `{ is: 'healthBelow', arg: 0.4 }`                           | A registered test, called with the numeric argument (default 0) |
| `{ value: 'healthShare', op: '<=', than: 0.5, epsilon: 0 }` | Compare a registered value read to a threshold                  |
| `all(a, b)` / `{ all: [a, b] }`                             | Every child holds                                               |
| `any(a, b)` / `{ any: [a, b] }`                             | At least one child holds                                        |
| `not(a)` / `{ not: a }`                                     | Negate the child                                                |

Empty `all` and `any` are rejected when compiled. `<` and `>` are strict. `<=` admits `than + epsilon`; `>=` admits
`than - epsilon`; `==` and `!=` compare the absolute difference with epsilon. Epsilon defaults to zero.

A condition spec can declare `world: true` for expensive world questions. Compilation moves world-reading children
behind cheaper children in `all` and `any`, where short-circuiting can avoid them. Therefore conditions must not depend
on callback order or mutate gameplay state.

### 7.2 Reads remain live

<!-- example: modifiers-host.ts#live-values -->

```ts
const talents = modifiers.compile([
  mul('damage', 1.5, { when: all({ is: 'standing' }, { is: 'healthBelow', arg: 0.4 }) }),
  plus('armor', 10, { when: { value: 'healthShare', op: '<=', than: 0.5 } }),
  mul('moveSpeed', hostValue('missingHealthFactor', 0.5)),
  plus('reach', 0.5),
  plus('chainJumps', perStat('reach', 2, { cap: 3 }))
]);

modifiers.setSource(sheet, sources.id.talents, [talents]);

assert.equal(modifiers.resolve(sheet, stats.id.damage, read), 1);

hero.hp = 30; // Conditions and host values read the new health without replacing a source.

assert.equal(modifiers.resolve(sheet, stats.id.damage, read), 1.5);
assert.equal(modifiers.resolve(sheet, stats.id.armor, read), 10);
assert.equal(modifiers.resolve(sheet, stats.id.moveSpeed, read), 6 * 1.35);
assert.equal(modifiers.resolve(sheet, stats.id.chainJumps, read), 1);
```

The health change requires no source replacement. Conditions and host value results are recomputed when the fold reaches
them; their results are not the compiled-list cache. A total that actually consults a condition or host value is not kept
by the optional revision cache.

Eligibility is checked in this order: source selected, scope reached, gate has positive stacks, condition holds.
Host-valued entries also need a host. A world condition is never asked for an entry already excluded by source, scope,
or gate, or when resolving an unrelated stat.

With no host, conditional and host-valued modifiers do not count. Plain ungated modifiers still count. Gate previews
have the special no-host behavior described in section 9.

Reference: [`conditions/index.ts`](../src/conditions/index.ts), [`conditions/expr.ts`](../src/conditions/expr.ts),
[`live.ts`](../src/modifiers/live.ts).

## 8. Scopes and partial reads

### 8.1 Scopes select applicability

A modifier has either no scope, reaching every read, or one numeric scope id. A read supplies a `Bitset` from
`runtide/core`. The modifier counts if the bitset has that id. The game decides whether ids mean a spell, damage
school, weapon family, tag, or another concept.

Use one coordinated scope-id namespace. If spell ids and tag ids overlap accidentally, a modifier cannot distinguish
them. Do not assume aura tag ids, spell ids, or stat ids are interchangeable scope ids.

An omitted scope set skips every scoped modifier. An empty scope set also skips every scoped modifier. Neither case
means all scopes. Unscoped modifiers count with any scope set.

### 8.2 Source masks select whole positions

`sourceMask(sources, names)` returns a numeric mask. Build it once and keep it. A read with `sources` folds only selected
sources; an absent mask folds all sources. A zero mask excludes all source entries, but the table base, intrinsic derived
terms, and final stat clamp still apply. Derived terms read their dependencies with the same filtered read.

There is no public flag for only scoped entries, only multipliers, or a different neutral base for a partial fold.
Combining a mask and scope set still follows the normal fold. Define content/source boundaries or a game-owned formula
for any specialized calculation that needs other semantics.

<!-- example: modifiers-host.ts#scoped-reads -->

```ts
const FIRE_SCOPE = 4;
const SPELL_SCOPE = 9;
const spellScope = createBitset([FIRE_SCOPE, SPELL_SCOPE]);
const gearOnly = sourceMask(sources, ['gear']);

modifiers.setSource(sheet, sources.id.gear, [modifiers.compile([mul('damage', 2, { scope: FIRE_SCOPE })])]);

const spellRead: FoldRead<Hero> = { host: hero, scope: spellScope };
const partialRead: FoldRead<Hero> = { host: hero, scope: spellScope, sources: gearOnly };

assert.equal(modifiers.resolve(sheet, stats.id.damage, read), 1.5);
assert.equal(modifiers.resolve(sheet, stats.id.damage, spellRead), 3);
assert.equal(modifiers.resolve(sheet, stats.id.damage, partialRead), 2);
```

In this example, the unscoped low-health talent contributes 1.5 to general damage. The fire-only gear factor contributes
2 to the spell-scoped read, giving 3 together. Selecting only the gear source gives 2.

Create a separate retained read/view for each purpose, such as general movement, a particular spell family, or an
equipment preview. `system.view(sheet, read)` captures that read object; it does not infer spell scopes later.

Reference: [`sheet.ts`](../src/modifiers/sheet.ts), [`sources.ts`](../src/modifiers/sources.ts),
[`gates-and-scopes.test.ts`](../tests/modifiers/gates-and-scopes.test.ts).

## 9. Gates, stacks, shared lists, and previews

### 9.1 Gated lists

Compile with `{ gate: numericId }` to make every modifier in the list wait on that gate. Supply a `stacks(host, gate)`
callback when creating the system. Installing a gated list without a stacks callback throws, even for preview use.

Ungated lists count as one stack. For a gated list with an eligible positive whole-number stack count:

| Operation              | One stack           | Multiple stacks `n`                 |
| ---------------------- | ------------------- | ----------------------------------- |
| `add`                  | Authored value `v`  | `v × n`                             |
| `mul`, default `power` | Authored factor `v` | `v ** n`                            |
| `mul`, `linear`        | Authored factor `v` | `1 + (v − 1) × n`                   |
| `min`                  | Cap `v`             | Cap `v`, independent of stack count |

The one-stack fast path keeps the authored float, including for linear stacking. This avoids computing a slightly
different float through `1 + (v - 1)`.

Zero or negative reported stacks suppress the list. The fold expects sensible game-supplied stack counts; it does not
validate arbitrary callback returns or `whatIf.stacks`. For custom gates use non-negative whole numbers. Positive
fractions at or below 1 use the one-stack fast path rather than fractional weighting.

An aura's stacking mode controls how applications build its stack count. A modifier's `stacking` field separately
controls how a gated multiplier uses that count. They are two distinct settings.

### 9.2 Share gates without copying them per bearer

`system.share(source, lists)` replaces that source's **system-wide shared gated lists**. Each shared list must be gated,
and the array must be ordered by ascending gate id; equal gate ids are allowed and retain their list order.

Use sharing for a registry of buffs that any bearer may hold. The lists are compiled once and evaluated against each
bearer's gate report. They fold after that bearer's own lists at the same source. Ordinary item lists belong in
`setSource`; ungated lists cannot be installed with `share`.

Supply `held(host)` for larger gate registries. It must report every gate that `stacks` says has positive stacks, in
ascending id order. Repeated ids are allowed; they do not multiply a gate's contributions again. Extra zero-stack gates
are harmless. `held` is an optimization over shared lists; the definitive count still comes from `stacks`.

Without `held`, the fold asks the stack callback for shared gates. With `held`, large shared collections walk gates the
bearer holds. Small collections use a bounded inline fast path. Do not rebuild shared collections every time a bearer
gains or loses a buff; change the bearer's gate state instead.

### 9.3 What-if reads

A read's `whatIf: { gate, stacks }` replaces that gate's reported count for this read. It uses an **absolute** count;
`stacks: 3` does not mean add three stacks. `stacks: 0` calculates without the gate. It does not mutate, apply, refresh,
or remove anything and does not run aura hooks.

The override can reach a shared gate even when it is absent from `held`. The list must already be installed. It overrides
one gate only and leaves other eligibility checks intact.

<!-- example: modifiers-host.ts#shared-gates -->

```ts
const ARMOR_GATE = 0;
const armorAura = modifiers.compile([plus('armor', 30)], { gate: ARMOR_GATE });

modifiers.share(sources.id.auras, [armorAura]);

hero.stacks[ARMOR_GATE] = 2;
hero.gates.push({ id: ARMOR_GATE }); // Keep this report sorted by id when adding more gates.
hero.revision += 1;

assert.equal(modifiers.resolve(sheet, stats.id.armor, read), 70);

const previewRead: FoldRead<Hero> = { host: hero, whatIf: { gate: ARMOR_GATE, stacks: 3 } };

assert.equal(modifiers.resolve(sheet, stats.id.armor, previewRead), 100);
assert.equal(modifiers.resolve(sheet, stats.id.armor, { whatIf: { gate: ARMOR_GATE, stacks: 3 } }), 90);
assert.equal(hero.stacks[ARMOR_GATE], 2); // The preview did not apply an aura.
```

With a host, the conditional armor talent contributes 10 and three previewed gate stacks contribute 90, giving 100.
Without a host, the same preview still contributes the gate's plain 90, but the conditional talent is skipped.

This exception is useful for content previews: a no-host `whatIf` can count plain entries of the overridden gate.
Conditions and host values still need a host, and scoped entries still need a scope bitset.

Reference: [`shared.ts`](../src/modifiers/shared.ts), [`live.ts`](../src/modifiers/live.ts),
[`held-gates.test.ts`](../tests/modifiers/held-gates.test.ts).

## 10. Connect the aura system

The standard adapters are `auraStacks`, `auraGates`, and `auraRevision`, exported by `runtide/auras`. They read a
bearer's aura state directly. Build the modifier system first, then give it to the aura system with a default `fold`
source. An individual aura can name another declared source through its own `fold` field.

Source: [`examples/modifiers-auras.ts`](examples/modifiers-auras.ts). Its full file includes imports and assertions.

<!-- example: modifiers-auras.ts#aura-setup -->

```ts
interface Hero extends AuraBearer {
  readonly id: number;
}

interface GameAuras extends AuraTypes {
  readonly bearer: Hero;
  readonly stat: 'armor' | 'moveSpeed';
  readonly condition: never;
  readonly valueKind: never;
  readonly source: 'base' | 'gear' | 'auras';
  readonly tag: 'boon';
  readonly clock: 'world';
  readonly state: 'dead';
  readonly ext: undefined;
}

const stats = defineStats({
  armor: { base: 0, kind: 'flat' },
  moveSpeed: { base: 6, kind: 'flat', min: 0 }
});

const sources = defineSources(['base', 'gear', 'auras']);

const modifiers = createModifierSystem({
  stats,
  sources,
  stacks: auraStacks,
  held: auraGates,
  revision: auraRevision
});

const aura = defineAura<GameAuras>;

const registry = defineAuras({
  guard: aura({
    duration: 10,
    stacking: 'stack',
    maxStacks: 3,
    tags: ['boon'],
    modifiers: [plus('armor', 30)]
  }),
  stride: aura({
    duration: 10,
    stacking: 'stack',
    maxStacks: 3,
    modifiers: [mul('moveSpeed', 1.1, { stacking: 'linear' })]
  })
});

const auras = createAuraSystem<GameAuras>({
  registry,
  tags: defineAuraTags(['boon']),
  clocks: { world: { dt: 0.125 } },
  states: ['dead'],
  modifiers,
  fold: 'auras'
});

const hero: Hero = { id: 1, auras: auras.createState() };
const sheet = modifiers.createSheet();
const read: FoldRead<Hero> = { host: hero };
```

Creating this aura system compiles the registry's modifier lists with the aura ids as gates and shares them at their
declared sources. Do not also install the same aura lists on each bearer's sheet: that would count them twice.

<!-- example: modifiers-auras.ts#aura-lifecycle -->

```ts
assert.equal(modifiers.resolve(sheet, stats.id.armor, read), 0);

auras.apply(hero, { aura: registry.id.guard, stacks: 2 });

assert.equal(modifiers.resolve(sheet, stats.id.armor, read), 60);

auras.apply(hero, { aura: registry.id.stride, stacks: 3 });

assert.equal(modifiers.resolve(sheet, stats.id.moveSpeed, read), 6 * (1 + (1.1 - 1) * 3));
assert.equal(
  modifiers.resolve(sheet, stats.id.armor, { host: hero, whatIf: { gate: registry.id.guard, stacks: 0 } }),
  0
);

auras.remove(hero, registry.id.guard);

assert.equal(modifiers.resolve(sheet, stats.id.armor, read), 0);

for (let tick = 0; tick < 80; tick++) {
  auras.tick(hero, 'world'); // The host owns which bearer clocks it steps and when.
}

assert.equal(modifiers.resolve(sheet, stats.id.moveSpeed, read), 6);
assert.equal(sheet.compiles, 1); // Apply, remove and expire only changed gates and their revision.
```

Applying, restacking, removing, and expiring these auras move the bearer state's revision. They do not rebuild the sheet's
compiled lists. The host steps the bearer clocks explicitly; modifier reads never advance clocks themselves.

`auraStacks` sums stacks across instances of the same aura id. Thus an independently stacked aura's modifiers see the
aggregate gate count. If a game wants per-instance snapshot values or a different aggregation policy, express that
through game value reads or another explicit game integration; a plain gated list has no per-instance payload.

`createAuraSystem` uses `share` for the sources with aura modifiers. Treat those shared positions and gate ids as one
coordinated registry. Creating another aura system on the same modifier system can replace an existing source's shared
lists and may reuse gate ids; do not treat separate aura registries as implicitly merged.

Reference: [`auras/compile.ts`](../src/auras/compile.ts), [`auras/state.ts`](../src/auras/state.ts),
[`auras/modifiers.test.ts`](../tests/auras/modifiers.test.ts).

## 11. Derived stats and conversions

There are three different ways one stat can affect another:

| Mechanism                    | Formula                                             | Reference point / use                                                  |
| ---------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------- |
| Destination stat's `derives` | `per × max(0, source total − source table base)`    | Permanent relationship; only positive gains contribute                 |
| Source stat's `converts`     | `curve(source total)` added to destination          | Rating conversion, possibly with level/stat-dependent curve parameters |
| Modifier value `perStat`     | `per × (source total − neutral)`, optionally capped | Content-owned relationship with source, scope, condition, and gate     |

For `derives`, `per` itself may be negative; only the followed gain is floored at zero. The followed total already includes
its own modifiers, conversions, caps, and clamp. The destination adds its derived contribution after ordinary additions
and before destination multipliers.

For conversions, define `converts: { to, curve }` on the rating stat. The curve reads the bearer as `caster`; conversion
curves cannot read a target. Every destination receives its own `derives` first, then each incoming conversion in the
rating stats' id order. The source rating is fully resolved before conversion.

`StatDef.curve` only associates a name with a stat; it does **not** transform that stat's resolved total. Use `converts`,
`compileCurve`/`evaluateCurve`, or a scaled value's curve when you want an actual conversion.

The following setup combines a reach-to-area derivation, a hit-rating conversion, and named curves. The complete
[`examples/modifiers-values.ts`](examples/modifiers-values.ts) contains its imports and all later scaling examples.

<!-- example: modifiers-values.ts#stats-and-curves -->

```ts
// A game's own curves: LoL's ability haste, and WoW's diminishing returns on avoidance with evaluated parameters.
const haste = customCurve((x) => (x >= 0 ? 100 / (100 + x) : 1 - x / 100));

const avoidance = customCurve(
  (x, { per, cap, k }) => {
    const percent = x / per / 100;

    return percent <= 0 ? 0 : 1 / (1 / cap + k / percent);
  },
  { per: 10, cap: 0.65, k: 1 }
);

const curves = defineCurves({
  haste,
  armor: hyperbolic({ k: 100, cap: 0.75, negative: 'amplify' }),
  hitRating: rating(
    byLevel([
      [1, 10],
      [60, 20]
    ])
  ),
  dodge: avoidance,
  slowResistance: stacking(0.2),
  growth: table([
    [1, 1],
    [10, 2]
  ]),
  flatConversion: linear(0.1),
  softCap: (x) => x / (1 + Math.abs(x))
});

const stats = defineStats(
  {
    attackDamage: { base: 60, kind: 'flat', min: 0 },
    abilityPower: { base: 0, kind: 'flat' },
    abilityHaste: { base: 0, kind: 'flat', curve: 'haste' },
    damage: { base: 1, kind: 'multiplier' },
    maxHealth: { base: 600, kind: 'flat', min: 1 },
    level: { base: 1, kind: 'flat' },
    reach: { base: 1, kind: 'multiplier' },
    area: { base: 1, kind: 'multiplier', derives: { from: 'reach', per: 0.125 } },
    hitRating: { base: 0, kind: 'flat', converts: { to: 'hitChance', curve: 'hitRating' } },
    hitChance: { base: 0.05, kind: 'flat', min: 0, max: 1 },
    armor: { base: 0, kind: 'flat' }
  },
  { curves }
);

const sources = defineSources(['base', 'gear', 'talents']);
const modifiers = createModifierSystem({ stats, sources });
const sheet = modifiers.createSheet();

modifiers.setSource(sheet, sources.id.gear, [
  modifiers.compile([
    plus('attackDamage', 40),
    plus('abilityPower', 50),
    plus('abilityHaste', 100),
    plus('reach', 1),
    plus('hitRating', 150)
  ])
]);

const caster = modifiers.view(sheet);

assert.equal(caster.total(stats.id.area), 1.125);
assert.equal(caster.total(stats.id.hitChance), 0.2);
```

At level 1, 150 hit rating contributes `150 / 10 / 100 = 0.15`; adding the hit-chance base 0.05 gives 0.2.
Reach rises from 1 to 2, so the area stat receives `0.125 × max(0, 2 - 1) = 0.125`.

Definitions reject cycles through `derives` and `converts` at table construction. Sheet construction also rejects cycles
through `perStat` and those intrinsic relationships, including shared lists, even when gates/conditions would currently
exclude the entries. That sheet check happens lazily at the first read after lists change, not necessarily at `compile`.
Game callbacks and curve-parameter dependencies must also be designed without recursion; the explicit graph checks are
not a general proof over arbitrary callback behavior.

Reference: [`stats.ts`](../src/modifiers/stats.ts), [`build-sheet.ts`](../src/modifiers/build-sheet.ts),
[`conversions.test.ts`](../tests/modifiers/conversions.test.ts).

## 12. Curve library

Curves are data or pure game functions mapping an input number to an effect. They are used by scaling, stat conversions,
and damage integrations. They do not automatically apply damage mitigation just because a stat is named armor.

The library ships general shapes only. A game's own formulas, such as League of Legends' ability haste or WoW's
diminishing returns on avoidance (both in the example above), are custom curves the game registers under its own names.
Register a named table with `defineCurves`, pass it to `defineStats`, and then use a curve name or an inline curve object.
The table is empty when none is passed.

| Constructor                            | Result                                           | Content constraints / interpretation                                    |
| -------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------- |
| `linear(per)`                          | `x × per`                                        | Flat conversion, no automatic clamp                                     |
| `rating(per)`                          | `x / per / 100`                                  | Rating per one percentage point; `per > 0`                              |
| `hyperbolic({ k, cap?, negative? })`   | Positive input: `x / (x + k)`, optionally capped | `k > 0`; cap in `(0, 1]`; result is a reduction fraction                |
| `stacking(rate)`                       | `1 - (1 - rate) ** x`                            | Equal-instance multiplicative removal; rate in `[0, 1]`                 |
| `table(points)`                        | Piecewise linear interpolation                   | Finite points, strictly ascending x; endpoint values hold outside range |
| `customCurve(map, params?)`            | `map(x, values)`                                 | Pure deterministic; `values` holds each named parameter, evaluated      |
| Game function passed to `defineCurves` | That function's result                           | Shorthand for `customCurve(map)` with no parameters                     |

`hyperbolic` with its default `negative: 'zero'` gives zero reduction at/below zero. With `negative: 'amplify'`, a
negative input instead returns `2 - k / (k - x)`, a **damage multiplier**, not a reduction. The damage pipeline understands
that distinction; a custom consumer must branch appropriately rather than apply `1 - result` to both cases.

Curve parameters such as `per`, `k`, `cap`, and `rate` can be numbers, scaled formulas, or lookup objects. So can a
custom curve's named parameters: the framework evaluates them before each call and passes their values to `map` by name,
so a game formula can read the attacker's level or the defender's stats, and snapshots and target checks see those reads.
A custom curve's function must not read stats itself. It receives only numbers; the parameter record is reused between
calls, so read it during the call and do not keep it. Custom parameters are only checked to be finite.
`byLevel(points, { stat?, from? })` produces a lookup, defaulting to the caster's `level` stat. It reads the stat's
resolved total and uses the same linear interpolation/endpoint behavior as a table curve.

`compileCurve(stats, ref, { ranks?, allowsTarget?, what? })` resolves parameter stat names and validates context use.
`evaluateCurve(compiled, x, { caster, target?, rank? })` returns the mapping directly. If a target lookup parameter is
required and evaluation has no target, it throws; omitting a target is not universally safe for curve parameters.

<!-- example: modifiers-values.ts#curve-evaluation -->

```ts
const armorCurve = compileCurve(stats, 'armor');

assert.equal(evaluateCurve(armorCurve, 100, { caster }), 0.5); // A reduction fraction, not damage remaining.
assert.equal(evaluateCurve(armorCurve, -100, { caster }), 1.5); // Amplify mode returns a damage multiplier here.

const converted = compileScaled(stats, scaled(10, curveOf('growth', 1, { stat: 'level' })));
const tableBases = basesView(stats.columns.base);

assert.equal(evaluateScaled(converted, { caster: tableBases }), 10);
assert.equal(explainScaled(damage, 2, { caster }).isPartial, true);
assert.equal(explainScaled(damage, 2).total, undefined);
```

Load-time checks verify declared parameter values (or a scaled parameter's base values), not every possible runtime
result of a dynamic formula. Keep dynamic denominators positive and finite. A custom curve's formula is the game's own:
guard its domain (a haste formula written as `100 / (100 + x)` alone divides by zero at -100), or clamp its input stat.

Reference: [`curves.ts`](../src/modifiers/curves.ts), [`evaluate.ts`](../src/modifiers/evaluate.ts),
[`curves.test.ts`](../tests/modifiers/curves.test.ts).

## 13. Scaled values

### 13.1 Formula and term helpers

A `Scaled` value is either a plain finite number or a formula. The compiler always produces a `CompiledScaled`.
It evaluates in the fixed order:

```text
(rank base + each additive term) × each amplification factor × curve(sum of curve-input terms)
```

| Helper                                        | Role                                      | Allowed stat kind / options                                          |
| --------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------- |
| `ranks(v1, v2, ...)`                          | Frozen per-rank array; at least one value | Rank numbers start at 1                                              |
| `scaled(base, ...parts)`                      | Assemble a formula                        | Groups add, amp, and curve terms, preserving order within each group |
| `add(stat, coef, { of?, from? })`             | Add `coef × stat` to formula base         | Flat stats only                                                      |
| `amp(stat, coef, { from? })`                  | Multiply by `1 + coef × (stat − neutral)` | Multiplier stats only; `of: 'bonus'` is rejected                     |
| `curveOf(curve, coef, { stat?, of?, from? })` | Add a term to the final curve's input     | Explicit stat, or infer one stat declaring a named curve             |

These helper names describe formula construction. They do not install modifiers on a sheet.

`of` defaults to `total`. `of: 'bonus'` reads `view.total(stat) - view.base(stat)` and can be negative; it is rejected for
a stat with table base zero because the bonus is already its total. `from` defaults to `caster`; `from: 'target'` reads
the target at evaluation. Curve terms can read either stat kind.

A multiplier share of exactly 1 and neutral of exactly 1 reads the multiplier unchanged through `shareOf`.
Rewriting it as `1 + 1 × (M - 1)` can produce a different last bit. A neutral of zero intentionally gives a factor of
`1 + share × M`; it does not use the neutral-one shortcut.

All curve terms of a formula must refer to the same curve reference. The `scaled` helper rejects mixing distinct curve
references; reuse the same inline object if several terms feed an inline curve. A curve is applied once, after summing
its inputs. A missing curve has factor exactly 1.

### 13.2 Compile once, evaluate for a context

<!-- example: modifiers-values.ts#scaled-values -->

```ts
const damage = compileScaled(
  stats,
  scaled(
    ranks(60, 95, 130),
    add('attackDamage', 1.2),
    add('abilityPower', 0.5),
    add('maxHealth', 0.08, { from: 'target' }),
    amp('damage', 1)
  ),
  { ranks: 3, what: 'blast damage' }
);

const targetSheet = modifiers.createSheet();

modifiers.setSource(targetSheet, sources.id.base, [modifiers.compile([plus('maxHealth', 1400)])]);

const target = modifiers.view(targetSheet);

assert.equal(evaluateScaled(damage, { caster, target, rank: 2 }), 400);
assert.equal(evaluateScaled(damage, { caster, rank: 2 }), 240); // Target term omitted for this preview.

const cooldown = compileScaled(stats, scaled(12, curveOf('haste', 0.5)), { allowsTarget: false });

assert.equal(evaluateScaled(cooldown, { caster }), 8);

const bonus = compileScaled(stats, scaled(0, add('attackDamage', 0.6, { of: 'bonus' })));

assert.equal(evaluateScaled(bonus, { caster }), 24); // 0.6 × (100 - 60).
assert.equal(shareOf(0.3, 1), 0.3); // Avoids the different last bit of 1 + (0.3 - 1).
```

The rank-2 damage example is `95 + 1.2 × 100 + 0.5 × 50 + 0.08 × 2000 = 400`, amplified by damage stat 1.
Without a target, the target-health term is omitted and the preview gives 240.

`compileScaled(stats, formula, options?)` checks all names, stat-kind/term combinations, finite bases and ratios,
per-rank list lengths, curve references, and target restrictions. Set `what` to content ownership and set `ranks` when
the containing spell or item has a declared rank count. Set `allowsTarget: false` for a cooldown or another context
that cannot have a target.

Without an explicit rank count, the first per-rank array determines it and all other arrays must match. A scalar base
or ratio repeats across the formula's ranks. A completely scalar formula has one rank. During evaluation, omitted ranks
and ranks at/below 1 select the first; ranks beyond the last select the last; in-range fractional ranks are truncated.
Games should pass finite rank numbers.

Without a target, normal target stat terms are skipped. This is a partial preview, not a prediction of unknown target
stats. A curve's target lookup parameter can still require a target, as described above.

The evaluation does not apply a final stat clamp to the formula's result or automatically enforce positive damage and
durations. Its input stats have already been clamped; the resulting number belongs to the game's next system.

Reference: [`scaled.ts`](../src/modifiers/scaled.ts), [`compile-values.ts`](../src/modifiers/compile-values.ts),
[`scaled.test.ts`](../tests/modifiers/scaled.test.ts).

## 14. Live views and snapshots

### 14.1 Live `StatView`

`system.view(sheet, read?)` returns a view with `total(stat)` and `base(stat)`. The total resolves the sheet with the
captured read each time. It is not a snapshot. Make the view once per bearer and read purpose; constructing it allocates
an object and closures. Changes made through sources or the read's host are reflected by future totals.

`view.base(stat)` is the stat table's base. Installing a base-source addition, including a unit template's base
adjustment, changes the total but does not change this method's return value. Consequently `of: 'bonus'` and built-in
`derives` measure against the **table base**, not an item's base or a unit's adjusted starting total. This also applies
to the unit system's modifier-backed view. If the game needs a different bonus baseline, supply a deliberate game-owned
`StatView` adapter for formulas; that does not change the sheet's intrinsic `derives` rule.

`basesView(arrayLike)` is a simpler view where each total equals its base. It does not fold modifiers, conversions, or
intrinsic derivations; missing indexes read zero. With the unit system and no modifier system, unit views use their own
base vectors through this helper.

### 14.2 `snapshotScaled` freezes a formula's caster inputs

`snapshotScaled(compiledValue, { caster, rank? }, into?)` captures the rank and every caster stat the formula reads,
including stats used by curve parameters. `finishScaled(snapshot, target?)` evaluates the full formula in the normal
order with frozen caster values and the target's current stats. Finishing without a target omits normal target terms.

Pass an existing snapshot of the same compiled value as `into` to reuse its storage. Do not reuse that storage for a
second concurrent cast while the first still owns it. Reusing a snapshot of a different compiled value creates a new one.

### 14.3 `freezeStats` freezes an explicit stat set

`freezeStats(view, statIds, into?)` produces `FrozenStats`, an explicit frozen view for use cases such as periodic damage
retaining attacker stats. It captures both totals and bases. Reading a stat that was not taken throws, preventing a mix
of live and frozen attacker stats.

`new FrozenStats(size)` followed by `.take(view, ids)` supports storage reuse. Every take forgets previously taken ids;
the size must cover every new id. Supplying `into` to `freezeStats` uses the same rules. Each effect owns its snapshot
for as long as later hits may read it.

<!-- example: modifiers-values.ts#snapshots -->

```ts
const snapshot = snapshotScaled(damage, { caster, rank: 2 });
const frozen = freezeStats(caster, [stats.id.damage, stats.id.attackDamage]);

modifiers.setSource(sheet, sources.id.talents, [modifiers.compile([plus('attackDamage', 100)])]);

assert.equal(evaluateScaled(damage, { caster, target, rank: 2 }), 520);
assert.equal(finishScaled(snapshot, target), 400); // Caster frozen at 100 attack damage.
assert.equal(frozen.total(stats.id.attackDamage), 100);

modifiers.setSource(targetSheet, sources.id.base, [modifiers.compile([plus('maxHealth', 400)])]);

assert.equal(finishScaled(snapshot, target), 320); // Target's maximum health remains live.
```

The generic scaled snapshot contains only the caster inputs that its compiled formula needs. Its caster view is not a
complete snapshot suitable for arbitrary other formulas; uncollected stats read NaN. Use `freezeStats` with an explicit
complete list of the stats the later consumer will read.

Freezing the formula alone does not freeze every outgoing multiplier a damage pipeline might apply later. For a periodic
effect that must keep those multipliers too, freeze that pipeline's required attacker stats and pass them through the
appropriate damage integration's `attackerStats` field. Decide whether a bonus belongs in the formula or in the pipeline
so the same outgoing multiplier is not applied twice.

Reference: [`compiled.ts`](../src/modifiers/compiled.ts), [`snapshot.ts`](../src/modifiers/snapshot.ts),
[`frozen-stats.ts`](../src/modifiers/frozen-stats.ts), [`bases-view.ts`](../src/modifiers/bases-view.ts).

## 15. Structured explanations

The framework returns ids, numeric values, conditions, and contribution data. The client maps ids to names, formats
numbers, and writes localized tooltip text; presentation does not belong in the modifier definitions.

| API                                                | Information returned                                                                   | Appropriate use                            |
| -------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------ |
| `explainModifier(compiledModifier, stacks = 1)`    | Operation, compiled value/condition/scope, stack count, and plain landed value         | One authored effect's tooltip              |
| `explainModifiers(list, stacks = 1)`               | One explanation per list modifier in authored order                                    | Item/aura content description              |
| `system.explainStat(sheet, stat, read?)`           | Base, additions, derivations, multipliers, caps, final clamp, total                    | Diagnose an actual bearer's resolved stat  |
| `explainScaled(compiledValue, rank = 1, context?)` | Rank base, each term's ratio and optional reading, curve identity, total, partial flag | Spell formula tooltip or combat debug view |

For computed modifier values, `explainModifier(...).landed` is undefined because it has no host/read with which to
evaluate the value. For a live stat explanation, `Contribution.value` is the actual computed/stacked value, or undefined
when the contribution is excluded. `Contribution.stacks` is zero when excluded. Do not mistake the nested authored
modifier's plain `landed` preview for the contribution's actual eligibility.

`explainStat` lists the compiled entries, including inactive ones; an absent buff can therefore appear with zero stacks.
It recomputes reads and allocates diagnostic objects. Under deterministic, side-effect-free callbacks, its total matches
`resolve` for the same sheet, stat, and read. Use it for debug tools and UI requests rather than every combat step.

`explainScaled(value, rank)` without context is a ratio-only explanation: `total` is undefined. With caster context it
can compute a total; if target-dependent terms exist and no target was supplied, `isPartial` is true. Required target
curve lookups can still throw. A ratio-only explanation's `isPartial: false` does not imply that a live total exists.

The following example also shows a watch; both are in the full host example.

<!-- example: modifiers-host.ts#explanations-and-watch -->

```ts
const explanation = modifiers.explainStat(sheet, stats.id.armor, read);
const authored = explainModifiers(armorAura, 2);

assert.equal(explanation.total, modifiers.resolve(sheet, stats.id.armor, read));
assert.equal(authored[0]?.landed, 60);

const changes: StatChange[] = [];

const watch = watchStats(modifiers, {
  stats: [stats.id.maxHealth],
  onChange: (change) => changes.push({ ...change }) // Copy the reused callback payload if keeping it.
});

watch.check(sheet, read); // First check records the starting value; it raises no change.
modifiers.setSource(sheet, sources.id.base, [modifiers.compile([plus('maxHealth', 50)])]);
watch.check(sheet, read);

assert.equal(changes[0]?.before, 100);
assert.equal(changes[0]?.after, 150);
```

Reference: [`explain.ts`](../src/modifiers/explain.ts), [`explain-scaled.ts`](../src/modifiers/explain-scaled.ts),
[`explain.test.ts`](../tests/modifiers/explain.test.ts).

## 16. Stat watches and resource policies

`watchStats(system, { stats, onChange })` creates a watch over the listed numeric ids. The host calls
`watch.check(sheet, read?)` at a chosen point after equipment, aura, rank, or other relevant state changes.

Contracts:

- The first check of a sheet records the current values and emits nothing.
- Later checks raise changed stats in the order the ids were listed.
- Comparisons use `Object.is`: a NaN remaining NaN is unchanged; signed zeros can differ.
- The watch remembers values per sheet in a `WeakMap`.
- The callback object is reused. Copy `{ ...change }` if storing a change beyond its callback.
- The watch does not subscribe to aura events or run automatically.
- It stores one baseline per sheet, not per scope/read. Use separate watches for distinct read purposes.

For maximum health, choose what the game does with current health when the maximum changes: preserve the amount,
preserve the fraction, heal some of the gain, clamp, or another policy. The watch reports before/after maximums; it does
not choose the policy. The unit system also provides health-policy and synchronization integration—avoid applying the
same adjustment through two paths.

Check at the game's required synchronization point before consumers use the corresponding resource or replicated
projection. A conditional maximum-health bonus can change when health changes even if no aura event occurred. Clock
rescaling and attack-timer changes likewise require explicit downstream integration; resolving haste does not edit them.

Reference: [`watch.ts`](../src/modifiers/watch.ts), [`units/hosts.ts`](../src/units/hosts.ts),
[`sheets.test.ts`](../tests/modifiers/sheets.test.ts).

## 17. Caching, allocation, and lifecycle

### 17.1 Compiled-list cache

The sheet builds its per-stat operation lists lazily on the first read. `setSource` marks the sheet dirty, even if the
caller supplies equivalent lists. `share` advances a system-wide shared-list revision; existing sheets rebuild lazily
on their next read. Shared changes may require rebuilding even when `sheet.isDirty` alone still reports false.

`sheet.compiles` counts times the sheet took a compiled cache, including reuse of another sheet's cache. It is a
diagnostic count, not a count of content compilation calls or necessarily of new allocations.

The system can share a built cache among sheets holding the **same compiled-list objects** in the same order at every
source and the same shared revision. Compiling identical content separately creates different identities and loses
that sharing opportunity. Unit templates and variants reuse lists for this reason.

Gate changes, health changes, and condition results do not replace compiled lists. Do not call `setSource` or `compile`
every tick to make state-dependent content update.

### 17.2 Optional kept totals

Without `revision`, every resolve folds current gates and state. With `revision(host)`, an eligible plain total can be
kept until the revision moves or the sheet/shared lists change. This is an additional cache, separate from compiled lists.

A total is eligible only when the read has a host and **omits** `scope`, `sources`, and `whatIf`, and the evaluated fold
does not consult a condition, host value, or conversion curve. A full source mask or empty scope object still disables
this optimization because the corresponding field is present. Dependency folds propagate state-read dependence, so a
stat depending on a dynamically read stat is not incorrectly retained as plain.

The revision must change whenever reported stacks or held gates can change. `auraRevision` provides this contract for
normal aura state operations, including silent states. Custom gate hosts must update their own revision in every
application, stack-change, removal, or other operation affecting the gate report.

<!-- example: modifiers-host.ts#kept-totals -->

```ts
const plainSheet = modifiers.createSheet(); // No conditional or host-valued own lists on this sheet.

assert.equal(modifiers.resolve(plainSheet, stats.id.armor, read), 60);

hero.stacks[ARMOR_GATE] = 3;
hero.revision += 1; // Required: this stat's plain total may have been kept at the old revision.

assert.equal(modifiers.resolve(plainSheet, stats.id.armor, read), 90);
assert.equal(plainSheet.compiles, 1); // A gate change did not rebuild the compiled lists.
```

Never use one cached sheet for different hosts merely because their revision numbers match. Kept totals are stored per
sheet by revision value, not by host identity. Maintain one sheet per bearer, or omit revision caching in an integration
that deliberately varies the host.

### 17.3 Hot-path guidance

- Load: define tables, compile lists/formulas, share aura registry lists, and build source masks/scope bitsets.
- Spawn: create the bearer's sheet and its retained read/view; install stable base/template and equipment lists.
- Content change: replace only the source(s) that changed.
- Buff state change: update gates through the aura system or the custom gate host; move the revision if enabled.
- Simulation reads: reuse read objects and call `resolve`, view totals, or formula evaluation.
- UI/debug request: allocate explanations when requested.

Normal resolution after a sheet is built allocates no framework objects. Sheet creation/rebuilds, `view`, compilation,
explanations, initial watches, and first-time snapshots allocate. Custom callbacks can still allocate on every read;
keep them inexpensive and avoid hidden world scans unless a lazy condition actually needs one.

The modifier system has no tick method, timer, disposal call, or own bearer registry. A game releases its references to
dead sheets/views when their consumers are finished. Aura state lifecycle belongs to the aura system. Retained snapshots
may intentionally outlive a caster, so their ownership must follow the pending effect rather than the live unit.

Reference: [`system.ts`](../src/modifiers/system.ts), [`build-sheet.ts`](../src/modifiers/build-sheet.ts),
[`kept-totals.test.ts`](../tests/modifiers/kept-totals.test.ts).

## 18. Integrate with the rest of a game

### 18.1 Suggested game-side organization

```text
game/content/stats.ts          stat and curve tables, units and neutral values
game/content/sources.ts        stable ordered source table and reusable masks
game/content/scopes.ts         coordinated scope ids and retained spell/tag sets
game/content/items.ts          authored content and compiled item lists
game/content/auras.ts          buff/debuff definitions with modifiers
game/runtime/stats.ts          modifier system, bearer sheets and read/view factories
game/runtime/stat-sync.ts      watches and chosen health/clock/replication policies
game/client/stat-text.ts       names, icons, formatting and localized explanation text
```

These are suggested consumer paths, not files or subsystems shipped by the framework. Keep the runtime read path generic:
equipment installs lists, auras report gates, and spells ask for views; no switch on a particular item or buff id is needed
to implement ordinary modifiers.

### 18.2 Equipment, passives, and unit bases

Maintain stable equipment slot order. Build the complete list collection for the equipment source when inventory changes,
and call `setSource` once. A content effect held by multiple bearers should share the same compiled list object.

For permanent progression, use owned source lists, or passive auras when the effect also needs aura lifecycle/triggers.
Avoid installing the same passive through both paths.

A game with its own bearer model can represent an adjusted base stat as an addition at a dedicated base source:
an attack-damage table base of 60 and a unit starting at 80 need a base-source addition of 20, not 80.

When using the framework unit system, pass its modifier integration `{ system, base: declaredSourceName }`.
The unit system compiles template/spawn base deltas and installs them at that source, creates sheets, and exposes live
views through `units.statsOf(unit)`. Treat the base source as owned by that integration. Templates and `units.variant`
share compiled base lists; individual spawn overrides compile per unit. See
[`units/bases.ts`](../src/units/bases.ts) and [`units/engine.ts`](../src/units/engine.ts).

### 18.3 Spells and damage

Provide a stat view whose read includes the actual spell's scope set wherever a spell-specific stat is requested.
The damage host's `statsOf(unit, spell)` integration receives the spell so the game can select such a view. An unscoped
general unit view skips scoped modifiers; a host must not silently use it for every spell if spell-specific bonuses exist.
See [`damage/options.ts`](../src/damage/options.ts).

Compile spell formulas at content load. At the cast's chosen capture point, take a `snapshotScaled` or retain a live view
according to game behavior. Finish snapshots against the target at hit time. Passing a naked number means the calculation
is already complete; it will not acquire target terms later.

Stat definitions do not route damage kinds, choose mitigation stats, or choose an outgoing multiplier list. Those are
damage pipeline/game definitions. If both a formula's `amp('damage', 1)` and the pipeline's outgoing stage use the same
damage stat, the bonus is applied twice. Assign each bonus to one intended stage.

### 18.4 Prediction, replication, and presentation

Use the same compatible content tables and ordering wherever the simulation is mirrored. A prediction copy can keep
its own sheets and aura state; callback dependencies must be present in that copy. Annotate mirror-safe conditions and
values truthfully, and use the prediction/aura checks for predicted content.

The modifier system itself is not a wire codec or complete rollback serializer. Replicate the game state the mirror
needs, or resolved values the client is meant to display, through the game's replication contracts. Rebuild caches from
content/state instead of treating internal compiled entries as persisted state.

Format percentages, rounding, units, names, and localization in client code. Use structured explanations to keep displayed
ratios and contributions tied to simulation data. Do not round values in the fold to make UI text look cleaner.

## 19. Validation and failure behavior

The public APIs generally throw `RangeError` for invalid content/ids and `TypeError` for a fabricated sheet. Errors at
load should stop content initialization and identify the owning definition through `what`.

| When                             | Checks / failures                                                                                                                                                                                         |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `defineStats`                    | Valid kind; no NaN bases/clamps; finite neutral; min ≤ max; known named curves; valid explicit linked stats; finite derives share; explicit derives/converts cycles; no target reads in conversion curves |
| `defineSources`                  | At most 32 declared sources; registry name rules                                                                                                                                                          |
| `system.compile`                 | Known stat/condition/value names; legal operation; no NaN numeric modifier fields; non-negative integer scope/gate; linear stacking only on `mul`; valid compiled condition expressions                   |
| `setSource`                      | Source id in range; gated lists require a stacks callback; array copied/frozen                                                                                                                            |
| `share`                          | Same source/gate requirements; every list gated; ascending gate order                                                                                                                                     |
| First sheet read after changes   | Build/cache adoption; cycles involving `perStat`, shared lists, and intrinsic relationships                                                                                                               |
| `compileScaled`                  | Known stats/curves; finite bases/ratios; consistent rank arrays; flat add / multiplier amp; valid bonus use; context permits target reads; unique inferred curve stat                                     |
| Curve registration / compilation | Parameter declared ranges; finite ordered lookup points; known parameter stats; context permits target reads                                                                                              |
| `FrozenStats.take` / read        | Requested ids fit storage; later reads were explicitly taken                                                                                                                                              |

Validation is not a universal runtime numeric sanitizer. Ordinary modifier numbers can be infinite if not NaN; finite
inputs can also overflow or produce NaN through invalid combinations. The final clamp leaves NaN as NaN. Callback
outputs, custom curves, arbitrary JavaScript input objects, rank values, and preview stack counts remain game
responsibilities. Use finite tuning values except where infinity is an intentional sentinel, and validate external
content before turning it into typed definitions.

Warm up representative sheets at load/spawn when you want sheet-level dependency errors discovered before combat.
Checking one resolved stat builds and checks the sheet's full explicit dependency graph, not just that stat's graph.

## 20. Troubleshooting

| Symptom                                           | Likely cause                                                                                                    | Check / correction                                                                  |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| A buff contributes nothing                        | Missing host, zero stacks, missing gate installation, failed condition, or unreached scope                      | Read `explainStat`; check `Contribution.stacks`, read fields, and aura application  |
| A fire bonus affects nothing                      | Read omitted the scope set or used the wrong scope namespace                                                    | Supply the retained bitset containing the modifier's scope id                       |
| Equipping one item removes other item bonuses     | `setSource` replaces the source's whole owned list set                                                          | Supply all occupied slot lists in stable order                                      |
| A buff counts twice                               | Aura shared lists were also installed as owned lists                                                            | Keep aura modifiers in the aura system's shared integration                         |
| A stack change leaves an old total                | Revision callback did not move, or a sheet was used for another host with the same revision                     | Update revision on every gate change; keep one sheet per bearer                     |
| Health condition seems stale                      | Host state was not updated, callbacks captured another object, or the application cached a number/view snapshot | Verify live host/read and snapshot ownership; conditions reached by a fold are live |
| Removing gear does not remove a buff              | Shared lists at that source are separate from owned lists                                                       | Remove the buff through the aura/gate lifecycle                                     |
| A cap appears to exceed its limit                 | Final stat floor is higher than the modifier cap                                                                | Set compatible stat clamp and cap values                                            |
| A fractional count appears                        | Stat folds do not round                                                                                         | Apply the game's rounding rule at the count-consuming boundary                      |
| A computed multiplier wipes the result to zero    | `perStat` returns a factor directly, and its followed bonus is zero                                             | Use a value formula that deliberately includes the desired neutral factor           |
| A cycle error appears only during the first read  | Sheet-level graph validation is lazy                                                                            | Warm up sheets; remove the circular relationships, even conditional ones            |
| A bonus term rejects a zero-base stat             | `of: 'bonus'` is redundant for table base zero                                                                  | Use the total term                                                                  |
| `curveOf('haste', …)` fails to infer a stat       | No stat, or multiple stats, declares the named curve                                                            | Declare one or name it: `curveOf('haste', coef, { stat })`                          |
| A delayed hit changes after a caster buff expires | It uses a live view or only part of its attacker stats was frozen                                               | Snapshot formula and required downstream attacker stats at the intended point       |
| A frozen view throws for a stat                   | Required stat was not taken, or storage was retaken for another effect                                          | Freeze every required stat and keep storage owned by one effect                     |
| Damage seems multiplied twice                     | Both scaled `amp` and pipeline outgoing stages include the same bonus                                           | Put the factor at its intended single stage                                         |
| Small replay differences appear after a refactor  | Source/list/multiplier order changed or factors were regrouped                                                  | Preserve the fixed order; inspect fold-order regressions                            |
| An explanation is expensive                       | It expands diagnostic entries and allocates, potentially evaluating world conditions                            | Request explanations for UI/debug purposes, reuse cheap resolution in combat        |
| A watch does not emit on spawn                    | Its first check establishes a baseline                                                                          | Initialize resource state separately, then watch subsequent changes                 |
| A watch emits inconsistent scoped changes         | One watch checks the same sheet with different read purposes                                                    | Use separate watches per purpose                                                    |

## 21. Public API map

Use [`src/modifiers/index.ts`](../src/modifiers/index.ts) as the authoritative export list. This table groups all public
runtime exports; accompanying type exports describe the same contracts.

| Area                             | Runtime exports                                                                                 | Primary types / source                                                                                                                                                                                                                                                 |
| -------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stats                            | `defineStats`                                                                                   | `StatDef`, `StatTable`, `Derivation`, `StatId`, `StatIndex`, `NamedCurve`; [stats](../src/modifiers/stats.ts), [ids/index](../src/modifiers/stat-id.ts)                                                                                                                |
| Sources                          | `defineSources`, `sourceMask`                                                                   | `SourceDef`, `SourceId`, `SourceTable`; [sources](../src/modifiers/sources.ts)                                                                                                                                                                                         |
| Modifier content                 | `plus`, `mul`, `cap`, `perStat`, `hostValue`                                                    | `Modifier`, `ModifierOptions`, `ModifierValue`, `StatValue`, `HostValue`, `CompiledValue`, `CompiledModifier`, `ModifierList`, `ModifierTables`; [modifier](../src/modifiers/modifier.ts)                                                                              |
| System                           | `createModifierSystem`                                                                          | `ModifierSystem`, `ModifierSystemOptions`, `StatSheet`, `FoldRead`; [system](../src/modifiers/system.ts), [sheet](../src/modifiers/sheet.ts)                                                                                                                           |
| Scaling content                  | `ranks`, `scaled`, `add`, `amp`, `curveOf`                                                      | `PerRank`, `Scaled`, `Scaling`, `ScalingPart`, `Term`, `CurveTerm`, `TermOptions`; [scaled](../src/modifiers/scaled.ts)                                                                                                                                                |
| Scaling compilation / evaluation | `compileScaled`, `compileCurve`, `evaluateScaled`, `evaluateCurve`, `shareOf`                   | `CompileOptions`, `StatView`, `ScaledContext`, `CompiledScaled`, `CompiledTerm`, `CompiledCurve`, `CompiledParam`, `CompiledLookup`; [compile](../src/modifiers/compile-values.ts), [compiled](../src/modifiers/compiled.ts), [evaluate](../src/modifiers/evaluate.ts) |
| Curves                           | `defineCurves`, `linear`, `rating`, `hyperbolic`, `stacking`, `table`, `customCurve`, `byLevel` | `Curve`, `CurveRef`, `CurveParam`, `CurveTable`, `CurveId`, `Lookup`, and the six curve interfaces; [curves](../src/modifiers/curves.ts)                                                                                                                               |
| Snapshots / bases                | `snapshotScaled`, `finishScaled`, `freezeStats`, `FrozenStats`, `basesView`                     | `ScaledSnapshot`; [snapshot](../src/modifiers/snapshot.ts), [frozen stats](../src/modifiers/frozen-stats.ts), [bases](../src/modifiers/bases-view.ts)                                                                                                                  |
| Explanations                     | `explainModifier`, `explainModifiers`, `explainScaled`; system method `explainStat`             | `ModifierExplanation`, `Contribution`, `DerivedContribution`, `StatExplanation`, `ScaledExplanation`, `TermExplanation`; [modifier/stat explanations](../src/modifiers/explain.ts), [scaled explanations](../src/modifiers/explain-scaled.ts)                          |
| Changes                          | `watchStats`                                                                                    | `StatWatch`, `StatChange`; [watch](../src/modifiers/watch.ts)                                                                                                                                                                                                          |

The system's callable methods are `compile`, `createSheet`, `setSource`, `share`, `resolve`, `view`, and `explainStat`.
It also exposes `stats` and `sources`. These functions are created as bound closures; consumers do not need a class
receiver for them. Internal helpers such as `foldStat`, `compileModifiers`, and `rankSlot` are not public subpath exports.

## 22. Agent handoff and verification

Before adding or modifying a game mechanic using this system, establish these facts:

1. Which stat is changed, with what kind, table base, neutral, units, clamp, and rounding rule at consumption?
2. Is the change additive, multiplicative, or an upper cap, and at what stable source/list position?
3. Is it unconditional, host-dependent, or gated by an aura/custom stack count?
4. Is it general or scoped to a coordinated id, and do all relevant read paths provide that scope?
5. Does the effect depend on another stat through a permanent derivation, rating conversion, or content-owned `perStat`?
6. Does a formula need total or bonus inputs, caster or target terms, and one or several ranks?
7. At what moment must caster stats be captured, which later pipeline stats also need freezing, and who owns storage?
8. Which resource/clock/movement/replication policy must respond, and where does that synchronization run?
9. If totals are cached by revision, does every gate state mutation move it and stay with the same bearer sheet?
10. Which existing contract test documents the behavior and which example can be adapted for the game?

Run these checks from the repository root using the Node version required by `package.json`:

```sh
npm run typecheck
npm run lint
npm run format:check
npm run docs:check
node --test 'tests/modifiers/*.test.ts' tests/auras/modifiers.test.ts
```

`docs/examples` is included in the normal TypeScript project and lint discovery. `npm run docs:check` executes the four
example files with their numeric assertions; it is also part of `npm run check` and CI. Every TypeScript block in this
guide is taken from one of those files (the marker immediately before the block identifies its file and region).
When editing an example, update its included Markdown block as well.

Focused contract references:

| Behavior                                                       | Tests                                                                                        |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Stat registration and validation                               | [stats](../tests/modifiers/stats.test.ts)                                                    |
| Fold, float order, caps, derived gain                          | [fold](../tests/modifiers/fold.test.ts), [fold order](../tests/modifiers/fold-order.test.ts) |
| Gate stacks, scopes, what-if reads                             | [gates and scopes](../tests/modifiers/gates-and-scopes.test.ts)                              |
| Held-gate optimization parity                                  | [held gates](../tests/modifiers/held-gates.test.ts)                                          |
| Owned/shared sheet caches, host values, cycle checks, watches  | [sheets](../tests/modifiers/sheets.test.ts)                                                  |
| Revision-based kept totals                                     | [kept totals](../tests/modifiers/kept-totals.test.ts)                                        |
| Derived/conversion graph and rating parameters                 | [conversions](../tests/modifiers/conversions.test.ts)                                        |
| Curve formulas and parameter validation                        | [curves](../tests/modifiers/curves.test.ts)                                                  |
| Scaled terms, ranks, exact share-of-1, snapshots, explanations | [scaled](../tests/modifiers/scaled.test.ts)                                                  |
| Live stat explanation matches resolution                       | [explain](../tests/modifiers/explain.test.ts)                                                |
| Aura integration and application-order independence            | [aura modifiers](../tests/auras/modifiers.test.ts)                                           |

For framework changes, preserve these contracts or deliberately revise the affected content/API and evidence together.
For ordinary game content changes, extend the game definitions and adapters without adding game-specific names or tuning
to the framework.
