# Movement and co-op

## Sub-features
Guest entry, two-player presence, predicted movement, jump, dash, disconnect.

## How to get to it (user POV)
Open the game, enter a name, and choose Enter island. A second browser opens the same room link.

## Driving it with T3 preview
Fill `#player-name`, click `#join`, and assert the room count in both tabs. Hold D briefly with real keyboard events. The second client's player record and rendered model must move. Space increases height and then lands. Shift moves farther without passing through a solid wall. Disconnecting removes the player from the other tab.

## Gotchas
New guests share the altar spawn and may overlap until one moves. Background tabs can throttle inputs. The local guest's pocket inventory resets on reconnect; the world and total harvested essence persist.
