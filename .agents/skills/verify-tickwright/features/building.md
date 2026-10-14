# Building and Sight

## Sub-features
Five block types, authoritative reach/collision checks, shared edits, Sight, manual layers and cutaway.

## How to get to it (user POV)
Walk near a surface and choose a block from the bottom toolbar. Right click places and left click breaks.

## Driving it with T3 preview
Read a nearby block's screen coordinates with `tickwright.project`, then click the actual canvas. Assert the target cell changed in both clients. Try a distant block and expect the move-closer toast. Tab reveals the hovered floor's light and spawn rejection reason. C or the layer buttons must reveal the farm beneath its roof.

## Gotchas
An occupied or player-overlapping cell is rejected. Camera movement changes projected click coordinates. A roof cutaway changes visibility only, never the server's light or collision rules. Decorative foliage is scenery and does not block movement.
