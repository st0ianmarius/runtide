# Benchmark baseline

`npm run bench` (tinybench, `bench/run.ts`), never part of `npm test`. Each task runs a batch of 1,000 operations per call, since one operation is far below the timer's resolution; the numbers are the mean time per operation.

Recorded at F1 on the development container (Node 22.22.2, linux x64, shared and noisy), as the range of three runs. They are a first reference, not a budget: CI on a fixed machine type sets the budgets later (§I.5.4).

| benchmark                                        | ns per op |
| ------------------------------------------------ | --------- |
| registry `get(id)` + typed column read           | 21–29     |
| registry `has` bit + hook dispatch table call    | 11–14     |
| bitset `has`                                     | 9–14      |
| bitset `intersects` (an immunity check)          | 20–30     |
| timing wheel schedule + collect (15% overflow)   | 54–80     |
| keyed roll, 5-part key passed as arguments       | 34–66     |
| keyed roll, 4-part key in a reused scratch array | 30–43     |
| sequential stream draw                           | 11–12     |

Added at F2 (same container, Node 22.22.2, range of three runs). The fold reads a hero-like sheet: six sources, eleven modifiers over the two stats read (two of them in gated lists, one at three stacks, one conditional). "Live folded stats" evaluates a spell's damage (three adds, one amp) through a sheet's view, so it folds each stat it reads; a snapshot finish reads the caster's frozen stats and folds nothing, which is the per-hit cost.

| benchmark                                   | ns per op |
| ------------------------------------------- | --------- |
| modifier fold, two stats (6 sources, gates) | 241–311   |
| scaled value evaluation, live folded stats  | 271–291   |
| scaled value finish from a snapshot         | 67–68     |
| scaled cooldown through the haste curve     | 39–56     |

Added at F3 (same container, Node 22.22.2, range of the runs). "Apply ×3 + fold" re-applies three auras to one bearer (a `stack`, a `refresh` and a `highest` aura, each with modifiers, so each application restacks and queues nothing: no hook, no bus listener) and folds two stats through the aura gates. The horde tick steps the world clock of 2,000 bearers holding three auras each (one beating every 0.5 s, through the host), and is reported per tick, not per operation.

| benchmark                                     | per op     |
| --------------------------------------------- | ---------- |
| aura apply ×3 + fold two stats                | 690–855 ns |
| aura tick, 2,000 bearers × 3 auras (per tick) | 177–291 µs |

Added at F4 (same container, Node 22.22.2, range of three runs; `bench/procs-triggers.ts`). Trigger dispatch raises one `hit` about the first unit of a party whose every unit holds three auras: one with two self triggers, one with a `party` trigger, one with none. Every trigger passes a filter and runs one `grant` through the host, so one event fires 7 triggers in a party of 5 and 27 in a party of 25; the time is per event. The proc list runs 8 prepared procs (two aura landings that refresh or stack, a cleanse, grants to self, the event unit and the party, and a group behind one roll), per list.

| benchmark                                    | per op       |
| -------------------------------------------- | ------------ |
| trigger dispatch, owner + 4 party listeners  | 1.10–1.35 µs |
| trigger dispatch, owner + 24 party listeners | 4.56–5.55 µs |
| proc list run, 8 prepared procs              | 2.19–2.86 µs |

After the buffer fix (F5's first commit: hot reused arrays keep their storage and fill by index up to a count, instead of `length = 0`, which drops V8's backing store; bitset `clear` zeroes in place; aura removals use no closure), same container, range of three runs: timing wheel schedule + collect 41–65 ns, aura apply ×3 + fold 669–817 ns, aura tick 156–232 µs, proc list run 1.67–2.09 µs, trigger dispatch 1.09–1.38 µs and 3.82–4.56 µs. Outside tinybench, 1M aura apply + remove on one bearer went from 762 garbage collections to 43 with a bus listener (383 to 28 without), and from about 1.5–2.2 µs to 0.5–0.8 µs per pair.

