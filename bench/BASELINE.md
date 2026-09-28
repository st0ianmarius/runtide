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
