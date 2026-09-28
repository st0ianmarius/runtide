# spellweave: the plan

A deterministic, engine-agnostic gameplay framework for MMO-like games: spells, auras, procs, triggers, modifiers and cues, woven together, in pure TypeScript with no rendering or networking dependencies.

This is the whole plan in one file. Nothing here is built yet.

- **Part I, the framework plan**: what spellweave is, its ground rules, layout and toolchain, the rules that keep it generic and exact, its systems, and the implementation phases (F0 onwards).
- **Part II, the model**: the Spell API design it implements (spells as the container that orchestrates every system; auras, procs, triggers, constructs, cues), with every spell of swarm, the game it comes out of, mapped onto it.

Section references read `§I.n` for Part I and `§II.n` for Part II. Paths such as `packages/game/src/…` and branch names such as `spell-primitive` refer to the swarm repository (`st0ianmarius/cryptwave`), which is the design reference, read-only.

# Part I. The framework plan

## I.1 Goal

Pull every gameplay system that does not depend on Babylon.js, Colyseus or swarm's content into one standalone project, **the framework** (working name; its package name is a decision, §I.9), so that:

- **the framework is the engine**: modifiers, auras, triggers, procs, cues, spells, constructs, the damage pipeline, abilities, prediction contracts and the deterministic core under them;
- **swarm becomes a consumer**, later and from the outside: its `packages/game` supplies content (stats, auras, spells, cards, classes, creatures) and the world adapter (its `Game` class); `packages/protocol`, `packages/sync` and `apps/server` consume the framework's wire-agnostic contracts; `apps/client` renders cues and replicated views;
- **a future MMO-like game** can start from the framework alone and write only its content, its world and its transport.

The framework has **no dependency on swarm** or any of its packages (not `@swarm/types`, not `@swarm/game`) and is fully unit-testable on its own. Third-party npm packages are allowed where they earn their place, under the policy in §I.5.1.

## I.2 Ground rules for the implementation