Added at F5 (same container, Node 22.22.2, range of three runs; `bench/damage.ts`). "Full pipeline" is one blow by an attacker (an outgoing multiplier, a crit roll on a sequential stream, both at a spell's share) on a target whose three auras hook it (an ignore gate that passes, an absorb that spends its value, a damage-taken scale), through a block roll, two mitigation rows (hyperbolic armor, damage taken), health and one `taken` subscriber, per blow. The burst deals one such blow to each of 100 targets, per burst. A blow allocates only what V8 boxes and what the absorb hook returns: 28 minor GCs over 1M blows.

| benchmark                                | per op     |
| ---------------------------------------- | ---------- |
| blow, full pipeline, 3 hooking auras     | 490–740 ns |
| burst of 100 blows on 100 hooked targets | 54–71 µs   |

Added at F6 (same container, Node 22.22.2, range of three runs; `bench/cues.ts`). One tick fires 200 cues (120 impacts on units with a facing, 60 owner-only numbers, 15 casts with three params, 5 chains of four points), then encodes the batch; the time is per tick. "Specs" is the authoring path (`fireCue` with reused spec objects, params by name); "by slot" is the hot path (`emit`, then the params' slots resolved at load). The decoder reads one tick's bytes into a client buffer. One tick is 2,294 bytes (11.5 per cue). Over 20M cues the slot path and the decoder cause under 200 minor GCs, what V8 boxes; the spec path about 470, from reading the params by name.

| benchmark                                  | per tick |
| ------------------------------------------ | -------- |
| fire 200 specs + encode as bytes           | 54–58 µs |
| emit 200 by slot + encode as numbers       | 31–35 µs |
| decode 200 events from bytes into a buffer | 31–37 µs |

After the fast-properties fix (F7's first commit: `createPool`, `createScratch`, `createClock`, `createTimingWheel`, `createBus`, `createScope`, the proc system and the damage system returned object literals with getters, which V8 keeps in dictionary mode, so every method call was a hash lookup; each is now an internal class whose functions are arrow fields, still callable detached), same container, range of two runs: timing wheel schedule + collect 38–49 ns, trigger dispatch 0.80–0.90 µs and 3.01–3.38 µs, proc list run 1.73–1.99 µs. Outside tinybench, per operation (three runs each, before → after): 16 pool acquire + get + release 0.95–1.29 µs → 0.51–0.63 µs, a nested scratch take + give pair 43–55 ns → 15–19 ns, a clock step + reads + `stampAt` 108–138 ns → 84–100 ns, a bus payload + raise to one subscriber 44–48 ns → 12–19 ns, a scope `withOwner` + reads 49–53 ns → 10–15 ns.

Added at F7 (`bench/spells.ts`), measured on a different machine from the rows above: an Apple Silicon Mac (arm64, Node 25.8.1), range of three runs, so compare these rows with each other and not with the container's. As a yardstick, the F3 aura horde tick measures 96–101 µs per tick on this machine (156–232 µs on the container). The horde is 2,000 casters, each with an `auto` spell every 3 s that winds up 0.5 s, channels 2 s beating every 0.5 s (one prepared `grant` per beat) and recovers 0.25 s, staggered so their casts sit at different points of their course: about 1,820 of them have a spell in flight on any tick. A tick steps the clock, then each caster's auto clock and casts; the time is per tick. The instant cast runs the whole cast order with a stats table (one scaled value, one constant) and a release of one prepared proc. A delayed list is one `after(0)` scheduled through the proc runner and landed on the next tick. Over 3,000 horde ticks (6M caster steps) the horde causes 9 minor GCs, 1M instant casts about 31 and 1M delayed lists 2, which is what V8 boxes; the bench makes about 1,825 cast records while it warms up and none after.

| benchmark                                        | per op     |
| ------------------------------------------------ | ---------- |
| horde tick, 2,000 casters with a spell in flight | 124–125 µs |
| instant cast, table stats + release              | 337–357 ns |
| `after(0)` scheduled + landed, per list          | 328–336 ns |
| 1,000 `after(0)` lists landing on one tick       | 185–193 µs |

Added at F8 (`bench/world.ts`, `bench/area-triggers.ts`), same Apple Silicon Mac (arm64, Node 25.8.1), range of three full runs. The whole suite now loads more modules, so the F7 rows read higher in a full run than in F7's (the horde tick 140–141 µs); run alone, the horde tick measures 99–101 µs at F7's commit and at F8's, so F8 changed nothing there. The world holds 2,000 units spread evenly at random over 200 m square (about 4.5 m apart, half on each side, 0.5 m bodies), queried for the foes of one of them; the grid's cells are 4 m. A move tick moves every unit a little and updates the point index: the uniform grid in place, or the k-d tree rebuilt (with one query to force the build), which is why the grid is `createMemoryWorld`'s default (§I.5.4: the benchmarks decide it). The area trigger tick steps the clock, the world and 200 area triggers over 2,000 foes: 150 pools 3 m across beating every 0.5 s on their own clocks, and 50 missiles orbiting at 12 m/s whose contacts sweep a 0.5 m body relative to the units' motion and record in a `rehit` ledger of 1 s; every beat or contact that catches a unit runs one prepared `grant`. Over 3,000 ticks the area trigger tick causes about 9 minor GCs above the bench's own setup, and 3,000 grid move ticks (6M unit moves) about 33, which is what V8 boxes; the queries cause 1–4 per 3,000 calls. No area trigger record is made after warm-up.

| benchmark                                               | per op       |
| ------------------------------------------------------- | ------------ |
| world: `inside` a 6 m circle, 2,000 units (grid)        | 301–360 ns   |
| world: `nearest` foe within 10 m (grid)                 | 756–805 ns   |
| world: `densest` 3 m cluster within 15 m, 16 candidates | 4.4–4.9 µs   |
| world: `sweep` 40 m with a 0.5 m body (grid)            | 412–453 ns   |
| world: 2,000 units move, grid updated, per tick         | 77–80 µs     |
| world: 2,000 units move, k-d tree rebuilt + a query     | 171–179 µs   |
| `secondsInside` a circle over one tick                  | 84–85 ns     |
| area triggers: 150 pools + 50 missiles over 2,000 units | 55.7–56.1 µs |

Added at F9 (`bench/abilities.ts`), same Apple Silicon Mac (arm64, Node 25.8.1), range of three full runs. 1,000 heroes each hold all three buttons down on every motion step: a dodge (1 s cooldown, a 0.5 s sprint aura, and a `travel` hook that moves the hero while it sprints), a skill blocked while sprinting (2 s) and an ultimate that resets the dodge's cooldown (4 s); every cast releases one prepared `grant`, about 58 of them a tick. A tick steps the clock, then each hero's auras, its press and its travel, so most of it is the aura tick (the aura system's own rows above); the press checks, the loadout reads and the travel hooks are about a fifth of the profile. Run alone, outside tinybench, the tick measures 134–135 µs. Over 3,000 ticks it causes about 18 minor GCs: the fires allocate their aura applications and argument tuples, which a press path that fires a few dozen times a tick can afford. In the same full runs the F7 horde tick reads 154–156 µs (140–141 µs in F8's), as the suite loads another module; the area trigger tick is unchanged.

| benchmark                                           | per op     |
| --------------------------------------------------- | ---------- |
| abilities: 1,000 heroes press three slots, per tick | 157–163 µs |

Added at F11 (`bench/combat-log.ts`), same Apple Silicon Mac (arm64, Node 25.8.1), range of three full runs. One landed blow raised on a core bus with one damage kind and recorded by a combat log of the default 4,096 entries, then the same with a damage meter subscribed. Over a million entries each, recording causes 0–2 minor GCs.

| benchmark                                     | per op   |
| --------------------------------------------- | -------- |
| combat log: a blow raised and recorded        | 45–46 ns |
| combat log: a blow recorded, meter subscribed | 59–63 ns |

Added at F13 (`bench/units.ts`), same Apple Silicon Mac (arm64, Node 25.8.1), range of three full runs. A unit system over an aura system whose modifiers fold through a modifier system, with each unit's own bases at its `base` source. A spawn makes the unit's aura state, caster state, stat sheet and view, and shares its template's compiled base list (a spawn with its own stats compiles one); units are not pooled yet, so a spawn allocates. The derived-state reads intersect the unit's aura tags with the states' bitsets; the folded stat reads a sheet with one aura modifier.

| benchmark                               | per op     |
| --------------------------------------- | ---------- |
| units: spawn + despawn a grunt          | 899–910 ns |
| units: canAct + canMove                 | 13 ns      |
| units: a folded stat (an aura modifier) | 41–42 ns   |

At F14 the block and crit stages became one roll stage over a declared roll table (`bench/damage.ts` rolls swarm's block-then-crit as an `independent` table, both rows reading a stat directly). On the Apple Silicon Mac, range of three full runs, a blow through the full pipeline measures 302–310 ns against 279–282 ns before it, and a burst of 100 blows 30.6–31.6 µs against 28.2–28.8 µs: about 25 ns a blow for the general row loop and the spell-share reads.

At F16, measured against the F15 commit in a worktree on the same Mac and the same day (two full runs each, since today's runs all sit above the F7 rows): the horde tick is 144–146 µs before and 145–146 µs after, the instant cast 408–410 ns before and 411–419 ns after (the reach check is one plan read for a spell with none), a delayed list 307–343 ns before and 327–337 ns after, and 1,000 lists landing on one tick 194–195 µs before and 208–221 µs after: the list of live delayed lists `withdrawDelayed` walks costs a push and a swap-remove per list. A unit spawn is 913–921 ns before and 948–950 ns after (one more field).

Added at F17 (`bench/units.ts`), same Apple Silicon Mac, range of three full runs. A tick of 2,000 thinking grunts, each with a pick timer restarted 1–3 s away whenever it fires (about 33 fire a tick at 30 Hz, each picking from four spells), measures 27.0–29.9 µs; a weighted pick of four `ai` spells, each checked through `spells.check`, 644–676 ns. The unit spawn row, now making and freeing a brain, measures 1,014–1,066 ns against 948–950 ns at F16 (another session was running on the machine during these runs); the horde is spawned on the tick task's first run so the spawn row does not carry it.

At F18 a unit spawn also gives the unit its summons list and, for an owned unit, joins its owner's: spawn plus despawn measures 1,023–1,092 ns, against 1,014–1,066 ns at F17, within the noise of these runs.

Added at F19 (`bench/units.ts`), same Apple Silicon Mac, range of three full runs. `scripts.step` over 2,000 units whose template names no script measures 2.0–2.5 µs a tick (a slot check each); over 2,000 scripted units with nothing due and no `tick` handler, 4.2–4.6 µs; and `scripts.collect` plus the step over 2,000 units whose one behaviour picks from four spells on a timer every 1–3 s, 35.2–36.9 µs, against 27.0–29.6 µs for the same picks fired straight from `ai.step`: the difference is the step loop and each handler's reused context.

At the review after F21 (P1), a stat read no longer walks every gated list the game defines. Before, every sheet held a copy of every aura's modifiers and a read asked the host's stacks for each one, so a read grew with the aura registry: over 2,000 bearers with 10% holding one aura, 31 ns per read with one speed aura defined, 121 ns with 10, 2.8 µs with 100 and 8.1 µs with 300 (and 16–38 KB of entries per sheet). Now the aura lists are compiled once for the system; a sheet points at a stat's shared entries where it has at most four gates at a fold position, and otherwise holds a marker where a read walks the host's held gates (`held: auraGates`): 30, 42, 38 and 44 ns for the same four registries. The new row reads a stat on a bearer holding 2 of 120 aura lists. Same Apple Silicon Mac, range of two full runs, against the F21 commit run the same day:

| benchmark                                       | F21            | now            |
| ----------------------------------------------- | -------------- | -------------- |
| fold a stat, 120 aura lists in the game, 2 held | about 3,000 ns | 80.6–81.6 ns   |
| units: a folded stat (an aura modifier)         | 43.1–44.1 ns   | 44.5–44.8 ns   |
| modifier fold, two stats (6 sources, gates)     | 121.3–126.6 ns | 129.1–129.2 ns |
| scaled value evaluation (live folded stats)     | 142.9–146.3 ns | 155.2–156.8 ns |
| units: spawn + despawn a grunt (template stats) | 1,005–1,015 ns | 1,198–1,218 ns |

The spawn row reads 961 ns in a run without the 120-aura system: that second modifier system, whose sheets hold markers, makes the sheet build polymorphic in the one bench process, which a game with one modifier system does not see. The F21 figure for the new row is the old read's cost at 100–120 lists from the numbers above.

At the review after F21 (P2), a caster steps only the `auto` clocks it has armed (`spells.arm`: a template's `autoAttack` at spawn, a card as the game grants it), in place of one clock per `auto` spell of the registry, each unowned one asking `host.owns` every step once it ran out (the host hook is gone). With 20 `auto` spells defined and 2,000 casters owning one each, far from casting, the auto step measured 155–162 µs a tick before (a scratch bench on the F21 code) and 17–20 µs now. The bench registry now defines the 20: the horde tick still arms only `strike` and measures 142.8 µs (142.8–145.2 µs at P1, with one `auto` spell defined), and the new row steps 2,000 idle casters with one of the 20 armed. Same Apple Silicon Mac, range of two full runs:

| benchmark                                                      | per op         |
| -------------------------------------------------------------- | -------------- |
| spells: auto step, 2,000 casters, 1 of 20 auto spells armed    | 20.2–20.3 µs   |
| spells: horde tick, 2,000 casters in flight (tick)             | 142.8 µs       |
| units: spawn + despawn a grunt (template stats), now arming it | 1,133–1,163 ns |
