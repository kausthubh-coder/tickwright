# Tickwright v2: design spec

Source of truth for building Tickwright v2. Approved direction from the user on 2026-10-14. The human-readable plan is `.agents/plans/2026-10-14-tickwright-v2.html`. Where this spec gives a number, use it. Where it doesn't, choose, write the value into the Codex data file, and note it in your milestone report.

## The game in one paragraph

An anime co-op voxel sandbox. Players see and exploit the world's exact rules to build Minecraft-style technical farms (mob farms, an iron-farm analog, trading halls, crop machines, raid farms). They spend the output in a fast third-person shooter with movement tech and loot that pops. A story across six regions gives reasons to explore and new rules to exploit. Worlds hold 1 to 8 friends.

## Pillars, in priority order

1. **Feel smart.** Every rule is short, deterministic, visible in Sight and written in the Codex with exact numbers. Farms come from combining documented rules. There are no hidden special cases.
2. **Feel fast.** Combat pays out every second: crits, kill pops, loot fountains, the style meter, movement tech.
3. **Make it yours.** Blocks, Ley logic and farms are fully player-built and shared in co-op.
4. **Worth exploring.** Landmarks visible from far away, regions with their own rules, a story that sends you somewhere new.

When pillars conflict, the earlier one wins. Example: a combat buff that makes farm design irrelevant loses to pillar 1.

## Core loop

Meet a mob or Folk behavior with a new rule. Read it with Sight. Build a farm that exploits it. The farm runs while you fight and explore. Craft guns, mods, ammo and tools from the output. Push into a harder region or boss. The story unlocks the next region and rule.

Farms are the economy. Combat is the test and the fun. Kills give a small share of loot and no levels. Your level comes from Insight (discoveries, see Progression).

## Fixed decisions

- Camera: third person over the shoulder by default. `V` toggles first person. Building works in both.
- Mouse: Pointer Lock with `unadjustedMovement: true` where supported.
- Platform: desktop keyboard and mouse first, then gamepad. Touch is out of scope until milestone 8.
- PvP: off.
- World: finite, 2048 x 2048 blocks, 192 high, bounded by the Null (story). One overworld plus the Yomi realm (milestone 7).
- Tick: 20 ticks per second, deterministic, shared code in `packages/sim` runs on server and client.
- Storage: Convex owns saved worlds. PartyServer (Durable Object) owns live ticks. Never write per-tick state to Convex.
- Hosted play needs a verified Clerk session. Guest access is local only.
- Keep the name Tickwright.

## World and chunks

- Block coordinates are integers. One block is 1 m.
- Chunk section: 32 x 32 x 32 blocks. Column: 6 sections (192 high).
- Block storage: per-section palette plus packed indices. Empty sections cost nothing.
- Block state: up to 16 bits per block (id plus state such as facing, growth stage, signal).
- Simulation distance: sections within 4 chunk columns of any player, plus sections held by Anchors. Only these tick.
- View distance: client renders up to 12 columns (384 blocks), with far terrain as low-detail meshes past 6 columns.
- Worldgen is deterministic from the world seed: height noise, biome map, caves, ores, structures (villages, shrines, dungeons, boss arenas) placed by seed with hand-authored templates.
- Regions (biomes plus story gating) in order: Hoshino Meadows (start), Lantern Marsh, Kitsune Forest, Ember Peaks, Yomi (separate realm), Archive Capital.
- Landmarks visible from far away in every region: a giant torii, a lantern lighthouse, a world-tree, a smoking peak, the capital spire. Every peak should show the next landmark.

## Light

- Sky light 15 under open sky, spreading sideways and down with -1 per block through transparent blocks.
- Block light from emitters (lantern 15, lamp 15 when powered, glowshroom 7), -1 per block, blocked by opaque blocks.
- Effective light = max(block light, sky light scaled by time of day). Spawning reads raw sky light and block light separately (see Spawning).
- The renderer bakes the same light values into vertex colors, so what Sight shows is what you see.

## Day and night

- One day is 20 real minutes: 14 day, 1 dusk, 4 night, 1 dawn. Shared per world. Paused when the world is empty.
- At night sky light counts as 4 for spawning, so the overworld surface spawns hostile mobs.

## Technical systems (the farm rules)

Every value here goes in a Codex data file (`packages/sim/src/codex/*.ts`) that both the simulation and the in-game Codex read. Sight renders from the same data.

### Tick order

Each tick runs these phases in this order. The Codex prints this order.