1. **A standalone project in its own repository**: this one, `st0ianmarius/spellweave` (created with an MIT `LICENSE` and a Node `.gitignore`). Not a swarm branch, not a workspace package: nothing in swarm's `packages/`, `apps/`, root config or lockfile changes. Locally it is cloned next to the swarm checkout, never inside it.
2. **The latest TypeScript.** The latest stable `typescript` on npm at the time the project starts (`npm view typescript version`), pinned exactly, upgraded deliberately. The project is written to that version's strictest settings (§I.4.1), not to swarm's older config.
3. **The current Node LTS.** `engines.node` is the current LTS major and later. Its built-in type stripping runs the `.ts` sources and tests directly, and its built-in test runner runs the tests (§I.7.0).
4. **Reference swarm, never import it.** The designs to realise live in swarm, read-only. Clone it next to the project (or use the existing checkout) and read with `git -C <swarm> show origin/spell-primitive:<path>`:
   - Part II of this document (written as swarm's `docs/spell-api.md`): the spell / aura / proc / construct model, pacts as passive auras, the barrier as an absorb aura;
   - `packages/game/src/spells/`: the working runner and proc registry;
   - on `master` too: `packages/game/src/{effects,modifiers,triggers,cues,abilities}/` and their READMEs.

   **Port the logic, not the content**: keep the semantics exact (§I.5), drop every game id, tuning number and class name, and restyle it to §I.5.2.

5. **Swarm keeps running unchanged.** Moving swarm onto the framework is a later, separate effort (§I.8). The framework ships as a project nobody imports yet, proven by its own unit tests only (§I.7.0): no example game, nothing visual.

## I.3 What goes in, what stays out

| In the framework (engine)                                                                                 | Stays in swarm (the consumer)                                                     |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| deterministic core: seeded random streams, clocks, ordered registries, event bus, scope                   | the `Game` class, `Game.step`, phases and their order                             |
| modifiers: stat registry, fold, conditions, scopes, caps, card text                                       | `STATS`, conditions' meaning (`enraged`…), numbers                                |
| auras (today's `effects/`): any bearer, stacking, clocks, periodic, values, damage hooks, lifecycle procs | `EFFECTS` content, `EFFECT_HOOKS` (clock rescales)                                |
| triggers: event subscriptions owned by auras, conditions, internal cooldowns, chance, validation, text    | the event kinds' payload sources (`hurtEnemy` raising `hit`…)                     |
| procs: registry, chance, groups, depth cap, the generic kinds                                             | game proc kinds (`shoot` with its shot table, `telegraph` with its hazard shapes) |
| cues: registry shape, event builder, wire table                                                           | `CUES` content, sound bank, Babylon playback                                      |
| spells: `SpellDef`, activation kinds, timeline, runner, delayed procs, spell events                       | every spell, weapon, ability and creature spell                                   |
| constructs: definition, store, tick order, lifetime and bounds, pulses, hit policies, spawning            | every construct kind, replication onto Colyseus schemas                           |
| shapes and geometry: circle, ring, cone, lane, polygon, segment-circle sweep, patterns                    | the world's spatial index, collision, pathfinding, physics (Havok)                |
| world query **interface** (what a spell may ask) + an in-memory reference implementation                  | the real query implementation over `Game.enemies` / heroes                        |
| damage pipeline: blow → mitigation → aura hooks (shelter, absorbs, lethal) → health                       | the mitigation stats' meaning, hit windows, knockback physics                     |
| abilities: button activation, loadouts, cooldowns as auras, costs, `requires` / `blockedBy` / `resets`    | dodge travel, `stepPlayerInput`, class loadouts                                   |
| prediction contracts: mirror-safe context, motion-clock stamps, seeding a mirror's auras                  | the reconciler, `LocalSession`, the co-op room                                    |
| replication **contracts**: append-only wire ids, view specs, projections                                  | Colyseus schemas, msgpack codecs, `PROTOCOL_VERSION`                              |

A rule of thumb for borderline code: if it names a class, a card, a creature, a map, a number from tuning, Babylon, Colyseus or a DOM API, it stays out.

## I.4 Project layout

```
framework/                # a sibling of the swarm checkout, its own git repository
  package.json            # name per §I.9, "type": "module", exports per system, engines, scripts; vetted deps only (§I.5.1)
  tsconfig.json           # the strict base (§I.4.1): src and tests, no emit
  tsconfig.build.json     # emits dist/ (ESM JS + .d.ts) from src only
  eslint.config.js        # flat config: typescript-eslint strict type-checked + the §I.5.2 style bans
  .prettierrc
  README.md               # the engine's model: spell, aura, proc, construct, cue; how a game plugs in
  LICENSE
  .github/workflows/ci.yml  # install, typecheck, lint, format check, test on the Node LTS (once the remote exists)
  src/
    core/                 # random (salted sequential streams + keyed rolls), time (fixed-step sim clock, world / motion,
                          # snap epsilon), registry (append-only ids), bus (typed events, payload reuse, "is anyone
                          # listening", depth cap), scope (owner, source, world)
    math/                 # Vec2, angles, shapes, segment-circle sweep, polygon tests, patterns (line, ring, cross)
    modifiers/            # stat registry, Modifier, conditions, scopes, sources and fold order, resolve, caps, describe
    auras/                # AuraDef, ActiveAura, bearer, stacking, clocks, periodic, value and merge, hooks, lifecycle, view
    triggers/             # TriggerDef on auras, filters, icd auras, dispatch, validate, describe
    procs/                # Proc, ProcDef registry, chance and groups, depth, generic kinds
    cues/                 # CueDef, cue events builder, wire table
    damage/               # Blow, pipeline stages, aura hooks (onIncomingDamage, onLethal), result
    spells/               # SpellDef, activation kinds, timeline, runner, SpellSystem, delayed procs, spell events
    constructs/           # ConstructDef, store, tick order, bounds, limits, pulses, hit policies, spawn
    world/                # WorldQuery interface (inside, nearest, densest, chain, sweep, lineClear, positions, velocities)
    abilities/            # button activation, loadouts, canActivate / tryActivate, cooldown and cost auras
    prediction/           # MirrorCtx, stamps, seeding, the "predicted" rule
    replication/          # wire tables, view specs, projections (transport-agnostic)
    index.ts
  tests/
    <system>/*.test.ts    # unit tests per system
    isolation.test.ts     # no import leaves the project except listed deps; no forbidden globals; the §I.5.2 style
    docs.test.ts          # every exported type, field and hook has a /** */ block
    helpers/              # fake hosts and bearers shared by the tests (not exported)
```

`package.json` exports one entry per system (`<name>/auras`, `<name>/spells`, …) and `.` for the whole, each with a `types` and a `default` condition pointing into `dist/`. The package manager is npm, as in swarm.

### I.4.1 Toolchain on the latest TypeScript

- **Compiler options** (the strict end of what the current TypeScript offers): `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature`, `verbatimModuleSyntax`, `isolatedModules`, `erasableSyntaxOnly` (no enums, namespaces or parameter properties, so every source runs under Node's type stripping, which also fits §I.5.2), `module` and `moduleResolution` `nodenext`, `target` and `lib` at the newest ECMAScript year both the compiler and the Node LTS support, with **no DOM lib**, and `types: ["node"]` in the test config only.
- **Imports** use explicit `.ts` extensions (`allowImportingTsExtensions`), which Node runs as they are; the build rewrites them to `.js` (`rewriteRelativeImportExtensions`) and emits declarations.
- **Scripts**: `typecheck` (`tsc --noEmit`), `build` (`tsc -p tsconfig.build.json`), `test` (`node --test "tests/**/*.test.ts"`), `lint` (`eslint .`), `format` / `format:check` (`prettier`). No bundler, and no `tsx`: Node's type stripping runs the TypeScript directly.
- **Lint**: ESLint flat config with `typescript-eslint`'s strict type-checked presets, plus the §I.5.2 bans through `no-restricted-syntax`.

## I.5 How it stays generic, and exact

**Generic by factories and type parameters, never by imports.** Each system is created from the game's registries, as `effectSystem(registry)` and `triggerSystem(effects, sources)` already are in swarm's `master`:

```ts
const stats = defineStats({ damage: { base: 1, … }, moveSpeed: { … } });       // the game's stat table
const auras = createAuraSystem({ stats, tags: AURA_TAGS, registry: AURAS });   // AuraDef<StatId, TagId, CueId>
const triggers = createTriggerSystem({ auras, events: EVENT_KINDS });
const procs = createProcRegistry({ ...CORE_PROCS, ...GAME_PROCS });            // the game adds its kinds
const spells = createSpellSystem({ procs, auras, triggers, cues, world: adapter });
```

Ids are the game's string unions, inferred from its `const` registries; the framework never names one. Vectors are the framework's own `Vec2` (`{ x, z }`), structurally compatible with the game's `Vec`.

**Hosts are narrow interfaces the game implements**, as `CastHost`, `TriggerHost` and `EffectTarget` are today: the world query, the damage sink, the random streams, the clock, cue output, spawning. The framework never reaches into a concrete world.

**Semantics to keep exactly**, so a later migration of swarm's `packages/game` holds every golden. The tests of each system pin these as literal expectations:

- **Auras:** the world clock is `max(0, t − dt)` and the motion clock snaps to 0 below `1e-8`; periodic beats fire before expiry; stacking modes (`refresh`, `extend`, `stack`, `highest`, `independent`) behave exactly as `effects/system.ts`; an `add` lands `value × stacks` and a `mul` lands `value ^ stacks`; registry order is fold order, walk order and wire id; `blockedBy` is tested before `removes`; `effectsRev` bumps only for predicted auras.
- **Modifiers:** `(base + Σadd) × Πmul`, then `min` caps; muls multiply one by one in source order; sources fold in the order the game declares (for swarm: class base, pacts, totem, passives, effects, class states), and an aura can pick its fold position (`'effects'`, `'classStates'`, and `'pacts'` for pact auras).
- **Triggers:** dispatch order is owner, then party listeners; within a bearer, aura order then authored order; conditions, then internal cooldown, then chance (rolled only when `0 < chance < 1`, on the triggers' own stream), then actions in order; depth cap 3.
- **Procs:** applied in list order; an always-proc rolls nothing; `chance` rolls on the procs' own stream; depth cap as in `spells/cast.ts`.
- **Cues:** a cue's parts come out in the order vfx, sound, text; only parameters that differ from the definition cross the wire.
- **Determinism:** no `Math.random`, `Date.now`, `performance.now` or iteration over unordered keys. `isolation.test.ts` scans for them. Every random draw comes from the run's seed, through the host, in one of the two forms below.
- **Time is a fixed-step simulation clock, never wall time.** The simulation advances in fixed ticks; `time = tick × dt` is derived from an integer tick count, not accumulated, so it never drifts and two runs agree to the bit. The host owns the clock and hands `tick`, `dt` and `time` to every system; the framework never reads a real clock. Rendering interpolates between ticks on its own side. Deadlines are **stamps** (an absolute tick or time at which something ends or fires), never countdowns that are decremented, so they need no syncing and cannot drift; the motion clock (co-op prediction) is a second fixed-step clock counted in motion steps, with the same rule. Swarm accumulates `game.time += dt` today, so the port keeps an **accumulating mode** for parity and the integer-tick mode is the default for new games; the clock's tests pin both.
- **Two kinds of random, both from the run's seed:**
  - **Sequential streams** (`stream(seed, salt)`), each salted so a roll added in one system never shifts another. Their draws depend on call order, so reordering two hits changes every later roll on that stream. The port uses them wherever swarm does today, bit for bit (crits on the main stream, `volley`, `horde`, `trigger`, `proc`…).
  - **Keyed rolls** (`roll(seed, stream, ...key)`), a counter-based 32-bit hash (decided: a Murmur3-finalizer chain, below) of the seed, the stream's salt and a key such as `(tick, casterId, spellId, targetId, index)`. A keyed roll depends only on its key, never on how many rolls came before, so adding content, reordering hits or skipping a system shifts nothing else. It is also safe for rollback and prediction: a client that knows the key rolls the same value the server does, without replaying the server's call history. **Keyed rolls are the default for new content**; a spell or aura picks sequential only to match existing behaviour.
  - Both return a float in `[0, 1)` built from integer arithmetic only, so they are identical on every platform (unlike `Math.sin`). Integer helpers (`int(n)`, `pick(list)`, `shuffle`, `weighted(weights)`) sit on top of both, with the same draw counts so a switch between the two kinds is a one-line change.
- **Keys must be stable.** A keyed roll's key uses integers the simulation already owns (tick, entity ids, registry indexes), never floats or object identity, and the key's parts are documented per call site (`crit: (tick, sourceId, targetId, hitIndex)`). Two rolls that must differ within one tick differ in their key (`hitIndex`, `index`).
- **Platform floats:** `Math.sin` and `Math.cos` differ in the last bit between x64 and arm64 V8 builds. The framework's own random is integer-only and identical everywhere; its unit tests never assert a bit-exact result that goes through `Math.sin`, `Math.cos` or `Math.atan2` (they compare with a tolerance, or use inputs whose results are exact, such as axis-aligned angles).

### I.5.1 Third-party dependencies

npm packages are welcome when they save real work, under five conditions:

1. **Pure and portable.** Plain JavaScript or TypeScript with no DOM, no Node-only runtime API, no native addon and no side effects on import, so the framework still runs in a browser, on a server and in a worker.
2. **Deterministic.** No hidden randomness, clocks or unordered iteration on a path the simulation depends on.
3. **Small and maintained.** A permissive licence (MIT, ISC, BSD, Apache-2.0), few or no transitive dependencies, recent releases.
4. **Pinned and declared.** An exact version in the project's `package.json`, and never swarm or any of its packages. `isolation.test.ts` allows exactly the packages listed there.
5. **Behind the framework's own API.** A dependency is an implementation detail: consumers never import it or see its types, so it can be replaced without a breaking change.

The plan adopts these; others follow the same test:

| package              | where               | why                                                                                                                                            |
| -------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `flatbush` (runtime) | `world/MemoryWorld` | a static packed R-tree with `search` and `neighbors`, for the reference world's `inside` and `nearest` queries without writing a spatial index |
| `fast-check` (dev)   | tests               | property tests on `node:test`: stacking and merge invariants, fold order, keyed-roll independence, tick-order stability, geometry round trips  |

Hand-written on purpose, since the exact semantics matter more than saving code: the sequential random streams and the keyed-roll mixer (they must match the game and stay frozen), the event bus (payload reuse, `hears`), the modifier fold (float order), and the timeline.

### I.5.2 Defining resources: plain objects and functions

A **resource** is anything a consumer registers with the framework: stats, auras, triggers, conditions, procs, cues, spells, constructs, abilities. Every kind has one interface (`AuraDef`, `SpellDef`, `ConstructDef`, …) and one identity helper (`defineAura`, `defineSpell`, …) that only fixes the types. **The rule:**

> A resource is a plain object: data fields and standalone functions. Shared behaviour comes from functions that build or combine those objects, never from classes, `this` or inheritance.

What that means in practice:

- **Hooks are standalone functions.** They receive everything they need as arguments (`ctx`, the target, the hit) and never read `this`. The framework may call a hook detached (`const { release } = def; release(ctx, target)`), and it must still work.
- **Sharing is by factories and composition.** A family of resources with shared behaviour is a function returning the interface (`telegraphedSpell({ id, shape })`), and variations spread or wrap hooks (`{ ...base, onHit: withBonus(base.onHit) }`). Definitions are plain objects, so spreading is always safe.
- **Definitions are stateless.** A definition is shared by every cast, aura or construct made from it, so per-instance state never lives on it: a cast has its `CastState`, an active aura its `value` and stacks, a construct its `State`. Registries freeze definitions in development builds to catch mutation.
- **Data stays data.** Fields the framework reads as data (ids, tags, durations, modifiers, a trigger's `do`) are plain values, not getters, because card text, validation and the wire read them.
- **Registration is by key.** `createRegistry({ key: def, … })`: the object's key order is the registry order and the wire order (append-only), and a definition's `id`, when it has one, must equal its key (checked at creation).
- **Variants are discriminated unions.** Anything that comes in several shapes says so in a `kind` field (`{ kind: 'circle', r }`), and code narrows on it; nothing is told apart by its prototype.

```ts
// A resource: data plus functions
export const frostNova = defineSpell({
  id: "frostNova",
  activation: { kind: "button" },
  release: (ctx) => [areaHit(ctx.caster, 4)],
  onHit: (_ctx, { targets }) =>
    targets.map((t) => applyAura(t, "frozen", { duration: 2 })),
});

// Shared behaviour: a factory, not a base class
const telegraphedSpell = (spec: {
  id: string;
  windup: number;
  shape: (aim: Aim) => Shape;
}) =>
  defineSpell({
    id: spec.id,
    activation: {
      kind: "ai",
      windup: spec.windup,
      recover: 0.25,
      cooldown: 5,
      range: 22,
    },
    begin: (_ctx, aim: Aim) => [
      telegraph(spec.shape(aim), { delay: spec.windup }),
    ],
    release: () => [], // the telegraph lands by itself
  });
export const blast = telegraphedSpell({
  id: "blast",
  windup: 1.2,
  shape: (aim) => circle(1.5, aim.point),
});

export const SPELLS = createRegistry({ frostNova, blast });
```

**The framework's own code follows the same style**: modules of functions over plain data, with factories (`createAuraSystem(…)`) returning objects of functions closed over their state, as swarm's `effectSystem(registry)` does today.

- **No `class`, no `this`, no `instanceof`.** Narrowing uses `kind` fields and type guards.
- **`new` only for built-ins** that have no other form: `Map`, `Set`, `WeakMap`, typed arrays, `Error`.
- **A third-party class** (for example `flatbush`'s index) is constructed in exactly one adapter module that exposes plain functions, so the rest of the framework never sees it.
- **Enforced by lint and a test.** The package's ESLint config bans `ClassDeclaration`, `ClassExpression`, `ThisExpression`, `instanceof`, and `new` outside the built-in allowlist and the adapter modules (`no-restricted-syntax`). `isolation.test.ts` repeats the check with the TypeScript parser, so it holds even where lint is not run.

A unit test per kind registers a resource, calls every hook detached, and holds that the framework never mutates it.

## I.6 The systems

Each is summarised by what it must offer; Part II has the full model.

- **Core.** Random: sequential salted streams (`stream(seed, salt)`, reproducing today's `rng(seed ^ salt)` exactly) and keyed rolls (`roll(seed, salt, ...key)`), with `int`, `pick`, `weighted` and `shuffle` on both. Time: a fixed-step `SimClock` (`tick`, `dt`, `time`; integer-tick mode by default and an accumulating mode for swarm's parity), world and motion kinds, stamps (`stampAt`, `due(stamp)`, `remaining(stamp)`) and the motion clock's `1e-8` snap; `Registry<Id, Def>` with append-only numeric wire ids and order checks; a typed `Bus` with payload reuse, `hears(kind)` short-circuiting and a nesting cap; `Scope` for owner, damage source and world context, re-entrant and idempotent.
- **Math.** Shapes (`circle`, `ring`, `cone`, `lane`, `polygon`, `point`) with `covers(shape, point, radius)`; `sweep(from, to, radius)` against circles; patterns returning point lists with a stagger (`linePoints`, `ringPoints`, `crossPoints`); angle helpers (`wrap`, `turnToward`).
- **Modifiers.** `defineStats`, `Modifier` (`add | mul | min`, `when`, `scope`), pluggable `Condition` evaluators, ordered sources, `resolve` / `fold`, caps, `describeModifier` with game-supplied labels and number formats.
- **Auras.** `AuraDef` on any bearer (`AuraBearer`: `auras`, `clocks`, `rev`); stacking; clocks (`world`, `motion`, `global`); `periodic` returning procs; `value` with `merge: 'max' | 'add' | 'replace'` and `keepWhenDepleted` (absorbs); tags, `blockedBy`, `removes`; `grants` through a resource registry; `fold` position; `predicted`; lifecycle procs (`onApplied`, `onExpired`, `onBearerDeath`); damage hooks (`onIncomingDamage`, `onLethal`); lifecycle events; `view()` for the wire; `status` metadata passed through untouched for the game's HUD.
- **Triggers.** `TriggerDef` owned by an `AuraDef` only (no free-standing sources); event kinds and filters supplied by the game; internal cooldowns as derived auras; `chance`; `hears: 'self' | 'party'`; `do` as data procs; `validate` (the prediction rule, driven by which auras the game marks as button-touched) and `describe`.
- **Procs.** `Proc`, `ProcDef`, `createProcRegistry`; `chance` and `group`; the depth cap; core kinds that need only framework hosts: `damage`, `heal`, `applyAura`, `removeAura`, `castSpell`, `after`, `spawn`, `cue`, `event`, `run`. A game adds kinds by registering more.
- **Cues.** `CueDef` generic over the game's sound, visual and phase ids (`anchor`, `sound`, `vfx`, `text`); `cueEvents(id, at, owner, params)`; `CueTable` for the wire. Presentation only: nothing in the engine reads a cue.
- **Damage.** `Blow` (amount, crushing, true damage, unblockable, lethal, source, kind); an ordered pipeline with game-supplied mitigation stages; aura hooks for shelter, absorbs and lethal prevention; the result (absorbed, lost, prevented), which the host applies to health.
- **Spells.** `SpellDef` (id, tags, activation, `stats`, `canCast`, `target`, timeline, `begin`, `release`, `onHit`, `onEnd`, spell-scoped triggers, cues); activation kinds (`auto`, `button`, `passive`, `trigger`, `ai`, `event`) with game-typed data; the timeline (windup with `track` helpers `lockBefore`, `lockAtShare`, `lockAtStart`; channels with `breakIf`; recover; interrupts; `onCancel`); the runner (`startSpell`, `releaseSpell`, `castSpell`); a `SpellSystem` that steps casts and delayed procs; spell events on the bus (`spellCast`, `spellHit`, `constructExpired`…); snapshot versus live stats.
- **Constructs.** `ConstructDef` (shape, lifetime, bound, anchor, limit, tick phase, `frame` as the primitive, then `move`, `every` pulses, `onContact`, `onLand`, `onExpire`, area auras, caster, replication spec); a store with pinned tick order (kind order, then creation order); hit policies (`once-per-cast`, `repeat-share`, `rehit-cooldown`, `pierce`, `budget`, `hottest-per-owner-clock`, `none`); spawning now or next frame.
- **World.** `WorldQuery` (`inside`, `nearest`, `densest`, `chain`, `sweep`, `lineClear`, `positionOf` with rewind semantics, `velocityOf`, `leadPoint`) with `side` relative to the caster; `MemoryWorld`, a reference implementation for tests and for small games.
- **Abilities.** `button` activation data: cooldown as an aura (`startsOn`), cost in aura stacks, `requires` / `blockedBy` / `resets` / `applies`; loadouts (`slot → ability`); `canActivate`, `tryActivate`, `landAbility`; the bearer's motion half remains a game hook (`activate`, `travel`).
- **Prediction.** `MirrorCtx` (the types a mirror-safe hook may read); motion-clock stamps; `seedMirrorAuras`; the rule that an aura the motion step reads must be `predicted`, as a validator the game runs over its registries.
- **Replication.** `WireTable` (append-only id ↔ key, with a checksum test helper), `ViewSpec` for constructs and auras (fields, rounding, `events-only`, `derived`), projection helpers. No schema library.

## I.7 Implementation phases (all in the new project)

### I.7.0 Testing: unit tests on `node:test`, nothing else

- **Tools.** Only Node's built-in test runner, `node:test` (`test`, `describe`, `it`, `beforeEach`, `mock.fn`), and `node:assert/strict`, as shipped by the current Node LTS (the project's `engines` floor), using only its stable APIs. The runner stays `node:test`; a third-party library that plugs into it is allowed under §I.5.1 (the plan adopts `fast-check` for property tests). No snapshot tool, no browser, no rendering.
- **What a test is.** A unit test of one system through its public API, with fake hosts and bearers from `tests/helpers/` (plain objects implementing the narrow interfaces, recording the calls they receive). Systems that sit on others (spells on procs, auras and triggers) are tested with the real lower systems plus fake hosts, never with a game.
- **No end-to-end example game.** Nothing visual and no sample game: completeness is shown by each system's tests covering its contract, including the §I.5 semantics as literal expectations.
- **Time and randomness in tests** come from the framework's own injected clock and seeded streams or keyed rolls. `mock.timers` and real timers are never needed. The keyed-roll mixer's frozen table is a literal array in its test, not a fixture file.
- **No fixture files and no goldens.** Expected values sit in the test next to the assertion. The per-platform golden machinery stays in swarm.
- **Run.** `node --test "tests/**/*.test.ts"` on Node's own type stripping, as the `test` script; optionally `--experimental-test-coverage` locally. `isolation.test.ts` and `docs.test.ts` are unit tests too, and run in the same command.
- **Per phase.** Every phase adds the tests for what it builds: stacking modes, clock arithmetic, fold order, dispatch order, chance rolls, depth caps, timeline transitions, hit policies, tick order, pipeline order, and refusals. A phase is not done until its system's contract is covered.

Each phase ends with the tests green, `npm run typecheck` clean, `npm run lint` and `npm run format:check` clean, `npm run build` emitting `dist/`, and `isolation.test.ts` and `docs.test.ts` passing.

- **F0. Scaffold.** In this repository (it already has `LICENSE` and `.gitignore`): `package.json` (latest `typescript` and the §I.5.1 dependencies pinned exactly, `engines` on the Node LTS), the §I.4.1 `tsconfig.json` / `tsconfig.build.json`, `eslint.config.js`, prettier, README skeleton, the CI workflow; `isolation.test.ts` (every import is relative and inside the project, a `node:` built-in in tests, or a package listed in `package.json`; never swarm; no forbidden globals) and `docs.test.ts`.
- **F1. Core and math.** Sequential streams (tested draw for draw against literal values taken from today's `rng`, since the framework cannot import swarm), keyed rolls (tested for key independence, platform-free integer arithmetic, and a uniformity check), the fixed-step clock in both modes and stamps, registries (the §I.5.2 rule: key order, `id` check, freezing, hooks callable detached), the lint and parser checks for the no-class style, bus, scope; shapes and sweeps.
- **F2. Modifiers.** Ported from swarm's `packages/game/src/modifiers/` with game content removed; tests reproduce the fold's documented float order.
- **F3. Auras.** Ported from swarm's `packages/game/src/effects/` and generalised to any bearer; add `value` / `merge` / `keepWhenDepleted`, lifecycle procs, damage hooks.
- **F4. Procs and triggers.** The proc registry (from `spells/procs` on `spell-primitive`) and triggers (from swarm's `packages/game/src/triggers/`), owned by auras only; `do` lists as procs.
- **F5. Damage pipeline.** Stages, hooks, the true-damage bypass, shelter → absorbs → lethal order.
- **F6. Cues.** Registry shape, events builder, wire table.
- **F7. Spells.** Definitions, activations, timeline, runner, `SpellSystem`, delayed procs, spell events (from swarm's `spells/` on `spell-primitive`, extended per Part II).
- **F8. Constructs and world.** Store, tick order, bounds, limits, pulses, hit policies, spawning; `WorldQuery` and `MemoryWorld`.
- **F9. Abilities.** Button activation and loadouts (from swarm's `packages/game/src/abilities/`), with cooldowns and costs as auras.
- **F10. Prediction and replication contracts.**

### I.7.1 Beyond the core: what a full MMO-like framework adds, and when

Compared with a WoW server emulator (TrinityCore, AzerothCore), phases F0–F10 cover the heart of the combat model: spells and their effects, auras (periodic, absorbs, prevent-death), procs with internal cooldowns, stat modifiers, AreaTrigger-like constructs, casts and channels, and a deterministic tick. The rest is tiered by one rule, the same one the spell primitive followed: **a framework feature is built when swarm consumes it; otherwise the design leaves it a place and it waits.**

**Tier 1, built now** (each with its consumer in swarm today):

| #   | Feature                                                                                                                                                     | Consumer in swarm today                                                                                                                                                                                                        | Scope now                                                                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| F11 | **Combat log**: a structured stream of every cast, hit, miss, heal, aura applied or removed, and death                                                      | the synced damage meter (`damageBySource`), the balance scripts (`balance:report`, `balance:clear`), the goldens that digest event streams                                                                                     | the full log, with subscribers (meter, tests, analytics)                                    |
| F12 | **Conditions**: one data-driven predicate system                                                                                                            | modifier conditions (`status`, `tag`, `healthBelow`, `noMapBuff`); trigger filters (`scope`, `source`, `ability`, `critOnly`…); the "objectives" and "unbranded" targeting rules repeated across cards; creature spell weights | the whole module; modifiers, triggers, targeting and AI all read it                         |
| F13 | **Unit model and states**: one unit shape for heroes, creatures and summons, with state flags derived from aura tags                                        | `frozen`, `stunned`, `rooted`, `invuln`, `downed`, casting (`e.cast`), immunity to pulls (bosses, objectives)                                                                                                                  | the states and the unit shape; factions only as two sides plus "objective"                  |
| F14 | **Combat roll table and damage kinds**, as damage-pipeline stages                                                                                           | crit (chance and damage stats), block (hero block chance, `unblockable`), crushing blows, and the kinds that bypass armor and the barrier (environmental, blood, lethal)                                                       | crit, block and damage kinds; no misses, dodges or school resistances                       |
| F15 | **Cooldown model**, as auras                                                                                                                                | ability cooldowns, cooldown reduction, `resets` (Overcharge refunding the dash), attack-clock intervals rescaled by haste                                                                                                      | the basic model plus resets and rescaling; no global cooldown, categories or charges        |
| F16 | **Cast rules** in `canCast` and the timeline                                                                                                                | range and line-of-sight gates (horde `range` / `sight`, sentry placement), refusals and retries, freeze or stun pausing a creature's cast, death cancelling it, an elite's enrage withdrawing its own telegraphs               | gates, pause and cancel; no pushback or school lockouts                                     |
| F17 | **AI toolkit**: a timed event scheduler (TrinityCore's `EventMap` / `TaskScheduler`), one weighted anti-repeat spell picker, a movement-generator interface | the elite, Warden and Archmage brains; three copies of the weighted picker; the Warden's named timers (`nextExecute`, `nextRaise`, `nextCharge`…)                                                                              | the scheduler, the picker, the interface (chase, flee, hold range, charge, leap, knockback) |
| F18 | **Pets and summons**: ownership, stat inheritance, despawn with the owner, follow or assist                                                                 | the Engineer's sentry; the adds raised by the Gravecaller, the Warden and the Archmage (`summonedBy`)                                                                                                                          | ownership, credit, lifetime and bounds, on top of constructs                                |

Each is proven by its own unit tests, like the phases before it (§I.7.0).

**Tier 1, deferred** (no consumer yet; each has a reserved place):

| Feature                                                                                                              | Where it would go                                                                                          |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Power resources (mana, energy, rage, combo points), costs and regeneration                                           | an aura-backed resource with a `value`; costs on the activation (`AbilityDef.cost` already exists, unused) |
| Misses, dodges, parries, school resistances                                                                          | more stages in the damage pipeline (F14)                                                                   |
| Global cooldown, category cooldowns, charges                                                                         | more cooldown auras and activation fields (F15)                                                            |
| Cast pushback, interrupts with school lockouts, cast-while-moving                                                    | the timeline's interrupt rules (F16)                                                                       |
| Threat tables, taunt, combat enter and leave, evade and leash                                                        | a creature-side module read by the AI toolkit (F17); today creatures use sticky focus targeting instead    |
| Full factions and reactions (hostile, friendly, neutral)                                                             | the unit model's side (F13)                                                                                |
| Helpful or harmful auras, dispel categories, uniqueness per caster, removal on damage, movement or cast, aura states | aura fields and rules (F3)                                                                                 |
| Procs per minute, more proc moments (on hit taken, on cast finished, on periodic tick)                               | trigger options and bus events (F4)                                                                        |
| Diminishing returns                                                                                                  | an aura application rule per category (F3)                                                                 |
| Server-authoritative movement curves (splines, jump and knockback arcs)                                              | a movement module beside the AI toolkit (F17)                                                              |

**Tier 2, progression** (optional framework modules, when a game needs them): items and equipment (templates, slots, item stats and set bonuses as auras, inventory, currencies, vendors); loot tables with conditions and group rules; levels, XP and scaling curves; talent trees as passive auras; achievements as event-driven criteria; quests (objectives tracked from events, conditions, rewards); spawn groups, pools, respawn timers and a world-events calendar.

**Tier 3, server infrastructure** (a separate server-side project or package beside the framework, never its core): interest management (area-of-interest grids, per-field visibility for owner, party and public); maps, instances and phasing; persistence with versioned migrations; content loading, validation and hot reload; server-side input validation and anti-cheat; party, raid, guild and chat. Party membership is the one piece the core needs, for `hears: 'party'` and later loot, and it takes it as a host fact.

## I.8 Afterwards (not in this project's first milestone)

Once the framework's first release is tagged, swarm consumes it from the outside, as any other game would:

- **During development**, as a `file:` or git dependency (or `npm link`) from swarm's `packages/game`.
- **Once it settles**, as a published package (npm or GitHub Packages, per §I.9), on a pinned version.

Swarm's `packages/game` then moves onto it in the phases of §II.5, each held by the game's goldens: modifiers and auras first, then triggers and procs, cues, spells and constructs, abilities, creatures. `packages/protocol` and `packages/sync` adopt the replication contracts when the construct schema unifies. Swarm's own `effects/`, `modifiers/`, `triggers/`, `cues/`, `abilities/` and `spells/` folders then shrink to content. Swarm's older TypeScript config needs no change to consume the framework's emitted `dist/` and declarations.

## I.9 Decisions to take before starting

1. **The name: decided, `spellweave`.** Repository `spellweave`, npm package `spellweave` (free on npm when chosen), with room for scoped siblings (`@spellweave/server`) later. Wherever this plan says "the framework" or `<name>`, read `spellweave`.
2. **Shared types.** The framework owns `Vec2` and its ids and depends on nothing. `@swarm/types` stays swarm's wire types, and swarm adapts at the boundary.
3. **Physics.** Swarm's `packages/physics` (Havok) stays out; the framework asks the world through `WorldQuery.sweep` / `lineClear`. A later `framework-physics` adapter could implement `WorldQuery` over Havok for any game.
4. **Navigation.** The flow field and mob navigation are fairly generic, but they are grid- and arena-shaped; they stay in swarm and are a candidate for a later framework module.
5. **How it ships.** Where it lives is decided (`st0ianmarius/spellweave`, MIT). Still open: the registry it publishes to (npm or GitHub Packages), and whether it stays private until swarm consumes it.
6. **The keyed-roll mixer: decided, 32-bit.** A Murmur3-finalizer chain over 32-bit integers, using only `Math.imul`, `^`, `>>>` and `| 0`, so it is fast and identical on every platform, with no `BigInt`. Each key part (seed, the stream's salt, then the key's integers in order) is folded in as `h = fmix32(h ^ mix(part))`, with `mix(k) = Math.imul(rotl(Math.imul(k, 0xcc9e2d51), 15), 0x1b873593)` and `fmix32` the Murmur3 finalizer. The result is divided by 2³² for a float in `[0, 1)`. Non-integer or out-of-range key parts are rejected. Once content depends on it the mixer is frozen: F1's unit test holds a literal table of rolls for fixed keys, and any change to the mixer fails it.

# Part II. The model: the Spell API

_Written against swarm's code (the co-op ARPG this framework comes out of) from a survey of every Arsenal weapon, hero ability, creature spell and map event in it. Its porting tables (§II.4) and migration phases (§II.5) are swarm's; the model (§II.1–§II.3) is the framework's._

## II.1 The idea

A **spell is the container that orchestrates every other system.** It says who may cast it and when (activation), how strong it is (stats and modifiers), where it goes (targeting and shapes), how its cast unfolds in time (a timeline), what it leaves in the world (constructs), what it does (procs), which states it lands on units (auras, our `effects/`), what it listens for while it lives (triggers), and how it looks (cues and replicated views). The other systems stay small and single-purpose; the spell is the one place that ties them together.

At the end everything is one of three things, as in WoW, where talents, racials, set bonuses and item effects are all spells applying passive auras:

- a **spell**: what a unit or the world does (a weapon, an ability, a creature attack, a map event, sealing a pact);
- an **aura**: what a unit has (a buff, a debuff, a status, a pact, later a passive card), with its modifiers and its procs;
- a **proc**: what happens, returned by a spell's hooks or fired by an aura on its events.

Constructs (what a spell leaves in the world) and cues (how it looks) complete the picture.

| System         | Answers                                               | Today                                                                                                                          | In this plan                                                                                                |
| -------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| **Activation** | who pulls the trigger, and whether they may           | attack clocks, `AbilityDef`, four creature brains, the director                                                                | one `activation` block per spell; brains only pick                                                          |
| **Stats**      | how strong                                            | `weaponStats`, class constants × `abilityArea`, four `*SpellDamage` helpers                                                    | `stats(ctx)` per cast, fed by the modifier fold with spell tags as scopes                                   |
| **Targeting**  | where and at whom                                     | a dozen resolvers (`resolvePrimaryAttack`, `densestCluster`, placements…)                                                      | shared queries on `ctx`, used by the `target` hook                                                          |
| **Timeline**   | windup, tracking, release, channel, recover, cancel   | a stage machine per creature family, `game.strikes`, per-card queues                                                           | one cast state machine run by the Spell System                                                              |
| **Constructs** | what persists in the world                            | 20 bespoke arrays and fields (`glaives`, `tempests`, `sanctuaries`, `hazards`, `frostField`…)                                  | one store of spell objects with hooks                                                                       |
| **Procs**      | what happens                                          | procs for spells, `TriggerAction` for triggers, direct `Game` calls everywhere else                                            | one vocabulary for spells, constructs, effects and triggers                                                 |
| **Auras**      | timed states on a unit (WoW auras: buffs and debuffs) | `effects/`, heroes only; creature statuses are bespoke fields; Cheat Death and the Sanctuary are special cases in `hurtPlayer` | `effects/` on any unit, with hooks into the damage pipeline (§II.3.8)                                       |
| **Triggers**   | when something reacts to an event                     | data procs on 10 hero events, from three sources (classes: empty; pacts: Bloodbound; effects)                                  | owned by auras only (§II.3.11): the trigger layer becomes the machinery that runs an aura's procs on events |
| **Cues**       | how it looks and sounds                               | 28 cue ids plus ~60 raw `emit` sites                                                                                           | every spell moment names a cue; predicted visuals come from the same hook                                   |

## II.2 Rules the API keeps

- **Hooks are functions returning data.** A hook reads the world through `ctx` (queries, stats, its own state) and returns procs. It may mutate **its own** cast or construct state (like a reducer's local state); it touches the world **only** through procs. That one rule makes spells testable, replayable and predictable.
- **Procs are the what, triggers the when.** A proc is one outcome with an optional `chance`; a trigger is a listener with conditions and an internal cooldown that answers with procs. Spell hooks are triggers scoped to one cast.
- **Everything is ordered and seeded.** Procs apply in the order returned. Randomness comes from named streams on `ctx`, and an always-proc rolls nothing. Constructs tick in a pinned kind order, then in creation order. Every port is held bit-exact by a golden recorded before it.
- **Data where it is described, functions where it is decided.** Anything a card or tooltip prints (a trigger's `do`, a pact's procs) stays plain data. Spell hooks are functions that return that data.
- **Mirror-safe by type.** A hook the co-op client runs gets a narrowed context (`MirrorCtx`: caster body, input, synced stats, static collision) and must not roll or read server state. The compiler enforces that, not a test.

## II.3 The shape of a spell

```ts
export const tempest = defineSpell({
  id: "tempest",
  tags: ["arsenal", "area", "wind", "summon"], // modifier scopes, trigger filters, class of the spell
  activation: { kind: "auto" }, // the attack clock reads stats.interval
  stats: (ctx) => ctx.weaponStats("tempest"), // one snapshot per cast
  release: (ctx) =>
    range(ctx.stats.count).map((i) =>
      spawn(cyclone, { heading: spreadHeading(ctx, i) }),
    ),
  cues: {
    cast: (ctx, spawned) => ({
      cue: "tempest.cast",
      at: spawned,
      radius: ctx.stats.radius,
    }),
  },
});
```

### II.3.1 `SpellDef`

```ts
interface SpellDef<Stats, Target, CastState> {
  id: SpellKey; // registry key; its wire id is the registry index (append-only)
  tags: readonly SpellTag[]; // 'arsenal' | 'ability' | 'creature' | 'area' | 'projectile' | 'fire' | 'frost' | …
  activation: Activation; // §II.3.2
  stats(ctx): Stats; // numbers for this cast: rank, legendary, links, area, duration, damage share
  live?: true; // hooks read stats live each tick instead of the snapshot (Hexfire today)
  canCast?(ctx): boolean; // the gate after the activation's own (Whirlwind suppresses Cleave; a 24-brand cap)
  target?(ctx, input): Target | undefined; // undefined refuses; `predictable` runs on the mirror
  timeline?: Timeline<Target, CastState>; // windup, track, channel, recover, cancel (§II.3.3)
  begin?(ctx, target): Proc[]; // the windup's start: telegraphs, caster motion
  release(ctx, target): Proc[]; // the payload
  onHit?(ctx, hit: Hit<Target>): Proc[]; // any delivery of this cast caught targets, all in one call
  onEnd?(ctx, outcome: CastOutcome): Proc[]; // 'released' | 'cancelled' | 'broken' (tether) | 'blocked' (charge)
  triggers?: SpellTrigger[]; // listeners active while the cast or any of its constructs live (§II.3.7)
  cues?: CueMap; // named moments → cue + params (§II.3.9)
}
```

`ctx` (`SpellCtx`) carries the caster, the owner credited with the damage, the stats snapshot, the cast (target, `shared` state for every delivery and construct of the cast), time and dt, rank and legendary flag, the queries (§II.3.5), and named random streams (`ctx.random('main' | 'volley' | 'horde' | 'proc' | …)`).

### II.3.2 Activation: who pulls the trigger

The spell never runs its own clock; the activation says which system does, and carries that system's rules as data.

| kind      | pulled by                                             | carries                                                                                                                                                                        |
| --------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `auto`    | the attack clock (Arsenal)                            | the interval comes from `stats`; `retryOnMiss` (Cleave); `aimed` rewinds when the hero aims                                                                                    |
| `button`  | a hero's key (every class ability)                    | what `AbilityDef` has today: cooldown effect and `startsOn`, cost, `requires` / `blockedBy`, `applies`, `resets`, `activate` / `travel` (the motion half the mirror runs), cue |
| `passive` | owning it (Ember Blades, Serpent Coil, Cheat Death)   | a construct attached to the owner, or an aura on them, for as long as the card is owned                                                                                        |
| `trigger` | a trigger event (an aura's "on kill, cast…")          | the event, conditions, charges, internal cooldown                                                                                                                              |
| `ai`      | a creature brain                                      | windup, lock, recover, cooldown, range, sight, budget, `weight(ctx)` for situational picking                                                                                   |
| `event`   | the wave director (Inferno, Venom Flood, Detonation…) | min/max wave, weight, overlap rules                                                                                                                                            |

`button` absorbs `AbilityDef` whole: an ability **is** a spell whose activation is a button. The motion half (`activate`, `travel`, `applies`, `resets`, cost, cooldown) stays pure data plus pure functions on `AbilityBearer`, so the mirror keeps running it exactly as `tryActivateAbility` does now.

`ai` puts each spell's pick weight on the spell (`weight(ctx)` reads distance, moving, kiting, clumped, hugged…). One shared picker replaces the three weighted anti-repeat pickers, and one pluggable budget policy covers both the horde's points pool and the elites' time gaps.

### II.3.3 Timeline: how a cast unfolds

```ts
interface Timeline<Target, State> {
  windup?: { seconds: number | ((ctx) => number); track?: Track<Target> }; // Track: (ctx, target, dt) => Target (re-aim) or 'lock'
  channel?: {
    seconds: number | ((ctx) => number);
    every?: number;
    tick(ctx, target, dt): Proc[];
    breakIf?(ctx, target): boolean;
  };
  recover?: { seconds: number };
  interrupts?: {
    stun?: "pause" | "cancel";
    freeze?: "pause" | "cancel";
    death: "cancel";
    phase?: "cancel";
  };
  onCancel?(ctx, target): Proc[]; // e.g. withdraw its own unfired telegraphs
}
```

- **The Spell System runs the timeline**, not the brain: it counts the windup, calls `track` each frame until the lock, releases, runs the channel, recovers, and reports the outcome. The brain picks, starts, and reads `ctx.cast.stage` for its movement (holding ground, facing).
- **`track` is a function**, so all three tracking rules in the code are helpers returning one: `lockBefore(seconds)` (horde, elites), `lockAtShare(share, turnRate)` (Warden), `lockAtStart` (Archmage explosion). A cast's own telegraphs are handles on the cast, so tracking moves or rotates **all of them** (the elite lance fan) rather than one hazard id.
- **Channels** cover every "active" stage: a charge (the caster moves each tick, and `onBlocked` ends the cast as `blocked` for a stagger), a whirlwind (moving pulses), a tether (`breakIf` the target leaves 8 m of the origin), the Archmage's Arcane Circle (a channel whose clock is a construct).
- **Chains** are procs: Cleave's release returns `castSpell(stab)`; a Warden charge that did not hit a wall returns `castSpell(charge, { windup: 0.45 })`.

### II.3.4 Constructs: what persists in the world

A **construct** is a spell object with a position, a shape, a lifetime and hooks: WoW's AreaTrigger / DynamicObject / missile, Unreal's spawned actor plus ability tasks. Hazards, projectiles, cyclones, wells, domes, fields, patches, falling hammers, sentries and the Serpent Coil's ribbon are all constructs.

The line between the two persistent things: an **aura sits on a unit** and goes where the unit goes; a **construct sits in the world**. A construct may hand auras to the units inside it (the Sanctuary's shelter, a field's slow), and what it does to the world itself (eating hostile shots, pushing creatures out) stays in its `frame`.

```ts
interface ConstructDef<State, Stats> {
  id: ConstructKey;
  shape(c): Shape; // circle | ring | cone | lane | polygon | point (§II.3.5)
  lifetime(c): number | "owner" | "spent"; // seconds, while the owner lives, or until a hit budget is spent
  bound?: "owner-standing" | "owner-present" | "source-alive" | "none"; // what ends it early, silently
  anchor?: "world" | "owner"; // an owner-attached construct moves with the hero (Ember, Coil)
  limit?: { perOwner: number; replace: "oldest" | "silent" | "fade" }; // one frost field, one grove, one sentry, 12 patches
  tickIn?: "movement" | "player" | "world"; // which Game phase ticks it (Coil: movement; the rest: world)
  // The one primitive: a frame, in one pass, returning procs. Everything below is sugar over it.
  frame?(c, dt): Proc[];
  move?(c, dt): void; // own motion (steer, home, bezier, orbit); may sweep and report contacts
  every?: Pulse[]; // { seconds, clock: 'own' | 'owner-shared' | 'global', hits?: Shape, pick?: 'all' | 'hottest', onPulse }
  onContact?(c, targets): Proc[]; // swept contacts along this frame's move (missiles, blades, waves)
  onLand?(c, targets): Proc[]; // a delayed construct lands (a telegraph firing, a hammer, a falling arrow)
  onExpire?(c): Proc[]; // the fling, the collapse, the dome's burst
  auras?: AreaAura[]; // auras it keeps on the units inside: applied on entry, removed on exit (§II.3.8)
  caster?: SpellRef; // a construct that casts its own spell on its own clock (the sentry)
  replicate?: ReplicaSpec; // §II.3.9
}
```

- **One `frame` hook is the primitive**, because some spells must interleave work per enemy in one pass for exact parity (Tempest: tick, then pull or fling, enemy by enemy, with Maelstrom's candidates gathered before any pull). The declarative parts (`move`, `every`, `onContact`, `onExpire`) are built on it for the common cases.
- **Hit policies are data, not code:** `once-per-cast` (Glaive, Spark, the Knight wave), `repeat-share` (Searing Arrow's 25%, a volley's 50% via the cast's `shared` set), `rehit-cooldown` (Chakram's crescents), `pierce` and `budget` (shots, Glaive), `hottest-per-owner-clock` (Searing patches, Coil nodes), and `none` (Tempest ticks, Ember Blades).
- **Spawning** is a proc, `spawn(def, init, { now?: dt })`. `now` lets a child fly this frame with the parent's leftover time (Glaive forks); without it the child starts next frame (Chakram crescents). Children may share state by reference (the crescents' `passes`).
- **Delayed procs** are the lightest construct: `after(seconds, procs, { bound: 'owner-standing' })`. They cover Searing Arrow's fall, Judgement and its aftershock, Hexfire's pop, Galeheart's strike, the Druid flask's two stages, the Warden's second barrage, the Archmage's second comet volley, and staggered explosion patterns. The credit (owner, damage source) and the stats are captured at the cast and restored when it lands.
- **Tick order is pinned:** kind order (today's `CARD_MECHANICS` order for the Arsenal, then abilities, then creatures, then events), then creation order within a kind. `wire-order.test.ts` grows to hold it.

### II.3.5 Shapes and queries

`ctx.query` is the one read API (pure, no side effects), shared by heroes and creatures, so every targeting resolver in the code is one call:

- `inside(shape, { side, filter, order })`: `side` is `'foes' | 'allies' | 'all'` relative to the caster, so a spell written for a hero works when a creature casts it.
- `nearest(from, range, n, { distinct, exclude })`, `densest(from, range, radius, excluded)` (Singularity, Tempest, Chakram), `chain(from, jumps, range, falloff)` (Spark, Voltaic's arc, Hexfire's leap), `sweep(from, to, radius)` (missiles, charges, waves), `lineClear`, `placement(input, { range, walls, snap })`.
- `positionOf(target)` is rewound only while the cast is aimed and in its cast frame, and it returns copies, never scratch. `velocityOf(target)` supports leads (`leadPoint(target, speed)` replaces `archmageLead` / `predictedBlast`).
- Shape builders return data: `circle(r)`, `ring(inner, outer)`, `cone(r, half, dir)`, `lane(len, width, dir)`, `polygon(points)`, and patterns (`linePoints`, `ringPoints`, `crossPoints`, `eruptionLine`) that return point lists with a stagger.

### II.3.6 Procs: one vocabulary

The same kinds serve spell hooks, construct hooks, effect lifecycles and trigger `do` lists. A new kind is one file, one registry line, and (if it touches the world) one host method taking its data.

| group         | kinds                                                                                                                                                                                                                                                                                                             |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| deliveries    | `areaHit` (any shape), `shoot` (either side, pierce, repeat share), `telegraph` (any shape, `onLand` → the spell's `onHit`), `spawn`, `after`                                                                                                                                                                     |
| on a target   | `damage` (hero or creature: amount, knock or `'none'`, strength, crushing, unblockable, lethal, horde, environmental), `heal`, `applyEffect` / `removeEffect` (heroes and creatures, with an optional `value`: the barrier is `applyEffect(barrier, { value, duration })`), `pull`, `push`, `teleport`, `despawn` |
| on the caster | `move` (dash, leap flight, teleport), `face`                                                                                                                                                                                                                                                                      |
| world         | `summon` (raise dead, adds, prison walls), `cue`, `castSpell`, `grant`, `event` (raise a trigger event)                                                                                                                                                                                                           |
| control       | `group` (several procs behind one `chance`), `run` (escape hatch, to be emptied)                                                                                                                                                                                                                                  |

Everything hard-coded by spell id in the engine today moves onto proc data: `HEAVY_HAZARDS` and `HEAVY_BLOWS` become `strength` and `crushing` on the telegraph's damage, the frost nova's slow becomes an `applyEffect` in its `onLand`, the repulse knock becomes the proc's `knock`, the elite volley's unblockable becomes the shot's flag, and `blast`'s heavy-spell list becomes `strength`. The four `*SpellDamage` helpers become each family's `stats` (base × share × family dial).

### II.3.7 Triggers and events

- **Trigger `do` lists become procs** (data form), and `chance` lives on the proc; a trigger that fires several things all or nothing wraps them in a `group`. `TriggerAction` goes away; `castAbility` becomes `castSpell`.
- **The Spell System raises spell events on the bus:** `spellCast`, `spellHit`, `constructSpawned`, `constructExpired`, `spellKill`, filterable by spell id, tag and owner. Auras (pacts, buffs, later passives) can then react to spells ("when a Tempest dissipates, cast Chain Lightning from its eye").
- **Spell-scoped triggers:** `SpellDef.triggers` and `ConstructDef` listeners are active while the cast or construct lives, as `EffectDef.triggers` are while an effect is active. An aura's own procs (§II.3.8) cover the unit-bound cases, such as Hexfire's pop when a branded creature dies.
- **Changing an outcome is an aura's job, not a trigger's.** Triggers react after something happened; anything that absorbs, reduces or cancels a blow, a knockback or a death is an aura hook in the damage pipeline (§II.3.8), as in WoW.

### II.3.8 Auras: effects on any unit

An **aura** is WoW's word for a timed state on a unit: a buff or a debuff. `effects/` already is that system for heroes (tags, modifiers, stacking, immunities by tag, periodic ticks, triggers while active, cues), so the plan widens it rather than adding a second one. Three changes:

1. **Any bearer.** `EffectTarget` covers creatures too: they get an `effects` list, and today's statuses become auras with tags: `frozen`, `stunned`, `rooted`, `slowed`, `chilled`, `invulnerable` (the Warden's War Cry, the Archmage's circle), `hexfire.brand`, `venom.toxin`. Credit rides the aura's `source` (owner and damage source), so a debuff's ticks count for whoever cast it. Resistance and immunity (`freezeImmune`, the elite cap, a boss taking a slow instead, the warrior's shorter control) become per-creature-class rules applied when a control aura lands. The wire keeps today's bytes at first: the synced `frozen`, `stunned`, `brand`, `toxin` and `chill` fields become projections of the creature's auras, so the protocol does not move until the replication phase.
2. **Procs through the lifecycle.** `onApplied`, `onExpired`, `periodic` and `onBearerDeath` return procs, credited to the aura's source. A damage-over-time debuff is a `periodic` returning `damage`; the brand's pop is its `onBearerDeath` returning `after(0.15, [areaHit, chain leap])`; the Whirlwind's sweep and Arrowstorm's strikes are their buffs' `periodic` returning `castSpell`, instead of bespoke loops in `Game.step`. The Arrowstorm beat stays aligned to world time (`clock: 'global'`) for parity.
3. **Hooks into the damage pipeline** (WoW's absorb and prevent-death aura effects). Before a blow lands on a unit, each of its auras with a hook sees it, in registry order, and may change it:

   ```ts
   onIncomingDamage?(aura, blow): BlowChange;   // { absorb?: number; scale?: number; block?: true; knock?: 'none' }
   onLethal?(aura, blow): { prevent: true; procs: Proc[] } | undefined;
   ```

   `hurtPlayer` and `hurtEnemy` then carry no card or ability names: they run the bearer's hooks and apply the result. The pipeline's order is fixed, and is today's: the blow (plus crushing) → armor and damage taken → `onIncomingDamage` (shelter, then absorbs) → `onLethal` (Cheat Death) → health. True damage (lethal, environmental, blood) skips armor and every absorb, as it does now.

4. **An aura can hold a value.** `ActiveEffect` gains `value` (and `ApplyOptions` a `value`): an amount that is not a stack count, such as the health an absorb has left. An aura may declare how two applications merge their values (`merge: 'max' | 'add' | 'replace'`) independently of how their durations stack.

The hard cases, each as an aura:

| case                 | aura                                                                                                                                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hexfire's brand      | a debuff on the creature: `periodic` burn (live stats, as today), `onBearerDeath` pop and leap, tags for the 24-brand cap and for "unbranded" targeting                                                  |
| Serpent Coil's toxin | a damage-over-time debuff, refreshed rather than stacked                                                                                                                                                 |
| Cheat Death          | a passive buff the card grants while owned, holding its charges: `onLethal` prevents the death and returns `heal`, invulnerability and `applyEffect(deathEscape)`; `deathEscape` is its cooldown, as now |
| Sanctuary            | the dome is a construct with `auras: [sheltered]`; `sheltered` blocks every non-exposed blow and knockback in `onIncomingDamage`. Eating hostile shots and pushing creatures out stay the dome's `frame` |

**The barrier becomes an absorb aura.** Today it is two bespoke hero fields (`barrier`, synced; `barrierTime`, server-only) written by Overcharge and Judgement, eaten inside `hurtPlayer`, ticked in `Game.advance` and cleared on going down. As an aura:

```ts
barrier: {
  /** Health it absorbs ahead of HP; a new shell keeps the larger amount and the longer time, as today. */
  clock: 'motion',                 // ticked once per motion step, before the input, as `barrierTime` is now
  stacking: 'highest', merge: 'max',
  keepWhenDepleted: true,          // an emptied shell keeps its clock, so a later shell still takes the longer time
  removedOn: ['down'],
  onIncomingDamage: (aura, blow) => ({ absorb: Math.min(aura.value, blow.amount) }),   // spends `value`
  cues: { absorbed: 'barrier.absorb' },                                                // today's private "(−N)" text
  status: { id: 'barrier', … },    // the HUD tile the client already draws
}
```

- **One pool, for parity.** Overcharge and Judgement both apply the same `barrier` aura with a `value` and a duration, so the max-of-each rule they share today (`shield` in `spells/procs`, and Judgement's own `shield`) holds exactly. The `shield` proc becomes `applyEffect(barrier, { value, duration })`, and Judgement's duplicate goes.
- **Separate absorbs, later and by choice.** A different shield (an ally's ward, a pact's) can be its own absorb aura with `merge: 'add'` or its own pool, consumed in registry order after the barrier, as WoW spends absorbs one after another. Nothing forces a single pool once parity is no longer the goal.
- **Everything around it stays exact.** Absorption comes after armor and before Cheat Death; the hit window still opens when the shell eats the whole blow; true damage still skips it; whatever is left still expires with the clock; going down still clears it.
- **The wire.** Step A keeps `PlayerSchema.barrier` as a projection of the aura's `value`, so nothing moves. Step B gives `EffectSchema` a `value` field, drops `barrier` from `PlayerSchema` (freeing one of Colyseus's 64 fields there), and has the HUD read the aura; it rides the same protocol bump as pacts step B.
- **Creatures get absorbs for free**: a boss's shield phase is the same aura on a creature.

Diminishing returns stay out of scope.

### II.3.9 Presentation and prediction

- **Cues everywhere:** every spell moment (`cast`, `release`, `hit`, `pulse`, `land`, `expire`, `fade`) names a cue plus params in `cues`, or returns a `cue` proc; no hook builds a raw `emit`. The ~60 raw sites migrate by appending to `CUES` (append-only wire).
- **Replication:** a construct kind declares `replicate: { fields, rounding }` (`x`, `z`, `heading`, `radius`, `started`, `duration`, `phase`, `evolved`, and a kind-specific extra), or `'events-only'` (Searing Arrow), or `'derived'` (Ember Blades, recomputed from time on the client). At first each kind maps onto its existing schema array (a storage adapter), so the protocol does not move; later one `ConstructSchema` plus a client renderer registry keyed by construct kind replaces the twelve per-kind schemas.
- **Prediction without duplication:** the hooks the client may run take `MirrorCtx` (`activation` motion data, `target` when `predictable`, and `cues.cast`). `castVisuals` becomes "run the spell's `cues.cast` on the mirror", so `CAST_VISUALS` and its equality test go away, and the Blink and Overcharge visuals stop being written twice.

### II.3.10 Scope and credit

The Spell System owns scope instead of each trigger: it runs every hook of a cast or construct inside `withPlayer(owner)` and `withDamageSource(source)` captured at the cast, and rewinds only for an aimed cast in its cast frame. Wrapping is idempotent (re-entering the same owner and source changes nothing), so the attack loop's and `runCast`'s existing wraps stay harmless during the migration and are removed at its end. Creature and world casts run `asWorld`.

### II.3.11 Pacts are spells with passive auras (and triggers live only on auras)

A pact's parts are already an aura's parts:

| pact today (`PactEntry`)                       | as a spell with an aura                                                           |
| ---------------------------------------------- | --------------------------------------------------------------------------------- |
| `modifiers` (+30% damage, −30% maximum health) | the aura's `modifiers`                                                            |
| `triggers` (Bloodbound: on kill, heal)         | the aura's `triggers`                                                             |
| `grants` (Gambler's Oath: +3 rerolls now)      | the aura's `grants`                                                               |
| its buff tile on the HUD                       | the aura's `status` tile                                                          |
| sealing it at the Pact Sigil                   | casting the pact's spell, whose release is `applyEffect(pact aura)` on every hero |

So a pact is `defineSpell({ id: 'pact.glassCannon', activation: { kind: 'event' /* the Sigil vote */ }, release: (ctx) => party(ctx).map((hero) => applyEffect(hero, 'pact.glassCannon')) })` plus one `EffectDef` holding its numbers, text and tile. The same rule holds for class triggers: there are none today, and a future one is a class's passive aura.

**Triggers stop having sources of their own.** Class triggers (`TRIGGERS`, empty) and pact triggers go; every trigger is an aura's, active while the aura is. The trigger machinery stays whole (conditions, internal cooldowns as `icd.<id>` effects, chance, `hears: 'party'`, the depth cap, the prediction rule, card text from `describeTrigger`); it just compiles from one place, the bearer's auras. Trigger ids become `aura.<id>.<i>`, which moves the derived `icd.*` effect ids, so that change lands with the wire change below.

What a pact aura needs that ordinary buffs do not:

1. **Its fold position.** Pacts fold as their own modifier source today (class base, pacts, totem, passives, effects, class states), and multiplications happen in that order, so moving pact modifiers into the ordinary effects slot would move the stat goldens. `EffectDef.fold` gains `'pacts'`, beside the `'classStates'` Enrage and Overcharge already use, and the stat fold stays bit-exact.
2. **Permanence.** `duration: 'infinite'`, kept through going down, reviving and a class change, never cleansed (no removable tag). A pact is a **party fact**: the room keeps the sealed list, and a hero who joins mid-run receives every sealed pact aura on joining.
3. **Sync.** Today the sealed pacts cross the wire as a list of ids (`pact.owned`). As auras they ride each hero's effect list: nine more entries out of the 256 a `uint8` effect id allows. Phase A keeps `pact.owned` as a projection, so the protocol and the pact-offer UI do not move; phase B drops it and bumps the protocol (the hydration test that drops unknown pact ids moves with it).
4. **Prediction.** Quicksilver changes movement speed, so its aura is `predicted: true` and the co-op mirror seeds it like any predicted effect; `tests/effects/docs.test.ts` already derives and enforces that rule.
5. **Card text.** Pact cards print text generated from their modifiers and triggers. That keeps working because the pact aura is plain data.

**Passive cards next, optionally.** Might, Haste, Vitality and the rest are the same shape: a permanent aura whose stacks are the rank, folding at `'passives'`. That is the full "everything is a spell and an aura" end state, but it touches the most sensitive golden (the stat fold, every rank) and the card pool's order, so it is its own later phase.

## II.4 Every existing spell, mapped

The weird ones first; the rest follow the same parts.

### Tempest (in full)

```ts
const cyclone = defineConstruct<{
  heading: number;
  goal?: Vec;
  nextTick: number;
  nextRetarget: number;
  nextStrike: number;
}>({
  id: "tempest.cyclone",
  shape: (c) => circle(c.stats.radius),
  lifetime: (c) => c.stats.duration,
  bound: "owner-standing", // a downed or gone owner takes it away, silently
  replicate: {
    fields: ["x", "z", "heading", "radius", "started", "duration", "evolved"],
    store: "tempests",
  },
  frame(c, dt) {
    steer(c, dt); // own state: retarget every 0.5 s (siblings' goals excluded), capped turn, leash to the owner
    const ending = c.age >= c.lifetime;
    const ticking = c.due("nextTick", TEMPEST.tick);
    const striking =
      c.evolved && c.due("nextStrike", LEGENDARY.tempest.strikeInterval);
    const procs: Proc[] = ending
      ? [
          cue("tempest.impact", c, {
            radius: c.stats.radius * TEMPEST.flingReach,
          }),
        ]
      : [];
    const candidates: Creature[] = [];
    for (const e of c.query.inside(
      circle(c.stats.radius * TEMPEST.pullReach + STRIKE_REACH),
      { side: "foes" },
    )) {
      if (striking && isStrikeCandidate(c, e)) candidates.push(e); // gathered before any pull, as today
      if (ticking && inside(c, e, c.stats.radius))
        procs.push(
          damage(e, c.stats.damage, { strength: "light", knock: "none" }),
        );
      if (ending) {
        if (inside(c, e, flingReach))
          procs.push(
            damage(e, c.stats.splash, { strength: "heavy", knock: "none" }),
            push(e, c, TEMPEST.fling),
          );
      } else if (inside(c, e, pullReach))
        procs.push(
          pull(e, c, TEMPEST.pullSpeed * dt, c.stats.radius * TEMPEST.core),
        );
    }
    if (striking && candidates.length)
      procs.push(...maelstromStrike(c, pick(c.random("main"), candidates))); // the main stream, as today
    return procs; // per enemy, in the order today's single pass does them
  },
});
```

Tempest needs: an owner-bound roaming construct, its own steering state, three clocks in one frame, per-enemy interleaving, a pick on the main random stream, a legendary branch, and replication through the existing `tempests` schema. Every one of those is a first-class part above; nothing is an escape hatch.

### The Arsenal

| weapon                | activation                                                                | parts                                                                                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cleave                | auto, `retryOnMiss`, `canCast` blocked by `state.whirlwind`               | `areaHit(cone)` → `damage` knock 0.15; `cue` with `sweepAngle`                                                                                                                                                                                      |
| Hawkeye, Verdant Bolt | auto, `aimed`                                                             | `shoot` × n (Projectile Count on `volley`), pierce, `repeat-share` 0.5 over the cast's `shared` set                                                                                                                                                 |
| Rivet Gun             | auto, `aimed`                                                             | `shoot` bullet, pierce, stops at walls                                                                                                                                                                                                              |
| Spark                 | auto, `aimed`                                                             | `query.chain` → `damage` × links with falloff, `knock: 'none'`; polyline cue                                                                                                                                                                        |
| Winter Pulse          | auto                                                                      | `areaHit` → `damage`, `applyEffect(slowed, chilled)`, legendary adds `applyEffect(frozen)`                                                                                                                                                          |
| Ember Blades          | passive                                                                   | owner-anchored construct, `replicate: 'derived'`, `every 0.18` contacts per blade, `none` hit policy                                                                                                                                                |
| Glaive                | auto                                                                      | homing missile construct, `once-per-cast` + reservations in cast `shared`, `budget`; legendary `spawn(fork, { now: leftover })`                                                                                                                     |
| Voltaic Orbs          | auto                                                                      | homing missiles, one per distinct target; legendary on-contact `chain` arc                                                                                                                                                                          |
| Singularity           | auto                                                                      | static well construct: `frame` pulls and tracks `caught`, `every 0.5` damage; `onExpire` collapse `areaHit` with a bonus per caught                                                                                                                 |
| Hexfire               | auto, `live` stats, `canCast` global cap 24                               | `applyEffect(hexfire.brand)` on creatures: a debuff aura whose `periodic` burns and whose `onBearerDeath` returns `after(0.15, pop)` → `areaHit` + `chain` leap                                                                                     |
| Searing Arrow         | auto                                                                      | per point `after(0.45, [areaHit repeat-share 0.25, spawn(patch)])`; patch constructs share an owner clock, `hottest-per-owner-clock`, `limit 12 oldest`                                                                                             |
| Judgement             | auto                                                                      | `after(0.5, [areaHit heavy, push, stun first only, `applyEffect(barrier)` on allies (legendary), after(0.5, aftershock)])`; the shield cue names the shielded ally                                                                                  |
| Tempest               | auto                                                                      | above                                                                                                                                                                                                                                               |
| Moon Chakram          | auto                                                                      | missile construct with its own phase machine in `frame` (bezier out, hang, home back, catch), per-pass hit sets, return-pass `pull`; legendary `spawn` × 3 crescents next frame, `rehit-cooldown` 0.3 s, shared `passes`                            |
| Serpent Coil          | passive, `tickIn: 'movement'`                                             | owner-anchored ribbon construct: lays nodes along the move, `hottest-per-owner-clock` burn, a coil detection → `areaHit(polygon)` + `applyEffect(venom.toxin)` (a damage-over-time debuff aura); legendary constrict channel then a second eruption |
| Cheat Death           | passive: a buff aura granted while the card is owned, holding its charges | the aura's `onLethal` prevents the death and returns `heal` to a share, `applyEffect(deathEscape)` (its cooldown), invulnerability, private cue                                                                                                     |

### Hero abilities

| ability          | activation (button)                           | parts                                                                                                                                                                                                                     |
| ---------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dash             | motion half only                              | no sim part; its `dodge` event stays                                                                                                                                                                                      |
| Blink            | motion half (exact travel)                    | `areaHit` → `damage`, `freeze` at the departure point (built)                                                                                                                                                             |
| Shockwave        | cooldown 8 s                                  | windup 0.2 → moving lane construct, `onContact` `once-per-cast` → `damage`, `stun`, cue; stops at walls                                                                                                                   |
| Sanctuary        | applies `sanctuary`                           | dome construct with `auras: [sheltered]` (the aura blocks non-exposed blows and knockback on heroes inside), a `frame` that eats hostile shots and pushes creatures out, `onExpire` `areaHit` 300 if the owner is present |
| Galeheart Volley | placement (predictable)                       | `after(0.35, [applyEffect(galeheart), cue, areaHit heavy])`, bound owner-standing                                                                                                                                         |
| Arrowstorm       | applies `arrowstorm`                          | opening `areaHit` (freeze, knock 3); the effect's `global` beat casts `arrowstorm.strike` (`areaHit` on `nearest(12)`)                                                                                                    |
| Frost Bomb       | placement                                     | `areaHit` (freeze) + field construct `limit 1 silent`, `every 0.5` → `damage`, `applyEffect(slowed, chilled)` or a sustained freeze                                                                                       |
| Overcharge       | applies `overcharged`, resets `cooldown.dash` | `applyEffect(barrier, { value: 0.5 × maxHp, duration: the ultimate's })` + `areaHit` knock (built today as a `shield` proc)                                                                                               |
| Whirlwind        | applies `whirlwind`                           | the effect's beat casts `whirlwind.sweep` (`areaHit` light); Cleave's `canCast` reads the tag                                                                                                                             |
| Enrage           | applies `enraged`                             | cue + `areaHit` knock; the clock rescale stays an effect hook                                                                                                                                                             |
| Verdant Flask    | placement                                     | `after(0.39, after(0.26, [cue, areaHit, spawn(field, limit 1 fade)]))`; the field pulses `damage` on foes and `heal` on allies                                                                                            |
| Living Grove     | applies `grove`, placement                    | field construct `limit 1 fade`, first pulse immediate, `damage` + `heal` + `applyEffect(slowed)`                                                                                                                          |
| Sentry           | `startsOn: 'cast'`, `place` (predictable)     | a summon construct that is a caster: its own `auto` spell (sticky target, bullets every 0.35 s) credited to the owner, `limit 1 fade`, bound owner and class                                                              |
| Overdrive        | applies `overdrive`                           | cue only                                                                                                                                                                                                                  |

### Creatures

| family            | parts                                                                                                                                                                                                                                                                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Horde (built)     | `ai` activation; telegraph and shot procs; the brain keeps pick and budget until the shared picker lands                                                                                                                                                                                                                                                        |
| Elite Juggernaut  | cleave (cone telegraph, `lockBefore(0.4)`, enraged release `castSpell(stab)`), charge (channel: caster `move` with sweep contacts, `onEnd: 'blocked'` → stagger), leap (`target` refuses without a landing; `move` flight; circle telegraph landing after windup + flight), whirlwind (moving pulse channel)                                                    |
| Elite Hexblade    | tether (channel, `breakIf` > 8 m from origin → `broken` → stagger; else an unblockable crushing `damage`), lance (lane telegraphs, the tracked fan rotates together), portal (circle telegraphs landing after the cast ends), step (`teleport` + departure telegraph)                                                                                           |
| Elite Gravecaller | shockwave (three staggered ring telegraphs), volley (shots with a gap; enraged: channel then a second fan), spikes (`eruptionLine` telegraphs), raise (`summon` with clearance rules)                                                                                                                                                                           |
| Elite enrage roar | a spell the brain casts at 50%: `onCancel`-style withdrawal of its own unfired telegraphs, knock telegraph, cooldown rescale                                                                                                                                                                                                                                    |
| Grave Warden      | the same parts with `lockAtShare(share, turnRate)`; execute (`lethal` damage); charge chains (`castSpell(charge, { windup: 0.45 })`); barrage second ring (`after(0.4)`); soulfire (ground constructs that hurt heroes over time); War Cry (`applyEffect(invulnerable)`, a buff aura on the boss, knock telegraph, then `summon`)                               |
| Archmage          | comet and chaos (shots and a lobbed telegraph whose delay is the flight), explosion patterns (points with stagger, aimed `lockAtStart`), repulse, blink (channel: vanish, then `teleport` and cue), Arcane Circle (channel whose clock is the fire-ring construct; `invulnerable`; `teleport` heroes; `despawn` adds; `every` barrage)                          |
| Map events        | `event` activation, caster `'world'`: Inferno (moving lethal wall construct, time-derived), Venom Flood (zone construct: harm outside, heal inside), Detonation (staggered telegraphs), Blood Horde (`summon` + a death trigger spawning pools), Prison (`summon` walls), Gravebloom (objective summons), Dread Totem (objective with an aura effect on heroes) |

## II.5 Migration

Every phase ends with the suite green, balance output identical except the timestamp, network bytes identical (except in phase 9 and pacts phase B), and the goldens held. A golden is recorded on the unchanged code before its family moves, on Linux x64 and arm64, with the macOS arm64 recording as the shared one where it exists.

0. **Safety net.** Add goldens that do not exist yet: every hero ability (both halves, with prediction), every elite spell (plain and enraged), the Warden per phase, the Archmage per phase, and each map event. Extend `wire-order.test.ts` with construct tick order.
1. **Core.** `defineSpell` / `defineConstruct`, the Spell System (casts, timeline, constructs store with storage adapters, `after`), `ctx.query`, named random streams, idempotent scope. Re-home the existing pilots; Searing Arrow's `run` becomes `after` and patch constructs.
2. **One proc vocabulary.** Trigger `do` lists become procs; spell events join the bus.
3. **Auras on any unit.** Creature statuses become auras (projected onto today's synced bytes), auras gain proc lifecycles, and the damage pipeline runs aura hooks. Auras gain a `value`, and the barrier becomes an absorb aura (step A: `PlayerSchema.barrier` stays as its projection). Cheat Death, the Sanctuary's shelter and the barrier move out of `hurtPlayer`, and Hexfire's death call out of `hurtEnemy`; the Overcharge golden (which records the barrier every frame) and the Judgement weapon parity hold it.
4. **Pacts as spells with passive auras** (§II.3.11). Pact auras with `fold: 'pacts'`, sealing as a spell, pacts as a party fact applied on join; triggers compile from auras only (class and pact sources removed). Phase A keeps `pact.owned` as a projection (no protocol move); phase B drops it with the trigger-id change (protocol bump). Held by the stat goldens, `pacts/mods.test.ts`, `pact-sync.test.ts` and the pact card text.
5. **The Arsenal**, family by family (instant, projectiles, delayed, constructs, statuses, passives), weapon parity after each. `CARD_MECHANICS` shrinks to nothing.
6. **Abilities.** `AbilityDef` becomes the `button` activation; `CAST_HANDLERS` and `CAST_VISUALS` go; prediction runs the spell's mirror-safe hooks.
7. **Creatures.** Elites, then the Warden, then the Archmage onto spells with timelines; the shared picker and budget policy; telegraph constructs with shapes and `onLand` replace the hazard loop's per-spell special cases.
8. **Cues.** The remaining raw `emit` sites become cue ids (append-only).
9. **Replication.** One `ConstructSchema` and a client renderer registry replace the per-kind schemas (protocol version bump, measured with `benchmark:network`; pacts phase B can ride along).
10. **Map events** onto `event` spells (optional; they already have their own clean state).
11. **Shared spells.** Nova, volley, whirlwind, cleave and charge written once in `spells/<id>/` and cast by either side, since targeting is side-relative.
12. **Passive cards as auras** (optional, §II.3.11): each passive a permanent aura, stacks = rank, `fold: 'passives'`, held by every stat golden.

## II.6 Decisions to take

1. **Construct is the name?** Alternatives: spell object, area trigger (WoW), entity. It names the one new concept, so it is worth settling first.
2. **Snapshot or live stats by default.** The plan snapshots (Searing, Judgement and Tempest do) and lets a spell opt into `live` (Hexfire does today).
3. **The Spell System owns scope.** Proposed, since constructs tick outside any trigger; the alternative keeps "the trigger owns the scope" and makes every construct re-enter its own.
4. **Auras on creatures in phase 3, or later.** They unlock Hexfire, Coil, Frost, Cheat Death, the Sanctuary and every creature control cleanly; without them those spells keep writing enemy fields through procs and `hurtPlayer` keeps its special cases.
5. **Replication unification (phase 9).** With pacts phase B, it is where the protocol moves; it can also be skipped, keeping storage adapters for good.
6. **Pacts' and the barrier's wire change.** Step B (drop `pact.owned` and `PlayerSchema.barrier`, give `EffectSchema` a `value`, rename trigger ids) is a protocol bump; it can wait for the replication phase so all byte changes land together.
7. **Passives as auras.** Worth doing for uniformity, but it risks the stat fold for no gameplay change; the plan leaves it last and optional.
8. **How far brains move.** The plan moves timelines and weights onto spells and keeps movement and positioning in the brains; moving positioning too (keep range, hold ground) would make creature behaviour data as well.
