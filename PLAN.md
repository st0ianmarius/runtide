# spellweave: the plan

A deterministic, engine-agnostic gameplay framework for MMO-like games: spells, auras, procs, triggers, modifiers and cues, woven together, in pure TypeScript with no rendering or networking dependencies.

This is the whole plan in one file. Nothing here is built yet.

- **Part I, the framework plan**: what spellweave is, its ground rules, layout and toolchain, the rules that keep it generic and exact, its systems, and the implementation phases (F0 onwards).
- **Part II, the model**: the Spell API design it implements (spells as the container that orchestrates every system; auras, procs, triggers, area triggers, cues), with every spell of swarm, the game it comes out of and its first consumer, mapped onto it.

Section references read `§I.n` for Part I and `§II.n` for Part II. Paths such as `packages/game/src/…` and branch names such as `spell-primitive` refer to the swarm repository (`st0ianmarius/cryptwave`), which is a design reference, read-only, and never the framework's specification.

# Part I. The framework plan

## I.1 Goal

Build **the framework** (working name; its package name is a decision, §I.9): a standalone, general-purpose gameplay framework for MMO-like games, holding every kind of gameplay system that swarm shows a game needs and that does not depend on a renderer, a transport or any game's content, so that:

- **the framework is the engine**: modifiers, auras, triggers, procs, cues, spells, area triggers, creature scripts, the damage pipeline, abilities, prediction contracts and the deterministic core under them;
- **swarm becomes its first consumer**, later and from the outside: its `packages/game` supplies content (stats, auras, spells, cards, classes, creatures) and the world adapter (its `Game` class); `packages/protocol`, `packages/sync` and `apps/server` consume the framework's wire-agnostic contracts; `apps/client` renders cues and replicated views;
- **a future MMO-like game** can start from the framework alone and write only its content, its world and its transport.

**Generic first, swarm on the hatches.** The framework is designed for MMO-like games in general, never around swarm. Every behaviour it ships is its own documented contract, chosen because it suits games in general; none exists only because swarm does it that way, and there are no "swarm modes". Swarm, as the first consumer, must still be able to keep every behaviour it has today exactly, goldens included, and it does so in its own game code through the escape hatches of §I.5.6 (hooks, policies, pluggable rules and functions, custom curves, host interfaces, typed `ext` slots). The framework's job is to make each of those behaviours reachable without fighting it: where swarm's rule differs from the framework's default, a hatch must exist that lets swarm write its own, and adding that hatch is framework work; the swarm-specific rule itself is not.

The framework has **no dependency on swarm** or any of its packages (not `@swarm/types`, not `@swarm/game`) and is fully unit-testable on its own. Third-party npm packages are allowed where they earn their place, under the policy in §I.5.1.

## I.2 Ground rules for the implementation