1. Player inputs (movement, place, break, use)
2. Scheduled block ticks (repeaters, pistons, crops due), first in, first out
3. Ley settle (signal propagation, breadth-first, same tick)
4. Random ticks: 3 random blocks per loaded section (crops, grass spread, leaf decay)
5. Entities move and think, oldest first
6. Spawning: one attempt per loaded column
7. Items: merge, collect, pick up
8. Folk schedules and Guardian checks (every 20 ticks)

Randomness uses a PRNG seeded per (world seed, tick, column) so the same build gives the same result.

### Spawning (mob farms)

- Each tick, each loaded column picks one random height from 0 to one above its top block.
- A hostile spawns there if: the block below is a full opaque block (not glass, slab, lamp, Ley part, or "spawn-proof" blocks), two air blocks above, block light 0, sky light ≤ 4 (or night), no player within 24 blocks, some player within 128 blocks, and the world is under its mob cap.
- Packs: after a success, 3 more tries within 4 blocks.
- Mob cap: 30 hostile per online player, counted across the world.
- Despawn: farther than 64 blocks from every player, 1 in 800 chance per tick. Farther than 128, removed at once. Named mobs never despawn.
- Which mob spawns depends on region and the surface block (for example Gloomlings on stone and grass, Lanternbacks only on marsh mud).

### Items

- Dropped items are entities: gravity 0.04 blocks/tick², air drag 2%/tick, ground friction 40%/tick.
- Matching items within 0.5 blocks merge (check every 10 ticks, stack max 64).
- Pickup radius 1.5 blocks, pickup delay 10 ticks after dropping. Lifetime 6000 ticks (5 minutes).
- Collector (hopper analog): pulls items from the cell above, holds 5 stacks, passes 1 item every 8 ticks to the container it faces. Can be locked by a Ley signal.
- Currents (water streams): spring water flows up to 7 blocks and pushes entities (items, mobs, players, pearls) at 0.15 blocks/tick.

### Ley logic (redstone analog)

- Wire carries 0 to 15, -1 per block.
- Sources: lever, button (10-tick pulse), pressure plate (any entity, including items), light sensor (outputs light level), Reader (comparator analog: outputs container fill 0 to 15, or compares and subtracts), Watcher (observer analog: one 2-tick pulse when the block it faces changes state).
- Components: repeater (1 to 4 tick delay, restores to 15, can be locked from the side), inverter.
- Outputs: lamp (light 15, stops spawning), door, piston (pushes up to 12 blocks), sticky piston (pulls one back), Gel block (slime analog: moves attached blocks, so flying machines are possible), Launcher (dispenser analog: fires or places the item it holds), current gate, Anchor (keeps a 3 x 3 column area loaded).
- Determinism: wire changes settle in the same tick, breadth-first from the changed source. Scheduled updates run first in, first out. No update order may depend on position, hash order or memory layout.
- Exploit or bug: a combination of documented rules is a feature and is never patched. Anything that depends on frame rate, latency or load order is an engine bug.

### Crops and animals

- Crops grow one stage on a random tick if light ≥ 9 and the soil is hydrated (spring water within 4 blocks horizontally, same level). Unhydrated soil grows at 1/3 speed.
- Crops: spirit rice (needs flooded soil), sunroot, frost melon (stem crop that places its fruit on an adjacent block, so a Watcher can detect it), ember pepper, lantern gourd.
- Bloom Dust (bonemeal analog) from Gloomling bones advances 2 to 5 stages.
- Farmer Folk harvest ripe crops near their workstation and replant; they share food with other Folk (this drives breeding).
- Animals: Fluffs (wool, dyeable), Cluckers (lay an egg item every 5 to 10 minutes), Moobs (milk, meat). Breed with their food; 5-minute cooldown; babies grow in 20 minutes.

### Folk, trading and Guardians (the iron-farm and trading-hall analogs)

