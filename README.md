# Pogicity

An isometric city builder engine built with Phaser 3 and Next.js. Place buildings, lay roads, and watch citizens and cars roam your city.

This is a foundation for building isometric strategy games—city builders, tycoon games, RTS, or anything that needs a tile-based isometric world.

## Features

- **Isometric Rendering** - Classic 2:1 isometric projection with proper depth sorting
- **Building System** - Place multi-tile buildings with 4-direction rotation support
- **Road Network** - Auto-connecting roads with proper intersection handling
- **Animated Characters** - GIF-based walking animations in 4 directions
- **Vehicles** - Cars that drive along roads
- **Save/Load** - Persist your city to localStorage
- **Multiple Tile Types** - Grass, asphalt, snow, and more
- **Building Categories** - Residential, commercial, civic, landmarks, props, and seasonal (Christmas!)

## Getting Started

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build
```

Open [http://localhost:3000](http://localhost:3000) to start building.

## Tech Stack

- **Framework:** Next.js 16 with React 19
- **Game Engine:** Phaser 3.90
- **Styling:** Tailwind CSS 4
- **Language:** TypeScript 5
- **GIF Support:** gifuct-js for character animations

## Project Structure

```
app/
├── components/
│   ├── game/
│   │   ├── phaser/           # Phaser game engine
│   │   │   ├── MainScene.ts  # Core rendering & game logic
│   │   │   └── PhaserGame.tsx# React wrapper
│   │   ├── GameBoard.tsx     # Main React component
│   │   ├── types.ts          # TypeScript types & enums
│   │   └── roadUtils.ts      # Road connection logic
│   └── ui/                   # React UI components
├── data/
│   └── buildings.ts          # Building registry
└── utils/
    └── sounds.ts             # Audio effects

public/
├── Building/                 # Building sprites by category
├── Tiles/                    # Ground tiles
├── Characters/               # Walking animations (GIFs)
└── cars/                     # Vehicle sprites
```

---

## How the Isometric System Works

### The Basics

Isometric projection creates a 3D-like view from 2D sprites. This engine uses **2:1 isometric** (also called "true isometric" or "dimetric"), where:

- Tiles are diamond-shaped, **44x22 pixels**
- The X-axis goes down-right
- The Y-axis goes down-left
- Depth (what's in front) is determined by position

### Coordinate Conversion

Converting between grid coordinates (x, y) and screen pixels:

```typescript
// Grid → Screen
function gridToScreen(gridX: number, gridY: number) {
  return {
    screenX: (gridX - gridY) * (TILE_WIDTH / 2),
    screenY: (gridX + gridY) * (TILE_HEIGHT / 2)
  };
}

// Screen → Grid
function screenToGrid(screenX: number, screenY: number) {
  return {
    gridX: Math.floor(screenX / TILE_WIDTH + screenY / TILE_HEIGHT),
    gridY: Math.floor(screenY / TILE_HEIGHT - screenX / TILE_WIDTH)
  };
}
```

### Depth Sorting

The key to isometric rendering is drawing things in the right order. Objects further "back" (higher up on screen) must be drawn first.

```typescript
// Basic depth formula
depth = (gridX + gridY) * DEPTH_MULTIPLIER;

