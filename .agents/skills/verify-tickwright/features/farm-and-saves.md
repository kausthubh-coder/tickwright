# Farming and saves

## Sub-features
Darkness/headroom/distance rules, falling mobs, sunlight damage, drops, merging, pickup, Convex save/reload, room isolation.

## How to get to it (user POV)
Wait at the altar while the tower farm runs, then walk toward it and collect violet crystals. Use F to strike nearby Gloomlings.

## Driving it with T3 preview
Observe mobs appear without attacks, then dropped crystals. Walk to a real drop using keyboard events and verify the Essence counter increases and the second client sees the updated inventory. Read `tickwright.inspect()` to identify a reachable drop; never teleport or inject one. Test combat with actual F presses near a mob. Use `scripts/verify-storage.mjs` plus a real server restart to verify saved blocks and harvested output.

## Gotchas
The slice's light model is roof shade plus a Manhattan lamp radius, not full light propagation. Mobs spawn at least 24 blocks from players. The illuminated collection floor prevents spawning underneath the raised deck. The world pauses only when the last player disconnects. Items expire after five minutes of simulated time.