- Folk claim a bed and a workstation within 48 blocks. The workstation sets the profession: Smith (anvil), Farmer (compost bin), Scribe (scroll rack), Alchemist (cauldron), Forgewright (forge), Lamplighter (lantern stand).
- Schedule: work 2/3 of the day at the workstation, gather at a bell in the evening, sleep at night.
- Trading: each profession has 5 tiers, unlocked by trading XP. A Folk's trade list is fixed once you trade with it. Until then, breaking and replacing its workstation rerolls the list (so players can hunt rare trades such as the Echo mod).
- Prices: demand rises 1 step each time a trade sells out, and falls after a restock. Folk restock twice a day at their workstation.
- Curing: a Wilted Folk (zombie-villager analog), purified with a Cleanse flask while it is weakened, gives a permanent 50% discount to the player who cured it, and smaller discounts to nearby Folk through Gossip.
- Breeding: two Folk breed when there is a free bed and each has 12 food points worth of crops in inventory.
- Fear and Guardians (iron-golem analog): every 20 ticks, a group of 3 or more Folk that slept within the last day, are within 16 blocks of each other, and can see a hostile within 8 blocks, and that have not seen a Haniwa Guardian in the last 30 seconds, summon one Haniwa Guardian within 8 blocks on a valid surface. Haniwa drop 3 to 5 Bronze. This is the intended Bronze farm.
- Gossip: Folk share opinions of players. Hurting a Folk lowers reputation across the village and raises prices.

### Raids (Wilt Tides)

- Killing a Wilt Captain gives Omen. Entering a village with Omen starts a Tide: 5 waves, spawning at the village edge at deterministic points.
- Tide drops: Revive Charms (totem analog) and Jade (trade currency). Raid farms are intended.

### Blink Pearls

- A thrown pearl is an entity. When it touches a block or a mob, its owner teleports there and takes 2 damage, as long as the pearl's chunk is loaded.
- A pearl held in an upward current floats forever, so stasis chambers work. Burst blocks add velocity to entities above them, so pearl cannons work.

### Strain (entity cramming analog)

- More than 24 entities in one block cell take 1 crush damage per tick.
- A chunk column with more than 300 entities draws a Null rift (story mob) after a 30-second warning shown in Sight. This keeps the server inside its budget and makes the limit a visible rule.

### Yomi realm (milestone 7)

- A portal frame of obsidian-analog blocks lit with a Spark leads to Yomi. 1 block in Yomi equals 8 in the overworld, so Yomi highways are fast travel.
- Kitsune spirits travel in packs: hit one and every Kitsune within 32 blocks aggroes for 30 seconds. This is the intended aggro-trap farm for Gold Leaf.

### Sight and the Codex

- `Tab` toggles Sight. It shows: light numbers on hovered blocks, spawnable cells (green) and the reason a cell can't spawn (red with the failing rule), mob cap use, Ley signal on every wire, Folk links (bed, workstation, last-slept, Fear timer, Guardian cooldown), chunk borders and loaded state, entity counts per cell, item counts on Collectors.
- The Codex (`J`) lists every rule with exact numbers, unlocked when the player first sees the related block or mob. Building a known named farm for the first time (for example the first Guardian that spawns from a player-built Fear setup) records a Codex entry with the builders' names.

## The shooter

### Movement

| Verb | Key | Numbers |
|---|---|---|
| Run | WASD | 6.5 m/s |
| Sprint | hold Shift | 9 m/s, no firing heavy weapons |
| Jump | Space | 1.25 m height; coyote time 100 ms; jump buffer 120 ms |
| Double jump | Space in air | unlocked in chapter 1 |
| Slide | Ctrl while sprinting | keeps momentum, 1.2 s, slide-jump keeps 90% of speed |
| Dash | Q (or double-tap direction) | 6 m in 0.15 s, 2 charges, 1.2 s recharge, 150 ms invulnerable |
| Spirit Thread (grapple) | E on a block | 32 m range; tap pulls you in, hold swings; 4 s cooldown |
| Glider | Space while falling | milestone 7; Spark rockets boost 20 m/s for 1.5 s |

Movement is client-predicted with the shared sim and reconciled by the server.

### Weapons (Arms)

Crafted at a Forge from farm output. Two Arms equipped, swap with `1`/`2` or the scroll wheel. The Spirit Pistol has infinite ammo so a player is never stuck.

| Arm | Fire | Numbers | Ammo source |
|---|---|---|---|
| Spirit Pistol | hitscan semi-auto | 18 damage, 2x weak-point crit, 6 shots/s | infinite |
| Scatter | 8 pellets | 9 each, strong knockback (launches mobs: combines with kill chambers) | Gloom Essence shells |
| Needle Rifle | charged hitscan | 0.8 s charge, 120 damage, pierces up to 5 | Bronze needles (Guardian farm) |
| Bloom Launcher | arcing projectile | 80 splash, 3 m radius; breaks weak blocks only inside Wilt zones | Spark powder (Ember Peaks farm) |
| Lantern Beam | continuous | 60 damage/s, ramps up, ignites | lantern oil (Lanternback farm) |