// With layer offsets for different object types:
// 0.00 - Ground tiles
// 0.03 - Back fences
// 0.05 - Buildings
// 0.06 - Props/trees
// 0.10 - Cars
// 0.20 - Characters
```

### Multi-Tile Buildings

Large buildings occupy multiple grid cells but are rendered as a single sprite anchored at their "origin" tile (typically the front corner).

```typescript
interface BuildingDefinition {
  footprint: { width: number; height: number };
  sprites: {
    south: string;  // Default facing
    north?: string;
    east?: string;
    west?: string;
  };
}
```

### Sprite Standards

Building sprites follow these conventions:
- **Canvas size:** Typically 512x512 or larger
- **Anchor point:** Front corner at bottom-center of canvas
- **Naming:** `{width}x{height}{name}_{direction}.png`
  - Example: `4x4bookstore_south.png`

### Vertical Slicing (Tall Buildings)

Very tall buildings can cause depth sorting issues when characters walk "behind" them. The solution is to slice the sprite into horizontal strips and give each strip a different depth:

```typescript
// Slice a tall building into strips
for (let slice = 0; slice < numSlices; slice++) {
  const sliceDepth = baseDepth + (slice * 0.001);
  // Render slice at sliceDepth
}
```

---

## Build Your Own Game

This engine is designed as a starting point. Here are some directions you could take it:

### City Builder (SimCity-style)
- Add zoning (residential/commercial/industrial)
- Implement population and demand simulation
- Create budget and tax systems
- Add city services (police, fire, hospitals)

### Tycoon Game
- Add economy and resource management
- Create customer/visitor AI
- Implement business progression
- Add scenarios and challenges

### RTS (Real-Time Strategy)
- Add unit selection and control
- Implement pathfinding for units
- Create combat systems
- Add fog of war

### 4X Strategy
- Add turn-based mechanics
- Implement tech trees
- Create diplomacy systems
- Add procedural map generation

### Colony Sim
- Add needs-based AI for citizens
- Implement job and task systems
- Create survival mechanics
- Add seasons and weather

---

## Inspiration & References

This project draws inspiration from classic isometric games:

### City Builders
- **SimCity 2000/3000/4** - The gold standard for city simulation
- **Cities: Skylines** - Modern take with detailed traffic simulation
- **Theotown** - Mobile-friendly SimCity clone

### Tycoon Games
- **RollerCoaster Tycoon 1 & 2** - Chris Sawyer's masterpiece, hand-coded in assembly
- **Transport Tycoon** - Complex logistics in isometric view
- **OpenTTD** - Open source Transport Tycoon with incredible modding
- **Theme Hospital** - Charming isometric management

### Strategy Games
- **Civilization series** - 4X with isometric roots (Civ 2, 3)
- **Age of Empires 2** - Isometric RTS perfection
- **Command & Conquer: Red Alert** - Classic isometric RTS
- **Factorio** - Factory building with isometric-adjacent view

### Colony Sims
- **RimWorld** - Deep simulation with simple graphics
- **Dwarf Fortress** - The ultimate simulation complexity
- **Prison Architect** - Accessible management sim

### Visual Style References
- **Pocket City** - Clean, modern mobile city builder
- **Northgard** - Beautiful isometric RTS
- **Frostpunk** - Atmospheric city survival

---

## Adding Buildings

Buildings are defined in `app/data/buildings.ts`:

```typescript
"my-building": {
  id: "my-building",
  name: "My Building",
  category: "commercial",
  footprint: { width: 2, height: 2 },
  sprites: {
    south: "/Building/commercial/2x2my_building_south.png",
    north: "/Building/commercial/2x2my_building_north.png",
    east: "/Building/commercial/2x2my_building_east.png",
    west: "/Building/commercial/2x2my_building_west.png",
  },
  icon: "🏢",
  supportsRotation: true,
}
```

---

## Creating Your Own Assets

Want to make your own isometric buildings? Here's a modern AI-assisted pipeline:

### 1. Generate Concept Art
Use an image generation model to create your building concept. Look for models that handle architecture well.

**Tools:** Midjourney, Stable Diffusion, or specialized models like [Nano Banana](https://replicate.com/fofr/nanobanana)

**Tips:**
- Prompt for "isometric view" or "3/4 view"
- Specify architectural style (Victorian, modern, brutalist, etc.)
- Include "game asset" or "video game building" for cleaner results

### 2. Convert to 3D
Turn your 2D concept into a 3D model. This gives you the ability to render from any angle consistently.

**Tools:**
- [Trellis](https://github.com/microsoft/TRELLIS) - Microsoft's image-to-3D
- [Hunyuan3D](https://github.com/Tencent/Hunyuan3D-1) - Tencent's image-to-3D
- Tripo, Meshy, or other image-to-3D services

### 3. Render Isometric Sprites
Set up your camera at the correct isometric angle and render out sprites for each direction.

**Tools:**
- [PixelOver](https://pixelover.io/) - Great for pixel art style renders
- Blender - Free, full control over rendering
- Any 3D software with orthographic camera support

**Camera setup for 2:1 isometric:**
- Orthographic projection
- 30° rotation from top-down
- 45° rotation for each cardinal direction (0°, 90°, 180°, 270°)

### 4. Post-Processing
Clean up your renders and ensure consistency:
- Match the color palette of existing assets
- Add shadows/ambient occlusion if needed
- Ensure transparent backgrounds
- Check that the anchor point aligns with the grid

### Sprite Specifications

| Property | Value |
|----------|-------|
| Tile size | 44x22 pixels |
| Canvas size | 512x512 (or larger for big buildings) |
| Anchor point | Bottom-center (front corner of building) |
| Format | PNG with transparency |
| Directions | South (required), North/East/West (optional) |

---

## Asset Usage

### Code
The source code is MIT licensed - use it however you like.

### Art Assets (Buildings, Props, Tiles)
The art assets in this repository are provided for **learning, demos, and prototyping**. Some assets were created for this project, others are from commercial asset packs with varying licenses.

**If you're releasing a game**, you should create or commission your own art assets to avoid any licensing issues.

### Characters
The character sprites (walking GIFs in `/public/Characters/`) are **NOT included in the open source license**. These are proprietary characters.

**You may:**
- Use them for demos, prototypes, and learning
- Use them in non-commercial projects
- Reference them for creating your own characters

**You may NOT:**
- Include them in published/released games
- Redistribute them separately
- Use them in commercial products

If you're building a game for release, please create or commission your own character sprites.

---

## Contributing

Contributions are welcome! Some areas that could use help:

- **More buildings** - Different architectural styles, eras, themes
- **Performance** - Optimization for larger maps
- **Features** - See `ROADMAP.md` for planned features
- **Documentation** - Tutorials, examples, better docs

---

## License

This project is licensed under the MIT License - see below.

**Exception:** Character sprites in `/public/Characters/` are proprietary and not included in this license. See "Asset Usage" above.

```
MIT License

Copyright (c) 2025

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Acknowledgments

Built with love for isometric games and the communities that keep them alive.