1. **A standalone project in its own repository**: this one, `st0ianmarius/spellweave` (created with an MIT `LICENSE` and a Node `.gitignore`). Not a swarm branch, not a workspace package: nothing in swarm's `packages/`, `apps/`, root config or lockfile changes. Locally it is cloned next to the swarm checkout, never inside it.
2. **The latest TypeScript.** The latest stable `typescript` on npm at the time the project starts (`npm view typescript version`), pinned exactly, upgraded deliberately. The project is written to that version's strictest settings (§I.4.1), not to swarm's older config.
3. **The current Node LTS.** `engines.node` is the current LTS major and later. Its built-in type stripping runs the `.ts` sources and tests directly, and its built-in test runner runs the tests (§I.7.0).
4. **Reference swarm, never import it.** The designs that inform the framework live in swarm, read-only. Clone it next to the project (or use the existing checkout) and read with `git -C <swarm> show origin/spell-primitive:<path>`:
   - Part II of this document (written as swarm's `docs/spell-api.md`): the spell / aura / proc / area trigger model, pacts as passive auras, the barrier as an absorb aura;
   - `packages/game/src/spells/`: the working runner and proc registry;
   - on `master` too: `packages/game/src/{effects,modifiers,triggers,cues,abilities}/` and their READMEs.

   **Learn from the logic, do not copy its choices**: swarm's systems show what a game needs and where the hard cases are. The framework keeps what is sound for any game and states it as its own documented contract (§I.5), drops every game id, tuning number and class name, and restyles it to §I.5.2. Where swarm made a choice that only suits swarm (an epsilon, an accumulation order, a float shortcut), the framework picks a sensible generic default and makes sure a hatch lets swarm keep its own choice in its own code (§I.5.6).

5. **Never published.** The project is implemented and pushed to its own repository, and that is all: no npm, no GitHub Packages, no other registry, no release pipeline. `package.json` carries `"private": true` so `npm publish` refuses it, there is no `publishConfig`, no release or publish CI job, and no version tags are required. Anything that consumes it (swarm, later) takes it straight from the repository or a local folder (§I.8).
6. **Swarm keeps running unchanged.** Moving swarm onto the framework is a later, separate effort (§I.8). The framework ships as a project nobody imports yet, proven by its own unit tests only (§I.7.0): no example game, nothing visual.

## I.3 What goes in, what stays out

| In the framework (engine)                                                                                                 | Stays in swarm (the consumer)                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| deterministic core: seeded random streams, clocks, ordered registries, event bus, scope                                   | the `Game` class, `Game.step`, phases and their order                                                               |
| modifiers: stat registry, fold, conditions, scopes, caps, structured explanations (data, never text)                      | `STATS`, conditions' meaning (`enraged`…), numbers                                                                  |
| auras (today's `effects/`): any bearer, stacking, clocks, periodic, values, damage hooks, lifecycle procs, clock rescales | `EFFECTS` content                                                                                                   |
| triggers: event subscriptions owned by auras, conditions, internal cooldowns, chance, validation, structured explanations | the event kinds' payload sources (`hurtEnemy` raising `hit`…)                                                       |
| procs: registry, chance, groups, depth cap, the generic kinds                                                             | game proc kinds (`shoot` with its shot table, `telegraph` with its hazard shapes)                                   |
| cues: numeric cue ids, their numeric params, cue events, the params' wire encoding                                        | everything a cue looks and sounds like: the client's cue table (VFX, sounds, texts), Babylon playback               |
| spells: `SpellDef`, activation kinds, timeline, runner, delayed procs, spell events                                       | every spell, weapon, ability and creature spell                                                                     |
| area triggers: definition, store, tick order, lifetime and bounds, pulses, hit policies, spawning                         | every area trigger kind, replication onto Colyseus schemas                                                          |
| shapes and geometry: circle, ring, cone, lane, polygon, segment-circle sweep, patterns                                    | the world's spatial index, collision, pathfinding, physics (Havok)                                                  |
| world query **interface** (what a spell may ask) + an in-memory reference implementation                                  | the real query implementation over `Game.enemies` / heroes                                                          |
| damage pipeline: blow → mitigation → aura hooks (shelter, absorbs, lethal) → health                                       | the mitigation stats' meaning, hit windows, knockback physics                                                       |
| abilities: button activation, loadouts, cooldowns as auras, costs, `requires` / `blockedBy` / `resets`                    | dodge travel, `stepPlayerInput`, class loadouts                                                                     |
| creature scripts: behaviours with spawn, tick, timer and bound-event hooks, in the unit's own step                        | every creature's and boss's script and its numbers; steering, pathfinding and the flow field                        |
| units: templates, traits, lifecycle (down, revive, despawn), spawning, the damage, heal, force and death pipelines        | every template and its numbers; the hit window's length                                                             |
| the caster's own rank and variant (`rankOf`, `variantOf`) from the game's host, and its armed `auto` clocks (`arm`)       | every card and its ranks; the draft, rerolls, levels, loot and pickups (game systems on the escape hatches, §I.5.6) |
| world scripts (creature scripts on bodiless units); swept path tests and shape algebra                                    | every map event, the event director, formations, blockers and reserved sites, the arena's geometry                  |
| prediction contracts: mirror-safe context, motion-clock stamps, seeding a mirror's auras                                  | the reconciler, `LocalSession`, the co-op room                                                                      |
| replication **contracts**: append-only wire ids, view specs, projections                                                  | Colyseus schemas, msgpack codecs, `PROTOCOL_VERSION`                                                                |

A rule of thumb for borderline code: if it names a class, a card, a creature, a map, a number from tuning, Babylon, Colyseus or a DOM API, it stays out. The reverse rule holds for the game once it has moved (§II.6): outside content definitions, no game code names a content id. **Presentation always stays out** (§I.5.3): no player-facing text, name, icon, colour, sound, VFX, animation or HUD layout lives in the framework; the client holds all of it, keyed by numeric ids.

## I.4 Project layout

```
framework/                # a sibling of the swarm checkout, its own git repository
  package.json            # name per §I.9, "private": true (never published, §I.2), "type": "module", "sideEffects": false, ESM exports per system (no Node-only conditions), engines (dev tooling only), scripts; vetted deps only (§I.5.1)
  tsconfig.json           # the strict base (§I.4.1) for src, tests and bench, with Node types; the linter reads it
  tsconfig.src.json       # extends it for src only: ECMAScript lib only, types: [], so src never sees Node
  tsconfig.build.json     # extends tsconfig.src.json; emits dist/ (ESM JS + .d.ts) from src only
  .oxlintrc.json          # oxlint: the §I.4.2 rules, type-aware through oxlint-tsgolint
  oxlint-plugin.js        # the project's own lint rules, for what oxlint has no native rule for
  .prettierrc.json        # the style of §I.4.2
  .editorconfig
  README.md               # the engine's model: spell, aura, proc, area trigger, cue; how a game plugs in
  docs/                   # one short document per system, written last (§I.7, F22)
  LICENSE
  .github/workflows/ci.yml  # install, typecheck, lint, format check, test on the Node LTS (once the remote exists)
  src/
    core/                 # random (salted sequential streams + keyed rolls), time (fixed-step sim clock, countdown
                          # rules, stamps), registry (append-only ids), bus (typed events, payload reuse, "is anyone
                          # listening", depth cap), scope (owner, source, world)
    math/                 # Vec2, angles, shapes, segment-circle sweep, polygon tests, patterns (line, ring, cross)
    modifiers/            # stat registry, Modifier, scopes, sources and fold order, resolve, caps, explain (structured data)
    conditions/           # game tests and value kinds, the condition language (is, compare, all / any / not), compile, bind
    auras/                # AuraDef, ActiveAura, bearer, stacking, clocks, periodic, value and merge, hooks, lifecycle, view
    triggers/             # TriggerDef on auras, filters, icd auras, dispatch, validate, explain (structured data)
    procs/                # Proc, ProcDef registry, chance and groups, depth, generic kinds
    cues/                 # CueId registry, param schemas, cue events, params wire encoding (no presentation)
    damage/               # Blow, pipeline stages, aura hooks (onIncomingDamage, onLethal), result
    spells/               # SpellDef, activation kinds, timeline, runner, SpellSystem, delayed procs, spell events
    area-triggers/        # AreaTriggerDef, store, tick order, bounds, limits, pulses, hit policies, spawn
    world/                # WorldQuery interface and options, MemoryWorld, placement picker, query extensions (swept path tests: math/)
    abilities/            # button activation data compiled per spell, slots, loadouts, tryActivate / trigger, previews
    combat-log/           # entries recorded from the systems' events into a ring, subscribers, the damage meter
    ai/                   # the AI toolkit: named timers on a wheel, the weighted anti-repeat picker, focus, movement intents
    scripts/              # behaviours and scripts, for creatures and the world: spawn, tick, timer and bound-event hooks
    units/                # UnitDef templates, traits, lifecycle and derived states, spawn and despawn, health, unit hosts
    prediction/           # the cosmetic world, the "predicted" rule (checkPredicted); MirrorCtx lives in spells/
    replication/          # wire tables, aura lifecycle from views, stat projections (transport-agnostic)
    index.ts
  tests/
    <system>/*.test.ts    # unit tests per system
    helpers/              # fake hosts and bearers shared by the tests (not exported)
  bench/                  # tinybench benchmarks (npm run bench, never part of npm test) and BASELINE.md
```

`package.json` exports one entry per system (`<name>/auras`, `<name>/spells`, …) and `.` for the whole, each with a `types` and a `default` condition pointing into `dist/`. The package manager is npm, as in swarm.

### I.4.1 Toolchain on TypeScript 7

- **TypeScript 7**, the native compiler, pinned exactly; its `typescript` package ships `tsc`. It has no JavaScript compiler API yet, so no tool here depends on one.
- **Compiler options** (the strict end of what TypeScript 7 offers): `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature`, `verbatimModuleSyntax`, `isolatedModules`, `erasableSyntaxOnly` (no enums, namespaces or parameter properties, so every source runs under Node's type stripping, which also fits §I.5.2), `module` and `moduleResolution` `nodenext`, `target` and `lib` at the newest ECMAScript year that the compiler, the Node LTS and the evergreen browsers all support. **`src/` sees neither Node nor the DOM**: `tsconfig.src.json` has `lib` ECMAScript only and `types: []`, so a stray `process`, `Buffer` or `window` fails the typecheck. The root `tsconfig.json` covers `src/`, `tests/` and `bench/` with Node types; `typecheck` runs both, and the linter reads the root one.
- **Imports** use explicit `.ts` extensions (`allowImportingTsExtensions`), which Node runs as they are; the build rewrites them to `.js` (`rewriteRelativeImportExtensions`) and emits declarations.
- **Scripts**: `typecheck` (`tsc -p tsconfig.json && tsc -p tsconfig.src.json`), `build` (`tsc -p tsconfig.build.json`), `test` (`node --test "tests/**/*.test.ts"`), `lint` (`oxlint`), `format` / `format:check` (`prettier`). No bundler, and no `tsx`: Node's type stripping runs the TypeScript directly.
- **Lint**: oxlint, with the type-aware rules of `typescript-eslint`'s strict and stylistic type-checked presets that it has, run by `oxlint-tsgolint` (built on TypeScript 7's compiler), and the project's own rules in `oxlint-plugin.js` (doc blocks, naming, import order, blank lines, presentation fields). `typescript-eslint` does not support TypeScript 7, so ESLint is not used.

### I.4.2 Code quality and style

The bar is code a reviewer reads without friction: one style everywhere, enforced by tools rather than by memory, and the same as swarm's, so moving between the two repositories costs nothing. CI fails on any finding: `lint` runs with `--max-warnings 0`, and `format:check`, `typecheck` and the tests must pass.

- **Prettier owns formatting, entirely.** `.prettierrc.json` is swarm's: `singleQuote: true`, `printWidth: 120`, `trailingComma: 'all'`, `semi: true`. It formats `src/`, `tests/`, `bench/`, `docs/` and every Markdown file; the lint config enables no rule that would fight it, and `.editorconfig` matches it for editors.
- **oxlint owns what Prettier cannot**, through its native `curly` and the project rules in `oxlint-plugin.js`, all autofixable:
  - `curly: 'all'`;
  - a blank line before and after every function and every multi-line export (`padding-line-between-statements`), and between object-literal functions in factories and definitions;
  - a blank line after the import block and before a doc comment; never two blank lines in a row;
  - imports grouped (packages, then relative) and sorted, as `simple-import-sort` does (a project rule, with oxlint's `sort-imports` for the names inside each import).
- **Type safety** (oxlint's port of `typescript-eslint`'s strict type-checked rules): no `any`, no non-null assertions, `as` casts only in the adapters and the branded-id constructors (`src/**/*-adapter.ts` and `src/**/ids.ts`, the only files the lint lets cast), `consistent-type-imports`, `explicit-module-boundary-types`, exhaustive `switch` over every `kind`, `readonly` on every field a hook must not write.
- **Naming** (a project rule after `@typescript-eslint/naming-convention`, without the type-aware boolean check, which review holds): `camelCase` for functions, variables and fields; `PascalCase` for types; `UPPER_SNAKE_CASE` for module-level tables; `kebab-case` file names; booleans read as questions (`isFrozen`, `hasTag`, `canCast`); definitions end in `Def`; factories start with `create` or `define`.
- **Small, flat code.** Named exports only; one concept per file; each system's `index.ts` is its whole public API. Functions stay short (`max-lines-per-function` 60, `complexity` 12, `max-depth` 3, `max-params` 3, with more arguments passed as one options object) and files under 400 lines (data tables and tests exempt). Early returns over nesting, no nested ternaries, `eqeqeq`, `prefer-const`.
- **Modern syntax.** ES2024 and ESM only: `const` / `let`, arrow functions, `for…of`, destructuring, spread, `?.`, `??` and `??=`, `Object.hasOwn`, `.at()`, `toSorted` and the other copying array methods, `satisfies` and `as const` for typed tables, `readonly` arrays and tuples, `unknown` over `any`, `#private` fields where a class is used inside. Never `var`, `arguments`, CommonJS, `namespace`, `enum`, `for…in`, `.apply` or `.call`. Hot paths keep indexed loops over arrays and typed arrays and allocate nothing (§I.5.4). oxlint holds what it can (`prefer-object-has-own`, `unicorn/prefer-at`, `prefer-spread`, `prefer-rest-params`, `typescript/prefer-optional-chain`, `typescript/prefer-nullish-coalescing` and the like).
- **No noise.** No `console`, no commented-out code, no `TODO` without an issue reference, no dead exports (`knip` in CI).
- **Doc blocks.** Every exported type, field, function and hook has a `/** */` block (a project lint rule, which also holds the form: full sentences) that says what it guarantees, in full sentences; inline comments explain only a non-obvious why.
- **Tests follow the same rules**: one `describe` per contract, test names that state the behaviour (`'a refresh keeps the beat'`), literal expectations beside the assertion, and no state shared between tests.
- **One command.** `npm run check` runs typecheck, lint, format check, tests and build, and passes before every commit; a pre-commit hook (`simple-git-hooks` with `lint-staged`) runs Prettier and oxlint on the staged files. `npm run format` fixes what can be fixed (`oxlint --fix`, then `prettier --write`).

## I.5 How it stays generic, and exact

**Generic by factories and type parameters, never by imports.** Each system is created from the game's registries, as `effectSystem(registry)` and `triggerSystem(effects, sources)` already are in swarm's `master`:

```ts
const stats = defineStats({ damage: { base: 1, … }, moveSpeed: { … } });       // the game's stat table
const auras = createAuraSystem({ stats, tags: AURA_TAGS, registry: AURAS });   // AuraDef<StatId, TagId, CueId>
const triggers = createTriggerSystem({ auras, events: EVENT_KINDS });
const procs = createProcRegistry({ ...CORE_PROCS, ...GAME_PROCS });            // the game adds its kinds
const spells = createSpellSystem({ procs, auras, triggers, cues, world: adapter });
```

**Ids are numbers.** Every resource and every entity is a small integer at runtime and on the wire; strings exist for authors only, so the network carries a byte or two where a string would carry ten.

- **Resource ids come from the registry.** `createRegistry({ frostNova, blast })` gives each definition a dense id, its position in the registry: `SPELLS.id.frostNova === 0`, `SPELLS.id.blast === 1`. Hooks, procs, active auras, events, conditions, keyed rolls and the wire all carry the number, and `SPELLS.get(id)` is an array index.
- **Branded per registry.** `SpellId = number & { readonly __registry: 'spells' }`, `AuraId`, `CueId`… so the compiler refuses an aura id where a spell id is expected, at no runtime cost. The framework never names a game's id; the types are inferred from the game's registries.
- **Names are for people.** The object key is the definition's name, used in code (`SPELLS.id.blast`), logs and validation messages, and returned by `SPELLS.name(id)`. It is a developer identifier, never a player-facing name (§I.5.3), never crosses the wire and never sits on a hot path.
- **Append-only order.** Because the number is the position, registries only grow: a retired definition keeps its slot as a tombstone, and each consuming game pins its order in a test (swarm's `wire-order.test.ts` pattern). The replication layer sizes the field to the registry: a `uint8` up to 256 entries, a `uint16` or a varint beyond.
- **Entities too.** Units, casts, area triggers and auras in flight get integer ids from the host's allocator. A game with string ids (swarm's player ids, `'local'`, `'p0'`) maps them to numbers at its boundary. Integer ids are also exactly what keyed rolls hash (below).

Vectors are the framework's own `Vec2` (`{ x, z }`), structurally compatible with the game's `Vec`.

**Hosts are narrow interfaces the game implements**, as `CastHost`, `TriggerHost` and `EffectTarget` are today: the world query, the damage sink, the random streams, the clock, cue output, spawning. The framework never reaches into a concrete world.

**Documented semantics.** Each system defines its semantics as a documented contract, chosen for games in general, and its tests pin them as literal expectations (§I.7.0). They are the framework's own; a game that needs another rule writes it on a hatch. Swarm reproduces its exact current behaviour, goldens included, through escape hatches in its own code (§I.5.6); where a contract below differs from swarm's rule, the hatch swarm uses is named.

- **Auras:** an aura's life is a stamp on its bearer's count of its clock's steps, `⌈(seconds − 1e-6) / dt⌉` steps away, so a length ends on the step its seconds say on every clock (one timing for every game, §II.6.1 rule 4); periodic beats fire before expiry; the built-in stacking modes (`refresh`, `extend`, `stack`, `highest`, `independent`) and value merges behave as their tests pin them, and a game's own stacking or merge function covers any other rule; an `add` lands `value × stacks` and a `mul` lands `value ^ stacks` (or `1 + (value − 1) × stacks` where the modifier declares linear stacking, §II.6 M4); the lifecycle raise rules of §II.6 A1 and the small semantics of A14; registry order is fold order, walk order and wire id; `blockedBy` is tested before `removes`; every lifecycle event carries its cause and the serial of the call that made it, so a game keeps its own revision rule (swarm's `effectsRev`, bumped only for predicted auras) in its own listener.
- **Modifiers:** `(base + Σadd + derived) × Πmul`, then `min` caps, then the stat's clamp; adds sum and muls multiply one by one in source order; sources fold in the order the game declares (for swarm: class base, pacts, totem, passives, effects, class states), and an aura can pick its fold position (`'effects'`, `'classStates'`, and `'pacts'` for pact auras); a derived stat follows the gain `total − base` of the stat it derives from, or the game's own measure of it (`derives.gain`, where swarm keeps its add-only plain sum).
- **Triggers:** dispatch order is owner, then party listeners; within a bearer, aura order then authored order (gathered into a scratch list before any runs); conditions, then whether its internal cooldown is running (a trigger on cooldown rolls nothing), then chance (rolled only when `0 < chance < 1`, on the triggers' own stream), then its internal cooldown starts (so a failed roll never starts it), then actions in order; a trigger whose aura left its bearer before its turn does not fire; a filter the event does not carry fails; a depth cap (3 by default, configurable), with subscribers still hearing events past it.
- **Procs:** applied in list order, each seeing the results of the ones before it (§II.6.1 rule 2); a proc aimed at a unit the list already killed does nothing; an always-proc rolls nothing; `chance` rolls on the procs' own stream; a configurable depth cap.
- **Cues:** a cue event is a `CueId`, an anchor position, an owner and numeric params, in the order the simulation fires them; only params that differ from the cue's declared defaults cross the wire. What the cue shows (swarm today: its parts in the order vfx, sound, text) is the client's.
- **Determinism:** no `Math.random`, `Date.now`, `performance.now` or iteration over unordered keys. The lint config bans them (`no-restricted-properties`); iteration order is held by review. Every random draw comes from the run's seed, through the host, in one of the two forms below.
- **Time is a fixed-step simulation clock, never wall time.** The simulation advances in fixed ticks; `time = tick × dt` is derived from an integer tick count, not accumulated, so it never drifts and two runs agree to the bit. The host owns the clock and hands `tick`, `dt` and `time` to every system; the framework never reads a real clock. Rendering interpolates between ticks on its own side. Deadlines are **stamps** (an absolute tick at which something ends or fires), so they need no syncing and cannot drift; timers that pause or rescale (cast stages, `auto` clocks, area trigger lifetimes and pulses) count their seconds down instead. Both keep **one timing** (§II.6.1 rule 4): a countdown snaps to zero below `1e-6`, and a stamp is `⌈(seconds − 1e-6) / dt⌉` steps away, so a length ends on the step its seconds say (3 s at 1/60 s on step 180, 0.1 s on step 6) on every clock, in every game. A game runs as many fixed-step clocks as it needs (a motion clock for co-op prediction, counted in motion steps), each with its own step. There is no accumulating mode: a game that sums its time today (swarm's `game.time += dt`) keeps that sum in its own code beside the clock, or moves onto ticks.
- **Two kinds of random, both from the run's seed:**
  - **Sequential streams** (`stream(seed, salt)`), each salted so a roll added in one system never shifts another. Their draws depend on call order, so reordering two hits changes every later roll on that stream. The generator is Mulberry32 on `seed ^ salt`, frozen, and its tests pin it with a literal table of its own draws. A game maps its named streams onto them through its stream table (§II.6.1 rule 3); that is how swarm keeps every sequential draw where it is today (crits on the main stream, `volley`, `horde`, `trigger`, `proc`…), in its own table.
  - **Keyed rolls** (`roll(seed, stream, ...key)`), a counter-based 32-bit hash (decided: a Murmur3-finalizer chain, below) of the seed, the stream's salt and a key such as `(tick, casterId, spellId, targetId, index)`. A keyed roll depends only on its key, never on how many rolls came before, so adding content, reordering hits or skipping a system shifts nothing else. It is also safe for rollback and prediction: a client that knows the key rolls the same value the server does, without replaying the server's call history. **Keyed rolls are the default for new content**; a game picks sequential where it wants draws in call order, or to keep the draws an existing game already makes.
  - Both return a float in `[0, 1)` built from integer arithmetic only, so they are identical on every platform (unlike `Math.sin`). Integer helpers (`int(n)`, `pick(list)`, `shuffle`, `weighted(weights)`) sit on top of both, with the same draw counts so a switch between the two kinds is a one-line change.
- **Keys must be stable.** A keyed roll's key uses integers the simulation already owns (tick, entity ids, registry indexes), never floats or object identity, and the key's parts are documented per call site (`crit: (tick, sourceId, targetId, hitIndex)`). Two rolls that must differ within one tick differ in their key (`hitIndex`, `index`).
- **Platform floats:** `Math.sin` and `Math.cos` differ in the last bit between x64 and arm64 V8 builds. The framework's own random is integer-only and identical everywhere; its unit tests never assert a bit-exact result that goes through `Math.sin`, `Math.cos` or `Math.atan2` (they compare with a tolerance, or use inputs whose results are exact, such as axis-aligned angles).

### I.5.1 Third-party dependencies

npm packages are welcome when they save real work, under five conditions:

1. **Pure and portable.** Plain JavaScript or TypeScript with no DOM, no Node-only runtime API, no native addon and no side effects on import, so the framework still runs in a browser, on a server and in a worker (§I.5.5); the CI browser bundle proves it.
2. **Deterministic.** No hidden randomness, clocks or unordered iteration on a path the simulation depends on.
3. **Small and maintained.** A permissive licence (MIT, ISC, BSD, Apache-2.0), few or no transitive dependencies, recent releases.
4. **Pinned and declared.** An exact version in the project's `package.json`, and never swarm or any of its packages. `knip` fails on an import of a package that is not listed, and the lint config rejects any swarm import.
5. **Behind the framework's own API.** A dependency is an implementation detail: consumers never import it or see its types, so it can be replaced without a breaking change.

The plan adopts these; others follow the same test:

| package                     | where                    | why                                                                                                                                                                                                                                    |
| --------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flatbush` (runtime)        | `world/` static geometry | a packed R-tree for what never moves (walls, colliders, zones): `search` and `neighbors` over static shapes. Moving units use the hand-written uniform grid instead (§I.5.4)                                                           |
| `tinybench` (dev)           | `bench/`                 | the benchmark harness for §I.5.4's budgets, outside the unit tests                                                                                                                                                                     |
| `flatqueue` (runtime)       | `core/timers`            | a binary heap on typed arrays (ISC, no dependencies) for the timer overflow beyond the timing wheel's horizon (§I.5.4)                                                                                                                 |
| `kdbush` (runtime)          | `world/` point index     | a static k-d tree of points on typed arrays (ISC, no dependencies), rebuilt per tick in well under a millisecond for thousands of units; the alternative to the uniform grid for large, sparse worlds where one cell size does not fit |
| `typedfastbitset` (runtime) | `core/bitset`            | fast bitsets on typed arrays (Apache-2.0, no dependencies): tag sets, `has`-hook tables, and per-cast hit sets over dense unit indexes (replacing `Set<number>` in `once-per-cast` and `repeat-share`)                                 |
| `fast-check` (dev)          | tests                    | property tests on `node:test`: stacking and merge invariants, fold order, keyed-roll independence, tick-order stability, geometry round trips                                                                                          |

Considered and declined: `bitecs` (an ECS whose MPL-2.0 licence fails condition 3 and whose world model would replace the hosts'), `rbush` (a dynamic R-tree, slower than a grid for moving points), `fastbitset` (pulls in dependencies). Versions are pinned exactly at F0 from the then-latest releases.

Hand-written on purpose, since the exact semantics matter more than saving code: the sequential random streams and the keyed-roll mixer (content depends on their exact draws, so they stay frozen), the event bus (payload reuse, `hears`), the modifier fold (float order), and the timeline.

### I.5.2 Defining resources: plain objects and functions

A **resource** is anything a consumer registers with the framework: stats, auras, triggers, conditions, procs, cues, spells, area triggers, abilities, creature scripts. Every kind has one interface (`AuraDef`, `SpellDef`, `AreaTriggerDef`, `Behaviour`, …) and one identity helper (`defineAura`, `defineSpell`, `defineBehaviour`, …) that only fixes the types. **The rule:**

> A resource is a plain object: data fields and standalone functions. Shared behaviour comes from functions that build or combine those objects, never from classes, `this` or inheritance.

What that means in practice:

- **Hooks are standalone functions.** They receive everything they need as arguments (`ctx`, the target, the hit) and never read `this`. The framework may call a hook detached (`const { release } = def; release(ctx, target)`), and it must still work.
- **Sharing is by factories and composition.** A family of resources with shared behaviour is a function returning the interface (`telegraphedSpell({ windup, shape })`), and variations spread or wrap hooks (`{ ...base, onHit: withBonus(base.onHit) }`). Definitions are plain objects, so spreading is always safe.
- **Definitions are stateless.** A definition is shared by every cast, aura or area trigger made from it, so per-instance state never lives on it: a cast has its `CastState`, an active aura its `value` and stacks, an area trigger its `State`, a scripted creature its script `State`. Registries freeze definitions in development builds to catch mutation.
- **Data stays data.** Fields the framework reads as data (ids, tags, durations, modifiers, a trigger's `do`) are plain values, not getters, because explanations, validation and the wire read them.
- **Registration is by name, identity is by number.** `createRegistry({ name: def, … })`: the key order assigns each definition its numeric id (append-only, §I.5). A definition carries no id of its own; the runtime hands it its id where it needs one (`ctx.spellId`, `aura.id`).
- **Variants are discriminated unions.** Anything that comes in several shapes says so in a `kind` field (`{ kind: 'circle', r }`), and code narrows on it; nothing is told apart by its prototype.

```ts
// A resource: data plus functions
export const frostNova = defineSpell({
  activation: { kind: 'button' },
  release: (ctx) => [areaHit(ctx.caster, 4)],
  onHit: (_ctx, { targets }) => targets.map((t) => applyAura(t, 'frozen', { duration: 2 })),
});

// Shared behaviour: a factory, not a base class
const telegraphedSpell = (spec: { windup: number; shape: (aim: Aim) => Shape }) =>
  defineSpell({
    activation: {
      kind: 'ai',
      windup: spec.windup,
      recover: 0.25,
      cooldown: 5,
      range: 22,
    },
    begin: (_ctx, aim: Aim) => [telegraph(spec.shape(aim), { delay: spec.windup })],
    release: () => [], // the telegraph lands by itself
  });
export const blast = telegraphedSpell({
  windup: 1.2,
  shape: (aim) => circle(1.5, aim.point),
});

export const SPELLS = createRegistry({ frostNova, blast }); // SPELLS.id.frostNova === 0, SPELLS.id.blast === 1
```

**Inside the framework, the implementer chooses.** The rule above is about the public surface: what a game writes and what it gets back are plain objects and functions, so a game never writes `new Spell()`, `new Aura()` or `extends CreatureScript`, and a hook never depends on `this`. The framework's own internals are free to use whatever reads best and runs fastest (factories closed over state, as swarm's `effectSystem(registry)` does today, or a class, `instanceof` or `new` where that is clearer), as long as none of it leaks into the API a game sees. This is a guideline for review, not a lint rule.

A unit test per kind registers a resource, calls every hook detached, and holds that the framework never mutates it.

### I.5.3 Presentation stays out: the client owns it

The framework is simulation only. **No player-facing text and no visual or audio information lives in it**, and none of its types has a field for one: no names, descriptions, tooltips or localised strings; no icons, colours, models, animations, VFX or sound ids; no HUD layout, number formatting or units. Gameplay speaks in **numeric ids and numbers**, and the client turns them into what players see and hear.

- **What the simulation emits.** Ids and numbers only: cue events (`CueId`, position, owner, numeric params such as direction, duration, radius, amount), and state views carrying `SpellId`, `AuraId`, `AreaTriggerKindId`, `StatId`, stacks, values and stamps.
- **What the client holds.** Presentation tables keyed by those ids: `SPELL_PRESENTATION[SpellId]` (name, description, icon, cast VFX), `AURA_PRESENTATION[AuraId]` (tile, icon, colour, name, text), `CUE_PRESENTATION[CueId]` (VFX, sound, floating-text template), `AREA_TRIGGER_PRESENTATION[AreaTriggerKindId]` (model, renderer), and its locale strings. It imports the game's id registries (or tables generated from them) and nothing else from the simulation's content.
- **Text that shows numbers.** Card and tooltip text must print the real numbers, so the framework gives the client **structured explanations**: `explainModifier`, `explainAura`, `explainTrigger` return data such as `{ kind: 'modifier', stat: StatId, op: 'mul', value: 1.3, when?: ConditionData }`, and the client phrases it with its own words, formats and language. The numbers come from the simulation; the words never do.
- **Floating numbers and callouts** (a damage number, an absorbed "(−N)", "STAGGERED") are cues with numeric params; the client's cue table owns the wording and the colour.
- **Completeness is the game's test, not the framework's.** A consuming game checks that every id in its registries has a presentation entry, for example with a `satisfies Record<SpellName, …>` table or a unit test over `SPELLS.id`.
- **Developer strings are allowed.** Registry names (§I.5) and error or validation messages in English are for developers, never shown to players, and never on the wire.
- **Enforced.** The framework's definition types carry no string fields except the developer-facing ones listed in a type-level test, and a project lint rule fails if an exported type gains a field named like presentation (`name`, `label`, `text`, `description`, `icon`, `color`, `sound`, `vfx`, `model`, `anim`) outside its allowlist.

### I.5.5 Runs anywhere: no Node.js at runtime

spellweave runs on the server (Node), in the browser (swarm's "local play" runs the whole simulation client-side) and in a Web Worker. Node.js is a **development tool** here (tests, build, benchmarks), never a runtime dependency.

- **`src/` uses ECMAScript only.** No `node:` imports; no `process`, `Buffer`, `global`, `require`, `module`, `__dirname`, `setImmediate` or `fs`; no DOM or `window` either. Timers, randomness and clocks come from the host (§I.5), so nothing needs a platform API. Typed arrays, `Math.imul`, `Map` / `Set` / `WeakMap` and `BigInt` are ECMAScript and allowed.
- **Checked three ways.** The `src/` compiler config has no Node or DOM types (§I.4.1); the lint config rejects any Node built-in import and any reference to the Node globals above inside `src/` (`import/no-nodejs-modules`, `no-restricted-globals`); and CI bundles `src/` for the browser (`esbuild --platform=browser --bundle`, a dev dependency) and fails if anything reaches for a Node built-in.
- **Dependencies meet the same bar** (§I.5.1, condition 1): `flatbush`, `flatqueue`, `kdbush` and `typedfastbitset` are plain ESM with no Node imports. The browser bundle check covers them too.
- **Built as ESM for any bundler.** `dist/` (built locally or by the consumer, never published, §I.2) is standard ES modules with `.js` extensions and declarations, `"sideEffects": false` for tree-shaking, and `exports` with only `types` and `default` conditions, so Vite, esbuild, webpack and Node all resolve it the same way.
- **Tests stay on `node:test`.** The unit tests and benchmarks run on Node, which is fine: they exercise the same ECMAScript code the browser runs. `node:` imports are allowed under `tests/` and `bench/` only.

### I.5.4 Performance: built for hordes

The framework runs on the server and on every client, every tick, for hundreds of creatures casting, ticking auras and firing procs at once. Every hot path is designed to be **O(1) by numeric id, monomorphic and allocation-free per tick**.

**Registries are dense arrays.**

- A registry is built once, at load, into flat arrays indexed by the numeric id: `SPELLS.defs[id]` is a plain array read, with no `Map`, no string key and no hashing anywhere on a hot path. Name-to-id lookups (`SPELLS.id.blast`) are resolved at module load or in authoring code, never per tick.
- **Normalised shapes.** Every definition of a kind is normalised at registration into one object shape with every optional field present (`undefined` or a no-op), so V8 sees one hidden class per kind and property reads stay monomorphic.
- **Hot fields as typed columns.** Numbers read every tick are copied into struct-of-arrays columns: `SPELLS.columns.windup: Float64Array`, `SPELLS.columns.channel`, `SPELLS.columns.flags: Uint8Array`, `AURAS.columns.maxStacks`, `AURAS.columns.flags`, and so on. Hot loops read columns, not objects.
- **Hooks as per-kind dispatch tables.** For each hook, a system builds an array indexed by id over its registry's definitions (`SPELLS.hooks.onHit[id]`), and where a hot path asks many ids, a bitset of which have it (`AURAS.has.onLand`), so a missing hook costs a read or one bit test, never an optional call on a megamorphic site. The core registry keeps ids, definitions and typed columns only (the review after F21 took out its own hook tables, which no system read).
- **Tags and sets as bitsets** (`typedfastbitset`, behind `core/bitset`). Tag ids are dense; an aura's tags, a bearer's active tags and `blockedBy` / `removes` are `Uint32Array` bitsets, so `hasTag`, immunity and cleanse checks are a few word operations.
- **Proc kinds dispatch on a small integer** (`PROCS.apply[kind](…)`); event subscriptions are arrays indexed by event-kind id, and `hears(kind)` is one array read.

**Nothing allocates per tick.**

- **Pools and free lists** for casts, active auras, area triggers and delayed procs, with generational handles (index plus generation) so a stale reference is detected, never followed; cue events, which live one tick, sit in a per-tick buffer that keeps its records when it is cleared.
- **Scratch buffers** reused for query results (`inside`, `nearest`), proc lists returned by hooks (the runner hands hooks a reusable output array to push into, and plain arrays remain accepted for authoring convenience), and event payloads (the bus already reuses one payload per kind per nesting level).
- **No closures created per tick** on engine paths, no `Array.prototype` chains (`map` / `filter`) in hot loops, no spreading of objects per call.

**Timers are a timing wheel.** Delayed procs (`after`, one wheel per tick slot), aura expiries, AI scheduler events and timers on the host's own clocks are due at a tick; with the fixed-step clock (§I.5) they go into a hand-written timing wheel (one FIFO bucket per tick over a fixed horizon), so scheduling and firing are O(1) and events due on the same tick fire in the order they were scheduled, deterministically. Anything beyond the horizon waits in a `flatqueue` heap keyed by tick and is moved into the wheel, in scheduling order, as its tick comes into range. **Cast stages are the exception** (decided at F7): they count down per caster when the host steps that caster (`spells.step(caster)`), not on the wheel, so the game keeps its own per-unit tick order (§II.6.1 rule 1), and pausing a cast (a stun, a freeze) is simply not counting it down. **Area trigger lifetimes, pulses and landings follow the same rule** (decided at F8): every area trigger is visited when its tick slot is stepped anyway (its frame runs), so its lifetime, its pulse clocks and its arming count down there, a suspended one simply does not count, and a telegraph lands as its lifetime runs out.

**Per-unit and per-world storage.**

- **Auras on a bearer** live in a small inline array sorted by aura id (the registry order the fold needs), with the bearer's tag bitset and a dirty flag. The bearer's own compiled modifier lists are cached per bearer and rebuilt only when the flag changes. The aura registry's gated lists are compiled once for the system, never copied per bearer: where a stat has a few gated lists at a fold position, a bearer's cache points at their entries, and where it has more, it holds one marker there and a read walks only the gates the bearer holds (`held: auraGates`), so a stat read costs what the bearer holds whatever the size of the aura registry. Conditions are still evaluated on every read (health thresholds, a world scan), because what they read changes without the bearer knowing.
- **Area triggers** live in one pool of records (decided at F8, in place of struct-of-arrays pools per kind): each record is the context its hooks receive, so the hooks read fields on one hidden class instead of a context built over typed columns per call; each kind keeps its tick-order and creation-order lists, the numbers read every tick per kind (tick slot, lifetime, expiry mode, limit, flags) are typed columns of the registry, and they are ticked kind by kind in the pinned order.
- **Moving units** are indexed each tick in a **uniform spatial grid** (a hash of cells rebuilt or updated incrementally from the positions), which answers `inside`, `nearest` and `densest` over thousands of mobs in near-constant time. For large, sparse worlds the point index can be a per-tick `kdbush` instead; the choice is the host's, behind the same `WorldQuery`, and the benchmarks decide the default. Static geometry uses the R-tree (§I.5.1).

**Measured, not assumed.**

- `bench/` holds `tinybench` benchmarks, run with `npm run bench` and kept out of `npm test`: registry lookups, aura application and fold, trigger dispatch, proc runs, the grid's queries, and a horde tick (for example 2,000 creatures, each with three auras and a spell in flight, plus 200 area triggers, 300 scripted horde units with movement intents and contact checks, 20 scripted elites and bosses, and a few hundred pickups).
- Each benchmark records a baseline in the repository; CI runs them on a fixed machine type and flags any regression beyond 20%. Absolute budgets per tick are set from the first measurements rather than guessed.
- Unit tests pin the performance-shaped contracts that can be checked exactly: registries expose typed columns of the right length, hook tables match the definitions, a pooled handle goes stale after release, and a steady-state tick allocates no new casts, auras or area triggers (counted through the pools).

### I.5.6 Escape hatches: the 5% that does not fit

The framework covers what is common: the mechanics several spells, units or games share. It does **not** try to model every one-off. A mechanic that fits nothing (a pickup's merge rule, a map event's placement search, a formation's swirl) is written by the game, in plain code, through a declared escape hatch, and that is a first-class, supported path, not a failure. The rule is only that the escape is **declared and owned**: it lives next to the content that needs it, it goes through one of the hatches below, and the engine's plumbing still never branches on a content id.

The hatches, from lightest to heaviest:

1. **Game proc kinds.** `createProcRegistry({ ...CORE_PROCS, ...GAME_PROCS })`: a game adds a kind with its own data and one host method (swarm's `shoot`, `telegraph`, a `drop`). The first choice for any new outcome.
2. **Function hooks and pluggable rules everywhere.** Every declarative part has a function form: `stats(ctx)`, `target`, an area trigger's `frame`, an aura's hooks, a script's `on.tick`, `keep` and placement functions; and every rule with a default takes the game's own in its place: stacking and merge functions, curves, a derived stat's gain measure. Code in a hook is ordinary game code, with `ctx` giving the world, the stats, the random streams and `ctx.apply`.
3. **`run(ctx => void)`.** The last-resort proc: arbitrary code with the host in hand, deterministic by contract (it uses `ctx.random` and the clock only). Each use is named (`run('coil.detect', fn)`) so it shows in the escape report.
4. **Game data on framework records.** Units, auras, area triggers, casts and scripts carry a typed `ext` slot for the game's own fields (declared once per game through a type parameter), so custom logic never needs a side table keyed by id.
5. **Host extension points.** The game supplies condition evaluators, target policies, budget policies, movement generators, tick slots, pipeline stages (named stages inserted into the damage, heal and force pipelines), world-query extensions (`WorldQuery & GameQuery`: a passage search, a site reservation) and the stream table.
6. **Game-owned steps.** Because the host owns the tick order (§II.6.1 rule 1), the game can run its own systems in its own slots between the framework's steppers: an event director, a pickup system, a formation controller, reading and writing framework state through the public API.
7. **The bus.** Game events in, framework events out; any game system can listen to spell, aura, unit and combat-log events and answer with procs.

What keeps the hatches honest:

- **Declared, not scattered.** Hatch code sits in the content's own module (`cards/coil/`, `events/prison/`) or in a named game system, never inside `Game.step`'s plumbing or the world adapter.
- **Deterministic by the same rules** (§I.5): no `Math.random`, no wall clock, streams through `ctx.random`; the lint bans cover hatch code too.
- **Counted.** The framework can list every game proc kind, `run` name, pipeline stage, activation kind, world-query extension and game-owned slot a game registered (a system's own proc kinds, such as the ability system's `useAbility`, are not hatches) (`escapeReport(registries)`); swarm prints it in CI, and a hatch that several mechanics start to share is a candidate to become a framework feature.
- **Typed.** Hatches get the same types as framework code (`ctx`, `Proc`, `ext`), so moving a hatch into the framework later is a refactor, not a rewrite.

**Swarm-specific behaviour lives in swarm, on the hatches.** The framework ships no swarm mode and no rule that only swarm needs. Every behaviour swarm has today that the framework's defaults do not give (a float shortcut, an order of accumulation, a raise rule, a revision counter) is written in swarm's own code on one of the hatches above, and the framework's job is to make every one of them reachable: when a phase finds a swarm behaviour no hatch can express, the framework gains or widens a generic hatch, proven by its own tests with neutral content, and swarm's goldens prove the swarm side once it migrates (§I.8).

## I.6 The systems

Each is summarised by what it must offer; Part II has the full model.

- **Core.** Random: sequential salted streams (`stream(seed, salt)`, Mulberry32 on `seed ^ salt`) and keyed rolls (`roll(seed, salt, ...key)`), with `int`, `pick`, `weighted` and `shuffle` on both. Time: a fixed-step `SimClock` (`tick`, `dt`, `time = tick × dt`), as many as the game runs (a world clock, a motion clock), stamps (`stampAt`, `isDue(stamp)`, `remaining(stamp)`), and the countdowns pausable and rescalable timers keep (`countDown`, `isRunOut`), which snap to zero below `1e-6`, so a countdown and a stamp of the same length (`stepsUntil`: `⌈(seconds − 1e-6) / dt⌉`) end on the step the seconds say; `Registry<Def>` assigning branded numeric ids by key order (append-only, tombstones for retired entries, `id` / `name` / `get` lookups, order checks), built into dense arrays, typed hot-field columns, per-hook dispatch tables and bitsets (§I.5.4); pools with generational handles; scratch buffers; a typed `Bus` with payload reuse, `hears(kind)` short-circuiting and a configurable nesting cap.
- **Math.** Shapes (`circle`, `ring`, `cone`, `lane`, `polygon`, `point`) with `covers(shape, point, radius)`; `sweep(from, to, radius)` against circles; patterns returning point lists with a stagger (`linePoints`, `ringPoints`, `crossPoints`); angle helpers (`wrap`, `turnToward`).
- **Modifiers.** `defineStats` with flat and multiplier stats, ratings that convert through curves, a curve library (linear, rating, hyperbolic, haste, avoidance, stacking, table; §II.3.14), scaled values with LoL-style ratios (§II.3.13), `Modifier` (`add | mul | min`, `when`, `scope`), pluggable `Condition` evaluators, ordered sources, `resolve` / `fold`, derived stats with a pluggable gain measure, caps, `explainModifier` returning structured data (stat id, op, value, condition) for the client to phrase.
- **Conditions.** The game's condition tests (`defineConditions`, each flaggable `mirrorSafe`, and `world` for one that asks the world) and value kinds (`defineValues`), and one condition language over them that modifiers, triggers, targeting and AI read: a game test (`{ is, arg }`), a comparison of a value kind with a threshold (`{ value, op, than, epsilon }`), and `all`, `any`, `not`; compiled at load (`compileCondition`: names checked, world tests moved last), bound once (`bindCondition`, `conditionTest`), explained as its compiled data, and checked mirror-safe (`isMirrorSafe`, and `checkPredicted` for predicted auras).
- **Every system below is widened by the coverage catalogue of §II.6, whose entries name the phase they land in; the catalogue is the checklist.**
- **Auras.** `AuraDef` on any bearer (`AuraBearer`: `auras`, `clocks`, `rev`); stacking, built in or the game's own; clocks the game names (`world`, `motion`, `global`), each with its step, each bearer counting its own steps on each, which aura stamps count against; `periodic` returning procs; `value` with `merge: 'max' | 'add' | 'replace'` and `keepWhenDepleted` (absorbs); tags, `blockedBy`, `removes`; `grants` through a resource registry; `fold` position; `predicted`; lifecycle hooks and events (`applied`, `refreshed`, `expired`, `removed`, `stateEntered`); application policy (`onIncomingAura`); periodic beats on their own clock and slot; instance payloads; `removedOn`, `boundToSource`, `activeWhile`; clock rescales on edges; damage hooks (`onIncomingDamage`, `onLethal`); lifecycle events and lifecycle cue ids; `view()` for the wire. No `status`, name, icon or colour: the client's aura table, keyed by `AuraId`, draws the tile.
- **Triggers.** `TriggerDef` owned by an `AuraDef` only (no free-standing sources); event kinds and filters supplied by the game; internal cooldowns as derived auras; `chance`; `hears: 'self' | 'party'`; `do` as data procs, validated at load (odds, cooldowns, filters); the prediction rule over the auras a press reads is `checkPredicted` (Prediction, below); and `explain` (structured data, never text).
- **Procs.** `Proc`, `ProcKindDef`, `createProcRegistry`; `chance` and `group`; the depth cap; core kinds that need only framework hosts: `damage`, `heal`, `setHealth` (made by the damage system, `damage.procKinds`, and registered beside `CORE_PROCS`), `applyAura`, `removeAura`, `removeByTag`, `castSpell` and `after` (made by the spell system, `spells.procKinds`), `spawn` (made by the area trigger system, `areaTriggers.procKinds`), `summon`, `despawn`, `despawnOwned`, `grant`, `revive`, `clearDisplacement`, cooldown `scale` / `clamp`, `rescaleClocks`, `cue`, `event`, `then` (named `andThen` in code, so that no registry or module is a thenable), `pickOne`, `run`; `ctx.apply` for hooks that observe a result. A game adds kinds by registering more.
- **Cues.** `defineCues` registers cue ids with their param schema (which numeric params a cue takes, their defaults and their wire quantisation: `f32`, `fixed`, `int`, `uint8`, `angle`, `vec2`, `vec2[]`, entity and registry ids), their anchor (`self`, `entity`, `target`, `world`), their audience (owner, party, everyone) and whether they are predicted, and nothing else; `CueEvent` (`cue: CueId`, its point, `owner`, `entity`, a predicted cue's `key`, and its params in slots resolved at load) is what the simulation emits, pooled in a per-tick buffer in firing order; `fireCue` fires a `CueSpec` (what spell and proc hooks return, typed per cue by `CueSpecOf`) at a place; the wire encoding (only params that differ from their defaults cross, as bytes or a plain number array, transport-agnostic), audience routing and predicted-cue echoes. Presentation only, and none of it inside: nothing in the engine reads a cue, and what a cue looks and sounds like is the client's (§I.5.3).
- **Damage, healing and force.** `Blow` (amount, origin, the outcome rows it skips, the game's own fields (`ext`), knock, source, spell, kind; true damage and the other bypassing kinds are damage kinds that skip stages); one side-agnostic pipeline for any unit, in a documented default stage order the game can extend with its own stages (§II.6 D1: ignore gates, the attacker's outgoing multipliers, the roll table's outcome rows (`defineRollTable`: miss, dodge, parry, glancing, block, crit or the game's own, in `single` or `independent` mode), mitigation, absorbs, `onLethal`, health; then the after-stages every blow runs: `onDealt`, the outcome events, the knockback, death; the hit window, the post-blow shove and going down are game stages placed after health); a heal pipeline; a force pipeline for knockback, push and pull; the death pipeline with rewards around the kill event; the game's own mapping from finished blows, heals, forces and deaths to cues, fired before the events of the same outcome.
- **Spells.** `SpellDef` (tags, activation, ranks, `stats` as a table of scaled values or a function, `scaling` shares, `live`, a cast aura, `state`, `canCast`, `target`, timeline, `begin`, `release`, `onHit`, `onEnd`, cues) registered by `defineSpells` into typed columns, hook tables, tag bitsets and compiled stats, checked at load; activation kinds (`auto`, `button`, `passive`, `trigger`, `ai`, `event`) with game-typed data, and the game's own kinds (`defineActivations`); the timeline (windup with `track` helpers `lockBefore`, `lockAtShare`, `lockAtStart` and `cancelIf`; channels with beats and `breakIf`; recover read with the outcome known; interrupts that pause or cancel; `onCancel`); the runner (`spells.cast` in the cast order: gates, stats, `canCast`, target, `begin`, release; the `castSpell` proc); a `SpellSystem` that steps casts per caster, lands delayed procs per tick slot and runs the `auto` clocks, with pause, resume, cancel, finish and interrupts for F16; pooled casts keyed for keyed rolls; spell events on the bus (`start`, `release`, `hit`, `end`) that triggers hear (`spellTriggerEvent`); snapshot versus live stats (`ctx.stats` plain numbers, `ctx.scaled` snapshots whose target terms finish at the hit); spell-scoped triggers on a cast aura; `explainSpell` and `previewStats` for the client.
- **Area triggers.** `AreaTriggerDef` (tags, tick slot and `after-parent` insertion, a shape relative to the area trigger, a lifetime of seconds, `owner`, `spent` or a function, the expiry mode, bound, anchor, limit, an owner aura, cues, `frame` as the primitive, then `move`, `every` pulses on their own, their owner's or the kind's clock, `contact` with `onContact`, `onLand`, `onExpire`, `onEnd` with its reason, named hit ledgers, area auras, a caster, an arming delay, the frame's order and a declared view; the replication spec is F10's) registered by `defineAreaTriggers` into typed columns, hook tables and tag bitsets, checked at load; a store (`createAreaTriggerSystem`) with pinned tick order (kind order, then creation order, children after their parents) stepped per slot or per owner; hit policies as ledgers (`once` in the cast's scope is `once-per-cast`, `repeat` with a share is `repeat-share`, `rehit` is `rehit-cooldown`, `pierce` and `budget` spend them, `claim` reserves, a shared pulse's `hottest` pick is `hottest-per-owner-clock`, and no ledger is `none`); spawning (the `spawn` proc) now or next frame; casts kept alive while their area triggers live; the `spawned` and `ended` events (`areaTriggerEvent`); queries over area triggers (by kind, owner and tag, a declared view, `coveredBy`, `intercept`, `despawnWhere`).
- **World.** `WorldQuery` (`inside`, `all`, `count`, `nearest`, `densest`, `chain`, `sweep` (relative to the units' motion when asked), `lineClear`, `isPositionClear`, `clamp`, `moveBody`, `pickPoint`, `positionOf`, `previousOf`, `velocityOf`, `leadPoint`) with `side` relative to the caster and the query options of §II.6 W10; `createMemoryWorld`, a reference implementation for tests and for small games, with the game's query extensions (listed in the escape report). It indexes moving units in a uniform spatial grid (or a k-d tree rebuilt when they moved) and static geometry in the R-tree (§I.5.4). The swept path tests (seconds inside a shape over a tick, edge crossings, exposure windows) and shape bounds are in `math`. Rewinding `positionOf` while a cast is aimed is the host's (F10's mirror).
- **Abilities.** `button` activation data on the spell (`ButtonActivation`): a cooldown (seconds, a scaled value at the slot's rank, or a function of the caster) that starts on `activation` or `cast`, a cost in aura stacks, `requires` / `blockedBy` / `resets` as aura tags, `applies` (each aura for its own length, times a stat when it names one), checked at load and compiled per spell by `createAbilitySystem`; the game's slots (`defineSlots`, in press order, each cooling on its own aura, so a cooldown belongs to the slot); loadouts on the bearer (`slot → spell` at a rank, `equip`, `abilityOf`, `slotOf`); `check` (why a slot may not fire: `empty`, `cooldown`, `requires`, `blocked`, `cost`), `tryActivate` (a press mask decided before any slot fires, then each fires in slot order: pay, `activate`, cooldown, `applies`, `resets`, the cast), `trigger` and the `useAbility` proc (the trigger path: no slot cooldown), `travel`; `cooldownOf` and `explain` for previews and tooltips. The bearer's motion half remains a game hook (`activate`, `travel`), typed over `MirrorCtx` (the bearer, the press's input, its stats for the spell, the static world the system is given, the step), so the mirror runs it too.
- **Combat log.** `createCombatLog` records every blow, immunity (a blow the ignore stage ignored, the damage system's `ignored` event), heal, death, aura change, cast moment and area trigger spawn and end from the systems' bus events, read through narrow views of their payloads, as ids and numbers (credit, actor, target, spell, aura, area kind, damage kind, amounts, overkill or overheal, flags, a status, outcome or reason code) into a ring of the latest entries in one `Float64Array`; subscribers get each entry as it is recorded; `checksum` digests the held entries for goldens; `createDamageMeter` sums damage and healing by credit and damage taken by target.
- **AI toolkit.** Named timers per unit brain (`defineTimers`) on a timing wheel, fired in due order and held by the game or by held interrupts; one weighted anti-repeat picker over a pool whose candidates are checked by the spells' own cast rules, weighted and filtered by the game; the first of an ordered list that would start (a reaction); a focus the procs may set; a reused movement intent per unit; the `setTimer`, `cancelTimer` and `setFocus` procs. Reactions, budgets, target policies and movement generators are the game's.
- **Creature scripts.** Behaviours (§II.3.12): a creature's script is a list of them, each with its own state per unit and optional handlers: `spawn`, `tick` in the unit's step, `timer` as its F17 timers come due (gathered once a tick and delivered in its step), and the game's own bus events bound by name to the unit they reach. Templates name their script; units with none cost nothing. Phases, picking, reactions, sensors, summon lists and factories are the game's behaviours, built on the AI toolkit (F17) and summons (F18).
- **Units.** `UnitDef` templates (base stats, class tags, traits, script, an optional auto-attack, the game's own `data`), `spawnUnit` with per-instance stats snapshotted at spawn, `despawn(reason)` distinct from death, the lifecycle (alive, dead, despawned) and its events, revive as a channel spell; going down and a player leaving are the game's own states.
- **Ownership and ranks.** No spellbook: what a unit owns, and at which rank and variant, is the game's own record (swarm's `player.ranks`), which the game tells the spell system: it arms an `auto` spell's clock on the unit as the unit gains it (`spells.arm`, a template's swing armed at spawn) and disarms it as the unit loses it, and the host's `rankOf` and `variantOf` give a cast that names none the caster's own rank and variant. A passive spell's aura or owner-attached area trigger is the game casting the spell as a card is picked and again after a revive; going down removes it through the aura system's bearer states and the area trigger's owner bound.
- **World scripts.** Creature scripts on bodiless units (§I.7.1 F21): a spawn names its script (`units.spawn(WORLD, { side, script })`), and the game never puts the unit in its world, so a map event, a formation or a world clock has timers, several casts at once, owned area triggers and summons like any unit. Behaviours keep state shared across instances (`shared`), and `scripts.count` and `scripts.instances` say who runs a script; the director that starts them stays the game's.
- **Prediction.** `MirrorCtx` (the types a mirror-safe hook may read: the bearer, its input, its synced stats, the static world, the step), with `StaticWorld`, in `spells` since a button's motion half (`activate`, `travel`) takes it (a read-only cosmetic world was sketched and dropped at the review after F21: nothing read it); `predicted` auras seeded on a silent mirror state from the server's views by the stamp contract (`auras.seed`); the rule that an aura the motion step reads must be `predicted`, checked both ways by `checkPredicted` over the aura registry, the presses' reads (`abilities.mirrorReads`) and the game's motion reads.
- **Replication.** `WireTable` (`wireTableOf`: append-only id ↔ name with an FNV-1a checksum; `checkWireTable`, the test helper), an area trigger kind's `replicate` spec (fields, view entries, rounding, `events-only`, `derived`) written by `areaTriggers.replicate`, aura views (F3's, with `ownerOnly`) whose lifecycle a client derives at zero bytes (`auraChanges`), stat projections over all or some sources (`defineProjection`), cast views (`spells.viewOf`). No schema library.

## I.7 Implementation phases (all in the new project)

### I.7.0 Testing: unit tests on `node:test`, nothing else

- **Tools.** Only Node's built-in test runner, `node:test` (`test`, `describe`, `it`, `beforeEach`, `mock.fn`), and `node:assert/strict`, as shipped by the current Node LTS (the project's `engines` floor), using only its stable APIs. The runner stays `node:test`; a third-party library that plugs into it is allowed under §I.5.1 (the plan adopts `fast-check` for property tests). No snapshot tool, no browser, no rendering.
- **What a test is.** A unit test of one system through its public API, with fake hosts and bearers from `tests/helpers/` (plain objects implementing the narrow interfaces, recording the calls they receive). Systems that sit on others (spells on procs, auras and triggers) are tested with the real lower systems plus fake hosts, never with a game.
- **No end-to-end example game.** Nothing visual and no sample game: completeness is shown by each system's tests covering its contract, including the §I.5 semantics as literal expectations.
- **Time and randomness in tests** come from the framework's own injected clock and seeded streams or keyed rolls. `mock.timers` and real timers are never needed. The keyed-roll mixer's frozen table is a literal array in its test, not a fixture file.
- **No fixture files and no goldens.** Expected values sit in the test next to the assertion. The per-platform golden machinery stays in swarm.
- **No swarm-derived expectations.** A test pins the framework's own documented contract with neutral content: no expected value is taken from swarm's code or output, no test is named or framed as matching swarm, and no fixture reproduces swarm's content or a transcription of its code. A frozen literal table (the random streams, the keyed-roll mixer) is the framework's own regression guard. That swarm can keep a behaviour of its own is shown by a test of the hatch it would use, with neutral content; the exact reproduction is proven by swarm's goldens, in swarm.
- **Run.** `node --test "tests/**/*.test.ts"` on Node's own type stripping, as the `test` script; optionally `--experimental-test-coverage` locally. Benchmarks (`npm run bench`, §I.5.4) are separate and never part of `npm test`.
- **Per phase.** Every phase adds the tests for what it builds: stacking modes, clock arithmetic, fold order, dispatch order, chance rolls, depth caps, timeline transitions, hit policies, tick order, pipeline order, and refusals. A phase is not done until its system's contract is covered.

Each phase ends with the tests green, `npm run typecheck` clean, `npm run lint` and `npm run format:check` clean, and `npm run build` emitting `dist/`.

- **F0. Scaffold.** In this repository (it already has `LICENSE` and `.gitignore`): `package.json` (TypeScript 7 and the §I.5.1 dependencies pinned exactly, `engines` on the Node LTS), the §I.4.1 `tsconfig.json` / `tsconfig.build.json`, `.oxlintrc.json` and `oxlint-plugin.js` with every rule of §I.4.2 that oxlint can hold (doc blocks on exports, no presentation fields, no swarm imports, no Node built-ins or globals in `src/`), `.prettierrc.json`, `.editorconfig`, the pre-commit hook, `npm run check`, README skeleton, the CI workflow with `knip`. The Node-free rule (§I.5.5) is in place from the start: the split `tsconfig.json` / `tsconfig.src.json`, the lint bans on Node built-ins and globals in `src/`, and the CI browser-bundle check.
- **F1. Core and math.** Sequential streams (tested for determinism, range and salt independence, with a frozen literal table of their own draws), keyed rolls (tested for key independence, platform-free integer arithmetic, and a uniformity check), the fixed-step clock with its stamps and countdowns, registries (the §I.5.2 rule: key order, `id` check, freezing, hooks callable detached), bus, scope; shapes and sweeps. The registry's dense layout, typed columns, dispatch tables and bitsets, the pools, and the first `bench/` baselines land here, so every later system is built on them.
- **F2. Modifiers.** Modelled on swarm's `packages/game/src/modifiers/`, generic and with no game content; tests pin the fold's documented float order with neutral stats and sources. Adds stat kinds, curves and scaled values (§II.3.13), tested on the fixed evaluation order, the share-of-1 rule, per-rank ratios, bonus and target terms, and the load-time checks.
- **F3. Auras.** Modelled on swarm's `packages/game/src/effects/` and generalised to any bearer; add `value` / `merge` / `keepWhenDepleted`, lifecycle procs, damage hooks, and the hatches a game keeps its own timers and rules on (clock rules and countdown timing, stacking and merge functions, event causes).
- **F4. Procs and triggers.** The proc registry (modelled on `spells/procs` on `spell-primitive`) and triggers (modelled on swarm's `packages/game/src/triggers/`), owned by auras only; `do` lists as procs.
- **F5. Damage pipeline.** Stages, hooks, the true-damage bypass, shelter → absorbs → lethal order; with them the heal, force and death pipelines, the `damage`, `heal` and `setHealth` proc kinds, and the mitigation rows of §II.3.14 (on F2's curves). F14 adds the roll table (outcome rows in `'single'` or `'independent'` mode) in the crit and block slots.
- **F6. Cues.** Registry shape, events builder, wire table; with them the core `cue` proc kind (appended to `CORE_PROCS`), `AuraDef.cues` typed by `CueId` (checked at load by `checkAuraCues`), the damage system's cue mapping, audience routing and predicted-cue echoes (§II.6 R1, R2's key and dedupe; the mirror's side of R2 is F10's).
- **F7. Spells.** Definitions, activations, timeline, runner, `SpellSystem`, delayed procs, spell events (modelled on swarm's `spells/` on `spell-primitive`, extended per Part II); with them the `castSpell` and `after` proc kinds (`spells.procKinds`, beside the core and damage kinds), chained delays counted from their parent's due time (§II.6 P5), casts kept alive while their delayed procs wait (§II.6 S6, the area trigger and summon side is F8's and F18's), the `auto` clocks (§II.6 S2), stat previews and explanations (§II.6 M6), the outgoing shares the damage host looks up (`spells.shareOf`), and the game's activation kinds in the escape report. Cast stages are stepped per caster, not on the timing wheel (§I.5.4), and spell-scoped triggers live on a cast aura (§II.3.7).
- **F8. Area triggers and world.** Store (pooled records, decided at F8 in place of struct-of-arrays pools, §I.5.4), tick order, bounds, limits, pulses, hit policies, spawning; `WorldQuery`, `MemoryWorld` with its uniform grid. With them the `spawn` proc kind (`areaTriggers.procKinds`), casts kept alive while their area triggers live (§II.6 S6), the `spawned` and `ended` events, owner auras for area trigger listeners (§II.3.7), hit ledgers (§II.6 W3), area auras (§II.6 A10), queries over area triggers (§II.6 W5), the swept path tests (§II.6 W6, in `math`), the completed `WorldQuery` (§II.6 W10) with the game's query extensions in the escape report, and the spell system's `hold`, `release`, `enter` and `leave` for other systems' liveness. Area trigger lifetimes count down as their slot is stepped, not on the timing wheel (§I.5.4).
- **F9. Abilities.** Button activation and loadouts (modelled on swarm's `packages/game/src/abilities/`), with cooldowns and costs as auras: the button's data on the spell's activation (checked by the `button` kind, compiled against the aura and stat tables by the ability system), slots with a cooldown aura each, loadouts on the bearer, the press (§II.6 S4), the trigger path with the `useAbility` proc kind (`abilities.procKinds`, listed as the framework's in the escape report), cooldown previews and explanations (§II.6 M6), and the motion half as hooks (§II.6 A12's F9 side: `activate` sets a forced movement's direction, an aura `applies` lands carries its duration, and `travel` moves the bearer while it holds; the prediction side is F10's).
- **F10. Prediction and replication contracts.** `predicted` auras and seeding a mirror by the stamp contract (§II.6 R3), `MirrorCtx` and the predicted rule checked both ways (§II.6 P7's F10 side, A12's: a press's applied motion aura is among the auras it must predict), wire tables, aura lifecycle from views (§II.6 A7, R4), area trigger replication specs (§II.3.9), stat projections (§II.6 M7's F10 side) and cast views (§II.6 C10's F10 side; script views are F19's), and the mirror-safe cast cue (§II.6 R2's mirror side: `SpellCues.cast` over a `MirrorCtx`, fired by the server as a cast starts and by the client through `spells.predictCast` or an ability system built with `mirror: true`, both with the press's key, so the F6 echo ring drops the server's copy). Left to the game: its transport and snapshot format, rewinding positions while a cast is aimed; the resource policy of M7 is F13's.

### I.7.1 Beyond the core: what a full MMO-like framework adds, and when

Compared with a WoW server emulator (TrinityCore, AzerothCore), phases F0–F10 cover the heart of the combat model: spells and their effects, auras (periodic, absorbs, prevent-death), procs with internal cooldowns, stat modifiers, AreaTrigger-like area triggers, casts and channels, and a deterministic tick. The rest is tiered by one rule, the same one the spell primitive followed: **a framework feature is built when swarm consumes it; otherwise the design leaves it a place and it waits.**

**Tier 1, built now** (each with its consumer in swarm today):

| #   | Feature                                                                                                                                             | Consumer in swarm today                                                                                                                                                                                                                                                      | Scope now                                                                                                                                                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F11 | **Combat log**: a structured stream of every cast, hit, miss, heal, aura applied or removed, and death                                              | the synced damage meter (`damageBySource`), the balance scripts (`balance:report`, `balance:clear`), the goldens that digest event streams                                                                                                                                   | the full log, with subscribers (meter, tests, analytics)                                                                                                          |
| F12 | **Conditions**: one data-driven predicate system                                                                                                    | modifier conditions (`status`, `tag`, `healthBelow`, `noMapBuff`); trigger filters (`scope`, `source`, `ability`, `critOnly`…); the "objectives" and "unbranded" targeting rules repeated across cards; creature spell weights                                               | the whole module; modifiers, triggers, targeting and AI all read it                                                                                               |
| F13 | **Unit model and states**: one unit shape for heroes, creatures and summons, with state flags derived from aura tags                                | `frozen`, `stunned`, `rooted`, `invuln`, `downed`, casting (`e.cast`), immunity to pulls (bosses, objectives)                                                                                                                                                                | the states and the unit shape; factions as sides, with the world's `isFoe` rule (objectives are a class tag)                                                      |
| F14 | **Combat roll table, mitigation and damage kinds**, as damage-pipeline stages (§II.3.14)                                                            | crit (chance and damage stats), block (hero block chance, `unblockable`), crushing blows, armor and `damageReduction`, and the kinds that bypass armor and the barrier (environmental, blood, lethal)                                                                        | outcome rows (miss, dodge, parry, glancing, block, crit) rolled as one table or independently; mitigation rows with penetration and curves; ratings; damage kinds |
| F15 | **Cooldown model**, as auras                                                                                                                        | ability cooldowns, cooldown reduction, `resets` (Overcharge refunding the dash), attack-clock intervals rescaled by haste                                                                                                                                                    | the basic model plus resets and rescaling; no global cooldown, categories or charges                                                                              |
| F16 | **Cast rules** in `canCast` and the timeline                                                                                                        | range and line-of-sight gates (horde `range` / `sight`, sentry placement), refusals and retries, freeze or stun pausing a creature's cast, death cancelling it, an elite's enrage withdrawing its own telegraphs                                                             | gates, pause and cancel; no pushback or school lockouts                                                                                                           |
| F17 | **AI toolkit**: a timed event scheduler (TrinityCore's `EventMap` / `TaskScheduler`), one weighted anti-repeat spell picker, a focus                | the elite, Warden and Archmage brains; three copies of the weighted picker; the Warden's named timers (`nextExecute`, `nextRaise`, `nextCharge`…)                                                                                                                            | the scheduler, the picker and a focus; movement generators are the game's (the review after F21 dropped the movement intent)                                      |
| F18 | **Pets and summons**: ownership, stat inheritance, despawn with the owner, follow or assist                                                         | the Engineer's sentry; the adds raised by the Gravecaller, the Warden and the Archmage (`summonedBy`)                                                                                                                                                                        | ownership, credit, lifetime and bounds, on top of area triggers                                                                                                   |
| F19 | **Creature scripts** (TrinityCore's `ScriptedAI` / `BossAI`, with SmartAI's data form): phases, named timers, summon lists, hooks, movement intents | the elite step (grace, enrage at half health, shared cast budget), `stepWarden` (three health phases from the wave config, War Cry, named timers, soulfire), `stepArchmage` (health phases, Circle of Fire, blink, repulse and barrage timers, add refills), the horde brain | the whole module (§II.3.12); no evade, leash or instance encounter state (deferred with threat)                                                                   |
| F20 | **Ranks and variants** (§II.6 S1; no spellbook)                                                                                                     | `player.ranks`, `acquireCard` hooks by id, re-arming passives on revive                                                                                                                                                                                                      | owned spells with rank and variant; learn, restack, re-arm                                                                                                        |
| F21 | **World scripts** (§II.6 C11)                                                                                                                       | all seven map events, supply and buff timers                                                                                                                                                                                                                                 | scripts owned by the world; the director, formations, pickups and loot stay game systems on the hatches                                                           |

As built: **F11** is `spellweave/combat-log` (§I.6 Combat log), with the damage meter as its first subscriber (§II.6 D2's F11 side). It records what the systems raise today; a miss, a dodge or a parry becomes an entry when F14's roll table gives blows those outcomes, and a game's own entries (loot, a wave) stay its own stream.

As built: **F12** is `spellweave/conditions` (§I.6 Conditions, §II.6 M3's and M8's F12 sides). The condition and value tables moved there from `modifiers`; modifiers and triggers take any condition in `when`. Targeting and AI read it when they are built (F16, F17), through `compileCondition` and `bindCondition`.

As built: **F13** is `spellweave/units` (§I.6 Units): templates, spawning with snapshotted stats, the lifecycle and its events, states derived from aura tags (`defineUnitStates`, `canAct`, `canMove`), stat folding for every unit, the resource policy, the damage host, the trait-driven force stage and application rules by class. A unit's auto-attack is optional: most heroes have none, their attacks being the spells they own (F20). Factions are sides, which the world's `isFoe` rule tells apart (different sides by default; since the review after F21).

As built: **F14** is the roll table in `spellweave/damage` (§II.3.14): outcome rows in one `roll` stage, replacing the separate block and crit stages and the `unblockable` flag. A dodge, a parry and a miss now reach the combat log as `avoided` blows with their outcome.

As built: **F15** completes the cooldown model on F9's slot cooldown auras: `timeLeft` scales or caps what is left of every aura carrying a tag (a cooldown reduction, a refund, a cap) keeping its duration, and clock rescales reach the spell system (`spells.rescaleClocks`, the `rescaleClocks` proc, and the aura system's rescale on an aura's edges). A cooldown reduction stat is a scaled cooldown (`scaled(8, amp('cooldownFactor', 1))`), not a system of its own. No global cooldown, categories or charges, as the tier says.

As built: **F16** puts the cast rules in the cast order and the timeline. A spell's `reach` (or an `ai` activation's `range` and `sight`) is checked right after its target: out of `range`, out of `sight` (the static world's `lineClear`) or no room at the point (`clearance`, the Sentry's placement) refuses the cast with that reason, which an `auto` clock answers as no target (a swing polling its reach every step, or, since the review after F21, waiting at zero on its activation's `ready` while the game's own distance says it is out of reach, attempting no cast); `spells.check` asks the whole cast order without starting anything, for F17's picker. The aura host's `onTagsChanged` lets the unit system raise its states' interrupts (each state names its own since the review after F21: `stunned: { …, interrupt: 'stun' }`; `units.syncStates`), which each cast answers as its timeline says, and a caster holds them (`spells.isInterrupted`); a unit leaving life has every cast cancelled (`spells.cancelAll`). An area trigger's `bound.pausedBy` suspends it while its owner holds one of those interrupts, so a frozen caster's telegraphs pause even after the cast ended, and the `despawnOwned` proc withdraws a unit's tagged area triggers and its delayed lists that have not landed (`spells.withdrawDelayed`): an elite's enrage withdrawing its own telegraphs. `castSpell` takes an optional cooldown (an aura), the unit system gains the `revive` proc, and an `auto` clock with `afterCast: 'reset'` waits out its caster's casts and restarts after each. No pushback or school lockouts, as the tier says. A cast started while its caster already holds an interrupt does not answer it: the unit states that interrupt also block acting (`canAct`).

As built: **F17** is `spellweave/ai`, kept small and general: the parts every brain is built from, and none of the brains' own rules. Each unit the unit system spawns gets a brain (`ai.createBrain`, freed on despawn): named timers (`defineTimers`) on one timing wheel, fired in due order by `ai.step` (so a unit with nothing due costs nothing a tick), held by the game (`ai.hold`: an intro, a blink) or while the unit holds an interrupt the system is `heldBy` (a freeze, raised by the unit system's states); a focus (an entity id, set by the game or the `setFocus` proc); and the last pick (a movement intent per brain was dropped at the review after F21: movement is the game's). `ai.pick` is the one weighted anti-repeat picker: each spell of the pool is weighted by the game's `weight` or its activation's, filtered by the game's `allows` (a budget), and checked by `spells.check` (its range, sight and gates), and the last pick is left out while another fits; `ai.first` is the first of an ordered list that would start (a reaction). `setTimer` and `cancelTimer` are procs too, so `setPickDelay` and `resetTimer` are `setTimer` on the game's timers. What a brain does with these (its pick gap and retry as timers it restarts, its reactions' conditions, its budget's claims and releases, its target policy, its movement generators, leashes and leap arcs) is the game's, until creature scripts (F19) give brains a shape.

As built: **F18** puts ownership on the unit system, kept general. A unit spawned with an owner joins its owner's summons (`units.summonsOf`, in spawn order) until it dies or despawns; a bound one despawns with its owner (the `despawned` event's reason is `owner`), and `units.creditOf` credits a summon's deeds up the owner chain, which a game uses as a blow's source. The `summon` proc spawns units of a template for the list's self: a count (or one read at the hit: a raise sized by missing health), at a point, a read point or one picked around the owner through the unit system's world, with stats over the template's and shares inherited from the owner's totals, bound unless told otherwise, and held by the cast whose procs ran, so a cast lives while its summons live. The `despawn` proc ends a unit with a reason, and `despawnSummons` an owner's summons (of a template). A spawn hands the point it asked for to the `spawned` event, for the game's world. Summons that are area triggers (the Sentry) were already owned, credited, limited and bound (F8). Following or assisting an owner is the game's (F17's intent and focus), and so are kept lists that refill (F19's summon lists, built on these procs) and the crowd-cap bypass.

As built: **F19** is `spellweave/scripts` (named `creature-scripts` until F21 showed the same module runs world scripts), and it decides nothing about how a creature behaves (§II.3.12). A script is a list of behaviours, each with its own state per unit and optional handlers: `spawn`; `tick` in the unit's step; `timer`, for the unit's F17 timers, gathered once a tick (`scripts.collect`) and delivered in its own step so casts keep the game's per-unit order; and `on`, for the game's own bus events bound by name to the unit they reach (a blow's target, a dead add's owner). A template names its script; the unit system attaches a record at spawn and frees it at despawn. On the Apple Silicon Mac, stepping 2,000 unscripted units costs 2.0–2.5 µs a tick and 2,000 scripted units with nothing due 4.2–4.6 µs. Phases, picking, reactions, sensors, summon lists, intros, targeting, movement, the wire view and factories are the game's behaviours; the audit of swarm's horde, elite, Warden and Archmage brains maps each of their mechanics onto these hooks and F16–F18's parts.

As built: **F20** is not a spellbook: a spellbook module would copy what a game already keeps (swarm's `player.ranks` and its offer, slot, link and pact rules), and those rules differ from game to game. The spell host gains `rankOf` and `variantOf` (F7's `owns`, which gated every `auto` clock, gave way to arming at the review after F21): a cast whose options name no rank or variant reads the caster's own, so an `auto` clock, a triggered cast and a `castSpell` outside a cast take a card's rank (a chained `castSpell` keeps its parent's). Passives are the game casting passive spells as cards are picked and after a revive (§II.6 S1).

As built: **F21** makes a world script an ordinary script on a bodiless unit, in the same `spellweave/scripts` module (renamed from `creature-scripts` for it): a spawn may name its script in place of its template's, so one bodiless template serves every map event, formation and world clock (`units.spawn(WORLD, { side: 1, script: 'inferno' })`), and the game never adds that unit to its world. Such a unit has everything the framework runs for units: timers delivered in its step, several casts at once, area triggers it owns (a Blood Horde's pools, an Inferno's wall), summons (its rogues, prison walls, a totem) whose deaths reach it through a binding routed to the owner, and a `despawn` of itself when it ends. Behaviours gain `shared` state, made once per script system and kept across instances (Inferno's occurrences, Gravebloom's reserved site, a horde's spell budget), and `scripts.count` and `scripts.instances` say who runs a script, for the director's overlap rules. The director, its concurrency classes and swarm's exposure and placement rules stay the game's.

**The review after F21** (before F22) measured every system against swarm's scale and pruned the API. Performance: a stat read walks the aura gates a bearer holds, not every gated list the game defines; a caster steps only the `auto` clocks it has armed (`spells.arm`); an `auto` activation's `ready` hook lets a swing wait on the game's own distance instead of polling a refused cast; an owner's area triggers step from its own lists; distances are one correctly rounded square root (`hypot`); a bearer's aura step returns at once when nothing on it is due; a template's units share their compiled sheet and base stats; pool handles stay small integers. The API: fields and options nothing read are gone (the `ai` activation's `cooldown` and `budget`, the `event` kind, `UnitDef.rewards` in favour of `data`, the heavy and objective traits, the area trigger silent knobs, core's `Scope`, the core registry's hook tables); crushing is a game stage over the hit's `ext`; a unit state names its interrupt, and the lifecycle enters the aura states of its own names; every proc names its unit `to`; a cast is `retain`ed; clock rescales are one shape; button and slot auras take names. The measurements are in `bench/BASELINE.md`.

Its second half gave swarm the hooks its port needs where the framework had fixed a rule: a blow's knockback takes the blow's `direction` and the damage system's `knock` rule, and the force it makes carries the blow; gates refuse with the game's own reasons (`SpellTypes.refusal`) and `abilities.check` says why a slot may not fire; a unit's `createExt` sees its template and spawn; cast outcomes, area trigger end reasons and force kinds are open to the game's own (registered in `outcomes` and `endReasons`, coded after the framework's), and the world asks the game's `isFoe` which sides fight; a `summon` names its side; the lifecycle is alive, dead and despawned, and entering a bearer state tells every aura (`onState`), one path for every death; `MoveIntent` is gone; an `auto` clock's after-cast wait is one `next(report)` hook. The plan's gaps closed with it: `after`'s `bound`, the unit and AI kinds in the escape report, a `spell` filter on blows and kills, the `force` proc (`push`, `pull`), `onOutgoingDamage`, frozen script behaviours, a whole-game horde bench and a CI bench job. A despawned unit now gives its auras back to their pool (`auras.release`), a leak the whole-game bench found.

The coverage audit (§II.6) widens F1–F19 as well: each catalogue entry names the phase it lands in, and a phase is not done until its entries are. Each is proven by its own unit tests, like the phases before it (§I.7.0). F19's cover, with fake hosts: the phase jump across several thresholds in one blow, phase auras swapped and casts interrupted on entry, timer order on the wheel and keyed intervals independent of other creatures, `whileBusy` and pausing auras, summon refills and despawns, factory merging, and registration-time validation.

**Tier 1, deferred** (no consumer yet; each has a reserved place):

| Feature                                                                                                              | Where it would go                                                                                          |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Power resources (mana, energy, rage, combo points), costs and regeneration                                           | an aura-backed resource with a `value`; costs on the activation (`AbilityDef.cost` already exists, unused) |
| Global cooldown, category cooldowns, charges                                                                         | more cooldown auras and activation fields (F15)                                                            |
| Cast pushback, interrupts with school lockouts, cast-while-moving                                                    | the timeline's interrupt rules (F16)                                                                       |
| Combat enter and leave, evade                                                                                        | a creature-side module read by the AI toolkit (F17); the Archmage's leash is a movement intent (C9)        |
| Full factions and reactions (hostile, friendly, neutral)                                                             | the unit model's side (F13), which the world's `isFoe` rule reads                                          |
| Helpful or harmful auras, dispel categories, uniqueness per caster, removal on damage, movement or cast, aura states | aura fields and rules (F3)                                                                                 |
| Procs per minute, more proc moments (on hit taken, on cast finished, on periodic tick)                               | trigger options and bus events (F4)                                                                        |
| Server-authoritative splines and knockback arcs                                                                      | a movement module beside the AI toolkit (F17); leap arcs and leashes are the game's movement (§II.6 C9)    |

**Not planned: threat tables and taunt.** No WoW-style aggro. Creatures choose targets through target policies (F17, §II.6 C5): nearest, sticky focus, lowest health, or a game's own. Combat numbers come from the curves of §II.3.13 and §II.3.14. A game that ever wants aggro writes it as a target policy on the escape hatches (§I.5.6).

**Tier 2, progression** (optional framework modules, when a game needs them): items and equipment (templates, slots, item stats and set bonuses as auras, inventory, currencies, vendors); group loot rules; talent trees as passive auras; achievements as event-driven criteria; quests (objectives tracked from events, conditions, rewards); spawn groups, pools and respawn timers. Loot tables, levels and XP, card drafts, pickups and an events calendar also belong here: swarm writes its own on the escape hatches (§I.5.6), and they become framework modules only if a second game needs them. Diminishing returns became the aura application policy (§II.6 A2).

**F22. Documentation, after every implementation phase.** Once F0–F21 are done, the project gets a `docs/` folder with **one short document per system**: `core.md`, `math.md`, `modifiers.md`, `auras.md`, `triggers.md`, `procs.md`, `cues.md`, `damage.md`, `spells.md`, `area-triggers.md`, `world.md`, `abilities.md`, `ai.md`, `scripts.md` (creature and world scripts), `units.md`, `prediction.md`, `replication.md`, `escape-hatches.md` (the seven hatches, with one example each), plus `docs/README.md` as the index and the one-page model (spell, aura, proc, area trigger, script, unit).

- **Short and succinct.** Each document fits on a screen or two (about 150 lines at most) and follows one template: what the system is for (two or three sentences), its concepts, a minimal example, the guarantees it pins (order, clocks, randomness, parity rules), how a game extends it, and pitfalls. Reference detail stays in the `/** */` blocks, which the documents link to rather than repeat.
- **Examples compile.** Every example is a `.ts` file under `docs/examples/`, typechecked and linted with the rest, and included in the Markdown; none is written only in prose.
- **Kept true.** Review holds that every system under `src/` has a document, that no document links to a missing export and that every example typechecks; the documents are formatted by Prettier like the code.

**Tier 3, server infrastructure** (a separate server-side project or package beside the framework, never its core): interest management (area-of-interest grids, per-field visibility for owner, party and public); maps, instances and phasing; persistence with versioned migrations; content loading, validation and hot reload; server-side input validation and anti-cheat; party, raid, guild and chat. Party membership is the one piece the core needs, for `hears: 'party'` and later loot, and it takes it as a host fact.

## I.8 Afterwards (not in this project's first milestone)

Once the framework is ready, swarm consumes it from the outside, as any other game would, and only ever straight from the source (it is never published, §I.2):

- **During development**, as a `file:` dependency on the sibling checkout (or `npm link`) from swarm's `packages/game`.
- **Once it settles**, as a git dependency on `st0ianmarius/spellweave` pinned to a commit.

Swarm's `packages/game` then moves onto it in the phases of §II.5, each held by the game's goldens, with every behaviour of its own that the framework's defaults do not give written on the hatches (§I.5.6): modifiers and auras first, then triggers and procs, cues, spells and area triggers, abilities, creatures. `packages/protocol` and `packages/sync` adopt the replication contracts when the area trigger schema unifies. Swarm's own `effects/`, `modifiers/`, `triggers/`, `cues/`, `abilities/` and `spells/` folders then shrink to content. Swarm's older TypeScript config needs no change to consume the framework's emitted `dist/` and declarations.

## I.9 Decisions

1. **The name: decided, `spellweave`.** Repository `spellweave`, package name `spellweave` (a private package, never published), with room for sibling packages (`@spellweave/server`) later. Wherever this plan says "the framework" or `<name>`, read `spellweave`.
2. **Shared types: decided.** The framework owns `Vec2` and its ids and depends on nothing. `@swarm/types` stays swarm's wire types, and swarm adapts at the boundary.
3. **Physics: decided, it stays out.** Swarm's `packages/physics` (Havok) stays out; the framework asks the world through `WorldQuery.sweep` / `lineClear`. A later `framework-physics` adapter could implement `WorldQuery` over Havok for any game.
4. **Navigation: decided, it stays in swarm.** The flow field and mob navigation are fairly generic, but they are grid- and arena-shaped; they stay in swarm and are a candidate for a later framework module.
5. **How it ships: decided, it does not.** It lives in `st0ianmarius/spellweave` (MIT) and is never published to npm, GitHub Packages or any other registry (§I.2). Consumers take it from the repository or a local folder (§I.8).
6. **The keyed-roll mixer: decided, 32-bit.** A Murmur3-finalizer chain over 32-bit integers, using only `Math.imul`, `^`, `>>>` and `| 0`, so it is fast and identical on every platform, with no `BigInt`. Each key part (seed, the stream's salt, then the key's integers in order) is folded in as `h = fmix32(h ^ mix(part))`, with `mix(k) = Math.imul(rotl(Math.imul(k, 0xcc9e2d51), 15), 0x1b873593)` and `fmix32` the Murmur3 finalizer. The result is divided by 2³² for a float in `[0, 1)`. Non-integer or out-of-range key parts are rejected. Once content depends on it the mixer is frozen: F1's unit test holds a literal table of rolls for fixed keys, and any change to the mixer fails it.
7. **Generic first, swarm on the hatches: decided.** The framework is built for MMO-like games in general (§I.1). It has no swarm modes and no tests whose expectations come from swarm (§I.7.0); swarm keeps its exact behaviour in its own code on the escape hatches, and the framework guarantees a hatch for each such behaviour (§I.5.6). Decision 16 of §II.7 applies it to the migration.

# Part II. The model: the Spell API

_Definitions carry no id: the name is the key they are registered under (`createRegistry({ tempest, cyclone })`), the id is the number the registry gives them (§I.5), and code that needs a definition refers to the object itself (`spawn(cyclone, …)`). Any visual or text a sketch mentions belongs to the client (§I.5.3). Written against swarm's code (the co-op ARPG this framework comes out of) from a survey of every Arsenal weapon, hero ability, creature spell and map event in it. Its porting tables (§II.4), migration phases (§II.5) and coverage catalogue (§II.6) are swarm's porting guide; the model (§II.1–§II.3) is the framework's. Where a sketch or an entry names a swarm rule the framework's defaults do not give, swarm keeps it in its own code on the hatch named (§I.5.6)._

## II.1 The idea

A **spell is the container that orchestrates every other system.** It says who may cast it and when (activation), how strong it is (stats and modifiers), where it goes (targeting and shapes), how its cast unfolds in time (a timeline), what it leaves in the world (area triggers), what it does (procs), which states it lands on units (auras, our `effects/`), what it listens for while it lives (triggers), and how it looks (cues and replicated views). The other systems stay small and single-purpose; the spell is the one place that ties them together.

At the end everything is one of three things, as in WoW, where talents, racials, set bonuses and item effects are all spells applying passive auras:

- a **spell**: what a unit or the world does (a weapon, an ability, a creature attack, a map event, sealing a pact);
- an **aura**: what a unit has (a buff, a debuff, a status, a pact, later a passive card), with its modifiers and its procs;
- a **proc**: what happens, returned by a spell's hooks or fired by an aura on its events.

Area triggers (what a spell leaves in the world) and cues (how it looks) complete the picture, and a **creature script** (§II.3.12) decides when a creature casts which spell, how it moves between casts and how its fight changes as it goes.

| System               | Answers                                               | Today                                                                                                                                                          | In this plan                                                                                                              |
| -------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Activation**       | who pulls the trigger, and whether they may           | attack clocks, `AbilityDef`, four creature brains, the director                                                                                                | one `activation` block per spell; brains only pick                                                                        |
| **Stats**            | how strong                                            | `weaponStats`, class constants × `abilityArea`, four `*SpellDamage` helpers                                                                                    | `stats(ctx)` per cast, fed by the modifier fold with spell tags as scopes                                                 |
| **Targeting**        | where and at whom                                     | a dozen resolvers (`resolvePrimaryAttack`, `densestCluster`, placements…)                                                                                      | shared queries on `ctx`, used by the `target` hook                                                                        |
| **Timeline**         | windup, tracking, release, channel, recover, cancel   | a stage machine per creature family, `game.strikes`, per-card queues                                                                                           | one cast state machine run by the Spell System                                                                            |
| **Area triggers**    | what persists in the world                            | 20 bespoke arrays and fields (`glaives`, `tempests`, `sanctuaries`, `hazards`, `frostField`…)                                                                  | one store of spell objects with hooks                                                                                     |
| **Procs**            | what happens                                          | procs for spells, `TriggerAction` for triggers, direct `Game` calls everywhere else                                                                            | one vocabulary for spells, area triggers, effects and triggers                                                            |
| **Auras**            | timed states on a unit (WoW auras: buffs and debuffs) | `effects/`, heroes only; creature statuses are bespoke fields; Cheat Death and the Sanctuary are special cases in `hurtPlayer`                                 | `effects/` on any unit, with hooks into the damage pipeline (§II.3.8)                                                     |
| **Triggers**         | when something reacts to an event                     | data procs on 10 hero events, from three sources (classes: empty; pacts: Bloodbound; effects)                                                                  | owned by auras only (§II.3.11): the trigger layer becomes the machinery that runs an aura's procs on events               |
| **Cues**             | that something should be seen or heard                | 28 cue ids plus ~60 raw `emit` sites                                                                                                                           | every spell moment names a numeric cue id with numeric params; the client's cue table is how it looks and sounds (§I.5.3) |
| **Creature scripts** | when a creature casts what, and how a fight unfolds   | `stepWarden`, `stepArchmage` and the elite step: hand-written stage machines with named timer fields (`nextBlink`, `nextRaise`…), phase checks and add refills | one script per creature: a list of behaviours whose hooks return procs, the logic the game's own (§II.3.12)               |

## II.2 Rules the API keeps

- **Hooks are functions returning data.** A hook reads the world through `ctx` (queries, stats, its own state) and returns procs, or applies them one by one through `ctx.apply` when it must see a result before its next choice (§II.6.1 rule 2). It may mutate **its own** cast or area trigger state (like a reducer's local state); it touches the world **only** through procs. That one rule makes spells testable, replayable and predictable.
- **Procs are the what, triggers the when.** A proc is one outcome with an optional `chance`; a trigger is a listener with conditions and an internal cooldown that answers with procs. Spell hooks are triggers scoped to one cast.
- **Everything is ordered and seeded.** Procs apply in the order returned. Randomness comes from named streams on `ctx`, and an always-proc rolls nothing. Area triggers tick in a pinned kind order, then in creation order. A game moving onto the framework holds its behaviour with its own goldens (swarm records one before each family moves, §II.5).
- **Data where it is described, functions where it is decided.** Anything a card or tooltip explains (a trigger's `do`, a pact's procs) stays plain data, which the framework turns into structured explanations and the client into words (§I.5.3). Spell hooks are functions that return that data.
- **Escape hatches are part of the API.** What fits no primitive is game code on a declared hatch (§I.5.6), deterministic and counted, never a branch in the plumbing.
- **Mirror-safe by type.** A hook the co-op client runs gets a narrowed context (`MirrorCtx`: caster body, input, synced stats, static collision) and must not roll or read server state. The compiler enforces that, not a test.

## II.3 The shape of a spell

```ts
export const tempest = defineSpell({
  tags: ['arsenal', 'area', 'wind', 'summon'], // modifier scopes, trigger filters, class of the spell
  activation: { kind: 'auto' }, // the attack clock reads stats.interval
  stats: (ctx) => ctx.weaponStats('tempest'), // one snapshot per cast
  release: (ctx) => range(ctx.stats.count).map((i) => spawn(cyclone, { heading: spreadHeading(ctx, i) })),
  cues: {
    cast: (ctx, spawned) => ({
      cue: 'tempest.cast',
      at: spawned,
      radius: ctx.stats.radius,
    }),
  },
});
```

### II.3.1 `SpellDef`

```ts
interface SpellDef<Stats, Target, CastState> {
  // no id field: the registry assigns a numeric, branded SpellId by key order (§I.5)
  tags: readonly SpellTag[]; // 'arsenal' | 'ability' | 'creature' | 'area' | 'projectile' | 'fire' | 'frost' | …
  activation: Activation; // §II.3.2
  stats: ScaledTable<Stats> | ((ctx) => Stats); // numbers for this cast: scaled values with ratios (§II.3.13), or a function
  scaling?: { [stat in StatId]?: number }; // its share of each outgoing multiplier stat, 1 by default (§II.3.13)
  live?: true; // hooks read stats live each tick instead of the snapshot (Hexfire today)
  canCast?(ctx): boolean; // the gate after the activation's own (Whirlwind suppresses Cleave; a 24-brand cap)
  target?(ctx, input): Target | undefined; // undefined refuses; `predictable` runs on the mirror
  timeline?: Timeline<Target, CastState>; // windup, track, channel, recover, cancel (§II.3.3)
  begin?(ctx, target): Proc[]; // the windup's start: telegraphs, caster motion
  release(ctx, target): Proc[]; // the payload
  onHit?(ctx, hit: Hit<Target>): Proc[]; // any delivery of this cast caught targets, all in one call
  onEnd?(ctx, outcome: CastOutcome): Proc[]; // 'released' | 'cancelled' | 'broken' (tether) | the game's ('blocked': a charge)
  castAura?: AuraRef; // held by the caster while the cast runs: its triggers are the spell's own (§II.3.7)
  cues?: CueMap; // named moments → cue + params (§II.3.9)
}
```

`ctx` (`SpellCtx`) carries the caster, the owner credited with the damage, the stats snapshot, the cast (target, `shared` state for every delivery and area trigger of the cast), time and dt, rank and legendary flag, the queries (§II.3.5), and named random streams (`ctx.random('main' | 'volley' | 'horde' | 'proc' | …)`).

As built (F7): `ctx` is the pooled cast itself (`SpellContext`), which a hook reads while it runs and never keeps; a delayed proc keeps the cast alive instead. `ctx.stats` holds plain numbers (each value's caster part), and `ctx.scaled` the same values as proc amounts, snapshots whose target terms the `damage` and `heal` procs finish at the hit (§II.3.13). A cast's keyed-roll key is `ctx.key(targetId, index)`: `(startTick, casterId, spellId, targetId, index)`, which a keyed stream of the host's table draws over. The cast order is fixed: the host's `canAct` and the activation kind's gate, the stats, `canCast`, the target, then `begin` and the release; each refusal is reported with its reason. The target hook's context leaves its target `unknown`, so a spell's target type is inferred from what the hook returns.

### II.3.2 Activation: who pulls the trigger

The spell never runs its own clock; the activation says which system does, and carries that system's rules as data.

| kind      | pulled by                                             | carries                                                                                                                                                                        |
| --------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `auto`    | the attack clock (Arsenal)                            | the interval comes from `stats`; a `next` that retries a miss (Cleave); `aimed` rewinds when the hero aims                                                                     |
| `button`  | a hero's key (every class ability)                    | what `AbilityDef` has today: cooldown effect and `startsOn`, cost, `requires` / `blockedBy`, `applies`, `resets`, `activate` / `travel` (the motion half the mirror runs), cue |
| `passive` | owning it (Ember Blades, Serpent Coil, Cheat Death)   | an area trigger attached to the owner, or an aura on them, for as long as the card is owned                                                                                    |
| `trigger` | a trigger event (an aura's "on kill, cast…")          | the event, conditions, charges, internal cooldown                                                                                                                              |
| `ai`      | a creature brain                                      | windup, lock, recover, cooldown, range, sight, budget, `weight(ctx)` for situational picking                                                                                   |
| `event`   | the wave director (Inferno, Venom Flood, Detonation…) | min/max wave, weight, overlap rules                                                                                                                                            |

`button` absorbs `AbilityDef` whole: an ability **is** a spell whose activation is a button. The motion half (`activate`, `travel`, `applies`, `resets`, cost, cooldown) stays pure data plus pure functions on `AbilityBearer`, so the mirror keeps running it exactly as `tryActivateAbility` does now.

As built (F9): the button's data lives on the spell (`ButtonActivation`) and the ability system (`createAbilitySystem`) compiles it; slots are declared by the game with a cooldown aura each (swarm's `cooldown.<slot>` tags go on those auras), and loadouts live on the bearer. A press is a mask of slot bits, decided before any slot fires; each fires in slot order and casts its spell last, so a spell with no windup releases inside `tryActivate`, before the game's `travel` moves the bearer (Blink's departure point), and its cast carries the tick it started on (`startTick`), which the game's lag compensation reads. The trigger path is `abilities.trigger` and the `useAbility` proc: a trigger that casts a button spell with its rules uses it, since `castSpell` casts the spell alone. A cast refused after a press has still fired: an `activation` cooldown has started and the cost is paid, as swarm's; a `cast` cooldown starts only when the cast was not refused.

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
    stun?: 'pause' | 'cancel';
    freeze?: 'pause' | 'cancel';
    death: 'cancel';
    phase?: 'cancel';
  };
  onCancel?(ctx, target): Proc[]; // e.g. withdraw its own unfired telegraphs
}
```

- **The Spell System runs the timeline**, not the brain: it counts the windup, calls `track` each frame until the lock, releases, runs the channel, recovers, and reports the outcome. The brain picks, starts, and reads `ctx.cast.stage` for its movement (holding ground, facing). Stages are stepped per caster (`spells.step(caster)`, in the order the caster's casts started), not on the timing wheel, so the game keeps its own per-unit order and a paused cast simply does not count down (§I.5.4). A windup may also cancel itself (`cancelIf`), the recovery reads the outcome (a break staggers longer), and `spells.pause`, `resume`, `cancel`, `finish` and `interrupt` are the hooks F16's cast rules build on.
- **`track` is a function**, so all three tracking rules in the code are helpers returning one: `lockBefore(seconds)` (horde, elites), `lockAtShare(share, turnRate)` (Warden), `lockAtStart` (Archmage explosion). A cast's own telegraphs are handles on the cast, so tracking moves or rotates **all of them** (the elite lance fan) rather than one hazard id.
- **Channels** cover every "active" stage: a charge (the caster moves each tick, and `onBlocked` ends the cast as `blocked` for a stagger), a whirlwind (moving pulses), a tether (`breakIf` the target leaves 8 m of the origin), the Archmage's Arcane Circle (a channel whose clock is an area trigger).
- **Chains** are procs: Cleave's release returns `castSpell(stab)`; a Warden charge that did not hit a wall returns `castSpell(charge, { windup: 0.45 })`.

### II.3.4 Area triggers: what persists in the world

An **area trigger** (the name is WoW's) is a spell object with a position, a shape, a lifetime and hooks: WoW's AreaTrigger / DynamicObject / missile, Unreal's spawned actor plus ability tasks. Hazards, projectiles, cyclones, wells, domes, fields, patches, falling hammers, sentries and the Serpent Coil's ribbon are all area triggers. The name says where it lives, not what it listens to: an area trigger is not a trigger (§II.3.7, the event listener an aura owns), and the two are never shortened to the same word.

The line between the two persistent things: an **aura sits on a unit** and goes where the unit goes; an **area trigger sits in the world**. An area trigger may hand auras to the units inside it (the Sanctuary's shelter, a field's slow), and what it does to the world itself (eating hostile shots, pushing creatures out) stays in its `frame`.

```ts
interface AreaTriggerDef<State, Stats> {
  shape(c): Shape; // circle | ring | cone | lane | polygon | point (§II.3.5)
  lifetime(c): number | 'owner' | 'spent'; // seconds, while the owner lives, or until a hit budget is spent
  bound?: Bound; // what ends it early (owner standing or present, source alive, a condition), or suspends it; its end cue fades or is none
  anchor?: 'world' | 'owner'; // an owner-attached area trigger moves with the hero (Ember, Coil)
  limit?: { perOwner: number; replace: 'oldest' | 'refuse' }; // one frost field, one grove, one sentry, 12 patches
  tickIn: TickSlotId; // a slot the game declares; the host steps it where its loop needs (§II.6.1 rule 1)
  init?(c, spawn): void; // after the host allocates the id (§II.6 W4)
  onEnd?(c, reason: EndReason): Proc[]; // every end: expired | spent | self | bound | replaced | source-gone
  // The one primitive: a frame, in one pass, returning procs. Everything below is sugar over it.
  frame?(c, dt): Proc[];
  move?(c, dt): void; // own motion (steer, home, bezier, orbit); may sweep and report contacts
  every?: Pulse[]; // { seconds, clock: 'own' | 'owner-shared' | 'global', hits?: Shape, pick?: 'all' | 'hottest', onPulse }
  onContact?(c, targets): Proc[]; // swept contacts along this frame's move (missiles, blades, waves)
  onLand?(c, targets): Proc[]; // a delayed area trigger lands (a telegraph firing, a hammer, a falling arrow)
  onExpire?(c): Proc[]; // the fling, the collapse, the dome's burst
  auras?: AreaAura[]; // auras it keeps on the units inside: applied on entry, removed on exit (§II.3.8)
  caster?: SpellRef; // an area trigger that casts its own spell on its own clock (the sentry)
  replicate?: ReplicaSpec; // §II.3.9
}
```

- **One `frame` hook is the primitive**, because some spells must interleave work per enemy in one pass (Tempest: tick, then pull or fling, enemy by enemy, with Maelstrom's candidates gathered before any pull). The declarative parts (`move`, `every`, `onContact`, `onExpire`) are built on it for the common cases.
- **Hit policies are data, not code:** `once-per-cast` (Glaive, Spark, the Knight wave), `repeat-share` (Searing Arrow's 25%, a volley's 50% via the cast's `shared` set), `rehit-cooldown` (Chakram's crescents), `pierce` and `budget` (shots, Glaive), `hottest-per-owner-clock` (Searing patches, Coil nodes), and `none` (Tempest ticks, Ember Blades).
- **Spawning** is a proc, `spawn(def, init, { now?: dt })`. `now` lets a child fly this frame with the parent's leftover time (Glaive forks); without it the child starts next frame (Chakram crescents). Children may share state by reference (the crescents' `passes`).
- **Delayed procs** are the lightest area trigger: `after(seconds, procs, { bound: isStanding })` (the game's check of the owner). They cover Searing Arrow's fall, Judgement and its aftershock, Hexfire's pop, Galeheart's strike, the Druid flask's two stages, the Warden's second barrage, the Archmage's second comet volley, and staggered explosion patterns. The credit (owner, damage source) and the stats are captured at the cast and restored when it lands.
- **Tick order is pinned:** within a slot, kind order (today's `CARD_MECHANICS` order for the Arsenal, then abilities, then creatures, then events), then creation order within a kind, with `after-parent` insertion where a child must follow its parent. `wire-order.test.ts` grows to hold it.
- **The rest of the contract** (self-despawn, suspension, timing modes, pulse rescheduling, owner-shared clocks, named hit ledgers, target-locked contact, queries over area triggers, exposure, blockers) is catalogued in §II.6 W1–W9.

As built (F8): an area trigger's hooks receive the pooled record itself (`AreaTriggerContext`), read while they run and never kept (they keep its handle): its owner and credit, its cast (held alive until it ends) with the cast's rank, stats and proc amounts, its input, its own `position` and `heading` to move, its placed `shape` (the kind's shape, relative to the area trigger, placed at its position and turned to its heading after its own motion each frame), its age, time left and `state`, `apply`, `random`, a keyed-roll `key(targetId, index)` of `(spawnTick, id, kind, targetId, index)`, `despawn`, `lock`, `ledger(name)` and `areas` (the queries over area triggers). A frame ages it, moves an owner-anchored one onto its owner, places its shape, then (once armed) runs its parts in its kind's order, `['move', 'contact', 'frame', 'pulses', 'auras']` by default, and ends it once a part whose hook asked for it is done; its lifetime counts down around the frame as its expiry mode says, and on expiry it lands (`onLand`), then `onExpire`, its end cue unless silent, `onEnd`, the `ended` event. What spawns during a step (or from a cast between steps) first ticks on the next tick, unless it flies `now`. A shared pulse clock counts down in the step of its first member to step each tick and beats every member at once from there, so a unit several members catch can go to the hottest only. Every catch (a contact, a pulse, a landing) names the hit ledger it records in; a ledger is the area trigger's own, its cast's or its family's (shared with the children it spawns), and a `claim` is held until its holder ends.

### II.3.5 Shapes and queries

`ctx.query` is the one read API (pure, no side effects), shared by heroes and creatures, so every targeting resolver in the code is one call:

- `inside(shape, { side, filter, order })`: `side` is `'foes' | 'allies' | 'all'` relative to the caster, so a spell written for a hero works when a creature casts it.
- `nearest(from, range, n, { distinct, exclude })`, `densest(from, range, radius, excluded)` (Singularity, Tempest, Chakram), `chain(from, jumps, range, falloff)` (Spark's links, one at a time through `ctx.apply`; Hexfire's leap is `nearest` with an unbranded filter), `sweep(from, to, radius)` (missiles, charges, waves), `lineClear`, `placement(input, { range, walls, snap })`.
- `positionOf(target)` is rewound only while the cast is aimed and in its cast frame, and it returns copies, never scratch. `velocityOf(target)` supports leads (`leadPoint(target, speed)` replaces `archmageLead` / `predictedBlast`).
- Every query takes the options of §II.6 W10 (centre or edge distance, inclusive bounds, id tie-breaks, filters, `minSeparation`), and the world also answers `isPositionClear`, bounds and `clamp`, a body sweep against static geometry, a sample-and-score point picker, and queries over area triggers.
- As built (F8): a list query writes into the caller's array from index 0 and returns how many (`world.inside(shape, { side: 'foes', of: caster }, out)`), orders by `near`, `far`, `id` or the game's score, several keys compared in turn with lower ids on ties, and allocates nothing once warm; `densest` writes into a reused cluster; the area trigger queries live on the area trigger system and on `c.areas` (`coveredBy(point, { tag })`, `intercept(segment, { tag }, out)`).
- Shape builders return data and carry their position, defaulting to the origin (an area trigger's shape is placed at its position): `circle(r, at?)`, `ring(inner, outer, at?)`, `cone({ r, half, dir, at?, apex? })`, `lane({ length, width, dir, at?, back? })` (one options object each, within the three-parameter rule), `polygon(points, band?)`, `point(at)`, `outside(shape)`, `union` and `difference`, and patterns (`linePoints`, `ringPoints`, `crossPoints`, `eruptionLine`) that return point lists with a stagger.

### II.3.6 Procs: one vocabulary

The same kinds serve spell hooks, area trigger hooks, effect lifecycles and trigger `do` lists. A new kind is one file, one registry line, and (if it touches the world) one host method taking its data.

| group         | kinds                                                                                                                                                                                                                                                                                                             |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| deliveries    | `areaHit` (any shape), `shoot` (either side, pierce, repeat share), `telegraph` (any shape, `onLand` → the spell's `onHit`), `spawn`, `after`                                                                                                                                                                     |
| on a target   | `damage` (hero or creature: amount, knock or `'none'`, strength, crushing, unblockable, lethal, horde, environmental), `heal`, `applyEffect` / `removeEffect` (heroes and creatures, with an optional `value`: the barrier is `applyEffect(barrier, { value, duration })`), `pull`, `push`, `teleport`, `despawn` |
| on the caster | `move` (dash, leap flight, teleport), `face`                                                                                                                                                                                                                                                                      |
| world         | `summon` (raise dead, adds, prison walls), `cue`, `castSpell`, `grant`, `event` (raise a trigger event)                                                                                                                                                                                                           |
| control       | `group` (several procs behind one `chance`), `run(name, fn)` (the last-resort escape hatch, named and counted, §I.5.6)                                                                                                                                                                                            |

Everything hard-coded by spell id in the engine today moves onto proc data: `HEAVY_HAZARDS` and `HEAVY_BLOWS` become `strength` and a crushing share in the telegraph's damage `ext` (read by swarm's own crushing stage), the frost nova's slow becomes an `applyEffect` in its `onLand`, the repulse knock becomes the proc's `knock`, the elite volley's unblockable becomes the shot's flag, and `blast`'s heavy-spell list becomes `strength`. The four `*SpellDamage` helpers become each family's `stats` (base × share × family dial).

### II.3.7 Triggers and events

- **Trigger `do` lists become procs** (data form). A trigger keeps its own `chance`, rolled before its internal cooldown so a failed roll never starts it; a proc may carry a `chance` of its own, and a trigger that fires several things all or nothing wraps them in a `group`. Procs in a trigger target `self`, `eventUnit` or `party`. `TriggerAction` goes away; `castAbility` becomes `castSpell`.
- **The Spell System raises spell events on the bus:** `start`, `release` (the plan's `spellCast`), `hit` and `end` (F7; the area trigger system's `spawned` and `ended` came with F8, `spellKill` comes with F13), filterable by spell id, spell tag and outcome (`spellTriggerEvent`). Auras (pacts, buffs, later passives) can then react to spells ("when a Tempest dissipates, cast Chain Lightning from its eye").
- **Spell-scoped triggers live on an aura** (decided at F7), so every trigger stays on an aura (§II.3.11): a spell names a cast aura (`SpellDef.castAura`, of infinite duration), which the caster holds while the cast runs (overlapping casts of it share one), and whose triggers are the spell's own; it comes off before the cast's end event. `AreaTriggerDef` listeners follow the same rule (F8): a kind names an owner aura (`AreaTriggerDef.ownerAura`, of infinite duration), which its owner holds while any instance of the kind lives, and the area trigger system raises `spawned` and `ended` (the plan's `areaTriggerSpawned`, and `areaTriggerExpired` widened to every end), filterable by kind, area trigger tag and end reason (`areaTriggerEvent`). An aura's own procs (§II.3.8) cover the unit-bound cases, such as Hexfire's pop when a branded creature dies.
- **Changing an outcome is an aura's job, not a trigger's.** Triggers react after something happened; anything that absorbs, reduces or cancels a blow, a knockback or a death is an aura hook in the damage pipeline (§II.3.8), as in WoW.

### II.3.8 Auras: effects on any unit

An **aura** is WoW's word for a timed state on a unit: a buff or a debuff. `effects/` already is that system for heroes (tags, modifiers, stacking, immunities by tag, periodic ticks, triggers while active, cues), so the plan widens it rather than adding a second one. Three changes:

1. **Any bearer.** `EffectTarget` covers creatures too: they get an `effects` list, and today's statuses become auras with tags: `frozen`, `stunned`, `rooted`, `slowed`, `chilled`, `invulnerable` (the Warden's War Cry, the Archmage's circle), `hexfire.brand`, `venom.toxin`. Credit rides the aura's `source` (owner and damage source), so a debuff's ticks count for whoever cast it. Resistance and immunity (`freezeImmune`, the elite cap, a boss taking a slow instead, the warrior's shorter control) become the bearer's **application policy**: declarative rules on its unit traits plus an `onIncomingAura` hook that refuse, substitute, scale, cap, arm an immunity window and set magnitudes (§II.6 A2). The wire keeps today's bytes at first: the synced `frozen`, `stunned`, `brand`, `toxin` and `chill` fields become projections of the creature's auras, so the protocol does not move until the replication phase.
2. **Procs through the lifecycle.** `onApplied`, `onRefreshed`, `onExpired`, `onRemoved`, `periodic` and `onState` return procs, credited to the aura's source, with the raise rules of §II.6 A1. A damage-over-time debuff is a `periodic` returning `damage`; the brand's pop is its `onState` of `dead` returning `after(0.15, [areaHit, chain leap])`; the Whirlwind's sweep and Arrowstorm's strikes are their buffs' `periodic` returning `castSpell`, instead of bespoke loops in `Game.step`. Their beats run on a beat clock of their own (world time, `floor(time × 3)` for Arrowstorm) while the buff's life counts on the motion clock, in the attack slot, with catch-up and a last beat on the expiry tick (§II.6 A3).
3. **Hooks into the damage pipeline** (WoW's absorb and prevent-death aura effects). Before a blow lands on a unit, each of its auras with a hook sees it, in registry order, and may change it:

   ```ts
   onIgnore?(ctx, blow): boolean;                       // the ignore stage: invulnerability, shelter, immunity
   onIncomingDamage?(ctx, blow): BlowChange;            // { absorb?: number; scale?: number; knock?: 'none' }
   onLethal?(ctx, blow): { prevent: true; procs: Proc[] } | undefined;
   onDealt?(ctx, blow): Proc[];                         // attacker side: lifesteal spending the aura's value
   onIncomingForce?(ctx, force): ForceChange;           // knockback, push, pull
   ```

   `hurtPlayer` and `hurtEnemy` then carry no card or ability names: they run the bearer's hooks and apply the result. The pipeline's default order is today's (§II.6 D1), and a game inserts its own named stages where it needs them: ignore gates (`onIgnore`: invulnerability, the horde window, shelter, environmental immunity, a downed or disconnected bearer) → the block roll → (the game's crushing stage) → armor and damage taken → absorbs (`onIncomingDamage`) → `onLethal` (Cheat Death) → health → the outcome and the hit window. True damage (lethal, environmental, blood) skips armor and every absorb, as it does now, but `onLethal` still runs for it; environmental damage passes only its own immunity, so fire walls still kill the invulnerable.

4. **An aura can hold a value.** `ActiveEffect` gains `value` (and `ApplyOptions` a `value`): an amount that is not a stack count, such as the health an absorb has left. An aura may declare how two applications merge their values (`merge: 'max' | 'add' | 'replace'`) independently of how their durations stack.

The hard cases, each as an aura:

| case                 | aura                                                                                                                                                                                                                                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hexfire's brand      | a debuff on the creature: `periodic` burn (live stats, as today), `onState` (`dead`) pop and leap, tags for the 24-brand cap and for "unbranded" targeting                                                                                                                                                            |
| Serpent Coil's toxin | a damage-over-time debuff, refreshed rather than stacked                                                                                                                                                                                                                                                              |
| Cheat Death          | a passive buff the card grants while owned, its charges as its value: `onLethal` (even for true damage) prevents the death, returns `setHealth` to a share, `applyEffect(deathEscape)` (the escape window: invulnerability × Duration and a speed boost) and its own recharge cooldown aura (motion clock, predicted) |
| Sanctuary            | the dome is an area trigger tagged `shelter`; every hero's base `onIgnore` and `onIncomingForce` ask `coveredBy(point, 'shelter')` at the blow, and continuous exposure subtracts the dome's time span (§II.6 W5, W6). It intercepts hostile shots before walls and is a keep-out for creatures (W8)                  |

**The barrier becomes an absorb aura.** Today it is two bespoke hero fields (`barrier`, synced; `barrierTime`, server-only) written by Overcharge and Judgement, eaten inside `hurtPlayer`, ticked in `Game.advance` and cleared on going down. As an aura:

```ts
barrier: {
  /** Health it absorbs ahead of HP; a new shell keeps the larger amount and the longer time, as today. */
  clock: 'motion',                 // ticked once per motion step, before the input, as `barrierTime` is now
  stacking: 'highest', merge: 'max',
  keepWhenDepleted: true,          // an emptied shell keeps its clock, so a later shell still takes the longer time
  removedOn: ['down'],
  onIncomingDamage: (ctx, blow) => ({ absorb: Math.min(ctx.aura.value, blow.amount) }),   // spends `value`
  // no absorb cue here: aura cues are lifecycle changes; the damage system's cue mapping fires the absorbed amount
  // (`blow.absorbed`) as an owner-only cue, and the client draws today's private "(−N)"
  // no HUD tile here: the client's AURA_PRESENTATION[AuraId] draws it
}
```

- **One pool, in swarm's content.** Overcharge and Judgement both apply the same `barrier` aura with a `value` and a duration, so the max-of-each rule they share today (`shield` in `spells/procs`, and Judgement's own `shield`) holds exactly. The `shield` proc becomes `applyEffect(barrier, { value, duration })`, and Judgement's duplicate goes.
- **Separate absorbs, later and by choice.** A different shield (an ally's ward, a pact's) can be its own absorb aura with `merge: 'add'` or its own pool, consumed in registry order after the barrier, as WoW spends absorbs one after another. Nothing in the framework forces a single pool; it is swarm's content choice.
- **Everything around it stays exact.** Absorption comes after armor and before Cheat Death; the hit window still opens when the shell eats the whole blow; true damage still skips it; whatever is left still expires with the clock; going down still clears it.
- **The wire.** Step A keeps `PlayerSchema.barrier` as a projection of the aura's `value`, so nothing moves. Step B gives `EffectSchema` a `value` field, drops `barrier` from `PlayerSchema` (freeing one of Colyseus's 64 fields there), and has the HUD read the aura; it rides the same protocol bump as pacts step B.
- **Creatures get absorbs for free**: a boss's shield phase is the same aura on a creature.

Diminishing returns in WoW's sense (categories that halve repeated control) stay out of scope; swarm's own control rules are the application policy above.

### II.3.9 Presentation and prediction

- **Cues everywhere:** every spell moment (`cast`, `release`, `hit`, `pulse`, `land`, `expire`, `fade`) names a numeric cue id plus numeric params in `cues`, or returns a `cue` proc; no hook builds a raw `emit`, and no spell carries a visual (the client keys its visuals by `SpellId` and `CueId`, §I.5.3). The ~60 raw sites migrate by appending to `CUES` (append-only wire).
- **Replication:** an area trigger kind declares `replicate: { fields, rounding }` (`x`, `z`, `heading`, `radius`, `started`, `duration`, `phase`, `evolved`, and a kind-specific extra), or `'events-only'` (Searing Arrow), or `'derived'` (Ember Blades, recomputed from time on the client). At first each kind maps onto its existing schema array (a storage adapter), so the protocol does not move; later one `AreaTriggerSchema` plus a client renderer registry keyed by area trigger kind replaces the twelve per-kind schemas.
- **Prediction without duplication:** the hooks the client may run take `MirrorCtx` (`activation` motion data, `target` when `predictable`, and `cues.cast`). `castVisuals` becomes "run the spell's `cues.cast` on the mirror", so `CAST_VISUALS` and its equality test go away, and the Blink and Overcharge visuals stop being written twice.

As built (F10): a kind declares `replicate` with the fields `x`, `z`, `heading`, `radius` (the reach of its placed shape), `started`, `duration` and `age`, and any entries of its declared `view` as the kind-specific extra; swarm's `phase` and `evolved` are such entries. A kind that declares nothing is `events-only`. `castVisuals` becomes a spell's `cues.cast`: a mirror-safe hook (`MirrorCtx`) returning a predicted cue, which the server fires as the cast starts and the predicting client fires at the press (`spells.predictCast`; an ability system with `mirror: true` does it for every fired slot and casts nothing), both carrying the press's key (`CastOptions.key`, `tryActivate`'s `{ input, key }`). The rest of the mirror side is data and types: `MirrorCtx` for the hooks it runs, `predicted` auras seeded from the views the server already sends, and `checkPredicted`, which a game runs in its tests.

### II.3.10 Scope and credit

Credit travels with the cast instead of in an ambient scope: a cast captures its caster and damage source at its start (`ctx.caster`, `ctx.source`, `CastOptions.source`), every proc list it runs carries them (`ProcOrigin`), and an area trigger keeps its owner and source from its spawn, so a hook reads who acts and whom a hit is credited to from its context. _As built (review after F21):_ the core `Scope` (`withPlayer`, `withDamageSource`) that the plan first sketched was never read by a system and was removed; swarm's own wraps stay in its code until its migration drops them.

### II.3.11 Pacts are spells with passive auras (and triggers live only on auras)

A pact's parts are already an aura's parts:

| pact today (`PactEntry`)                       | as a spell with an aura                                                           |
| ---------------------------------------------- | --------------------------------------------------------------------------------- |
| `modifiers` (+30% damage, −30% maximum health) | the aura's `modifiers`                                                            |
| `triggers` (Bloodbound: on kill, heal)         | the aura's `triggers`                                                             |
| `grants` (Gambler's Oath: +3 rerolls now)      | the aura's `grants`                                                               |
| its buff tile on the HUD                       | the client's tile for the pact aura's `AuraId`                                    |
| sealing it at the Pact Sigil                   | casting the pact's spell, whose release is `applyEffect(pact aura)` on every hero |

So a pact is a spell registered as `glassCannon`, `defineSpell({ activation: { kind: 'vote' /* the game's own kind: the Sigil vote */ }, release: (ctx) => party(ctx).map((hero) => applyEffect(hero, 'pact.glassCannon')) })` plus one `EffectDef` holding its numbers, text and tile. The same rule holds for class triggers: there are none today, and a future one is a class's passive aura.

**One-off grants belong to the sealing spell, not the aura.** Gambler's Oath's three rerolls are a `grant` proc in the pact spell's release; as an aura grant they would be handed out again to every hero who joins mid-run.

**Triggers stop having sources of their own.** Class triggers (`TRIGGERS`, empty) and pact triggers go; every trigger is an aura's, active while the aura is. The trigger machinery stays whole (conditions, internal cooldowns as `icd.<id>` effects, chance, `hears: 'party'`, the depth cap, the prediction rule, card text from `describeTrigger`); it just compiles from one place, the bearer's auras. Trigger ids become `aura.<id>.<i>`, which moves the derived `icd.*` effect ids, so that change lands with the wire change below.

What a pact aura needs that ordinary buffs do not:

1. **Its fold position.** Pacts fold as their own modifier source today (class base, pacts, totem, passives, effects, class states), and multiplications happen in that order, so moving pact modifiers into the ordinary effects slot would move the stat goldens. An aura's `fold` names any source the game declares, so swarm's pact auras fold at its `'pacts'` source, beside the `'classStates'` Enrage and Overcharge already use, and the stat fold stays bit-exact.
2. **Permanence.** `duration: 'infinite'`, kept through going down, reviving and a class change, never cleansed (no removable tag). A pact is a **party fact**: the room keeps the sealed list, and a hero who joins mid-run receives every sealed pact aura on joining.
3. **Sync.** Today the sealed pacts cross the wire as a list of ids (`pact.owned`). As auras they ride each hero's effect list: nine more entries out of the 256 a `uint8` effect id allows. Phase A keeps `pact.owned` as a projection, so the protocol and the pact-offer UI do not move; phase B drops it and bumps the protocol (the hydration test that drops unknown pact ids moves with it).
4. **Prediction.** Quicksilver changes movement speed, so its aura is `predicted: true` and the co-op mirror seeds it like any predicted effect; `tests/effects/docs.test.ts` already derives and enforces that rule.
5. **Card text.** Pact cards print text built from their modifiers and triggers. The framework hands the client the pact aura's structured explanation (§I.5.3); the client phrases it, so the text still follows the numbers.

**Passive cards next, and required.** Might, Haste, Vitality and the rest are the same shape: a permanent aura whose stacks are the rank, folding at `'passives'` (Stride stacks linearly, §II.6 M4). That is the full "everything is a spell and an aura" end state, but it touches the most sensitive golden (the stat fold, every rank) and the card pool's order, so it is its own later phase.

### II.3.12 Creature scripts: scripted creatures and bosses

A **creature script** is where a creature's own logic runs: when it casts what, how it moves between casts, how its fight changes. It takes the place of TrinityCore's `CreatureScript` with its `ScriptedAI` / `BossAI` and of swarm's `step<Boss>` functions, without taking over their shape: the framework decides nothing about how a creature behaves. It gives a creature places to run the game's logic, and the game writes the logic (as built at F19; the fixed `CreatureScriptDef` first sketched here, with phases, reactions, a pick spec, sensors and summon lists as properties, was dropped as too narrow for other games).

```ts
interface Behaviour<G, State> {
  state?(unit): State; // its own state on each unit, made at spawn
  spawn?(ctx): Proc[]; // once, after the unit's spawned event
  tick?(ctx): Proc[]; // in the unit's step, only for behaviours that need per-tick work
  timer?(ctx, timer: TimerId): Proc[]; // one of the unit's F17 timers came due, delivered in its step
  on?: { [event in G['scriptEvents']]?: (ctx, payload) => Proc[] }; // the game's own bus events, bound by name
}

const SCRIPTS = defineScripts<Game>({ hordeCaster: [picking], warden: [picking, wardenPhases, raise, soulfire] });

const scripts = createScriptSystem<Game>({
  registry: SCRIPTS,
  units,
  ai,
  procs,
  bus,
  host,
  events: {
    damaged: { kind: bus.kind.taken, unitOf: (e) => e.blow?.target },
    castEnd: { kind: bus.kind.spellEnd, unitOf: (e) => e.cast?.caster },
    summonDied: { kind: bus.kind.unitChanged, unitOf: (e) => (e.to === 'dead' ? e.unit?.owner : undefined) },
  },
});

// each tick: scripts.collect(), then in the game's per-unit loop scripts.step(unit)
```

- **A script is a list of behaviours**, each a few optional handlers with its own state per unit (`ctx.state`). Composing is concatenating lists: a boss is its own behaviours plus shared ones (`[...eliteBase, enrage]`), with no merge rules.
- **Handlers return procs**, as everywhere (§II.2), run for the unit and credited to it; `ctx.run` runs some before the handler returns. A script touches the world through procs and the game's host (`ctx.host`), so it adds no world API of its own.
- **Three moments, and the game's events.** The framework drives `spawn`, `tick` and `timer`. Anything else a creature reacts to is a game bus event bound once by name with the unit it reaches: a blow's target, a cast's caster, a dead add's owner. A new kind of creature never needs a framework change.
- **Timers keep the per-unit order** (§II.6.1 rule 1). `scripts.collect()` gathers every due F17 timer once a tick onto its unit, and `scripts.step(unit)` delivers them in the unit's own slot of the game's loop, then runs its `tick` handlers, so a Warden's raise lands where swarm's loop has it today. A due timer of a unit with no script goes to the game's own `fire`.
- **Cheap for hordes.** A unit whose template names no script has no record: its step is one field check, about 1 ns. A scripted unit with nothing due and no `tick` handler costs one more field check. Each script's handler lists are built at registration, so only behaviours that declare a handler are called.
- **What stays the game's**, as behaviours written from the AI toolkit (F17), the spell system (F7, F15, F16) and summons (F18):
  - **Phases**: forward-only jumps on a `damaged` event or in `tick`, phase auras through the aura system, a pool per phase.
  - **Picking**: a pick timer, `ai.pick` with the game's `allows` for its budget, restarted on the cast's end event.
  - **Reactions**: `ai.first` in `tick`.
  - **Sensors**: dwell meters in the behaviour's state.
  - **Summon lists**: the `summon` proc, `summonsOf` and `despawnSummons`.
  - **Intros**: `ai.hold` until a timer.
  - **Targeting**: F17's focus and the game's policies.
  - **Movement**: the game's own (F17's `MoveIntent` was removed at the review after F21: nothing read it).
  - **The wire view**: the game's numbers from `scripts.stateOf`.
  - **Factories** such as `bossScript` or `withEnrage`: plain functions returning behaviour lists.
- **No presentation.** A boss's name, yells, emotes and phase banner are the client's (§I.5.3).
- **Out of scope:** threat tables and taunt (not planned: target policies choose targets, §I.7.1), evade (deferred), and instance-level encounter state (doors, encounter done, wipe reset), which belongs to Tier 3. World scripts (§II.6 C11) are F21's, and may reuse behaviours.

The Grave Warden, sketched as swarm would write it (its numbers stay swarm's, in `WARDEN` and the wave config):

```ts
const behaviour = defineBehaviour<Game>();

const wardenPhases = behaviour({
  state: () => ({ phase: 0 }),
  on: {
    damaged: (ctx) => {
      const next = wardenPhase(ctx.unit); // the deepest phase whose threshold holds: one blow may cross two
      if (next <= ctx.state.phase) return undefined;
      ctx.state.phase = next;
      return [despawnOwned({ tag: 'telegraph' }), castSpell('warCry')]; // War Cry holds `invulnerable` while it roars
    },
  },
});

const picking = behaviour({
  spawn: () => [setTimer('pick', 0.5)],
  timer: (ctx, timer) => (timer === TIMERS.id.pick ? ctx.host.wardenPick(ctx.unit) : undefined),
  on: { castEnd: (ctx) => [setTimer('pick', ctx.host.wardenGap(ctx.unit))] },
});

const raise = behaviour({
  spawn: () => [setTimer('raise', WARDEN.raise.opening)],
  timer: (ctx, timer) => (timer === TIMERS.id.raise ? [castSpell('raiseDead'), setTimer('raise', 28)] : undefined),
});
```

### II.3.13 Stat scaling: flat stats, multiplier stats, and ratios on spells

A game can have both kinds of stat, as League of Legends does, and a spell scales with either one by a declared ratio.

- **Flat stats** are quantities: attack damage 400, ability power 250, ability haste 400, maximum health 2,000, armor. A spell takes a share of them: "60 (+120% attack damage) (+50% ability power)".
- **Multiplier stats** are percentages around a neutral value: swarm's `damage` (1 = neutral, 1.3 = +30%), critical damage (1.75), cooldown reduction, damage taken. A spell takes a share of their bonus: "scales with 110% of the damage bonus", "crits for 100% of critical damage".
- **Curves** turn a flat stat into an effect that is not linear: ability haste shortens a cooldown by `100 / (100 + haste)`, so 100 haste halves it and it never reaches zero. A spell may take a share of the stat before the curve: "50% of ability haste" on a spell is `100 / (100 + 0.5 × haste)`.

The stat table declares the kind, and the curve where there is one:

```ts
const STATS = defineStats({
  attackDamage: { base: 60, kind: 'flat' },
  abilityPower: { base: 0, kind: 'flat' },
  abilityHaste: { base: 0, kind: 'flat', curve: 'haste' }, // 100 / (100 + x) on whatever it shortens
  maxHealth: { base: 600, kind: 'flat' },
  critChance: { base: 0, kind: 'flat', max: 1 }, // a chance is a flat stat on 0..1
  damage: { base: 1, kind: 'multiplier' }, // swarm's damage bonus
  critDamage: { base: 1.75, kind: 'multiplier' },
});
```

A **scaled value** is any number on a spell, aura, area trigger or unit template, written as data instead of a function:

```ts
type Scaled<S extends StatId> = number | Scaling<S>;

interface Scaling<S> {
  base: number | readonly number[]; // one number, or one per rank (60 / 95 / 130)
  add?: readonly Term<S>[]; // + coef × stat
  amp?: readonly Term<S>[]; // × (1 + coef × (stat − neutral)), multiplier stats only
  curve?: { kind: CurveId; by: readonly Term<S>[] }; // × curve(Σ coef × stat), e.g. haste
}

interface Term<S> {
  stat: S;
  coef: number | readonly number[]; // one ratio, or one per rank (50% / 60% / 70%)
  of?: 'total' | 'bonus'; // bonus = the stat minus its base ("+60% bonus attack damage")
  from?: 'caster' | 'target'; // target terms are read at the hit: "+8% of the target's maximum health"
}
```

A value with `from: 'target'` terms snapshots its caster part at the cast and keeps its target terms; the `damage` and `heal` procs finish it against each target they hit. A spell reads it as `ctx.scaled.damage`, which keeps the target terms for the hit, while `ctx.stats.damage` is the plain number of its caster part (F7). Helpers keep definitions short. The value is always `(base + Σ add) × Π amp × curve(Σ curve terms)`, in that fixed order, so the float result is the same everywhere:

```ts
export const piercingLight = defineSpell({
  tags: ['ability', 'physical'],
  activation: button({ cooldown: scaled(12, haste(0.5)) }), // 12 s × 100 / (100 + 0.5 × ability haste)
  stats: {
    damage: scaled(
      ranks(60, 95, 130),
      add('attackDamage', 1.2),
      add('abilityPower', 0.5),
      add('maxHealth', 0.08, { from: 'target' }), // read when it hits
    ),
    radius: 3,
  },
  scaling: { damage: 1.1, critChance: 1, critDamage: 1 }, // shares of the outgoing multipliers (below)
  release: (ctx, target) => [damage(ctx.scaled.damage, { to: target })], // the target term finishes at the hit
});
```

**Outgoing multipliers.** The game declares which multiplier stats every blow gets at the damage pipeline's attacker-side stage (swarm: `damage`; the crit stage reads `critChance` and `critDamage`). Each spell's `scaling` gives its share of each one, with a missing entry meaning 1 (the spell system answers the damage host's lookup: `shareOf: spells.shareOf`). So "scales with 110% of the damage bonus" is `scaling: { damage: 1.1 }`: a +30% bonus gives × 1.33. A spell that ignores damage bonuses writes `damage: 0`. The pipeline finds the share through the blow's source spell, so area triggers, delayed procs, periodic beats and summons all get it with no work in the spell. A share of exactly 1 reads the stat as it is, not `1 + 1 × (M − 1)`, which can differ from `M` in the last bit. The pipeline reads these stats at the hit (swarm reads them there today: `core.ts`, `weaponStat('damage', spell)`); the terms in `stats` follow the spell's snapshot rule (decision 2).

**What else it gives:**

- **Explanations.** `explainScaled(value, rank)` returns `{ base, terms: [{ stat, coef, of, from, op, value }], total }`, so the client prints "60 (+120% AD) (+50% AP)" in its own words and colours, from the simulation's numbers (§I.5.3).
- **Previews.** Evaluated at any rank with no world (M6). Target terms show as their ratio.
- **Checks when the registry is built.** An `amp` term must name a multiplier stat and an `add` term a flat one; `of: 'bonus'` needs a base; a per-rank list must match the spell's ranks. A mistake fails at load, not in play.
- **Speed.** Scaled values compile into flat term arrays (stat id, coefficient, op) when the registry is built. Each evaluation is one loop over stats already folded for the cast, with no allocation (§I.5.4).
- **Escape hatches.** `stats(ctx)` can still be a function for a number no formula covers. A game registers its own curves (`defineCurves({ haste, diminishing })`), and custom term sources through the stat host (§I.5.6).

**In swarm:** the weapons' rank tables (`(27 + r × 10) × legendary`) become `ranks(...)` bases, and `damage` and `critDamage` become outgoing multipliers with the default share of 1. Every golden stays bit-exact, because a share of 1 reads the stat as it is and the order of the multiplications does not change. Flat stats and ratios are there when the game wants them, with no framework change.

### II.3.14 Mitigation, ratings and diminishing returns

Armor, resistances, hit, dodge and penetration work as they do in WoW and League of Legends. A defender's rating becomes a reduction or a chance through a curve with diminishing returns, and the curve can read the attacker: their level, their penetration, their hit rating. The framework ships the well-known curves and the pipeline stages, and the game declares which stats feed them.

**Curves** are pure, deterministic functions from a number to an effect. They are shared by scaling (§II.3.13), mitigation, ratings and the roll table:

| curve                                | formula                                                                                        | used for                                                                                      |
| ------------------------------------ | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `linear(per)`                        | `x × per`                                                                                      | flat conversions, swarm's creature `damageReduction`                                          |
| `rating(per)`                        | `x / per / 100`, with `per` the rating for 1%                                                  | WoW combat ratings: hit, crit, haste, expertise                                               |
| `hyperbolic({ k, cap?, negative? })` | `x / (x + k)`; below zero `'zero'`, or `'amplify'` as `2 − k / (k − x)` as a damage multiplier | LoL armor and magic resist (`k: 100`), WoW armor (`k` from the attacker's level), swarm armor |
| `hasteCurve()`                       | `100 / (100 + x)` on a duration (`haste(coef)` is the scaled-value term that applies it)       | LoL ability haste (§II.3.13)                                                                  |
| `avoidance({ per, cap, k })`         | `1 / (1 / cap + k / p)`, with `p = x / per / 100` before diminishing returns                   | WoW's diminishing returns on dodge, parry and block from ratings                              |
| `stacking(rate)`                     | `1 − (1 − rate)^x` for `x` equal instances; unequal rates `1 − Π (1 − rᵢ)` fold as `mul`s      | multiplicative stacking: tenacity, slow resistance, several % penetrations                    |
| `table(points)`                      | piecewise linear over `[x, y]` points                                                          | rating-per-percent by level, level-difference tables                                          |

Every parameter of a curve (`k`, `cap`, `per`) can be a scaled value (§II.3.13), so it can read either side of the hit. WoW's armor constant, `400 + 85 × attacker level`, is `k: scaled(400, add('level', 85, { from: 'caster' }))`. In the pipeline, `caster` is the attacker and `target` the defender.

**Ratings** are flat stats that convert into a percentage stat through a curve, extending derived stats (M1). WoW's hit rating becomes hit chance at so much rating per 1% at the bearer's level (`byLevel(table)` reads the bearer's `level` stat through `table`); dodge rating becomes a dodge percentage, then goes through diminishing returns:

```ts
const STATS = defineStats({
  level: { base: 1, kind: 'flat' },
  hitRating: { base: 0, kind: 'flat', converts: { to: 'hitChance', curve: rating(byLevel(RATING.hit)) } },
  dodgeRating: {
    base: 0,
    kind: 'flat',
    converts: { to: 'dodgeChance', curve: avoidance({ per: byLevel(RATING.dodge), cap: 0.6563, k: 0.956 }) },
  },
  armor: { base: 0, kind: 'flat' },
  armorPen: { base: 0, kind: 'multiplier' }, // % penetration, 0 = none
  lethality: { base: 0, kind: 'flat' }, // flat penetration
});
```

**Mitigation rows.** The game declares one row per defence, the blow kinds each row applies to, and the order. The pipeline's armor stage (D1) runs the rows in that order:

```ts
const MITIGATION = defineMitigation({
  armor: {
    kinds: ['physical'],
    rating: 'armor', // the defender's stat
    penetration: [percent('armorPen'), flat('lethality')], // the attacker's, in LoL's order
    curve: hyperbolic({ k: 100, negative: 'amplify' }), // LoL
    // WoW: curve: hyperbolic({ k: scaled(400, add('level', 85, { from: 'caster' })), cap: 0.75 }),
  },
  magicResist: {
    kinds: ['magic'],
    rating: 'magicResist',
    penetration: [percent('magicPen')],
    curve: hyperbolic({ k: 100 }),
  },
  taken: { kinds: 'all', multiplier: 'damageTaken' }, // a plain multiplier stat, after the curves
});
```

Penetration applies to the rating before the curve, in the declared order and never below zero, unless the row says otherwise. The result multiplies the amount: `amount × (1 − reduction)`, or the curve's multiplier when the rating is negative and the row amplifies. True damage and the kinds a game marks as bypassing (swarm's environmental, blood, lethal) skip every row, as today.

**The roll table** (F14) takes the same approach for outcomes. The game declares outcome rows: miss, dodge, parry, glancing, block, crit, or its own. Each row's chance is a scaled value from both sides, and the table rolls in one of two modes:

- **`'single'`**: WoW's attack table. One roll in the declared order, each outcome pushing the rest off the table. The miss chance can grow with the level difference and shrink with the attacker's hit chance, for example `scaled(0.05, add('level', 0.01, { from: 'target' }), add('level', -0.01, { from: 'caster' }), add('hitChance', -1, { from: 'caster' }))`, floored at 0.
- **`'independent'`**: League of Legends and swarm. Each row rolls on its own stream, in order: swarm's block, then the attacker's crit.

Rows name their outcome for the combat log, the triggers and the cues (`dodged`, `parried`, `missed`). A spell can be flagged `unblockable`, `undodgeable` or `cannotMiss` per row, generalising swarm's `unblockable`.

**What else it gives:**

- **Explanations.** `explainMitigation(defender, { attacker, kind })` (a method of the damage system) returns each row's rating, the rating after penetration, and the reduction, so the client can print "Armor 120: 54.5% less physical damage from a level 60 attacker". Card text such as the Guard buff's "armor has diminishing returns" can then show the real before-and-after.
- **Checks when the registry is built.** Every blow kind must be covered, penetration must name attacker stats of the right kind, and curve parameters must be in range (`k > 0`, `0 < cap ≤ 1`).
- **Speed.** Rows compile into flat arrays. A blow costs a few multiplies over stats already folded; the attacker's side is read once per blow.
- **Escape hatches.** A game registers its own curves, and a game pipeline stage (§I.5.6) can sit between rows for a rule no row describes.

**In swarm:** heroes get one row, `armor` with `hyperbolic({ k: ARMOR.scale, negative: 'zero' })`, computed as `rating / (rating + k)` exactly like `armorReduction`, then `damageTaken`. Creatures get `damageReduction` through `linear(1)`. The roll table runs `'independent'` with block and crit. The multiplication order is today's (`blow × (1 − reduction) × damageTaken`), so every golden stays bit-exact. Levels, hit rating, dodge and penetration are there when the game wants them, with no framework change.

## II.4 Every existing spell, mapped

The weird ones first; the rest follow the same parts.

### Tempest (in full)

```ts
const cyclone = defineAreaTrigger<{
  heading: number;
  goal?: Vec;
  nextTick: number;
  nextRetarget: number;
  nextStrike: number;
}>({
  shape: (c) => circle(c.stats.radius),
  lifetime: (c) => c.stats.duration,
  bound: { owner: 'standing' }, // a downed or gone owner takes it away; its end cue says nothing
  replicate: {
    fields: ['x', 'z', 'heading', 'radius', 'started', 'duration', 'evolved'],
    store: 'tempests',
  },
  frame(c, dt) {
    steer(c, dt); // own state: retarget every 0.5 s (siblings' goals excluded), capped turn, leash to the owner
    const ending = c.age >= c.lifetime;
    const ticking = c.due('nextTick', TEMPEST.tick);
    const striking = c.evolved && c.due('nextStrike', LEGENDARY.tempest.strikeInterval);
    const procs: Proc[] = ending
      ? [
          cue('tempest.impact', c, {
            radius: c.stats.radius * TEMPEST.flingReach,
          }),
        ]
      : [];
    const candidates: Creature[] = [];
    for (const e of c.query.inside(circle(c.stats.radius * TEMPEST.pullReach + STRIKE_REACH), { side: 'foes' })) {
      if (striking && isStrikeCandidate(c, e)) candidates.push(e); // gathered before any pull, as today
      if (ticking && inside(c, e, c.stats.radius))
        procs.push(damage(e, c.stats.damage, { strength: 'light', knock: 'none' }));
      if (ending) {
        if (inside(c, e, flingReach))
          procs.push(damage(e, c.stats.splash, { strength: 'heavy', knock: 'none' }), push(e, c, TEMPEST.fling));
      } else if (inside(c, e, pullReach)) procs.push(pull(e, c, TEMPEST.pullSpeed * dt, c.stats.radius * TEMPEST.core));
    }
    if (striking && candidates.length) procs.push(pickOne(candidates, 'main', (target) => maelstromStrike(c, target))); // drawn after the damage above, as today
    return procs; // per enemy, in the order today's single pass does them
  },
});
```

Tempest needs: an owner-bound roaming area trigger, its own steering state (the retarget reads the goals of the owner's other live cyclones through a query over area triggers), three clocks in one frame, per-enemy interleaving, a pick on the main random stream drawn at apply time after the tick's crit rolls (`pickOne`), a legendary branch, and replication through the existing `tempests` schema. Every one of those is a first-class part above; nothing is an escape hatch.

### The Arsenal

| weapon                | activation                                                               | parts                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cleave                | auto, `next` retrying a miss; refused as `spend` while `state.whirlwind` | `areaHit(cone)` → `damage` knock 0.15; `cue` with `sweepAngle`                                                                                                                                                                                                                                                                                                                          |
| Hawkeye, Verdant Bolt | auto, `aimed`                                                            | `shoot` × n (Projectile Count on `volley`), pierce, `repeat-share` 0.5 over the cast's `shared` set                                                                                                                                                                                                                                                                                     |
| Rivet Gun             | auto, `aimed`                                                            | `shoot` bullet, pierce, stops at walls (relative sweep and wall bisection, §II.6 W10)                                                                                                                                                                                                                                                                                                   |
| Spark                 | auto, `aimed`; the target may be a fizzle direction                      | links picked one at a time through `ctx.apply` (each after the previous hit's triggers), edge distance, id ties; `damage` with falloff, `knock: 'none'`; a `vec2[]` polyline cue                                                                                                                                                                                                        |
| Winter Pulse          | auto                                                                     | `areaHit` → `damage`, `applyEffect(slowed, chilled)`, legendary adds `applyEffect(frozen)`                                                                                                                                                                                                                                                                                              |
| Ember Blades          | passive                                                                  | owner-anchored area trigger, `replicate: 'derived'`, n blade circles per pulse in `onPulse`, pulses restarted from now with no first delay, `none` hit policy, suspended (clock kept) while the owner is down                                                                                                                                                                           |
| Glaive                | auto                                                                     | homing missile, several contacts per frame with leftover time, a `reserve / claim` ledger released in `onEnd`, the last frame clipped to the cast's expiry, `budget`; legendary `spawn(fork, { now: leftover })`                                                                                                                                                                        |
| Voltaic Orbs          | auto                                                                     | homing missiles, one per distinct target, target-locked contact, retarget when the target dies, expiry checked before the move, self-despawn on contact; legendary one-hop `nearest` arc through `ctx.apply`                                                                                                                                                                            |
| Singularity           | auto                                                                     | static well: `frame` pulls and tracks `caught`, `every 0.5` damage, in the order pull → pulse → collapse with the last frame before expiry; `onExpire` heavy collapse with a bonus per caught; placed by `densest` with an objective filter, a 40-candidate cap and a centroid                                                                                                          |
| Hexfire               | auto, `live` stats, refused as `spend` at the global cap of 24           | `applyEffect(hexfire.brand)` with a payload (generation, variant, owner), `boundToSource`, a `periodic` reading Hexfire's live stats in Hexfire's slot; `onState` of `dead` → `after(0.15, pop)` → `areaHit`, then (`then`) brand picks by `nearest` with an unbranded filter, counted down per brand                                                                                   |
| Searing Arrow         | auto                                                                     | per point `after(0.45, [areaHit repeat-share 0.25, spawn(patch)])`, points spread by `minSeparation`; patches share an owner clock (starts at the first patch, dropped when none remain, catches up, membership judged at the beat), `hottest-per-owner-clock`, `limit 12 oldest`                                                                                                       |
| Judgement             | auto                                                                     | `after(0.5, [areaHit heavy, push, stun first only, applyEffect(barrier)` on allies (legendary)`, after(0.5, aftershock, { from: 'due' })])`; procs after the damage skip the targets it killed                                                                                                                                                                                          |
| Tempest               | auto                                                                     | above                                                                                                                                                                                                                                                                                                                                                                                   |
| Moon Chakram          | auto                                                                     | missile with its phase machine in `frame` (bezier out, hang, home back, catch), named hit ledgers (out, back, orbit rehit 0.3 s) shared by reference, the lean from `init` with the id, return-pass `pull`; legendary crescents spawned next frame and inserted `after-parent`                                                                                                          |
| Serpent Coil          | passive, movement slot, stepped per owner                                | owner-anchored ribbon with before-move and after-move hooks (a teleport breaks it), re-armed on revive; on a coil, the owner's nodes are queried in order and a subset despawned; `areaHit(polygon band)` + `applyEffect(venom.toxin)` (payload: damage snapshot and owner; a refresh keeps the beat and credits the newest source); legendary constrict channel then a second eruption |
| Cheat Death           | passive: a buff aura while owned, its charges as its value               | `onLethal` (with ctx, even for true damage) prevents the death, returns `setHealth` to a share, `applyEffect(deathEscape)` (the escape window), cancels the knock, applies its own recharge cooldown aura (motion clock, predicted), private cue                                                                                                                                        |

### Hero abilities

| ability          | activation (button)                            | parts                                                                                                                                                                                                                                                                                                                                   |
| ---------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dash             | motion aura (§II.6 A12)                        | invulnerability window (`max` stacking), knockback cleared; the `dodge` event comes from the spell's tag, not the slot key                                                                                                                                                                                                              |
| Blink            | motion aura, exact travel                      | released inside the motion step between `activate` and travel: `areaHit` → `damage`, `freeze` (through the creatures' application policy) at the departure point                                                                                                                                                                        |
| Shockwave        | cooldown 8 s, cast stamped at the tick's start | not a windup (the Knight is never locked): `face`, then a lane area trigger spawned 0.2 s later where the Knight stood, contacts by relative sweep against previous positions with line of sight from the origin, `once-per-cast` → `damage`, `stun`; stops at walls                                                                    |
| Sanctuary        | applies `sanctuary`                            | a dome area trigger tagged `shelter`: the ignore stage and the force pipeline ask `coveredBy` at each blow, exposure subtracts its span, it intercepts hostile shots before walls and keeps creatures out (trait exemptions); `onExpire` `areaHit` 300 if the owner is present                                                          |
| Galeheart Volley | placement clamped at walls (predictable)       | `after(0.35, [applyEffect(galeheart), cue, areaHit heavy with line of sight from the impact], { bound: isStanding })`, duration snapshot at cast                                                                                                                                                                                        |
| Arrowstorm       | applies `arrowstorm`                           | opening `areaHit` (freeze, knock 3); the aura's beat clock is world time (`floor(time × 3)`) in the attack slot, `castSpell(arrowstorm.strike)` (`areaHit` on `nearest(12)`); no class check                                                                                                                                            |
| Frost Bomb       | placement (ignores walls)                      | `areaHit` (freeze) + field `limit 1` with no end cue, heavy `every 0.5` → `damage`, and a refresh-while-inside area aura (slow and chill topped up to 0.3 s) or a sustained freeze; ends silently when the owner goes down                                                                                                              |
| Overcharge       | applies `overcharged`, resets `cooldown.dash`  | `applyEffect(barrier, { value: 0.5 × maxHp, duration: the ultimate's })` + `areaHit` knock; the aura rescales Spark's clock (§II.6 A13)                                                                                                                                                                                                 |
| Whirlwind        | applies `whirlwind`                            | its beat runs on the world clock in the attack slot, with catch-up and a last beat on the expiry tick: `castSpell(whirlwind.sweep)` (`areaHit` light); Cleave refuses as `spend` on the tag                                                                                                                                             |
| Enrage           | applies `enraged`                              | cue + `areaHit` knock; the aura rescales every attack clock on applied and refreshed and holds the lifesteal budget as its value, spent by `onDealt` and reset on refresh                                                                                                                                                               |
| Verdant Flask    | placement                                      | `after(0.39, after(0.26, …))`, only the impact bound to the owner standing: cue, `areaHit`, `spawn(field, limit 1 fade)`; pulses with line of sight `damage` foes and `heal` allies (private heal cue)                                                                                                                                  |
| Living Grove     | applies `grove`, placement                     | field `limit 1 fade`, first pulse immediate, `damage` + `heal`, and a refresh-while-inside slow with line of sight from the grove                                                                                                                                                                                                       |
| Sentry           | `startsOn: 'cast'`, `place` (predictable)      | a summon area trigger that is a caster: an arming delay whose leftover carries, then its own `auto` spell (sticky target with id ties, clock reset when nothing is in range, catch-up shots, line of sight, shot life = range ÷ speed) credited to the owner, `limit 1 fade`, bound to "the granting ability is in the owner's loadout" |
| Overdrive        | applies `overdrive`                            | cue; the aura rescales the Rivet Gun's clock on applied and expired, and is `removedOn` down, disconnect and death                                                                                                                                                                                                                      |

Revive and going down are not abilities but unit lifecycle (§II.6 U3): revive is a proximity channel spell every hero carries.

### Creatures

| family            | parts                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Horde (built)     | `ai` activation; telegraph and shot procs; a melee swing as the unit's auto-attack (§II.6 S3); the brain keeps pick and budget until the shared picker lands                                                                                                                                                                                                           |
| Elite Juggernaut  | cleave (cone telegraph, `lockBefore(0.4)`, enraged release `castSpell(stab)`), charge (channel: caster `move` with sweep contacts, `onEnd: 'blocked'` → stagger), leap (`target` refuses without a landing; `move` flight; circle telegraph landing after windup + flight), whirlwind (moving pulse channel)                                                           |
| Elite Hexblade    | tether (channel, `breakIf` > 8 m from origin → `broken` → stagger; else an unblockable crushing `damage`), lance (lane telegraphs, the tracked fan rotates together), portal (circle telegraphs landing after the cast ends), step (`teleport` + departure telegraph)                                                                                                  |
| Elite Gravecaller | shockwave (three staggered ring telegraphs), volley (shots with a gap; enraged: channel then a second fan), spikes (telegraphs at `linePoints` along a line), raise (`summon` with clearance rules)                                                                                                                                                                    |
| Elite enrage roar | a spell the brain casts at 50%: `onCancel`-style withdrawal of its own unfired telegraphs, knock telegraph, cooldown rescale                                                                                                                                                                                                                                           |
| Grave Warden      | the same parts with `lockAtShare(share, turnRate)`; execute (`lethal` damage); charge chains (`castSpell(charge, { windup: 0.45 })`); barrage second ring (`after(0.4)`); soulfire (ground area triggers that hurt heroes over time); War Cry (`applyEffect(invulnerable)`, a buff aura on the boss, knock telegraph, then `summon`)                                   |
| Archmage          | comet and chaos (shots and a lobbed telegraph whose delay is the flight), explosion patterns (points with stagger, aimed `lockAtStart`), repulse, blink (channel: vanish, then `teleport` and cue), Arcane Circle (channel whose clock is the fire-ring area trigger; `invulnerable`; `teleport` heroes; `despawn` adds; `every` barrage)                              |
| Map events        | world scripts on bodiless units (F21): Inferno (moving lethal wall area trigger, time-derived), Venom Flood (zone area trigger: harm outside, heal inside), Detonation (staggered telegraphs), Blood Horde (`summon` + a death trigger spawning pools), Prison (`summon` walls), Gravebloom (objective summons), Dread Totem (objective with an aura effect on heroes) |

Every family's brain becomes a creature script (§II.3.12), and each row above is that script's spells. The script shapes below (`hordeScript`, `eliteScript`, `bossScript`) are swarm's own behaviour lists, not the framework's:

- **Horde:** the shared `hordeScript`: the kind's kit as the pool (uniform weights, no repeat), the points budget (claimed with a time to live, released on release, death and despawn), a retry range after a refusal, a gap counted while idle, line of sight sampled every 0.25 s staggered by id, the first cast `1 + rand × 2` s after spawn, hold-ground movement, the melee swing as the unit's auto-attack, and the flow field's target policy.
- **Elites:** one `eliteScript(variant)` factory: the intro grace, the variant's kit, the shared elite budget (0.9 s global gap, 2 s per spell, Cleave and Stab exempt, claimed at every cast start), a hug sensor, the Juggernaut's forced Whirlwind as a reaction, a 0.2 s retry, stagger after a charge into a wall (recover by outcome), the tether's own target and `cancelIf`, and `withEnrage(ELITES.enrageAt, 'elite.enraged', roar)`, whose aura scales every cooldown by `enragedCooldown` and unlocks Whirlwind, and whose roar withdraws every unfired telegraph the elite owns (`despawnOwned`, also from casts that already ended) and lands a leap in mid-air.
- **Grave Warden:** `bossScript` as sketched in §II.3.12: three health phases from the wave config with per-phase `params` and gaps, War Cry as each transition (invulnerable while it roars, clamping the charge and Whirlwind cooldowns, then raising at once), the forced Whirlwind reaction, the raise timer (a one-shot summon sized by missing health, not a list), soulfire as a phase parameter, speed from missing health, and chase with a run factor and a capped turn.
- **Archmage:** `bossScript` with phases at 66% and 33% (strict `>=` comparisons), the Circle of Fire as a transition: a channel whose clock is the fire ring's life, invulnerable through it and the 1.5 s break after, heroes teleported, adds despawned with the phase, a barrage `every` inside the ring, a burn outside it (`outside` shape), the ring's lethal crossing (exposure's edge hook), and a party knockback at the end that resets the pick delay and the blink cooldown. Repulse (hugged 1.2 s) and blink (ready, or early when pinned with half its cooldown left, never with a volley pending) are reactions; the comet's second volley is an `after(0.45)` whose tag blocks picks; the adds are a summon list whose `keep` is a function of the party, placed in an 18–28 m annulus away from heroes with wave 6 stats; a leash keeps it within 14 m of the centre.
- **Map events** are world scripts (§II.6 C11) run by the event scheduler (C13); a totem or objective that behaves on its own (the Dread Totem) is a small unit script.

## II.5 Migration

Every phase ends with the suite green, balance output identical except the timestamp, network bytes identical (except in phase 9 and pacts phase B), and the goldens held. A golden is recorded on the unchanged code before its family moves, on Linux x64 and arm64, with the macOS arm64 recording as the shared one where it exists.

0. **Safety net.** Add goldens that do not exist yet: every hero ability (both halves, with prediction), every elite spell (plain and enraged), the Warden per phase, the Archmage per phase, and each map event. Extend `wire-order.test.ts` with area trigger tick order.
1. **Core.** `defineSpell` / `defineAreaTrigger`, the Spell System (casts, timeline, the area trigger store with storage adapters, `after`), `ctx.query`, named random streams, idempotent scope. Re-home the existing pilots; Searing Arrow's `run` becomes `after` and patch area triggers.
2. **One proc vocabulary.** Trigger `do` lists become procs; spell events join the bus.
3. **Auras on any unit.** Creature statuses become auras (projected onto today's synced bytes), auras gain proc lifecycles, and the damage pipeline runs aura hooks. Auras gain a `value`, and the barrier becomes an absorb aura (step A: `PlayerSchema.barrier` stays as its projection). Cheat Death, the Sanctuary's shelter and the barrier move out of `hurtPlayer`, and Hexfire's death call out of `hurtEnemy`; the Overcharge golden (which records the barrier every frame) and the Judgement weapon parity hold it.
   3b. **Units, lifecycle and the pipelines** (§II.6 U1–U3, D1–D5). Unit templates and traits replace every `kind` branch in crowd physics, knockback, control and rewards; one side-agnostic damage pipeline with heal, force and death pipelines replaces `hurtPlayer` and `hurtEnemy`; going down, disconnecting and reviving become lifecycle states with `removedOn`; `refreshMaxHp` becomes the resource policy. Held by every golden that hurts or kills anything, plus new goldens for revive and going down.
4. **Pacts as spells with passive auras** (§II.3.11). Pact auras with `fold: 'pacts'`, sealing as a spell, pacts as a party fact applied on join; triggers compile from auras only (class and pact sources removed). Phase A keeps `pact.owned` as a projection (no protocol move); phase B drops it with the trigger-id change (protocol bump). Held by the stat goldens, `pacts/mods.test.ts`, `pact-sync.test.ts` and the pact card text.
5. **The Arsenal**, family by family (instant, projectiles, delayed, area triggers, statuses, passives), weapon parity after each. `CARD_MECHANICS` shrinks to nothing.
6. **Abilities.** `AbilityDef` becomes the `button` activation; `CAST_HANDLERS` and `CAST_VISUALS` go; prediction runs the spell's mirror-safe hooks.
7. **Creatures.** Elites, then the Warden, then the Archmage onto creature scripts (§II.3.12) and spells with timelines: the elite step, `stepWarden` and `stepArchmage` become scripts, and `EliteAbility`, `WardenAbility` and `ArchmageAbility` become script state, timers, phase auras and summon lists; the shared picker and budget policy; telegraph area triggers with shapes and `onLand` replace the hazard loop's per-spell special cases. The horde brain moves onto the shared `hordeScript` last, held by the cast golden.
8. **Cues.** The remaining raw `emit` sites become cue ids (append-only).
9. **Replication.** One `AreaTriggerSchema` and a client renderer registry replace the per-kind schemas (protocol version bump, measured with `benchmark:network`; pacts phase B can ride along).
10. **Map events** onto world scripts (§II.6 C11), with the director, exposure unions, blockers and reserved sites as game code on the escape hatches, **required**: they are not clean today (about 25 special cases in `core.ts`, cyclic imports, the exposure and keep-out blocks in the hero and enemy loops), and exposure and the Sanctuary's subtraction get goldens first.
11. **Shared spells.** Nova, volley, whirlwind, cleave and charge written once in `spells/<id>/` and cast by either side, since targeting is side-relative.
12. **Passive cards as auras** (§II.3.11): each passive a permanent aura, stacks = rank, `fold: 'passives'` in `PASSIVES` order, Stride with linear stacking, held by every stat golden. No longer optional: without it the passives stay the last content read by id.
13. **Ownership, ranks and the game's own progression** (§II.6 S1, U4, U5, W11, W12): `player.ranks` answers the spell host's `rankOf` and `variantOf`, and `acquireCard` arms a card's `auto` spell and casts its passive spell; the draft, rerolls, levels, loot, souls, hearts, the magnet, map buffs, supply drops and the Pact Sigil become game systems and game area trigger kinds on the escape hatches, out of `core.ts`. Held by new goldens for the draft's draws and for drops.
14. **Zero special cases.** `no-content-branches.test.ts` (§II.6.6) runs with an empty allowlist.

## II.6 Coverage: every mechanic, no special cases

**The goal of the migration: no content logic in the engine's plumbing, and most of it in framework primitives.** Once swarm is on the framework, `Game` and its world adapter hold plumbing only (world, physics, navigation, input, networking, screens), and no plumbing branches on a card, class, ability, creature, effect, event or spell id. About 95% of the behaviour is spells, auras, procs, area triggers, scripts and unit templates; the rest is game code on declared escape hatches (§I.5.6), next to the content it serves. Full coverage by the framework is not the aim: a hatch is a supported path.

**How this was checked.** Nine independent audits read every file of swarm's `packages/game/src` (the Arsenal in two halves, passives and pacts, the effect / modifier / trigger / cue systems, hero abilities and classes, the horde and waves, elites and bosses, map events and pickups, and all 4,684 lines of `core.ts`) and classified every mechanic as expressible with this plan, a gap, or legitimately game-side. The verdict: the model holds (spell, aura, proc, area trigger, script), but the plan as first written would have left roughly a hundred special cases in the game. The gaps below close them, either as framework features or as escape hatches (§II.6.0). Each names its primitive or hatch, what in swarm needs it, and where it lands; the earlier sections are corrected in place where they were wrong (§II.6.3).

### II.6.0 Framework or escape hatch

Not every entry below becomes framework code. The rule (§I.5.6): **a mechanic several spells, units or games share goes into the framework; a one-off stays in the game through an escape hatch.** Each catalogue entry is marked:

- **[F]** framework: built, tested and documented in the phase it names;
- **[H]** escape hatch: swarm writes it itself on the named hatch, and the framework only guarantees the hatch.

The audit's one-offs that stay in the game on hatches: the card draft, rerolls and levels (a game system on its own ranks and streams); loot tables and pity (a game system listening to the death pipeline's reward slots); pickups, the magnet and the Pact Sigil (game area trigger kinds and a query extension); the event director with its calm gaps and concurrency classes (a game-owned step using the shared picker and world scripts); formations (a world script's `on.tick` steering its members); map-wide reference-counted auras (a world script); blockers, keep-outs and reserved sites (host collision, navigation and a query extension); the union of overlapping pools and the Sanctuary's exposure subtraction (a game pipeline stage over the framework's swept path tests); platform-free pool outlines (game data tables); the Coil's loop detection, the Inferno passage search and the Tempest's steering (function hooks, as before).

### II.6.1 Cross-cutting rules the audits forced

These change how the framework runs, not just what it offers, and every system follows them.

1. **The host owns the tick order.** A game's exact behaviour needs its own interleaving (swarm's: toxins tick per owner inside the movement phase, a field's slow lands between a creature's status countdown and its brain, the sanctuary keep-out runs after crowd separation, arrows and hammers land inside their card's slot after creatures move). So the framework never runs a fixed "tick everything" pass. The game declares its **tick slots** (a registry like any other), every stepped thing names its slot (area trigger kinds, aura periodics, delayed procs, scripts, auto-attacks, pickups), and the framework exposes steppers the host calls inside its own loops: `step(slot)`, `stepOwner(slot, owner)`, `stepUnit(slot, unit)`. `tickIn` becomes a slot id, not one of three strings. Within a slot the order is kind order, then creation order, with `insert: 'after-parent'` for a child that must tick right after its parent (the Chakram's crescents); delayed procs follow the same rule, and every creature telegraph is one area trigger kind so landings keep one creation order. `wire-order.test.ts` pins it all.
2. **Procs apply in order, and a hook may observe them.** Damage runs triggers synchronously, so a chain that picks its next link after the previous hit (Spark, Glaive's retarget, Voltaic's arc, the Hexfire burst's brand picks) must see the result. Hooks keep returning procs for the simple cases, and gain `ctx.apply(proc)`, which applies at once and returns the outcome (`ignored | blocked | absorbed | landed`, amount, killed). The data form gets `then(ctx => Proc[])` (`andThen` in code), evaluated after the procs before it; `pickOne(candidates, stream, then)` draws at apply time so a random pick lands after the crit rolls it follows (the Tempest's Maelstrom); and a proc aimed at a unit the same list already killed does nothing.
3. **Random streams are the host's.** `ctx.random(name)` resolves through a table the game supplies. Swarm maps crits, picks, pick gaps, placements and the Maelstrom to its main stream, and runs scripts inside its per-unit loop, so every sequential draw keeps its place; a new game maps them to keyed rolls. "Keyed rolls are the default" stays true for new content, and the table is the hatch that lets swarm keep its draws.
4. **One timing, stamps and countdowns alike.** Deadlines are stamps; timers that pause or rescale (a cast's stages, an `auto` clock, an area trigger's life, arming and beats) count their seconds down. Both end on the step the seconds say: a countdown snaps to zero below `1e-6`, and a stamp is `⌈(seconds − 1e-6) / dt⌉` steps away. _Decided after the review after F21:_ the plan first let each clock take its own countdown rule and let auras count down per clock, so swarm could keep its own (`max(0, t − dt)` with no epsilon on its world clock, `1e-8`, `1e-6` and `1e-9` elsewhere). Those rules end most round lengths one step late (0.1 s at 1/60 s on the seventh step, not the sixth) and only reproduced that; swarm moves to the one timing in its own code before it ports (decision 9), and the rules, the countdown aura mode and the walk behind `stepsUntil` are gone.
5. **One side-agnostic damage pipeline, plus heal and force pipelines.** `hurtPlayer` and `hurtEnemy` merge into one staged pipeline any unit goes through (§II.6.2 D1–D5), with outcomes the hooks after it can read. Shared spells (phase 11) need it, and it is where invulnerability, shelter, block, absorbs, lifesteal and death rewards stop being special cases.
6. **Units are first-class.** A creature is a registered **unit template**, not a `kind` string the engine switches on; heroes, creatures, summons and objectives share one lifecycle (alive, dead, despawned; going down and disconnecting are the game's states on top) that auras, area triggers, scripts and budgets react to (§II.6.2 U1–U3).
7. **Shared goes in, one-offs escape.** A mechanic several spells, units or games share becomes a framework feature; a one-off stays in the game on an escape hatch (§I.5.6), declared, deterministic and counted. Leashes and leap arcs are shared, so they are built now; the draft, loot, pickups, the event director and formations are swarm's alone, so they stay swarm's code.

### II.6.2 The gap catalogue

Each entry: **id. name.** What the framework gains. _Needs:_ what in swarm. _Lands:_ phase.

Entries marked **[H]** are listed so the game knows where its own code goes; the framework builds only the hatch.

**Core, time and order (K)**

- **[F] K1. Tick slots.** Game-declared slots and per-slot / per-owner / per-unit steppers (§II.6.1 rule 1). _Needs:_ every card's world update, toxins, field slows, keep-outs. _Lands:_ F1, F8.
- **[F] K2. In-slot order.** Kind order, then creation order, `after-parent` insertion; delayed procs ordered like area triggers. _Needs:_ Chakram, Searing, Judgement, Hexfire, creature telegraphs. _Lands:_ F7, F8.
- **[F] K3. Countdown mode and per-clock countdown rules** (rule 4). _Needs:_ every aura, the Hexfire pop (`1e-6`), the Chakram (`1e-9`). _Lands:_ F1, F3. _As built:_ F1 and F3 built both; after the review after F21 they gave way to one timing (rule 4), which swarm adopts before its port.
- **[F] K4. Host stream table** (rule 3). _Needs:_ crits, pickers, gaps, placements, the Maelstrom. _Lands:_ F1.
- **[F] K5. Stable ids for derived entries.** Derived registries (internal-cooldown auras) get their own append-only order, so an earlier trigger's new cooldown never shifts later wire ids. _Lands:_ F1, F4.
- **[H] K6. Platform-free authoritative geometry.** Shapes the simulation decides with (blood pool outlines built with `Math.sin`) come from precomputed tables or integer trigonometry. _Escape hatch:_ game data tables (precomputed outlines).

**Modifiers and stats (M)**

- **[F] M1. Derived stats and the final clamp.** `derives: { from, per, gain? }` adds `per × max(0, gain(from))` after the adds and before the muls, the gain being `total − base` of the followed stat; swarm's add-only float path (the plain sum of the additions while nothing multiplies or caps the followed stat) is swarm's code, on the `gain` measure. The stat's own `min` / `max` clamp runs last, after caps. _Needs:_ Pickup Radius → ability area, Soul Glutton, Echo Sigil, block chance. _Lands:_ F2.
- **[F] M2. Stat-derived modifiers.** A modifier whose value is `per × (total(stat, scope) − neutral)` of another stat, with a per-source cap, still data and explainable. _Needs:_ all sixteen Arsenal links, the Hexfire leap cap. _Lands:_ F2.
- **[F] M3. Values from bearer state.** Declared value kinds such as `byMissingHealth(max)`, data for `explain`. _Needs:_ the Warden's speed (+50% at 0 HP). _Lands:_ F2, F12. _As built:_ value kinds are F2's (`hostValue`); F12 moves them into `conditions`, where comparisons read them too, and flags them mirror-safe.
- **[F] M4. Stacking rule per modifier.** `mul` stacks as `value ^ stacks` or `1 + (value − 1) × stacks`. _Needs:_ Stride. _Lands:_ F2.
- **[F] M5. Partial and filtered folds.** Resolve over chosen sources or fold positions, unscoped modifiers only, or the scoped multipliers only; any declared fold position (`'totem'`). _Needs:_ weapon haste's float order, the synced base speed, the aim-lead clamp, the Dread Totem. _Lands:_ F2.
- **[F] M6. What-if fold and previews.** Resolve with a virtual aura delta (+1 stack, without X) and evaluate spell `stats` at any rank with no world (`previewStats`, `explainSpell`), as structured data for the client's text, including formulas computed in `stats` (Projectile Count). _Needs:_ every card preview, tooltip, indicator and catalogue cooldown. _Lands:_ F2, F7, F9.
- **[F] M7. Stat changes, resource policy and projections.** The fold raises `statChanged(bearer, stat, before, after)` for watched stats; a declared resource policy decides what current health does when max health moves (swarm: a gain heals the difference through the heal pipeline, a loss scales); declared stat projections (including partial folds) feed the wire and the mirror. _Needs:_ `refreshMaxHp`, `syncMotionStats` and their seven hand-placed calls. _Lands:_ F2, F10, F13. _As built:_ the watched stat changes are F2's (`watchStats`) and the projections F10's (`defineProjection`, including partial folds). F13 built the resource policy (`health.policy` on the unit system: `heal-gain-scale-loss`, the default, heals a gain through the heal pipeline and keeps the share on a loss; or `scale`, `keep`, or the game's rule), applied by `units.syncHealth` where maximum health can change. Nothing is left.
- **[F] M8. Conditions.** `and` / `or` / `not` composition, comparators both strict and `≤` with epsilon, a mirror-safe flag per evaluator, lazy world conditions. _Needs:_ `noMapBuff`, the class states, the Archmage's strict phase check. _Lands:_ F12. _As built:_ `all` / `any` / `not`, comparisons with `<` and `>` strict and `<=`, `>=`, `==`, `!=` within an epsilon, `mirrorSafe` per test and value kind, `world` tests evaluated last.
- **[F] M9. Every bearer folds.** Creatures resolve stats like heroes (speed, mitigation, cooldown scale), so phase and enrage auras are ordinary modifiers. _Lands:_ F2, F13. _As built (F13):_ every unit has a stat sheet folded by the modifier system with the unit as the host, its own bases at the system's `base` source (`units.statsOf`).
- **[F] M10. Stat scaling.** Flat and multiplier stats, curves, scaled values with ratios on any stat (total or bonus, caster or target, per rank), outgoing multiplier shares per spell, `explainScaled` (§II.3.13). _Needs:_ `damage` and `critDamage` read per weapon at the hit, the weapons' rank tables, the `*SpellDamage` helpers, card previews; flat stats and ability haste for future content. _Lands:_ F2, F5, F7.

**Auras (A)**

- **[F] A1. Full lifecycle.** `applied`, `refreshed`, `expired`, `removed` and `bearerDeath` as hooks and events, with documented raise rules that match swarm's (an eviction raises `removed` before `applied`, a partial spend raises `refreshed`, a losing `highest` or a refusal raises nothing), queue-and-flush nesting, listeners bound to the bearer (a mirror copy hears nothing), hook → triggers → subscribers order, and an aura's own triggers never hearing its own end. _Needs:_ every effect hook, aura cues. _Lands:_ F3. _As built (review after F21):_ `bearerDeath` became `stateEntered`: `auras.enterState` tells every aura on the bearer through `onState(ctx, state)` before those `removedOn` it go, so a death burst is an `onState` of `dead` and runs however the unit died.
- **[F] A2. Application policy per bearer.** Declarative rules on unit traits, plus an `onIncomingAura` hook, that refuse, substitute (a boss takes a slow instead of a freeze), scale (a warrior's control × 0.75), cap (an elite's freeze 0.75 s), arm an immunity window sized from the applied duration, let a sustained source bypass it, and set the magnitude per class (slow 0.45 / 0.7 / 0.85). This replaces "diminishing returns stay out of scope": swarm has them. _Needs:_ `freezeEnemy`, `rootEnemy`, `stunEnemy`, `enemySlowSpeed`, `controlDuration`. _Lands:_ F3, F13. _As built (F13):_ `units.auraPolicy(rules)` gives the aura host's `onIncomingAura`: rules by unit class that refuse, substitute (`instead`), scale and cap the length, and arm an immunity aura for a share of the landed length. **Left open (no phase yet):** a sustained source bypassing the immunity window, and setting a magnitude per class (slow 0.45 / 0.7 / 0.85); a game writes both in its own `onIncomingAura` until a consumer asks for them as rule fields.
- **[F] A3. Periodic beats.** A beat clock of its own, independent of the clock the lifetime counts on; a tick slot; catch-up; a final beat on the expiry tick; a `when` gate; an every-tick beat scaled by `dt`; the first beat one `every` after application, a refresh keeping the beat, the amount per stack; period and amount read live from the source spell's stats when declared. _Needs:_ Whirlwind, Arrowstorm, Regeneration (paused by Wounded), Hexfire's burn. _Lands:_ F3.
- **[F] A4. Instance payload.** A small numeric record captured when an aura is applied (generation, variant, damage snapshot, owner), and a declared rule for whether a refresh hands credit to the newest source. _Needs:_ the Hexfire brand, the Coil toxin. _Lands:_ F3.
- **[F] A5. Durations.** A duration function read per application; auras with no length of their own that require one from the caller (cooldowns); a per-application stacking override (`max` or `replace`). _Needs:_ the ultimates, cooldowns, invulnerability. _Lands:_ F3.
- **[F] A6. Removal and suppression.** `removedOn: UnitState[]` (down, dead, disconnected, class change); `boundToSource` (removed when its source goes down or leaves); `activeWhile` (modifiers suppressed while the bearer is not standing), replacing the class-and-standing gates on the class states. _Needs:_ the barrier, Galeheart, Overdrive, brands, toxins, Enrage, Overcharge. _Lands:_ F3, F13. _As built (F13, the review after F21):_ the unit lifecycle enters the aura system's bearer state of the same name when the aura system declares one (`dead`, `despawned`), so `removedOn` auras go; going down, disconnecting and a class change are the game's own states, which it enters itself (`auras.enterState`).
- **[F] A7. Visibility and view.** `ownerOnly` auras (cooldowns, internal cooldowns); a view that lets the client derive lifecycle cues at zero bytes (the end stamp tells expired from removed from refreshed). _Lands:_ F3, F10.
- **[F] A8. Value merges.** A merge that keeps the duration and adds to the value. _Needs:_ the Gravebloom healing allowance. _Lands:_ F3.
- **[H] A9. Map-wide auras.** An aura on every unit of a side while at least one emitter lives, reference-counted across emitters, correct when a hero joins or revives, with a declared fold position. _Needs:_ the Dread Totem. _Escape hatch:_ a world script applying the aura to the side while an emitter lives, and on join.
- **[F] A10. Area-aura modes.** Enter / exit, or refresh-while-inside with a linger (a top-up), with a per-unit filter such as line of sight from the area trigger. _Needs:_ the Frost Bomb field, the Living Grove. _Lands:_ F3, F8.
- **[F] A11. Hooks get a context.** `onIncomingDamage`, `onLethal` and the lifecycle hooks receive the bearer, its stats and the aura's stacks, value and payload. _Needs:_ Cheat Death (Duration, the regeneration link, rank). _Lands:_ F3.
- **[F] A12. Motion auras.** A predicted forced movement (direction, speed, duration, exact travel, replaces walking, cancels knockback) carried by an aura, not by whatever ability sits on the dodge slot. _Needs:_ Dash, Blink, the `dodge` event. _Lands:_ F9, F10.
- **[F] A13. Clock rescale on aura edges, as data.** An aura declares that its own multiplier on a stat rescales pending activation clocks on chosen edges (applied, refreshed, expired, removed), pending only or all, divided by its own product, not the fold ratio; plus a `rescaleClocks(scope, factor)` proc. `EFFECT_HOOKS` goes; §I.3 no longer keeps it game-side. _Needs:_ Enrage, Overcharge, Overdrive, Galeheart. _Lands:_ F3, F15. _As built:_ F3 raises the rescale on an aura's edges (`AuraDef.rescale`, the factor its own product, handed to the host's `rescaleClocks`); F15 receives it: `spells.rescaleClocks` rescales the caster's `auto` clocks still counting in a spell tag's scope (and with `clocks: 'all'` its running casts' stage time), and the `rescaleClocks` proc (`spells.procKinds`) does the same from any list. Nothing is left.
- **[F] A14. Small semantics pinned.** `ApplyResult { applied, fresh, changed }`; an explicit source overwrites; stacks are `max(1, floor(n))`; an `independent` eviction takes the instance with least time left, the first on ties; remaining is the longest instance; `spend` refuses when too few stacks are held. _Lands:_ F3.

**Triggers and procs (P)**

- **[F] P1. Trigger-level chance.** A trigger's `chance` stays on the trigger and rolls before its internal cooldown, so a failed roll never starts the cooldown; `chance` on a proc is separate (§II.3.7 corrected). _Lands:_ F4.
- **[F] P2. Proc targets in a trigger.** `self`, `eventUnit`, `party`. _Lands:_ F4.
- **[F] P3. Core proc kinds.** Beyond §I.6's list: `summon` and `despawn(reason)` (units, U1), `grant`, `removeByTag` (a cleanse), `setHealth` (bypasses heal stages), `revive`, `clearDisplacement`, `heal` as a share of a stat, `castSpell` through the activation's gates with an optional cooldown, cooldown `scale` / `clamp` on cooldown auras, `rescaleClocks`, `despawnOwned(filter, { unfiredOnly })` (withdraw every pending telegraph and delayed proc a caster owns), `setFocus`, `setPickDelay`, `resetTimer`. _Lands:_ F4, F15, F16, F18, F19. _As built:_ `grant`, `removeByTag` (F4), `setHealth`, `heal` (F5), `castSpell`, `after` (F7), `spawn` (F8), `useAbility` (F9), and at F15 the cooldown `scale` / `clamp` as one `timeLeft` proc (a factor, a cap, or both, on the auras carrying a tag) and `rescaleClocks`. At F16: `despawnOwned` (as `despawnOwned({ tag, delayed })`: "unfired" is the unit's area triggers with a tag, `telegraph` say, and its delayed lists that have not landed), `revive` (the unit system's `procKinds`) and `castSpell` with an optional cooldown (an aura). At F17: `setFocus`, and `setTimer` / `cancelTimer`, which are `setPickDelay` and `resetTimer` on the game's timers. At F18: `summon`, `despawn(reason)` and `despawnSummons`. **Left:** `clearDisplacement` is the game's own proc kind, since displacement is its motion; `heal` as a share of a stat (no phase yet: a `heal` whose amount is a scaled value of a stat covers it today).
- **[F] P4. Observing and continuing** (rule 2): `ctx.apply`, `then` (`andThen`), `pickOne`, outcome-gated `damage(…, { andThen, on: 'landed' | 'absorbed' | 'blocked' })` (the frost nova's slow lands only if the hit did), no-op on dead targets. _Lands:_ F4, F5.
- **[F] P5. Chained delays.** `after(seconds, procs, { from: 'due', slot, bound })`: an aftershock is due at its parent's stamp plus 0.5, not the tick's time. _Needs:_ Judgement. _Lands:_ F7. _As built (review after F21):_ `bound` is a function of the list's owner asked as it falls due; a false drops the list unrun.
- **[F] P6. Damage origin.** `damage` carries a `from` point for impact and knock direction. _Lands:_ F4, F5.
- **[F] P7. Validation and addresses.** Registration refuses a chance outside `(0, 1]`, a non-positive or infinite internal cooldown, an empty `do`, unknown references and cue anchors a trigger cannot place, and checks the predicted rule both ways; explain entries carry an address (aura id + index) for the client's text overrides. _Lands:_ F4, F10.

**Damage, healing and force (D)**

- **[F] D1. The staged pipeline.** Named stages in a documented default order, which a game extends with its own stages (§I.5.6 hatch 5). The default is swarm's order, which suits games in general and differs from the first draft of §II.3.8: **ignore gates** before any roll (invulnerability, the horde hit window, shelter, environmental immunity, a downed or disconnected bearer; environmental damage checks only its own immunity, so fire walls still kill the invulnerable) → **block** roll → crushing → armor and damage taken → **absorbs** (`onIncomingDamage`) → **`onLethal`** (it runs for true damage too: Cheat Death survives the Warden's execute) → health → the **outcome** (`ignored`, `blocked`, `absorbed`, `landed`) → the hit window (opened by blocked and absorbed blows, never by ignored ones) → post-blow (the shove only when health was lost; `damaged` with a crushing flag, so Wounded is a plain trigger) → going down or dying. _Lands:_ F5, F14. _As built (F14):_ the block and crit rolls are one `roll` stage after `outgoing`, running the game's outcome rows (a block row ends the blow `blocked`, an avoid row `avoided`), so the order is ignore gates → outgoing → rolls → mitigation → absorbs → `onLethal` → health → the after-stages; crit still multiplies after the outgoing multipliers, and swarm's block-then-crit order is an `independent` table with those two rows. _As built (review after F21):_ crushing is no longer a built-in stage: swarm places its own after `roll`, reading the share its hits carry in `ext` (the `damage` proc's `ext` reaches the blow's), and its Wounded trigger filters on it in its own event mapping.
- **[F] D2. Attacker side.** The crit stage (on the main stream in swarm's mapping, in hit order), `onOutgoingDamage` / `onDealt` aura hooks that can spend an aura's value (Enrage's lifesteal budget, reset when the aura refreshes), and the meter as a combat-log subscriber. _Lands:_ F5, F11. _As built (review after F21):_ `onOutgoingDamage` scales a blow its bearer deals after the outgoing multipliers (a game with no such aura walks nothing); `onDealt` runs as an after-stage.
- **[F] D3. Healing pipeline.** Heal stages (`healingReceived`, heal-block tags such as Wounded's), regeneration from a stat, heal results in the combat log; `setHealth` bypasses it. _Lands:_ F5.
- **[F] D4. Force pipeline.** Knockback, push and pull are their own "force" blow with `onIncomingForce` hooks and traits: immunity (bosses, objectives), a resist factor and cap (elites × 0.5, cap 1.5), holding ground while casting, shelter. A hazard's knock is vetoed by shelter even when invulnerability ate its damage. _Lands:_ F5, F13. _As built (F13):_ `units.forceStage` reads the traits: immovable and pull-immune units are not moved, a unit holding its ground while it casts is not moved, and a knock resist scales and caps the strength. Shelter stays a game stage over `coveredBy`. _As built (review after F21):_ a blow carries a `direction` its knockback takes, the force carries the blow that caused it, the damage system's `knock` rule decides how hard a finished blow knocks (a default shove, none on a dodge), force kinds are open to the game's own, and the `force` proc (`push`, `pull`) moves a unit from a proc list.
- **[F] D5. The death pipeline.** Rewards before the kill event (souls), the `kill` event (objectives excluded by class tag or trait, not by id), rewards after it (the heart roll), then removal; a despawn is not a death (no rewards, no kill, no death burst), and every system hears which one happened. _Lands:_ F5, F13 (the reward slots; the tables are the game's). _As built (F13):_ an inert unit (`traits.inert`) gets no death or kill event and no rewards through the damage host's `isInert`; `units.despawn` is not a death.
- **[F] D6. Mitigation rows, ratings and outcome rows.** Declared defences per blow kind (rating, attacker penetration in order, curve with cap and negative rule), multiplier rows such as damage taken, rating conversions with diminishing returns, and a roll table of game-declared outcomes in `'single'` (WoW) or `'independent'` (LoL, swarm) mode; `explainMitigation` (§II.3.14). _Needs:_ `armorReduction`, `damageReduction`, `damageTaken`, block and crit in their order; levels, hit, dodge and penetration for future content. _Lands:_ F2, F5, F14. _As built:_ mitigation rows and ratings are F2's and F5's; F14 adds the roll table (`defineRollTable`, rows that avoid, block or scale, chances and multipliers read from either side, `single` or `independent` mode, per-blow `skips` and per-kind `unrolled` effects, the blow's `outcome` for triggers, cues and the combat log, and `explainRolls`).

**Spells and activation (S)**

- **[F] S1. Ownership and ranks** (planned as a spellbook). Each unit owns spells with a rank and a variant (legendary); learning applies a `passive` spell's aura or area trigger, a rank-up restacks it, `ctx.rank` reads it, `auto` and `passive` enumerate it, and a revive re-arms what going down removed. _Needs:_ every card (`player.ranks`, `acquireCard` hooks by id). _Lands:_ F20. _As built (F20):_ no spellbook module: ownership and ranks stay the game's (swarm's `player.ranks`, its offers, slots, links and pacts), and the spell host asks for them: the game arms a spell's `auto` clock as the unit gains it (`spells.arm`; F7's `owns` gated every clock until the review after F21), `rankOf` and `variantOf` give every cast that names none (an `auto` clock, a triggered cast, a `castSpell` outside a cast) the caster's own rank and variant, so `ctx.rank` reads a card's rank. Learning a passive is the game casting the passive spell (its release applies the aura or spawns the owner-attached area trigger; the aura's stacking makes a rank-up a restack), and re-arming after a revive is the same cast; going down removes it through `removedOn` and the area trigger's `standing` bound. Complete.
- **[F] S2. `auto` exactly.** The clock counts while the spell is unowned (a new card fires at once), resets to the interval read at the cast (no carry-over), rewinds positions for every auto cast while the hero aims; a refusal answers `spend` (the whole interval: Whirlwind suppressing Cleave, Hexfire at its cap) or `retry(delay)` (no target). _Lands:_ F7, F16. _As built:_ F7 built the clock and the costs; at F16 a refusal by a reach rule (range, sight, placement) costs what no target costs (`onNoTarget`, a retry). The aim rewind while a hero aims is the game's input (its `target` hook reads it). Complete. _As built (review after F21):_ the costs are one `next(report, interval, caster)` hook answering the seconds until the clock tries again; `autoNext` is the default (the next step after no target, out of reach or a release that set nothing off, the interval otherwise), which a game's own `next` falls back to.
- **[F] S3. Unit auto-attack.** A melee swing: a reach gate polled every tick on its own timer, independent of the pick gap, reset after a cast's recovery, spent even when the target's invulnerability ignores it; strength and reach per template. _Needs:_ every melee horde kind, group bodies. _Lands:_ F16, F17. _As built (F16):_ the swing is the template's `autoAttack`, armed at spawn, an `auto` spell whose `reach` is polled every step (a reach refusal retries) or, cheaper for a horde, whose `ready` hook answers from the distance the game measured to steer (a refused cast costs a few hundred nanoseconds, a `ready` answer a few dozen), `afterCast: 'reset'` holds it through the unit's casts and restarts it after each one's recovery, and a `next` answering the interval spends it when an invulnerable target ignores it; strength and reach are its stats. Its independence from the pick gap holds by construction: the swing is its own `auto` clock and the pick gap a brain timer (F17). Complete.
- **[F] S4. `button` exactly.** Cooldowns per slot (`cooldown.<slot>`), `applies` durations scaled by a stat, all buttons decided before any fires, the trigger cast path (no slot cooldown, slot looked up from the loadout), casts stamped at the tick's start for lag compensation, the release inside the motion step between `activate` and travel (Blink's departure point). _Lands:_ F9.
- **[F] S5. Timeline.** `recover` as a function of the outcome (a charge into a wall staggers 1.2 s instead of recovering 0.8 s); a stagger contract (no cast, move, turn, pick or swing; script timers held); windup `cancelIf` (the tether's target lost); a channel whose clock is an area trigger's life (the Circle of Fire); stages that hold the script's timers; a frozen caster pausing its own telegraphs even after the cast ended. _Lands:_ F7, F16. _As built:_ F7 built `recover` by outcome, `cancelIf`, and `pause` / `finish` / `interrupt`; at F16 the stagger contract's "no cast" is `canAct` over the stagger's state, interrupts come from unit states, and a frozen caster's telegraphs pause (`bound.pausedBy`). Stages that hold a script's timers are `ai.hold` from the game's behaviours (F17, F19); "no pick, move or turn" is the game's behaviour reading the cast's stage; a channel whose clock is an area trigger's life is `spells.finish` from the area trigger's `onEnd`. Complete.
- **[F] S6. Liveness.** A cast is live while its area triggers or its summons live ("the event is still running"). _Lands:_ F7, F18. _As built:_ F7 held a cast while its delayed procs and area triggers live; at F18 a summon holds the cast whose procs summoned it until it dies or despawns. Complete.

**Area triggers and the world (W)**

- **[F] W1. Ending.** Self-despawn from `frame` or `onContact`; one `onEnd(reason)` for `expired | spent | self | bound | replaced | source-gone`, so shared claims are released; a fade-or-silent cue policy on bound ends (as built: the kind's `end` cue hook, answering nothing for silence); `suspend` instead of end while the owner is down (Ember Blades keep their clock); `bound` by a condition (the granting ability is still in the owner's loadout, not "the owner is an Engineer"); a dies-with-source rule that also covers telegraphs that already fired. _Lands:_ F8.
- **[F] W2. Timing.** Expiry checked before the frame, after it (the last frame runs), or with `dt` clipped to the expiry stamp; a declared order within a tick for `move`, `frame`, `every`, `onContact`, `onExpire`; pulses rescheduled by cadence (`prev + s`) or restart (`now + s`), a first delay, `seconds` from stats; owner-shared clocks with options for start (first member), reset when empty or survive, catch-up, and membership judged at the beat; an arming delay whose leftover carries into the same tick (the Sentry). _Lands:_ F8.
- **[F] W3. Hit ledgers.** Several named ledgers per area trigger or cast (`once`, `rehit-cooldown`, `reserve / claim`), chosen per phase or sweep, shared with spawned siblings, released on end; target-locked contact (a missile that hits only its locked unit). _Needs:_ Chakram (out, back, orbit), Glaive reservations, Voltaic. _Lands:_ F8.
- **[F] W4. Init with the id.** `init(c, spawn)` runs after the host allocates the id from the game's shared counter. _Needs:_ the Chakram's lean by id parity. _Lands:_ F8.
- **[F] W5. Queries over area triggers.** By kind, owner and order, with a declared state view; despawn a chosen subset; `coveredBy(point, tag)`; interceptors (a projectile tested against domes before walls); `limit` computed from stats. _Needs:_ Tempest's goal exclusion, the Coil, Detonation spacing, the magnet, Sanctuary. _Lands:_ F8.
- **[F] W6. Continuous exposure.** A unit's tick path `(from, to, t0, t1)` against time-varying shapes gives seconds inside, the union across instances of a kind (overlapping pools never multiply), subtraction of shelter shapes, sub-tick invulnerability windows, and a rate or lethal outcome; an edge-crossing hook on the path. _Needs:_ Inferno, Venom Flood, blood pools, the Archmage's fire rings and their lethal crossing, the Sanctuary's `exposedSegments`. The framework gives the swept path tests (seconds inside a shape, edge crossings, sub-tick windows); the union across a kind and the Sanctuary's subtraction are a game pipeline stage (§I.5.6). _Lands:_ F8.
- **[F] W7. Shape algebra.** Complement (`outside`: Venom Flood, the burn outside the fire ring), union and difference (a lane with a gap: Inferno), polygon band, and geometry helpers (segment intersection, area, centroid, edge distance). _Lands:_ F1.
- **[H] W8. Blockers and keep-outs.** An area trigger or unit contributes dynamic colliders or keep-out zones filtered by side or tag, with a push speed and change notifications to the host's collision and navigation; the host's mover consults them with the previous position (charges, teleports). _Needs:_ Prison walls, the Venom ward, the Sanctuary push-out. _Escape hatch:_ host collision and navigation (game-owned), fed by the game's area trigger kinds.
- **[H] W9. Occupancy.** Footprints and reserved sites that placement respects across kinds. _Needs:_ Prison, Gravebloom, the Totem, map buffs. _Escape hatch:_ a world-query extension the placement hooks call.
- **[F] W10. `WorldQuery`, completed.** Previous positions and relative sweeps; `isPositionClear(p, r)`, bounds and `clamp`, a body sweep against static geometry returning `{ position, hit }`; a sample-and-score point picker (annulus, arc, walk-back, filter, score, attempts); query options: distance measured to centre or edge, inclusive bounds, lower-id tie-breaks, an exclude set, a condition filter, `minSeparation`, composite order, a shape-less world-wide filter and count; `densest` with a candidate cap, a centroid result and first-maximum ties; `chain` with a supplied first link; and a game-typed extension point for collision-aware searches (the Inferno passage search, `squareClear`). Hexfire's leap is `nearest` with a filter, not `chain`. _Lands:_ F8.
- **[H] W11. Pickups.** An area trigger consumed by one unit: the nearest collector with an id tie-break, reach from the collector's stat, attraction by age, coalescing at spawn (merge radius, live cap), a lifetime; collect-all by query (the magnet); kinds for heal, resource, party aura. _Needs:_ souls, hearts, the magnet, map buffs, supply drops. _Escape hatch:_ game area trigger kinds, a collector query extension and a game-owned pickup step.
- **[H] W12. Interactables.** Touch fires an action; a refusal leaves the object in place. _Needs:_ the Pact Sigil (the vote screen stays game-side). _Escape hatch:_ a game area trigger kind whose touch runs a game proc.

**Creature and world scripts (C)**

- **[F] C1. Per-tick sensing.** `on.tick` and declared sensors (dwell accumulators such as "seconds a foe is within r", +dt / −2dt), and `on.castStart`. _Needs:_ the hug meters of the Juggernaut, Warden and Archmage. _Lands:_ F19. _As built (F19):_ `tick` handlers in the unit's step and the game's own bus events (`on`), with each behaviour's own state for its meters; the dwell rules are the game's. Complete.
- **[F] C2. Reactions.** Ordered rules polled each tick before the picker (condition, spell, whether it bypasses or consumes the gap and the budget), able to read a cooldown's remaining time. _Needs:_ forced Whirlwinds, the Warden's raise, the Archmage's repulse and blink. _Lands:_ F17, F19. _As built (F17):_ `ai.first`, the first spell of an ordered list that would start, with the game's filter; `ai.remaining` reads a timer and the aura system a cooldown. At F19 the rules are a game behaviour's `tick`, in the order it chooses; their data form is the game's. Complete.
- **[F] C3. Pick spec.** The gap counted from the cast's start or end and only in chosen stages, a retry delay when nothing fits, a first delay, a per-phase override, `setPickDelay`. One picker serves the horde, the elites, the bosses and the event scheduler (four copies today). _Lands:_ F17. _As built:_ `ai.pick`, the one weighted anti-repeat picker; the gap, the retry delay, the first delay and `setPickDelay` are a pick timer the game (and F19's scripts) starts with `ai.start` or `setTimer`. A per-phase gap is the game's phase behaviour restarting the pick timer (F19). Complete.
- **[F] C4. Budget policies.** An interface with world scope: `allows` with live capacity, `claim` at the start of every cast with a time to live, `release` on release, death and despawn, exempt spells; the horde's points pool and the elites' shared gaps are two policies. _Lands:_ F17. _As built:_ the picker's `allows` filter is where a policy plugs in; the policies themselves (claims with a time to live, releases on release, death and despawn, exempt spells) are the game's, which keeps the toolkit general.
- **[F] C5. Target policies.** Host-supplied (flow-field nearest by path, sticky nearest with a margin, first in reach); a spell may set the focus (the tether). They drive `engage` and `targetLost`. _Lands:_ F17. _As built:_ the focus on each brain and the `setFocus` proc; policies are the game's functions over its world, and `engage` / `targetLost` are game events bound to a script's `on` (F19). Complete.
- **[F] C6. Phase parameters.** Spells read the caster's phase and its `params` (`stabChain`, `charges`, `aftershock`, `barrageShots`). _Lands:_ F19. _As built (F19):_ a phase and its parameters are a behaviour's state, which spells read through the game's host or `scripts.stateOf`. Complete.
- **[F] C7. Timer anchors.** `spawn | introEnd | transitionEnd`, a per-phase first delay, `resetTimer`. _Lands:_ F19. _As built (F19):_ timers are F17's, started from `spawn`, a phase's handler or a transition spell's end event, and `resetTimer` is `setTimer`. Complete.
- **[F] C8. Summon spec.** `count` or `keep` as functions, placement rules (annulus, clamp, clearance from foes, attempts, skip or stop), stat overrides (spawn at wave 6), a pausable refill; one-shot summons (the Warden's raise, sized by missing health) as well as kept lists. _Lands:_ F18. _As built:_ the `summon` proc: `count` or `countOf`, a point or a pick in an annulus with clearance and attempts, stat overrides and inherited shares; `summonsOf` and `despawnSummons` for a list's count and its despawn. At F19 a kept list is a game behaviour: a refill timer counting `summonsOf`, and `summonDied` a bound unit event routed to the owner. Complete.
- **[F] C9. Movement intents.** Written into a reusable output (no allocation); facing with a turn cap, separate from moving; speed factors; a leash to an area; eased leap arcs; holding still through recovery and stagger. Leashes and arcs leave the deferred list. _Lands:_ F17. _As built:_ `MoveIntent`, one reused record per brain (chase with a stop distance, hold, move to a point, keep range, flee a unit or a point; a speed factor, a facing, a turn rate), which the game's movement steers by; removed at the review after F21, since nothing in the framework read it and swarm steers its horde by a flow field: a game keeps its movement wishes in its unit fields or script state. **Left to games:** leashes, eased leap arcs and holding still through a stagger are the game's movement (a stagger reads the cast's stage); charges, leaps and knockbacks stay motion a spell or a force drives.
- **[F] C10. Script view.** Script stage ids, an end stamp, the spell, a direction, a bound-target entity and an origin, for the wire. _Lands:_ F10, F19. _As built:_ F10 gives a running spell cast its view (`spells.viewOf`: spell, rank, stage id, stage length, end stamp, start, caster and credit). At F19 a script's view is the game's: its numbers come from its behaviours' state (`scripts.stateOf`) and the cast's view. Complete.
- **[F] C11. World scripts.** A script with no body, owned by the world: phases, timers, summon lists, `summonDied`, outcomes, persistent state across occurrences, "running until its spawns are gone", and several casts at once (the one-cast rule is for units). _Needs:_ all seven map events, supply and buff timers, the per-wave magnet. _Lands:_ F21. _As built (F21):_ creature scripts on bodiless units: a spawn names its script, the event's phases and outcomes are its behaviours and timers, its spawns are its summons (`summonsOf`, a death routed to the owner, unbound ones outliving it), its pools and walls are area triggers it owns, it ends by despawning itself, and state across occurrences is a behaviour's `shared`; a unit already runs several casts at once. Complete.
- **[H] C12. Groups.** A world script that owns members, runs group phases and sets its members' movement intents (march, pincer, ring), with the slowest pace as a `min` modifier. _Escape hatch:_ a world script's `on.tick` writing its members' movement intents. _As built (F21):_ a group script owns its members as summons and writes their movement from `tick` (the game's own fields since the review after F21 dropped F17's intents); bound members leave with it.
- **[H] C13. Event scheduler.** It starts the map events: calm gaps rolled per gap, lerped by run progress and divided by a pace stat; opening grace and wind-down; a pending pick retried until it places and re-rolled after a while; anti-repeat; per-run caps; concurrency classes (floor events exclusive, a pressure event joining one after a delay on a chance); `active()`; timings read from the event spells, never duplicated by hand (`EVENT_LIFETIME_ESTIMATES` is already stale). The director keeps its roster and curves as content. _Escape hatch:_ the game's director as a game-owned step, on the shared picker (C3) and world scripts. _As built (F21):_ the director stays the game's; it starts an event by spawning its world unit and reads `scripts.count` for its concurrency classes.
- **[F] C14. One source of phases.** The director's own boss-phase tracking goes; it listens to the script's phase events. _Lands:_ phase 7.

**Units, lifecycle and progression (U)**

- **[F] U1. Unit templates.** `defineUnit`: a base stat vector (health, damage, speed, radius, attack interval, mitigation, knock resist), class tags (horde, elite, boss, objective, heavy), traits (U2), a script, an auto-attack spell, reward and kill-accounting data, crowd-cap bypass; `spawnUnit(template, at, { owner, stats, tags })` snapshots per-instance stats at spawn (a mob keeps its spawn wave's numbers), and `despawn(reason)` is distinct from death. _Needs:_ all thirteen kinds, objectives, adds, walls, roots, the totem. _Lands:_ F13, F18. _As built (F13):_ `defineUnits` (base stats over the table's, class tags, traits, an optional auto-attack, reward numbers), `units.spawn` with stats snapshotted and the spawn's own on top, `units.despawn`. At F18: ownership (`summonsOf`, bound despawns, `creditOf`) and `despawn(reason)` with its reason on the event. **Left:** the script (F19), the crowd-cap bypass (the game's spawn rule, reading `summonsOf`), and pooling units (a spawn allocates today, about 1 µs).
- **[F] U2. Traits.** Heavy, objective side, immovable, inert (no rewards, no kill event), knock resist with a cap, pull immunity, holds ground while casting. They replace `heavyKind`, `isObjective`, `IMMOVABLE`, `NEVER_SPREADS`, `OBJECTIVES` and `excludeFromSanctuaries`. _Lands:_ F13. _As built (F13):_ all of them, as `UnitDef.traits`. _As built (review after F21):_ the traits are what the framework's own pipelines read (immovable, inert, pull immunity, holding ground, knock resist); heavy and an objective, which only a game's rules read, are class tags (`units.hasTag`), and a template's reward numbers are the game's own `data`.
- **[F] U3. Lifecycle and revive.** Standing, downed, dead, disconnected and despawned, with bus events and `onDowned` / `onRevived`; revive is a channel spell (a standing, connected ally within 3.5 m with line of sight fills it, it decays otherwise) whose completion returns `setHealth`, `revive`, invulnerability and the game's own `clearDisplacement`. _Needs:_ `reviveProgress` and the four cleanup sites. _Lands:_ F13, phase 3b. _As built (F13):_ the lifecycle states and their moves, with `spawned`, `changed` and `despawned` events in place of `onDowned` / `onRevived` hooks, and `units.revive`; at F16 the `revive` proc a channel's completion returns, and casts cancelled on leaving `standing`. **Left:** revive as a proximity channel spell (a spell and an area trigger a game writes; the framework's pieces exist), which the entry assigns to swarm's phase 3b. _As built (review after F21):_ the lifecycle is alive, dead and despawned; going down and disconnecting are the game's own states (an aura a unit state reads, standing up again when it is removed), since only co-op heroes have them.
- **[H] U4. Draft and levels.** An offer pool of spell references with a max rank, a slot category and eligibility conditions (max rank, slot limits, the legendary gated by its linked passive, class signatures); the draw on a stream with the hand size from a stat; rerolls as a resource with one-time milestones; party-shared XP on a curve with one offer per level. The co-op screen flow stays game-side. _Escape hatch:_ a game system on its own ranks (S1: the host's `owns`, `rankOf` and `variantOf`), conditions and streams.
- **[H] U5. Loot.** Drop tables per template with pity accumulators (a heart pity that ramps faster while anyone is under half health), rate multipliers from party state and stats (`heartDrops`, `xpValue`), drops spawned as pickups, in the death pipeline's order. _Escape hatch:_ a game system on the death pipeline's reward slots (D5).

**Cues, replication and prediction (R)**

- **[F] R1. Cues.** An anchor kind (`self`, `target`, `world`, `entity`); an audience declared on the cue (owner only, party, everyone), which the server routes; param kinds `vec2`, `vec2[]` with quantisation, entity id and registry id; no strings anywhere (text and colours become ids, banners become cues plus a view). _Lands:_ F6.
- **[F] R2. Predicted cue dedupe.** Predicted cues carry a key the server's copy matches; cues that depend on server-allocated ids are never predicted. _Lands:_ F6, F10.
- **[F] R3. The mirror.** The stamp contract (`expirySteps` walk with its large-step fallback, re-stamping predicted world-clock auras when the clocks part, the motion-live read by the clock's countdown rule, which is `≥ 1e-8` in swarm's; as built, a stamp's distance on the server, with one timing on every clock), mirror-safe conditions and split folds (synced base times a mirror-evaluated factor), and a read-only cosmetic view of the interpolated world for aim assist and cast cues only. _Lands:_ F10.
- **[F] R4. Views.** Aura views that tell lifecycle ends apart, owner-only auras, stat projections (M7), script views (C10). _Lands:_ F10.

### II.6.3 Corrections made to the earlier sections

- **§I.3:** the clock rescale moves into the framework (A13); units, progression, loot, pickups, world scripts and the event scheduler join the framework column; the director keeps only content.
- **§I.5:** stamps by default, countdowns where a game needs them (K3); the fold cache holds compiled modifier lists, and conditions are evaluated on every read (what they read changes without the bearer knowing).
- **§I.7.1:** new phases F20 (ranks and variants, planned as a spellbook) and F21 (world scripts), documentation as F22; diminishing returns (as application policy), leashes and leap arcs leave the deferred list; loot, levels, drafts, pickups and the events calendar stay in Tier 2 and in swarm's own code on the hatches.
- **§II.3.4:** `tickIn` is a game slot (K1); `onEnd`, suspension and the timing modes (W1, W2).
- **§II.3.7:** a trigger's `chance` stays on the trigger and gates its internal cooldown (P1).
- **§II.3.8:** the pipeline order (D1); `onLethal` runs for true damage; application policy replaces "diminishing returns stay out of scope" (A2); Cheat Death's `deathEscape` is its escape window (invulnerability × Duration and a speed boost), its 180–240 s recharge is its own cooldown aura (motion clock, predicted), its charges are the aura's value and its heal is `setHealth`; the Sanctuary's shelter is positional, tested at the ignore stage by `coveredBy` and subtracted from exposure, not an aura added on entry; Whirlwind's and Arrowstorm's beats run on their own beat clock in the attack slot, with a final beat on the expiry tick (A3).
- **§II.3.11:** Gambler's Oath's rerolls are a `grant` in the sealing spell's release, not on the aura, so a hero joining mid-run does not receive them again.
- **§II.3.12:** reactions, sensors, the pick spec, phase parameters, timer anchors, target policies and world scripts join the script model, and the Grave Warden sketch is rewritten from the real code.
- **§II.4:** Hexfire's leap is `nearest` with a filter; the Tempest sketch's Maelstrom pick is `pickOne` after the damage; the hero, Arsenal and creature rows are corrected (Dash, Shockwave, Sanctuary, Arrowstorm, Frost Bomb, Whirlwind, Enrage, Living Grove, Sentry, Overdrive, Cheat Death, the Warden, the Archmage, the elites).
- **§II.5:** phase 3b (units, lifecycle and the pipelines), phase 10 is required, phase 13 (progression, loot and pickups) and phase 14 (the zero-special-case check).

### II.6.4 What removes each kind of special case

| special case in swarm today                                                                                                    | removed by                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `kind === …` for heavy, objective, boss, elite, archmage, warrior, golem, rogue (crowd, knock, control, rewards, stats)        | unit templates and traits (U1, U2), A2, D4, D5                                             |
| `stepElite` / `stepWarden` / `stepArchmage` dispatch, `*Ability` fields, named timer fields                                    | creature scripts (§II.3.12, C1–C10)                                                        |
| `classId === …` (Engineer sentries, Barbarian whirlwind, Ranger arrowstorm and crit base, per-class cooldown switches)         | the game's ownership record and loadout bounds (S1, W1), A3, A6                            |
| effect ids in code (`EFFECT_HOOKS`, `haste`, `wounded`, `frostSlowed`, `resumeSprint`, `overdrive`, `galeheart`)               | A1, A3, A6, A13, D1, M5                                                                    |
| spell and visual id lists (`HEAVY_HAZARDS`, `HEAVY_BLOWS`, the blast list, elite volley, frost nova, repulse, `ARROW_FAN`)     | proc data (§II.3.6), P4                                                                    |
| card id sets (`LATE_SCALED`, `HASTE_EXEMPT`, `SCOPED_HASTE_LAST`, `DURATION_SCALED`, `PIERCING`, `CHAINING`), `CARD_MECHANICS` | spell tags as scopes, `stats`, the host's ranks (S1)                                       |
| per-card and per-event arrays and fields on `Game`, `PlayerState` and `Enemy`                                                  | area trigger store, auras, script state, C11                                               |
| `startWaveEvent` / `activeWaveEvents` switches, cross-event placement gates, the fixed `updateEncounters` order                | world scripts (C11), the game's director and a placement query extension (C13, W9)         |
| the exposure block in the hero loop, the ward and sanctuary checks in the enemy loop, the prison collider sync                 | swept path tests (W6) plus a game pipeline stage; host collision fed by area triggers (W8) |
| `hurtPlayer` / `hurtEnemy` branches, `preventCardDeath`, `refreshMaxHp` call sites, lifesteal, regeneration                    | D1–D5, M7                                                                                  |
| going-down, disconnect and revive cleanup lists                                                                                | U3, A6, W1                                                                                 |
| pickups, souls, hearts, magnet, supply, map buffs, the sigil                                                                   | game systems and area trigger kinds on the hatches (W11, W12, U5)                          |
| strings in the simulation (`announce` banners, `text` and `color` cue params, visual strings)                                  | R1                                                                                         |

### II.6.5 What stays in the game, legitimately

The world and its plumbing, which the framework reaches only through host interfaces and which never branch on content ids: navigation and the flow field; collision, walls and the knockback integrator; crowd separation; input sanitising; the arena's geometry, clearings and sites; the wave and event director (roster, curves, tuning dials, calm gaps, concurrency classes); the card draft, levels, loot and pickups; formations; blockers and reserved sites; everything on the escape hatches of §I.5.6; economy numbers; Colyseus schemas and codecs; the co-op screen flow (reward and pact screens, the vote, timers); and everything the client draws. A rule for review: plumbing may read tags, traits, stats and views, never a content id; content-owned hatch code may name its own content, and nothing else.

### II.6.6 Proving it

- **A zero-special-case test in swarm.** After the migration, `no-content-branches.test.ts` scans `core.ts`, the world adapter and every non-content module for comparisons against registry keys (`=== '<key>'`, `kind ===`, `classId ===`, `ranks.<key>`, `attackClocks.<key>`, `has('<aura>')`), built from the registries themselves; content modules and declared hatch code are outside its scope, and its allowlist for the plumbing shrinks phase by phase and ends empty. CI also prints the escape report (§I.5.6), so the 5% stays visible and small.
- **Goldens that do not exist yet**, recorded before their family moves (phase 0 grows): continuous exposure and the Sanctuary's subtraction, every map event, revive and going down, pickups and drops, the card draft's draws, contact melee, and each boss phase with its reactions.
- **The framework's side:** each gap above lands with unit tests in its phase (§I.7.0), and the horde benchmark grows to about 300 scripted units with movement intents and contact checks, plus the pickups.

## II.7 Decisions

1. **The name: decided, area trigger.** WoW's name for the same thing (`AreaTrigger`), preferred over construct, spell object and entity. In code it is `AreaTriggerDef` / `defineAreaTrigger`, and in prose always the full "area trigger", never a bare "trigger", which stays the event listener an aura owns (§II.3.7).
2. **Snapshot stats by default: decided.** The plan snapshots (Searing, Judgement and Tempest do) and lets a spell opt into `live` (Hexfire does today).
3. **Credit travels with the cast: decided.** Area triggers tick outside any trigger, so a cast captures its owner and damage source at its start and hands them on in every context and proc origin (§II.3.10), rather than every area trigger re-entering an ambient scope.
4. **Auras on creatures: decided, in phase 3.** Creatures get auras in the same phase as heroes (§II.5 phase 3; F3 in the framework): creature statuses become auras, and Hexfire, Coil, Frost, Cheat Death, the Sanctuary and every creature control move onto them there, instead of writing enemy fields through procs, and `hurtPlayer` loses its special cases.
5. **Replication unification: decided, done in phase 9.** With pacts phase B, it is where the protocol moves; one `AreaTriggerSchema` and a client renderer registry replace the storage adapters and the per-kind schemas.
6. **Pacts' and the barrier's wire change: decided, it lands with phase 9.** Step B (drop `pact.owned` and `PlayerSchema.barrier`, give `EffectSchema` a `value`, rename trigger ids) is a protocol bump; it waits for the replication phase so all byte changes land together in one protocol bump.
7. **Passives as auras: decided, required.** It risks the stat fold, so it stays late (phase 12) and is held by every stat golden, but without it the passives remain the last content read by id (§II.6).
8. **How far brains move: decided, into creature scripts.** Timelines and weights move onto spells, and everything else a brain does (phases, timers, adds, when to cast, and positioning as a movement intent) moves into the creature's script (§II.3.12). Only steering, pathfinding and the flow field stay the game's.
9. **The parity strategy: decided, every golden stays bit-exact**, held by swarm's own code on the hatches through §II.6.1's rules (the host owns the tick order and the stream table, procs can be observed). _Revised for timing after the review after F21:_ swarm first moves every timer to `time = tick × dt` and the one timing of rule 4 in its own code, in one change that re-records its goldens (each diff an end one step earlier, reviewed as such) and re-runs its balance bench; its port then stays bit-exact against those goldens. The cheaper alternative (re-recording the goldens per family and letting the framework run its own fixed pass with keyed rolls everywhere) was declined because it gives up the proof that behaviour did not change.
10. **Who owns invulnerability: decided, an aura** whose `onIgnore` gates blows at the pipeline's first stage, stacking with `max`; the horde hit window stays a game-side stage of the same gate, as §I.3 keeps hit windows in the game.
11. **The wave director's split: decided by the escape-hatch rule.** The pickers and the budgets are the framework's (F17), and world scripts run the events (F21); the director itself (roster, opening burst, elite schedule, group clock, calm gaps, concurrency classes, curves) stays swarm's code as a game-owned step.
12. **Units live in the framework: decided** (templates, traits, lifecycle, spawning), since control rules, rewards and the pipelines all read them; leaving them in the game would keep its `kind` branches.
13. **Stat scaling: decided, both kinds, League of Legends style** (§II.3.13). Flat stats (attack damage, ability haste) and multiplier stats (damage bonus, critical damage) live in one table; spells scale with any of them by a ratio, and multiplier stats by a share of their bonus. Evaluation order is fixed, and a share of 1 reads the stat unchanged, so swarm stays bit-exact.
14. **Mitigation and ratings: decided, WoW and League of Legends style** (§II.3.14). One curve library (hyperbolic armor, haste, avoidance, stacking, rating tables) whose parameters can read the attacker (level, penetration, hit); mitigation and outcome rows are the game's data, so misses, dodges, parries and resistances are built now instead of deferred. Swarm's armor is `hyperbolic` with its own constant and stays bit-exact.
15. **Threat and aggro: decided, not built.** Targeting stays on target policies (F17); combat maths stays on the curves (§II.3.13, §II.3.14). Aggro, if a game ever wants it, is a target policy on the escape hatches.
16. **Generic first, swarm on the hatches: decided** (§I.9 decision 7). This guide maps swarm onto the framework; it does not shape the framework around swarm. Each swarm rule it names that the framework's defaults do not give (the add-only gain, sequential draws on the main stream, its revision counter, its tick interleaving) lands in swarm's code on a hatch, and the framework's part is the hatch and its generic tests. A phase that finds a swarm behaviour no hatch can express adds a generic hatch, never a swarm mode.