Every Arm has 3 mod slots. Mods come from mob drops, Folk trades and bosses (examples: Ricochet, Chain Spark, Echo (refund on crit), Gravity Well).

### Parry

`F` punches. Punching an incoming projectile within 150 ms of contact reflects it at 2x damage, gives 0.2 s of hit-stop and refills one dash charge.

### Charms (stacking items)

Run-independent, permanent items held in 12 charm slots. Each charm stacks to 5 with diminishing returns (each extra copy gives 70% of the previous). They proc chains in the style of Risk of Rain 2: on crit, on kill, on dash, on parry. Rare charms drop from farms at low rates and from bosses at fixed rates, so farm throughput matters.

### Feedback that must exist (dopamine checklist)

- Weak points on every elite and boss, with a distinct crit sound and yellow damage numbers.
- Hit markers; a kill marker with a different sound; multi-kill callouts.
- Hit-stop: 30 ms on crits, 60 ms on kills of elites, 120 ms on boss phase breaks. Capped.
- Screen shake that decays within 150 ms; recoil kick; muzzle flash light.
- Kill pop: mobs burst into item fountains; drops get a beam colored by rarity; XP orbs magnetize to the player.
- Style meter (D, C, B, A, S, SS, SSS) from varied kills, parries and air time. Higher style raises drop rate up to +50% and charm proc chance.
- Short slow motion on a boss's final hit.

### Enemies

Each mob has one combat behavior and one exploitable farm rule.

| Mob | Region | Combat | Farm rule |
|---|---|---|---|
| Gloomling | Meadows | small swarm, leaps | spawns at light 0, walks off edges, takes fall damage |
| Wilt Brute | Meadows | elite, weak-point back crystal | none (combat elite) |
| Lanternback | Marsh | shoots lantern globs | won't step down more than 1 block; lights a 7-block radius that stops other spawns |
| Kitsune Blinker | Forest | teleports when hit or stared at | teleports to a random dark cell within 16 blocks |
| Ember Imp | Peaks | explodes near players | drops Spark powder; explosion triggers nearby imps |
| Kitsune (Yomi) | Yomi | pack aggro | hit one, all within 32 aggro |
| Null Mite | anywhere with high Strain | eats blocks | spawns only from Strain |

Every enemy attack has a telegraph of at least 400 ms (wind-up pose, glint and sound).

### Bosses

Gloom Matron (Meadows; her adds are farmable), Lantern Colossus (Marsh; weak points light up in sequence), Nine-Tails (Forest; parry her orbs), Ember Wyrm (Peaks; glider fight), Archivist Ren (Capital; rival duel), the Null (finale). Each drops a Law Shard and a fixed rare charm.

## Progression

- Insight: earned by discovery only (first time reading a rule in Sight, first Codex entry, first named farm, boss kills). Insight raises your level and buys Arts: Sight upgrades (see spawn attempts live, see Folk Fear timers), movement upgrades (double jump, Spirit Thread, glider), building tools (copy a structure as a blueprint, mirror placement).
- Gear comes from farm output through crafting. Level shows what you understand. Gear shows what your farms produce.
- Law Shards (endgame): placed in a Codex Altar, each one amends one rule inside your claim (lower the darkness mobs need from 0 to 3, double item lifetime, disable fall damage, raise the Collector rate). A claim holds 3.

## Story

The Drift is a world run by the Codex, a law engine that ticks twenty times a second. People live by its rules without seeing them. You can see them. That Sight makes you a Tickwright, which the Archive, the order that guards the Codex, treats as a crime. The Null, a static that deletes whatever costs the most to simulate, is eating the outer regions.

