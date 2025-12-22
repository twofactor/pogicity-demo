# Project Guidelines for Claude

## Notifications

Play a system ping sound (`afplay /System/Library/Sounds/Ping.aiff`) when:
- Finishing a long-running task
- Needing user input or asking a question
- Encountering an error that blocks progress

## Tech Stack

- **Framework:** Next.js 16 with React 19, TypeScript 5, App Router
- **Game Engine:** Phaser 3.90 (loaded dynamically, no SSR)
- **Styling:** Tailwind CSS 4 + custom RCT1-themed CSS
- **GIF Support:** gifuct-js for character animations

## Commands

```bash
npm run dev     # Development server (localhost:3000)
npm run build   # Production build
npm run lint    # ESLint
```

## Project Structure

```
/app
  /components
    /game
      /phaser        # Phaser game engine code
        MainScene.ts   # Core game logic, rendering, entities
        PhaserGame.tsx # React wrapper with imperative handle
      GameBoard.tsx    # Main React component, grid state
      types.ts         # Enums: TileType, ToolType, Direction
      roadUtils.ts     # Road connection logic
    /ui              # React UI components (ToolWindow, Modal, etc.)
  /data
    buildings.ts     # Building registry (single source of truth)
  /utils
    sounds.ts        # Audio effects
/public
  /Building          # Building sprites by category
  /Tiles             # Ground tiles (grass, road, asphalt, snow)
  /Characters        # Walking GIF animations (4 directions)
  /cars              # Vehicle sprites (4 directions)
```

## Architecture

**React-Phaser Communication:**
- React manages: grid state (48x48), UI, tool selection
- Phaser manages: rendering, characters, cars, animations
- React → Phaser: via ref methods (`spawnCharacter()`, `shakeScreen()`)
- Phaser → React: via callbacks (`onTileClick`, `onTilesDrag`)

**Isometric System:**
- Tile size: 44x22 pixels
- Roads snap to 4x4 grid segments
- Depth sorting: `depth = (x + y) * DEPTH_Y_MULT`

## Key Files to Modify

| Task | File |
|------|------|
| Add new buildings | `app/data/buildings.ts` |
| Game logic/rendering | `app/components/game/phaser/MainScene.ts` |
| UI/grid state | `app/components/game/GameBoard.tsx` |
| Types/enums | `app/components/game/types.ts` |
| Road behavior | `app/components/game/roadUtils.ts` |

## Adding Buildings

Buildings are defined in `app/data/buildings.ts`. Structure:

```typescript
"building-id": {
  id: "building-id",
  name: "Display Name",
  category: "residential" | "commercial" | "civic" | "landmark" | "props" | "christmas",
  footprint: { south: [width, height], east: [width, height], ... },
  sprites: {
    south: "/Building/category/WxHname_south.png",
    east: "/Building/category/WxHname_east.png",
    // ... other orientations
  },
  icon: "/Building/category/WxHname_south.png",
  canRotate: true | false
}
```

**Sprite naming convention:** `{width}x{height}{name}_{direction}.png`

## Phaser Resources

When troubleshooting Phaser issues, check these resources first:

- **Official Examples:** https://phaser.io/examples/v3.85.0 (searchable, covers most use cases)
- **API Docs:** https://newdocs.phaser.io/docs/3.90.0
- **Community Forum:** https://phaser.discourse.group

Common solutions exist for: camera zoom/pan, input handling, tilemaps, physics, animations.

## Code Conventions

- Components: PascalCase
- Functions: camelCase
- Constants: SCREAMING_SNAKE_CASE
- Building IDs: kebab-case
- Enums: PascalCase values

## Grid Cell Structure

```typescript
{
  type: TileType,
  x, y: number,
  isOrigin?: boolean,        // Top-left of multi-cell building
  originX?, originY?: number,
  buildingId?: string,
  buildingOrientation?: Direction,
  underlyingTileType?: TileType  // For props preserving ground
}
```

## Save/Load

Saves to localStorage as JSON with: grid, character count, car count, zoom level, visual settings, timestamp.