Cast: Pell (retired Tickwright who lost her Sight; mentor; hides that she once made the Null worse), Ren (Archive agent who patches laws; rival; in chapter 2 she patches a rule and the players' farm stops working until they find a new design, then she becomes an uneasy ally), Bit (a tiny glitch sprite companion who speaks rarely and never explains puzzles), and one Folk per region whose friendship scenes teach a movement Art.

| Chapter | Region | New rule | Boss |
|---|---|---|---|
| 1 Sight | Hoshino Meadows | spawning, light, items | Gloom Matron |
| 2 Currents | Lantern Marsh | currents, Folk trading, Ren's patch | Lantern Colossus |
| 3 Blink | Kitsune Forest | pearls, teleport mobs, Guardians | Nine-Tails |
| 4 Spark | Ember Peaks | explosions, glider, Tides | Ember Wyrm |
| 5 Below | Yomi | 8:1 travel, pack aggro | (Yomi gate warden) |
| 6 Collection | Archive Capital | Law Shards, the Null | Archivist Ren, then the Null |

Delivery rules: scenes play in-engine, 30 to 90 seconds, always skippable. Portraits are rendered from the VRM models. Story progress belongs to the world, so the crew shares it. Quests point at the next rule ("Lanternbacks won't step down. Find another way to move them."). After every return to the home village, at least one character has a short new line (Hades-style hub talk).

## Multiplayer

- A world is a private co-op room for 1 to 8 players, joined by invite link. Drop in and out at any time.
- One Durable Object per world runs the authoritative simulation for loaded sections.
- Shared per world: blocks, farms, Folk, story progress, Codex discoveries, Law Shards. Per player: inventory, Arms, mods, charms, level and Arts. A player's inventory and progress also persist per world in Convex.
- Persistence: dirty chunk sections are saved to Convex every 30 seconds and when the last player leaves; player state on leave and every 60 seconds. The world pauses when empty.
- Netcode:
  - Own movement: client prediction with the shared sim, server reconciliation (Gambetta).
  - Others: interpolated 100 ms behind.
  - Hitscan: the client shows the hit immediately; the server validates by rewinding entity positions by the shooter's measured latency plus interpolation delay, capped at 200 ms (Valve lag compensation).
  - Projectiles: simulated by the server; the client spawns a local visual immediately and reconciles.
  - Block edits: predicted, confirmed or rolled back by the server.
  - Chunk streaming: binary WebSocket messages with palette plus run-length encoding; entity snapshots as deltas at 20 Hz, limited to entities within 96 blocks of each player.
  - Enemy attacks telegraph ≥ 400 ms, which hides up to about 250 ms of round trip.
- Budgets per world: 8 players, 300 entities per column (Strain), the server tick must finish in under 25 ms at the 8-player test load.

## Visual direction

Anime voxel: the look of Dragon Quest Builders 2 and Hytale, not Minecraft. Blocks stay blocks; everything around them is soft and stylized.

- Renderer: three.js `WebGPURenderer` with TSL and the automatic WebGL2 fallback. Test both paths.
- Voxel material: one TSL toon material for all chunk meshes. Two- or three-band ramp on N·L, tinted shadow color (cool, never black), per-vertex ambient occlusion (Minecraft smooth-lighting style), baked sky and block light from the simulation, a soft rim light.
- Meshing: greedy meshing in a Web Worker per section; rebuild only dirty sections; far columns use a simplified mesh.
- Outlines: depth and normal edge pass on the world; inverted-hull outlines on characters and mobs.
- Sky: gradient dome driven by time of day, toon clouds, sun and moon, stars. Fog matched to the horizon color.
- Water: toon shader with depth tint, shoreline foam, gentle waves.
- Foliage: cross-quad plants and leaf blocks with vertex wind; grass tufts on grass blocks near the camera.
- Emissives (lamps, Ley wire, crystals, weak points) feed a mild bloom pass. Tone mapping AgX.
- Textures: 32 x 32 hand-painted-style atlas generated by a deterministic script (`scripts/gen-textures.mjs`) from noise and per-block palettes, soft and painterly, no harsh contrast. Players can override with a resource pack folder later.
- Characters: VRM 1.0 models via `@pixiv/three-vrm` with MToon. Animations from Quaternius' Universal Animation Library (CC0), retargeted and baked to `.vrma`. Players can import their own `.vrm` avatar (stored per player; validate size ≤ 15 MB and license metadata). Default placeholder models must be CC0 or created in code.
- Mobs: stylized models (Quaternius CC0 monster packs or built from primitives in code) with the toon material and outlines.
- UI: clean anime HUD: hotbar, two Arm slots with ammo, dash pips, style meter, crosshair with hit markers, damage numbers. Dialogue box with name plate and rendered portrait.

### Performance budget

Measure with `node scripts/measure-gpu.mjs low on` (Radeon 780M, the mid-laptop target) and `high on` (RTX 4060). Baseline before v2: 2.1 ms GPU per frame on the 780M at 2383 x 1163 render pixels (`.agents/evidence/gpu-baseline-2026-10-14.json`).

- 780M, 1920 x 1080 window at DPR 1.25, view distance 12: GPU ≤ 10 ms p50, ≤ 14 ms p95; 60 fps.
- JavaScript main thread ≤ 5 ms per frame; meshing off the main thread.
- Draw calls ≤ 300; first download ≤ 25 MB; time to play ≤ 8 s on localhost production build.
- Never claim performance from SwiftShader.

## Milestones

Each milestone ends with a playable build, passing `bun run check` and `bun run build`, a report in `.agents/reports/<date>-m<N>-<slug>.html` (follow the repo's report format), and screenshots in `.agents/evidence/`. Do not start the next milestone inside the same task.

Every milestone has three kinds of checks:

- **Agent checks** (the implementer): unit and replay tests, the GPU harness, two-browser play via `verify-tickwright`.
- **Reviewer checks** (Claude, after the milestone): reads the diff, reruns the tests and harness, plays two clients, compares screenshots against the visual direction.
- **User checks** (the user plays): listed per milestone.

### M1: Engine foundation

Build: chunked world (sections, palette storage), deterministic worldgen for Hoshino Meadows plus a flat test world, sky and block light propagation, chunk streaming over the room socket, Convex section persistence (dirty sections only), interest management, client prediction and reconciliation for movement, block place and break with prediction. Remove the old 56 x 48 island, the Gloomling tower, the cutaway view and the iso camera. Keep the PartyServer room, Convex saves, Clerk and the dev scripts.

Agent checks: replay determinism test (same seed and inputs give the same world hash after 2000 ticks), light propagation tests, section save and restore test, collision tests, two clients see the same edits, a restarted server restores edited sections.

User checks: walk around a generated landscape with a friend in another tab, place and break blocks, restart and see the edits kept.

### M2: Anime look

Build everything in Visual direction, plus third- and first-person cameras, a placeholder VRM character with idle, run, jump, slide and aim animations, and the HUD shell.

Agent checks: GPU harness on both GPUs meets the budget; screenshots at noon, dusk and night from the same spots; WebGL2 fallback screenshot.

User checks: does it look anime and good? Does it hold 60 fps on your laptop?

### M3: The shooter

Build: the movement kit (without glider), Spirit Pistol, Scatter and Needle Rifle, parry, Gloomlings and Wilt Brutes with telegraphs, the full dopamine checklist, lag compensation, the style meter, death and respawn at a shrine.

Agent checks: tests for lag-compensated hits (a shot that hit on the shooter's screen within 200 ms is accepted), dash invulnerability, parry window; a two-client fight recording.

User checks: is a 5-minute fight against a Gloomling swarm fun? Does it feel fast?

### M4: Technical systems

Build: spawning rules, item physics, Collectors, currents, all Ley parts including Gel blocks and Watchers, crops and Bloom Dust, animals, Strain, Anchors, Sight and the Codex.

Agent checks: rule tests for every Codex value; a scripted test world containing a working Gloomling drop farm, an automatic frost-melon farm (Watcher plus piston), a Ley clock and a flying machine, each producing the expected output per in-game hour with the same result every run.

User checks: build a Gloomling farm using only Sight and the Codex.

### M5: Folk, trading and Guardians

Build: Folk with beds, workstations, professions, schedules, trades, demand pricing, restocks, rerolling, curing discounts, gossip, breeding, Fear and Haniwa Guardians. A starting village structure.

Agent checks: tests for each rule; a scripted Guardian farm producing Bronze at a deterministic rate; a trading-hall scenario.

User checks: build a Bronze farm and a small trading hall.

### M6: World and story, chapters 1 and 2

Build: Hoshino Meadows and Lantern Marsh fully dressed, landmarks, villages, shrines and dungeons, quest and dialogue system with portraits, Pell, Ren and Bit, Gloom Matron and Lantern Colossus, Ren's rule patch event, Wilt Tides, the first Law Shards, Insight and Arts.

User checks: play chapters 1 and 2 in co-op from a new world.

### M7: Content expansion

Build: Kitsune Forest, Ember Peaks, Yomi, Blink Pearls, Spirit Thread, glider with Spark rockets, Bloom Launcher and Lantern Beam, charms, mods, the remaining bosses, chapters 3 to 6.

### M8: Web polish and hosting

Build: load-time work (asset streaming, KTX2, meshopt), settings (graphics presets, sensitivity, key rebinding), gamepad, touch prototype, hosted deployment through `ship-tickwright` only after the user's explicit go.
