import Phaser from "phaser";
import {
  GridCell,
  Character,
  Car,
  CarType,
  TileType,
  Direction,
  CharacterType,
  GRID_WIDTH,
  GRID_HEIGHT,
  SUBTILE_WIDTH,
  SUBTILE_HEIGHT,
  TILE_WIDTH,
  TILE_HEIGHT,
  TileIndex,
  QUADRANT_TILES,
  ToolType,
  CHARACTER_SPEED,
  ROAD_LANE_SIZE,
} from "../types";
import { GRID_OFFSET_X, GRID_OFFSET_Y, WORLD_WIDTH, WORLD_HEIGHT } from "./gameConfig";
import {
  getRoadLaneOrigin,
  hasRoadLane,
  canPlaceRoadLane,
  getDirectionAngle,
  cycleDirection,
  directionVectors as roadDirectionVectors,
  oppositeDirection,
  rightTurnDirection,
  isRoadTileType,
} from "../roadUtils";
import {
  BUILDINGS,
  getBuilding,
  getBuildingFootprint,
  BuildingDefinition,
} from "@/app/data/buildings";
import { loadGifAsAnimation, playGifAnimation } from "./GifLoader";
import { TrafficManager } from "./TrafficManager";

// Event types for React communication
export interface SceneEvents {
  onTileClick: (x: number, y: number) => void;
  onTileHover: (x: number | null, y: number | null) => void;
  onTilesDrag?: (tiles: Array<{ x: number; y: number }>) => void;
  onEraserDrag?: (tiles: Array<{ x: number; y: number }>) => void;
  onRoadLaneDrag?: (lanes: Array<{ x: number; y: number }>, direction: Direction, tileType: TileType) => void;
}

// Generate unique ID
const generateId = () => Math.random().toString(36).substring(2, 9);

// Direction vectors for movement
const directionVectors: Record<Direction, { dx: number; dy: number }> = {
  [Direction.Up]: { dx: 0, dy: -1 },
  [Direction.Down]: { dx: 0, dy: 1 },
  [Direction.Left]: { dx: -1, dy: 0 },
  [Direction.Right]: { dx: 1, dy: 0 },
};

// All directions as array
const allDirections = [
  Direction.Up,
  Direction.Down,
  Direction.Left,
  Direction.Right,
];

// Deterministic snow variant based on grid position
function getSnowTextureKey(x: number, y: number): string {
  // Simple hash to pick variant 1-3 based on position
  const variant = ((x * 7 + y * 13) % 3) + 1;
  return `snow_${variant}`;
}

export class MainScene extends Phaser.Scene {
  // Depth scaling for stable painter's algorithm ordering
  private readonly DEPTH_Y_MULT = 10000;

  // Tilemap for ground layer (32x16 subtiles, batched rendering)
  private groundMap: Phaser.Tilemaps.Tilemap | null = null;
  private groundLayer: Phaser.Tilemaps.TilemapLayer | null = null;
  private tileData: number[][] = []; // 2D array of TileIndex values

  // Sprite containers (buildings/entities on top of tilemap)
  private tileSprites: Map<string, Phaser.GameObjects.Image> = new Map(); // Legacy, will remove
  private buildingSprites: Map<string, Phaser.GameObjects.Image> = new Map();
  private propOnBuildingSprites: Map<string, Phaser.GameObjects.Image> = new Map(); // Props on building tiles
  private glowSprites: Map<string, Phaser.GameObjects.GameObject> = new Map();
  private carSprites: Map<string, Phaser.GameObjects.Sprite> = new Map();
  private characterSprites: Map<string, Phaser.GameObjects.Sprite> = new Map();
  private previewSprites: (Phaser.GameObjects.Image | Phaser.GameObjects.Graphics)[] = [];
  private lotPreviewSprites: Phaser.GameObjects.Image[] = [];

  // Game state (owned by Phaser, not React)
  private grid: GridCell[][] = [];
  private characters: Character[] = [];
  private trafficManager: TrafficManager = new TrafficManager();

  // Tool state (synced from React)
  private selectedTool: ToolType = ToolType.RoadLane;
  private selectedBuildingId: string | null = null;
  private buildingOrientation: Direction = Direction.Down;
  private roadLaneDirection: Direction = Direction.Right; // Default direction for road lanes
  private hoverTile: { x: number; y: number } | null = null;

  // Event callbacks
  private events_: SceneEvents = {
    onTileClick: () => {},
    onTileHover: () => {},
  };

  // Zoom level
  private zoomLevel: number = 1;
  // Flag to skip React's setZoom after internal wheel zoom
  private zoomHandledInternally: boolean = false;

  // Scene ready flag
  private isReady: boolean = false;

  // GIF animations loaded flag
  private gifsLoaded: boolean = false;

  // Debug: show walkable paths
  private showPaths: boolean = false;
  private pathOverlaySprites: Phaser.GameObjects.Graphics | null = null;

  // Debug: show entity tile positions
  private showEntityTiles: boolean = false;
  private entityTileGraphics: Phaser.GameObjects.Graphics | null = null;

  // Debug: show road lane directions (always on for now during development)
  private showRoadLaneArrows: boolean = true;
  private roadLaneArrowGraphics: Phaser.GameObjects.Graphics | null = null;

  // Driving mode - keyboard input tracking
  private pressedKeys: Set<string> = new Set();

  // Keyboard controls
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
  };
  private readonly CAMERA_SPEED = 8;

  // Dirty flags for efficient updates
  private gridDirty: boolean = false;
  private gridDirtyTiles: Set<string> = new Set();

  // Stats display
  private statsText: Phaser.GameObjects.Text | null = null;
  private showStats: boolean = true;

  // Drag state for painting tiles (snow/tile tools)
  private isDragging: boolean = false;
  private dragTiles: Set<string> = new Set();
  private dragStartTile: { x: number; y: number } | null = null;
  private dragDirection: "horizontal" | "vertical" | null = null;

  // Camera panning state (for click/touch drag panning)
  private isPanning: boolean = false;
  private panStartX: number = 0;
  private panStartY: number = 0;
  private cameraStartX: number = 0;
  private cameraStartY: number = 0;

  // Screen shake state (for building placement impact)
  // IMPORTANT: keep "base" camera scroll separate from transient shake offset.
  // Otherwise panning / keyboard input can accidentally bake the shake into the base scroll.
  private baseScrollX: number = 0;
  private baseScrollY: number = 0;
  private wasDriving: boolean = false;
  private needsCameraCenter: boolean = true; // Center camera on first update

  private shakeAxis: "x" | "y" = "y";
  private shakeOffset: number = 0;
  private shakeDuration: number = 0;
  private shakeIntensity: number = 0;
  private shakeElapsed: number = 0;
  // Number of oscillations during the shake (must be an integer so it ends at exactly 0)
  private shakeCycles: number = 3;

  constructor() {
    super({ key: "MainScene" });
  }

  preload(): void {
    // Load tile textures (will be combined into tileset in create())
    // These are 64x32, we'll scale to 32x16 for the tilemap
    this.load.image("grass", "/Tiles/1x1grass.png");
    this.load.image("road", "/Tiles/1x1square_tile.png");
    this.load.image("asphalt", "/Tiles/1x1asphalt_tile.png");
    this.load.image("snow_1", "/Tiles/1x1snow_tile_1.png");
    this.load.image("snow_2", "/Tiles/1x1snow_tile_2.png");
    this.load.image("snow_3", "/Tiles/1x1snow_tile_3.png");

    // Load building textures dynamically from registry
    for (const building of Object.values(BUILDINGS)) {
      for (const [dir, path] of Object.entries(building.sprites)) {
        const key = `${building.id}_${dir}`;
        this.load.image(key, path);
      }
    }

    // Load car textures (old format: jeepn.png)
    const oldCarTypes = ["jeep", "taxi"];
    const shortDirs = ["n", "s", "e", "w"];
    for (const car of oldCarTypes) {
      for (const dir of shortDirs) {
        this.load.image(`${car}_${dir}`, `/cars/${car}${dir}.png`);
      }
    }

    // Load car textures (new format: 1x1waymo_north.png)
    const newCarTypes = ["waymo", "robotaxi", "zoox"];
    const longDirs = ["north", "south", "east", "west"];
    const dirMap: Record<string, string> = { north: "n", south: "s", east: "e", west: "w" };
    for (const car of newCarTypes) {
      for (const dir of longDirs) {
        this.load.image(`${car}_${dirMap[dir]}`, `/cars/1x1${car}_${dir}.png`);
      }
    }
  }

  create(): void {
    // Set up keyboard controls
    if (this.input.keyboard) {
      this.cursors = this.input.keyboard.createCursorKeys();
      this.wasd = {
        W: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
        A: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
        S: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
        D: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      };

      // Set up driving controls
      this.input.keyboard.on("keydown", (event: KeyboardEvent) => {
        const key = event.key.toLowerCase();

        // P key toggles debug path overlay
        if (key === "p") {
          this.showPaths = !this.showPaths;
          console.log("[Debug] Path overlay:", this.showPaths ? "ON" : "OFF");
          this.renderPathOverlay();
          return;
        }

        // R key cycles road lane direction when any road lane tool is selected
        if (key === "r" && (
          this.selectedTool === ToolType.RoadLane ||
          this.selectedTool === ToolType.RoadTurn
        )) {
          this.roadLaneDirection = cycleDirection(this.roadLaneDirection);
          this.updatePreview();
          return;
        }

      });

      this.input.keyboard.on("keyup", (event: KeyboardEvent) => {
        const key = event.key.toLowerCase();
        this.pressedKeys.delete(key);
      });
    }

    // Initialize empty grid and tile data
    this.initializeGrid();

    // Set up tilemap for ground rendering
    this.setupTilemap();

    // Set world bounds for camera (world is larger than viewport)
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    // Mark scene as ready
    this.isReady = true;

    // Enable input
    this.input.on("pointermove", this.handlePointerMove, this);
    this.input.on("pointerdown", this.handlePointerDown, this);
    this.input.on("pointerup", this.handlePointerUp, this);

    // Mouse wheel zoom - handled directly in Phaser for correct coordinates
    // Based on: https://phaser.io/examples/v3.85.0/tilemap/view/mouse-wheel-zoom
    this.input.on("wheel", this.handleWheel, this);

    // Initial render (buildings only - ground is handled by tilemap)
    this.renderGrid();

    // Camera will be centered on first update frame (when dimensions are known)

    // Load character GIF animations asynchronously
    this.loadCharacterAnimations();

    // Create stats display (fixed to camera, top-right corner)
    this.statsText = this.add.text(10, 100, "FPS: --", {
      fontFamily: "monospace",
      fontSize: "14px",
      color: "#00ff00",
      backgroundColor: "rgba(0,0,0,0.8)",
      padding: { x: 10, y: 8 },
    });
    this.statsText.setScrollFactor(0); // Fixed to camera/viewport
    this.statsText.setDepth(2_000_000); // Always on top
    this.statsText.setOrigin(0, 0); // Anchor to top-left of text
    // Position will be updated in updateStatsDisplay based on camera size
  }

  private initializeGrid(): void {
    // Initialize grid cell data
    this.grid = Array.from({ length: GRID_HEIGHT }, (_, y) =>
      Array.from({ length: GRID_WIDTH }, (_, x) => ({
        type: TileType.Grass,
        x,
        y,
        isOrigin: true,
      }))
    );

    // Initialize tilemap data (all grass to start)
    // Note: tileData is for reference, actual rendering uses groundLayer directly
    this.tileData = Array.from({ length: GRID_HEIGHT }, () =>
      Array.from({ length: GRID_WIDTH }, () => TileIndex.Grass)
    );

  }

  // Generate tileset texture and create isometric tilemap
  private setupTilemap(): void {
    // Tileset layout (must match TileIndex enum):
    // 0: Grass (scaled)
    // 1-3: Snow1, Snow2, Snow3 (scaled)
    // 4-7: Road quadrants (TL, TR, BL, BR) - scaled for now, ready for native assets
    // 8-11: Asphalt quadrants (TL, TR, BL, BR) - scaled for now

    const tilesetWidth = SUBTILE_WIDTH;
    const tilesetHeight = SUBTILE_HEIGHT * 12; // 4 non-quadrant + 8 quadrant slots

    const canvas = document.createElement("canvas");
    canvas.width = tilesetWidth;
    canvas.height = tilesetHeight;
    const ctx = canvas.getContext("2d")!;

    // Helper to draw a scaled tile at an index
    const drawScaledTile = (textureKey: string, index: number) => {
      const texture = this.textures.get(textureKey);
      const source = texture.getSourceImage() as HTMLImageElement;
      ctx.drawImage(
        source,
        0, 0, source.width, source.height,
        0, index * SUBTILE_HEIGHT, SUBTILE_WIDTH, SUBTILE_HEIGHT
      );
    };

    // Non-quadrant tiles (scaled)
    drawScaledTile("grass", TileIndex.Grass);
    drawScaledTile("snow_1", TileIndex.Snow1);
    drawScaledTile("snow_2", TileIndex.Snow2);
    drawScaledTile("snow_3", TileIndex.Snow3);

    // Quadrant tiles - for now just scale the same image 4 times
    // Later: load actual quadrant assets (road_tl.png, road_tr.png, etc.)
    for (let q = 0; q < 4; q++) {
      drawScaledTile("road", TileIndex.RoadTL + q);
      drawScaledTile("asphalt", TileIndex.AsphaltTL + q);
    }

    // Add tileset texture to Phaser
    this.textures.addCanvas("ground_tileset", canvas);

    // Create a blank isometric tilemap
    // We need to construct it with the proper config for isometric
    const mapData = new Phaser.Tilemaps.MapData({
      name: 'ground',
      width: GRID_WIDTH,
      height: GRID_HEIGHT,
      tileWidth: SUBTILE_WIDTH,
      tileHeight: SUBTILE_HEIGHT,
      orientation: Phaser.Tilemaps.Orientation.ISOMETRIC,
      format: Phaser.Tilemaps.Formats.ARRAY_2D,
    });

    this.groundMap = new Phaser.Tilemaps.Tilemap(this, mapData);

    // Add tileset image to the map
    const tileset = this.groundMap.addTilesetImage(
      "ground_tileset",
      "ground_tileset",
      SUBTILE_WIDTH,
      SUBTILE_HEIGHT,
      0,
      0
    );

    if (!tileset) {
      console.error("Failed to create tileset");
      return;
    }

    // Create a blank layer and fill it with our tile data
    this.groundLayer = this.groundMap.createBlankLayer(
      "ground",
      tileset,
      GRID_OFFSET_X,
      GRID_OFFSET_Y,
      GRID_WIDTH,
      GRID_HEIGHT
    );

    if (this.groundLayer) {
      this.groundLayer.setDepth(0); // Ground is always at the bottom

      // Fill the layer with grass tiles initially
      for (let y = 0; y < GRID_HEIGHT; y++) {
        for (let x = 0; x < GRID_WIDTH; x++) {
          this.groundLayer.putTileAt(TileIndex.Grass, x, y);
        }
      }
    }
  }

  private async loadCharacterAnimations(): Promise<void> {
    const charTypes = ["banana", "apple"];
    const charDirs = ["north", "south", "east", "west"];

    const loadPromises: Promise<void>[] = [];

    for (const char of charTypes) {
      for (const dir of charDirs) {
        const key = `${char}_${dir}`;
        const url = `/Characters/${char}walk${dir}.gif`;
        loadPromises.push(loadGifAsAnimation(this, key, url));
      }
    }

    try {
      await Promise.all(loadPromises);
      this.gifsLoaded = true;
      console.log("Character GIF animations loaded successfully");

      // Re-render characters to apply animations
      if (this.characters.length > 0) {
        this.renderCharacters();
      }
    } catch (error) {
      console.error("Failed to load character animations:", error);
    }
  }

  update(_time: number, delta: number): void {
    if (!this.isReady) return;

    // Update game entities
    this.updateCharacters();
    this.trafficManager.update();

    // Center camera on first frame (camera dimensions now known)
    if (this.needsCameraCenter) {
      this.centerCameraOnMap();
      this.needsCameraCenter = false;
    }

    // Handle camera movement (when not driving)
    this.updateCamera(delta);

    // Render updated entities
    this.renderCharacters();
    this.renderCars();

    // Handle dirty grid updates
    if (this.gridDirty) {
      this.applyGridUpdates();
      this.gridDirty = false;
    }

    // Update stats display
    this.updateStatsDisplay();
  }

  private statsLogCounter = 0;
  private updateStatsDisplay(): void {
    const fps = Math.round(this.game.loop.actualFps);
    const charCount = this.characters.length;
    const carCount = this.trafficManager.getCarCount();

    // Log every 60 frames (~1 second)
    this.statsLogCounter++;
    if (this.statsLogCounter >= 60) {
      console.log(`[Stats] FPS: ${fps} | Characters: ${charCount} | Cars: ${carCount}`);
      this.statsLogCounter = 0;
    }

    if (!this.statsText || !this.showStats) {
      if (this.statsText) this.statsText.setVisible(false);
      return;
    }

    this.statsText.setVisible(true);

    // Position in bottom-left (origin is top-left of text, so offset by text height)
    const camera = this.cameras.main;
    this.statsText.setPosition(10, camera.height - this.statsText.height - 10);

    // Color FPS based on performance
    let fpsColor = "#00ff00"; // Green = good
    if (fps < 50) fpsColor = "#ffff00"; // Yellow = warning
    if (fps < 30) fpsColor = "#ff0000"; // Red = bad

    this.statsText.setText(
      [
        `FPS: ${fps}`,
        `Characters: ${charCount}`,
        `Cars: ${carCount}`,
        `Phaser-managed ✓`,
      ].join("\n")
    );
    this.statsText.setColor(fpsColor);
  }

  private updateCamera(delta: number): void {
    if (!this.cursors) return;

    const camera = this.cameras.main;

    // Update screen shake (pure offset; MUST end at exactly 0)
    if (this.shakeElapsed < this.shakeDuration) {
      this.shakeElapsed += delta;
      const t = Math.min(this.shakeElapsed / this.shakeDuration, 1); // 0 -> 1
      // Snappy + SC4-ish: slightly stronger first hit, then damps faster.
      // (1 - t)^2 is fast ease-out; the extra *(1 + boost*(1 - t)) biases early frames a bit higher.
      const baseEnvelope = (1 - t) * (1 - t);
      const boost = 0.1; // "slightly more" on the first hit
      const envelope = baseEnvelope * (1 + boost * (1 - t));
      // Oscillate and guarantee we end at exactly 0 at t=1 (sin(2πn)=0)
      // Start with a small "down" impact (positive scrollY), then a smaller up rebound.
      // Phase ease: advance faster early so the first downward hit is snappier
      const phaseT = Math.sqrt(t);
      const wave =
        Math.sin(phaseT * this.shakeCycles * Math.PI * 2) *
        this.shakeIntensity *
        envelope;
      this.shakeOffset = wave < 0 ? wave * 0.45 : wave;
    } else {
      this.shakeOffset = 0;
    }

    // Manual camera movement
    // Don't move camera if user is typing in an input field
    const activeElement = document.activeElement;
    const isTyping =
      activeElement &&
      (activeElement.tagName === "INPUT" ||
        activeElement.tagName === "TEXTAREA" ||
        (activeElement as HTMLElement)?.isContentEditable);

    if (!isTyping) {
      const speed = this.CAMERA_SPEED / camera.zoom;
      if (this.cursors.left.isDown || this.wasd?.A.isDown) {
        this.baseScrollX -= speed;
      }
      if (this.cursors.right.isDown || this.wasd?.D.isDown) {
        this.baseScrollX += speed;
      }
      if (this.cursors.up.isDown || this.wasd?.W.isDown) {
        this.baseScrollY -= speed;
      }
      if (this.cursors.down.isDown || this.wasd?.S.isDown) {
        this.baseScrollY += speed;
      }
    }

    camera.setScroll(
      Math.round(this.baseScrollX + (this.shakeAxis === "x" ? this.shakeOffset : 0)),
      Math.round(this.baseScrollY + (this.shakeAxis === "y" ? this.shakeOffset : 0))
    );
  }

  // Trigger screen shake effect (like SimCity 4 building placement)
  shakeScreen(
    axis: "x" | "y" = "y",
    intensity: number = 2,
    duration: number = 150
  ): void {
    this.shakeAxis = axis;
    this.shakeIntensity = intensity;
    this.shakeDuration = duration;
    this.shakeElapsed = 0;
  }

  // ============================================
  // CHARACTER LOGIC (moved from React)
  // ============================================

  private updateCharacters(): void {
    for (let i = 0; i < this.characters.length; i++) {
      this.characters[i] = this.updateSingleCharacter(this.characters[i]);
    }
  }

  private isWalkable(x: number, y: number): boolean {
    const gx = Math.floor(x);
    const gy = Math.floor(y);
    if (gx < 0 || gx >= GRID_WIDTH || gy < 0 || gy >= GRID_HEIGHT) return false;
    const tileType = this.grid[gy][gx].type;
    return tileType === TileType.Sidewalk || tileType === TileType.Tile;
  }

  private getValidDirections(tileX: number, tileY: number): Direction[] {
    const valid: Direction[] = [];
    for (const dir of allDirections) {
      const vec = directionVectors[dir];
      if (this.isWalkable(tileX + vec.dx, tileY + vec.dy)) {
        valid.push(dir);
      }
    }
    return valid;
  }

  private pickNewDirection(
    tileX: number,
    tileY: number,
    currentDir: Direction
  ): Direction | null {
    const validDirs = this.getValidDirections(tileX, tileY);
    if (validDirs.length === 0) return null;

    const opposite = oppositeDirection[currentDir];
    const preferredDirs = validDirs.filter((d) => d !== opposite);

    // 60% chance to continue straight if possible
    if (preferredDirs.includes(currentDir) && Math.random() < 0.6) {
      return currentDir;
    }

    const choices = preferredDirs.length > 0 ? preferredDirs : validDirs;
    return choices[Math.floor(Math.random() * choices.length)];
  }

  private updateSingleCharacter(char: Character): Character {
    const { x, y, direction, speed } = char;
    const vec = directionVectors[direction];
    const tileX = Math.floor(x);
    const tileY = Math.floor(y);

    // Check if current tile is still walkable
    if (!this.isWalkable(tileX, tileY)) {
      const walkableTiles: { x: number; y: number }[] = [];
      for (let gy = 0; gy < GRID_HEIGHT; gy++) {
        for (let gx = 0; gx < GRID_WIDTH; gx++) {
          const tileType = this.grid[gy][gx].type;
          if (tileType === TileType.Sidewalk || tileType === TileType.Tile) {
            walkableTiles.push({ x: gx, y: gy });
          }
        }
      }
      if (walkableTiles.length > 0) {
        const newTile =
          walkableTiles[Math.floor(Math.random() * walkableTiles.length)];
        return {
          ...char,
          x: newTile.x + 0.5,
          y: newTile.y + 0.5,
          direction:
            allDirections[Math.floor(Math.random() * allDirections.length)],
        };
      }
      return char;
    }

    const inTileX = x - tileX;
    const inTileY = y - tileY;
    const threshold = speed * 3;
    const nearCenter =
      Math.abs(inTileX - 0.5) < threshold &&
      Math.abs(inTileY - 0.5) < threshold;

    let newDirection = direction;
    let nextX = x;
    let nextY = y;

    if (nearCenter) {
      const nextTileX = tileX + vec.dx;
      const nextTileY = tileY + vec.dy;

      if (!this.isWalkable(nextTileX, nextTileY)) {
        const newDir = this.pickNewDirection(tileX, tileY, direction);
        if (newDir) {
          newDirection = newDir;
        }
        nextX = tileX + 0.5;
        nextY = tileY + 0.5;
      } else {
        const validDirs = this.getValidDirections(tileX, tileY);
        if (validDirs.length > 2 && Math.random() < 0.1) {
          const newDir = this.pickNewDirection(tileX, tileY, direction);
          if (newDir) {
            newDirection = newDir;
            nextX = tileX + 0.5;
            nextY = tileY + 0.5;
          }
        }
      }
    }

    const moveVec = directionVectors[newDirection];
    nextX += moveVec.dx * speed;
    nextY += moveVec.dy * speed;

    const finalTileX = Math.floor(nextX);
    const finalTileY = Math.floor(nextY);

    if (!this.isWalkable(finalTileX, finalTileY)) {
      return {
        ...char,
        x: tileX + 0.5,
        y: tileY + 0.5,
        direction: newDirection,
      };
    }

    return { ...char, x: nextX, y: nextY, direction: newDirection };
  }

  // ============================================
  // PUBLIC METHODS (called from React)
  // ============================================

  // Convert subtile grid coordinates to isometric screen position
  // Use tilemap's tileToWorldXY for perfect alignment with tilemap tiles
  gridToScreen(gridX: number, gridY: number): { x: number; y: number } {
    if (this.groundMap) {
      const worldPoint = this.groundMap.tileToWorldXY(gridX, gridY);
      if (worldPoint) {
        // tileToWorldXY returns top-left of bounding box
        // Add half tile width to get the top corner of the diamond
        return { x: worldPoint.x + SUBTILE_WIDTH / 2, y: worldPoint.y };
      }
    }
    // Fallback if tilemap not ready
    return {
      x: GRID_OFFSET_X + (gridX - gridY) * (SUBTILE_WIDTH / 2),
      y: GRID_OFFSET_Y + (gridX + gridY) * (SUBTILE_HEIGHT / 2),
    };
  }

  // Convert grid to screen using pure math formula for smooth sub-tile movement
  // This guarantees perfect 2:1 isometric ratios for moving entities (cars, characters)
  // Unlike gridToScreen, this doesn't use the tilemap which can cause jitter with fractional coords
  private gridToScreenSmooth(gridX: number, gridY: number): { x: number; y: number } {
    return {
      x: GRID_OFFSET_X + (gridX - gridY) * (SUBTILE_WIDTH / 2),
      y: GRID_OFFSET_Y + (gridX + gridY) * (SUBTILE_HEIGHT / 2),
    };
  }

  screenToGrid(screenX: number, screenY: number): { x: number; y: number } {
    if (this.groundMap) {
      // Offset Y down so cursor selects the tile it's visually "on" rather than "under"
      const tilePoint = this.groundMap.worldToTileXY(screenX, screenY + SUBTILE_HEIGHT / 2);
      if (tilePoint) {
        return { x: tilePoint.x, y: tilePoint.y };
      }
    }
    // Fallback if tilemap not ready
    const relX = screenX - GRID_OFFSET_X;
    const relY = screenY - GRID_OFFSET_Y;

    return {
      x: (relX / (SUBTILE_WIDTH / 2) + relY / (SUBTILE_HEIGHT / 2)) / 2,
      y: (relY / (SUBTILE_HEIGHT / 2) - relX / (SUBTILE_WIDTH / 2)) / 2,
    };
  }

  private depthFromSortPoint(
    sortX: number,
    sortY: number,
    layerOffset: number = 0
  ): number {
    return sortY * this.DEPTH_Y_MULT + sortX + layerOffset;
  }

  handlePointerMove(pointer: Phaser.Input.Pointer): void {
    if (!this.isReady) return;

    // Handle camera panning
    if (this.isPanning && pointer.leftButtonDown()) {
      const camera = this.cameras.main;
      const dx = (this.panStartX - pointer.x) / camera.zoom;
      const dy = (this.panStartY - pointer.y) / camera.zoom;
      // Update BASE scroll (never include transient shake in the base)
      this.baseScrollX = this.cameraStartX + dx;
      this.baseScrollY = this.cameraStartY + dy;
      camera.setScroll(
        Math.round(this.baseScrollX + (this.shakeAxis === "x" ? this.shakeOffset : 0)),
        Math.round(this.baseScrollY + (this.shakeAxis === "y" ? this.shakeOffset : 0))
      );
      return;
    }

    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const gridPos = this.screenToGrid(worldPoint.x, worldPoint.y);
    const tileX = Math.floor(gridPos.x);
    const tileY = Math.floor(gridPos.y);

    if (tileX >= 0 && tileX < GRID_WIDTH && tileY >= 0 && tileY < GRID_HEIGHT) {
      if (
        !this.hoverTile ||
        this.hoverTile.x !== tileX ||
        this.hoverTile.y !== tileY
      ) {
        this.hoverTile = { x: tileX, y: tileY };
        this.events_.onTileHover(tileX, tileY);

        // If dragging with snow/tile/asphalt/eraser tool, add tile to drag set
        if (
          this.isDragging &&
          (this.selectedTool === ToolType.Snow ||
            this.selectedTool === ToolType.Tile ||
            this.selectedTool === ToolType.Asphalt ||
            this.selectedTool === ToolType.Eraser)
        ) {
          this.dragTiles.add(`${tileX},${tileY}`);
        }

        // If dragging with road lane tool, add lanes in straight line (snapped to 2x2 grid)
        if (
          this.isDragging &&
          (this.selectedTool === ToolType.RoadLane ||
           this.selectedTool === ToolType.RoadTurn) &&
          this.dragStartTile
        ) {
          // Determine direction on first movement
          if (this.dragDirection === null) {
            const dx = Math.abs(tileX - this.dragStartTile.x);
            const dy = Math.abs(tileY - this.dragStartTile.y);
            if (dx > dy) {
              this.dragDirection = "horizontal";
            } else if (dy > dx) {
              this.dragDirection = "vertical";
            } else {
              // Equal movement - wait for more movement, keep initial lane
              return;
            }
          }

          // Clear and rebuild drag tiles for road lanes
          this.dragTiles.clear();

          // Constrain to the determined direction
          if (this.dragDirection === "horizontal") {
            // Only add lanes along horizontal line
            const startX = Math.min(this.dragStartTile.x, tileX);
            const endX = Math.max(this.dragStartTile.x, tileX);
            const startLane = getRoadLaneOrigin(startX, this.dragStartTile.y);
            const endLane = getRoadLaneOrigin(endX, this.dragStartTile.y);

            const startLaneX = Math.min(startLane.x, endLane.x);
            const endLaneX = Math.max(startLane.x, endLane.x);

            for (
              let laneX = startLaneX;
              laneX <= endLaneX;
              laneX += ROAD_LANE_SIZE
            ) {
              this.dragTiles.add(`${laneX},${startLane.y}`);
            }
          } else if (this.dragDirection === "vertical") {
            // Only add lanes along vertical line
            const startY = Math.min(this.dragStartTile.y, tileY);
            const endY = Math.max(this.dragStartTile.y, tileY);
            const startLane = getRoadLaneOrigin(this.dragStartTile.x, startY);
            const endLane = getRoadLaneOrigin(this.dragStartTile.x, endY);

            const startLaneY = Math.min(startLane.y, endLane.y);
            const endLaneY = Math.max(startLane.y, endLane.y);

            for (
              let laneY = startLaneY;
              laneY <= endLaneY;
              laneY += ROAD_LANE_SIZE
            ) {
              this.dragTiles.add(`${startLane.x},${laneY}`);
            }
          }

          // Update preview after updating drag tiles
          this.updatePreview();
        }

        this.updatePreview();
      }
    } else {
      if (this.hoverTile) {
        this.hoverTile = null;
        this.events_.onTileHover(null, null);
        this.clearPreview();
      }
    }
  }

  handlePointerDown(pointer: Phaser.Input.Pointer): void {
    if (!this.isReady) return;

    if (pointer.leftButtonDown()) {
      // Check if we should start panning (no tool selected OR clicking empty space with no active tool)
      const shouldPan =
        this.selectedTool === ToolType.None ||
        (this.selectedTool === ToolType.Building && !this.hoverTile);

      if (shouldPan) {
        // Start camera panning
        this.isPanning = true;
        this.panStartX = pointer.x;
        this.panStartY = pointer.y;
        // Capture BASE scroll (never include transient shake in the base)
        this.cameraStartX = this.baseScrollX;
        this.cameraStartY = this.baseScrollY;
        return;
      }

      if (this.hoverTile) {
        // Start drag for snow/tile/asphalt/eraser/road tools
        if (
          this.selectedTool === ToolType.Snow ||
          this.selectedTool === ToolType.Tile ||
          this.selectedTool === ToolType.Asphalt ||
          this.selectedTool === ToolType.Eraser ||
          this.selectedTool === ToolType.Sidewalk ||
          this.selectedTool === ToolType.RoadLane ||
          this.selectedTool === ToolType.RoadTurn
        ) {
          this.isDragging = true;
          this.dragTiles.clear();
          this.dragStartTile = { x: this.hoverTile.x, y: this.hoverTile.y };
          this.dragDirection = null;

          if (
            this.selectedTool === ToolType.RoadLane ||
            this.selectedTool === ToolType.RoadTurn
          ) {
            // For road lanes, add the initial lane origin (snapped to 2x2 grid)
            const laneOrigin = getRoadLaneOrigin(
              this.hoverTile.x,
              this.hoverTile.y
            );
            this.dragTiles.add(`${laneOrigin.x},${laneOrigin.y}`);
          } else {
            // For other tools, add the tile directly
            this.dragTiles.add(`${this.hoverTile.x},${this.hoverTile.y}`);
          }
          this.updatePreview();
        } else {
          // Regular single click for other tools
          this.events_.onTileClick(this.hoverTile.x, this.hoverTile.y);
        }
      }
    }
  }

  handlePointerUp(_pointer: Phaser.Input.Pointer): void {
    if (!this.isReady) return;

    // End camera panning
    if (this.isPanning) {
      this.isPanning = false;
    }

    if (this.isDragging) {
      const tiles = Array.from(this.dragTiles).map((key) => {
        const [x, y] = key.split(",").map(Number);
        return { x, y };
      });

      if (tiles.length > 0) {
        if (
          this.selectedTool === ToolType.Eraser &&
          this.events_.onEraserDrag
        ) {
          // Eraser uses confirmation dialog
          this.events_.onEraserDrag(tiles);
        } else if (
          (this.selectedTool === ToolType.RoadLane ||
           this.selectedTool === ToolType.RoadTurn) &&
          this.events_.onRoadLaneDrag
        ) {
          // Road lane drag - lanes are already in dragTiles with 2x2 origins
          // Map tool type to tile type
          const tileType = this.selectedTool === ToolType.RoadTurn ? TileType.RoadTurn : TileType.RoadLane;
          this.events_.onRoadLaneDrag(tiles, this.roadLaneDirection, tileType);
        } else if (this.events_.onTilesDrag) {
          // Snow/Tile place immediately
          this.events_.onTilesDrag(tiles);
        }
      }

      this.isDragging = false;
      this.dragTiles.clear();
      this.dragStartTile = null;
      this.dragDirection = null;
      this.updatePreview();
    }
  }

  // Zoom levels matching React state
  private static readonly ZOOM_LEVELS = [0.25, 0.5, 1, 2, 4];
  private wheelAccumulator = 0;
  private lastWheelDirection = 0;
  // Anchor point for consistent zoom-at-cursor during rapid scrolling
  private zoomAnchorWorld: { x: number; y: number } | null = null;
  private zoomAnchorScreen: { x: number; y: number } | null = null;
  private lastZoomTime = 0;
  private static readonly ZOOM_ANCHOR_TIMEOUT = 150; // ms to keep anchor locked

  // Handle mouse wheel zoom - anchor-based to prevent drift
  // Official Phaser approach: https://phaser.io/examples/v3.85.0/tilemap/view/mouse-wheel-zoom
  handleWheel(
    pointer: Phaser.Input.Pointer,
    _gameObjects: Phaser.GameObjects.GameObject[],
    _deltaX: number,
    deltaY: number,
    _deltaZ: number
  ): void {
    if (!this.isReady) return;

    const camera = this.cameras.main;
    const WHEEL_THRESHOLD = 100;

    // Accumulate wheel delta for discrete zoom levels
    const direction = deltaY > 0 ? 1 : -1;
    if (this.lastWheelDirection !== 0 && this.lastWheelDirection !== direction) {
      this.wheelAccumulator = 0;
    }
    this.lastWheelDirection = direction;
    this.wheelAccumulator += Math.abs(deltaY);

    if (this.wheelAccumulator < WHEEL_THRESHOLD) return;
    this.wheelAccumulator = 0;

    // Find current zoom index and calculate new zoom
    const currentZoom = camera.zoom;
    let currentIndex = MainScene.ZOOM_LEVELS.indexOf(currentZoom);
    if (currentIndex === -1) {
      currentIndex = MainScene.ZOOM_LEVELS.reduce((closest, z, i) =>
        Math.abs(z - currentZoom) < Math.abs(MainScene.ZOOM_LEVELS[closest] - currentZoom) ? i : closest, 0);
    }

    const newIndex = direction > 0
      ? Math.max(0, currentIndex - 1)
      : Math.min(MainScene.ZOOM_LEVELS.length - 1, currentIndex + 1);

    const newZoom = MainScene.ZOOM_LEVELS[newIndex];
    if (newZoom === currentZoom) return;

    // === OFFICIAL PHASER APPROACH ===
    // Step 1: Get world point under cursor BEFORE zoom
    const worldPoint = camera.getWorldPoint(pointer.x, pointer.y);

    // Step 2: Apply new zoom
    camera.zoom = newZoom;

    // Step 3: Update camera matrix so getWorldPoint returns zoom-adjusted coords
    camera.preRender();

    // Step 4: Get world point at same screen position AFTER zoom
    const newWorldPoint = camera.getWorldPoint(pointer.x, pointer.y);

    // Step 5: Scroll camera to keep pointer under same world point
    camera.scrollX -= newWorldPoint.x - worldPoint.x;
    camera.scrollY -= newWorldPoint.y - worldPoint.y;

    // Update our state to match
    this.baseScrollX = camera.scrollX;
    this.baseScrollY = camera.scrollY;
    this.zoomLevel = newZoom;
    this.zoomHandledInternally = true;

    this.events.emit('zoomChanged', newZoom);
  }

  setEventCallbacks(events: SceneEvents): void {
    this.events_ = events;
  }

  // Receive grid updates from React (differential update)
  // Mark specific tiles as dirty (called from React after grid mutations)
  markTilesDirty(tiles: Array<{ x: number; y: number }>): void {
    for (const { x, y } of tiles) {
      this.gridDirtyTiles.add(`${x},${y}`);
    }
    if (tiles.length > 0) {
      this.gridDirty = true;
    }
  }

  updateGrid(newGrid: GridCell[][]): void {
    // Update grid reference (React now tells us what changed via markTilesDirty)
    this.grid = newGrid;
    this.trafficManager.setGrid(newGrid);

    if (this.gridDirtyTiles.size > 0) {
      this.gridDirty = true;
    }

    // Refresh preview
    if (this.isReady) {
      this.updatePreview();
      if (this.showPaths) {
        this.renderPathOverlay();
      }
    }
  }

  private applyGridUpdates(): void {
    // Process dirty tiles
    const buildingsToRender = new Set<string>();
    const buildingsToRemove = new Set<string>();
    const propsOnBuildingsToRender = new Set<string>();
    const propsOnBuildingsToRemove = new Set<string>();

    for (const key of this.gridDirtyTiles) {
      const [xStr, yStr] = key.split(",");
      const x = parseInt(xStr);
      const y = parseInt(yStr);
      const cell = this.grid[y]?.[x];
      if (!cell) continue;

      // Update tile sprite
      this.updateTileSprite(x, y, cell);

      // Track building changes
      if (cell.type === TileType.Building && cell.isOrigin && cell.buildingId) {
        buildingsToRender.add(`${x},${y}`);
      }

      // Check if an old building was here
      const oldBuildingKey = `building_${x},${y}`;
      if (
        this.buildingSprites.has(oldBuildingKey) &&
        (cell.type !== TileType.Building || !cell.isOrigin)
      ) {
        buildingsToRemove.add(oldBuildingKey);
      }

      // Track prop-on-building changes
      const propKey = `prop_${x},${y}`;
      if (cell.propId && cell.propOriginX === x && cell.propOriginY === y) {
        // This is the origin of a prop on a building tile
        propsOnBuildingsToRender.add(`${x},${y}`);
      }
      // Check if an old prop was here
      if (this.propOnBuildingSprites.has(propKey) && !cell.propId) {
        propsOnBuildingsToRemove.add(propKey);
      }
    }

    // Remove old buildings and their glows (including slices)
    for (const key of buildingsToRemove) {
      this.removeBuildingSprites(key);
    }

    // Render new/changed buildings
    for (const key of buildingsToRender) {
      const [xStr, yStr] = key.split(",");
      const x = parseInt(xStr);
      const y = parseInt(yStr);
      const cell = this.grid[y]?.[x];
      if (cell?.buildingId) {
        // Remove old sprite and glow if exists (including slices)
        const buildingKey = `building_${x},${y}`;
        this.removeBuildingSprites(buildingKey);
        this.renderBuilding(x, y, cell.buildingId, cell.buildingOrientation);
      }
    }

    // Remove old props on buildings
    for (const key of propsOnBuildingsToRemove) {
      const sprite = this.propOnBuildingSprites.get(key);
      if (sprite) {
        sprite.destroy();
        this.propOnBuildingSprites.delete(key);
      }
    }

    // Render new/changed props on buildings
    for (const key of propsOnBuildingsToRender) {
      const [xStr, yStr] = key.split(",");
      const x = parseInt(xStr);
      const y = parseInt(yStr);
      const cell = this.grid[y]?.[x];
      if (cell?.propId) {
        const propKey = `prop_${x},${y}`;
        // Remove old sprite if exists
        const oldSprite = this.propOnBuildingSprites.get(propKey);
        if (oldSprite) {
          oldSprite.destroy();
          this.propOnBuildingSprites.delete(propKey);
        }
        this.renderPropOnBuilding(x, y, cell.propId, cell.propOrientation);
      }
    }

    // Update debug path overlay if enabled
    if (this.showPaths) {
      this.renderPathOverlay();
    }

    this.gridDirtyTiles.clear();
  }

  private updateTileSprite(x: number, y: number, cell: GridCell): void {
    // Use tilemap for ground tiles instead of individual sprites
    this.updateTilemapTile(x, y);
  }

  // Spawn a character
  spawnCharacter(): boolean {
    const roadTiles: { x: number; y: number }[] = [];
    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        const tileType = this.grid[y][x].type;
        if (tileType === TileType.Sidewalk || tileType === TileType.Tile) {
          roadTiles.push({ x, y });
        }
      }
    }

    if (roadTiles.length === 0) return false;

    const roadTile = roadTiles[Math.floor(Math.random() * roadTiles.length)];
    const characterTypes = [CharacterType.Banana, CharacterType.Apple];
    const randomCharacterType =
      characterTypes[Math.floor(Math.random() * characterTypes.length)];

    const newCharacter: Character = {
      id: generateId(),
      x: roadTile.x + 0.5,
      y: roadTile.y + 0.5,
      direction:
        allDirections[Math.floor(Math.random() * allDirections.length)],
      speed: CHARACTER_SPEED,
      characterType: randomCharacterType,
    };

    this.characters.push(newCharacter);
    return true;
  }

  // Car methods
  spawnCar(): boolean {
    return this.trafficManager.spawnCar();
  }

  setDrivingState(_isDriving: boolean): void {
    // TODO: implement player driving mode
  }

  getPlayerCar(): Car | null {
    // TODO: implement player car
    return null;
  }

  isPlayerDrivingMode(): boolean {
    // TODO: implement player driving mode
    return false;
  }

  getCharacterCount(): number {
    return this.characters.length;
  }

  getCarCount(): number {
    return this.trafficManager.getCarCount();
  }

  clearCharacters(): void {
    this.characters = [];
    this.characterSprites.forEach((sprite) => sprite.destroy());
    this.characterSprites.clear();
  }

  clearCars(): void {
    this.trafficManager.clearCars();
    this.carSprites.forEach((sprite) => sprite.destroy());
    this.carSprites.clear();
  }

  setSelectedTool(tool: ToolType): void {
    this.selectedTool = tool;
    if (this.isReady) {
      this.updatePreview();
    }
  }

  setSelectedBuilding(buildingId: string | null): void {
    this.selectedBuildingId = buildingId;
    if (this.isReady) {
      this.updatePreview();
    }
  }

  setBuildingOrientation(orientation: Direction): void {
    this.buildingOrientation = orientation;
    if (this.isReady) {
      this.updatePreview();
    }
  }

  setZoom(zoom: number): void {
    // Skip if zoom was just handled by internal wheel handler
    if (this.zoomHandledInternally) {
      this.zoomHandledInternally = false;
      return;
    }

    if (this.isReady) {
      const camera = this.cameras.main;

      // Store the current center point in WORLD coordinates
      const centerX = camera.midPoint.x;
      const centerY = camera.midPoint.y;

      // Apply new zoom
      camera.setZoom(zoom);

      // Calculate new scroll to keep same center point visible
      // Viewport size changes with zoom, so recalculate
      const viewportWidth = camera.width / zoom;
      const viewportHeight = camera.height / zoom;

      this.baseScrollX = Math.round(centerX - viewportWidth / 2);
      this.baseScrollY = Math.round(centerY - viewportHeight / 2);

      camera.setScroll(this.baseScrollX, this.baseScrollY);
    }
    this.zoomLevel = zoom;
  }

  // Zoom towards a specific screen point (legacy method, now using handleWheel)
  zoomAtPoint(zoom: number, screenX: number, screenY: number): void {
    if (!this.isReady) {
      this.zoomLevel = zoom;
      return;
    }

    const camera = this.cameras.main;

    // Get world position under cursor before zoom
    const worldPoint = camera.getWorldPoint(screenX, screenY);

    // Apply new zoom
    camera.setZoom(zoom);

    // Update camera matrix
    camera.preRender();

    // Get new world position and adjust scroll
    const newWorldPoint = camera.getWorldPoint(screenX, screenY);
    camera.scrollX = Math.round(camera.scrollX - (newWorldPoint.x - worldPoint.x));
    camera.scrollY = Math.round(camera.scrollY - (newWorldPoint.y - worldPoint.y));

    // Update baseScroll so update() loop doesn't reset it
    this.baseScrollX = camera.scrollX;
    this.baseScrollY = camera.scrollY;

    this.zoomLevel = zoom;
  }

  setShowPaths(show: boolean): void {
    this.showPaths = show;
    if (this.isReady) {
      this.renderPathOverlay();
    }
  }

  setShowStats(show: boolean): void {
    this.showStats = show;
  }

  // Center camera on the middle of the isometric map
  centerCameraOnMap(): void {
    if (!this.isReady) return;

    const camera = this.cameras.main;

    // Calculate center of the isometric map in world coordinates
    // The visual center of an isometric map at grid (GRID_WIDTH/2, GRID_HEIGHT/2)
    const centerPos = this.gridToScreen(GRID_WIDTH / 2, GRID_HEIGHT / 2);

    // Calculate scroll position to center the map
    // scrollX/Y is the top-left corner, so we offset by half the viewport size
    const viewportWidth = camera.width / camera.zoom;
    const viewportHeight = camera.height / camera.zoom;

    this.baseScrollX = Math.round(centerPos.x - viewportWidth / 2);
    this.baseScrollY = Math.round(centerPos.y - viewportHeight / 2);

    // Apply immediately
    camera.setScroll(this.baseScrollX, this.baseScrollY);
  }

  // ============================================
  // RENDERING
  // ============================================

  private renderPathOverlay(): void {
    if (this.pathOverlaySprites) {
      this.pathOverlaySprites.destroy();
      this.pathOverlaySprites = null;
    }

    if (!this.showPaths) return;

    const graphics = this.add.graphics();
    graphics.setDepth(900_000);

    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        const cell = this.grid[y]?.[x];
        if (!cell) continue;

        const tileType = cell.type;
        let color: number | null = null;
        const alpha = 0.5;

        if (tileType === TileType.Sidewalk) {
          color = 0x4488ff;
        } else if (tileType === TileType.Tile) {
          color = 0x44dddd;
        } else if (tileType === TileType.Asphalt) {
          color = 0xffcc00;
        }

        if (color !== null) {
          const screenPos = this.gridToScreen(x, y);

          graphics.fillStyle(color, alpha);
          graphics.beginPath();
          graphics.moveTo(screenPos.x, screenPos.y);
          graphics.lineTo(
            screenPos.x + SUBTILE_WIDTH / 2,
            screenPos.y + SUBTILE_HEIGHT / 2
          );
          graphics.lineTo(screenPos.x, screenPos.y + SUBTILE_HEIGHT);
          graphics.lineTo(
            screenPos.x - SUBTILE_WIDTH / 2,
            screenPos.y + SUBTILE_HEIGHT / 2
          );
          graphics.closePath();
          graphics.fillPath();
        }
      }
    }

    // Draw lane direction arrows for all road lane types
    // Red arrow = tile's stored direction
    // Green arrow = turn direction (for turn tiles)
    for (let y = 0; y < GRID_HEIGHT; y += ROAD_LANE_SIZE) {
      for (let x = 0; x < GRID_WIDTH; x += ROAD_LANE_SIZE) {
        const cell = this.grid[y]?.[x];
        const isRoadLane = cell?.type === TileType.RoadLane ||
                          cell?.type === TileType.RoadTurn;
        if (isRoadLane && cell?.isOrigin && cell?.laneDirection) {
          // Get center of 2x2 lane in screen coords
          const centerX = x + ROAD_LANE_SIZE / 2;
          const centerY = y + ROAD_LANE_SIZE / 2;
          const screenPos = this.gridToScreen(centerX, centerY);

          // Draw arrow showing tile's stored direction (RED)
          const dir = cell.laneDirection;
          const vec = directionVectors[dir];

          // Arrow points in isometric direction
          const isoVec = {
            x: (vec.dx - vec.dy) * 15,
            y: (vec.dx + vec.dy) * 7.5,
          };

          const startX = screenPos.x - isoVec.x * 0.5;
          const startY = screenPos.y - isoVec.y * 0.5;
          const endX = screenPos.x + isoVec.x * 0.5;
          const endY = screenPos.y + isoVec.y * 0.5;

          // Draw line
          graphics.lineStyle(3, 0xff0000, 1);
          graphics.beginPath();
          graphics.moveTo(startX, startY);
          graphics.lineTo(endX, endY);
          graphics.strokePath();

          // Draw arrowhead
          const headSize = 6;
          const angle = Math.atan2(endY - startY, endX - startX);
          graphics.fillStyle(0xff0000, 1);
          graphics.beginPath();
          graphics.moveTo(endX, endY);
          graphics.lineTo(
            endX - headSize * Math.cos(angle - 0.5),
            endY - headSize * Math.sin(angle - 0.5)
          );
          graphics.lineTo(
            endX - headSize * Math.cos(angle + 0.5),
            endY - headSize * Math.sin(angle + 0.5)
          );
          graphics.closePath();
          graphics.fillPath();

          // For turn tiles, draw a second arrow in the turn direction (GREEN)
          if (cell.type === TileType.RoadTurn) {
            const turnDir = rightTurnDirection[dir];
            const turnVec = directionVectors[turnDir];
            const turnIsoVec = {
              x: (turnVec.dx - turnVec.dy) * 15,
              y: (turnVec.dx + turnVec.dy) * 7.5,
            };

            const turnStartX = screenPos.x - turnIsoVec.x * 0.5;
            const turnStartY = screenPos.y - turnIsoVec.y * 0.5;
            const turnEndX = screenPos.x + turnIsoVec.x * 0.5;
            const turnEndY = screenPos.y + turnIsoVec.y * 0.5;

            // Draw turn arrow line (GREEN)
            graphics.lineStyle(3, 0x00ff00, 0.8);
            graphics.beginPath();
            graphics.moveTo(turnStartX, turnStartY);
            graphics.lineTo(turnEndX, turnEndY);
            graphics.strokePath();

            // Draw turn arrowhead
            const turnAngle = Math.atan2(turnEndY - turnStartY, turnEndX - turnStartX);
            graphics.fillStyle(0x00ff00, 0.8);
            graphics.beginPath();
            graphics.moveTo(turnEndX, turnEndY);
            graphics.lineTo(
              turnEndX - headSize * Math.cos(turnAngle - 0.5),
              turnEndY - headSize * Math.sin(turnAngle - 0.5)
            );
            graphics.lineTo(
              turnEndX - headSize * Math.cos(turnAngle + 0.5),
              turnEndY - headSize * Math.sin(turnAngle + 0.5)
            );
            graphics.closePath();
            graphics.fillPath();
          }
        }
      }
    }

    this.pathOverlaySprites = graphics;
  }

  private renderGrid(): void {
    // Ground tiles are now handled by the tilemap - only render buildings here
    this.buildingSprites.forEach((sprite) => sprite.destroy());
    this.buildingSprites.clear();
    this.propOnBuildingSprites.forEach((sprite) => sprite.destroy());
    this.propOnBuildingSprites.clear();
    this.glowSprites.forEach((sprite) => sprite.destroy());
    this.glowSprites.clear();

    // Sync tilemap with grid data
    this.syncTilemapWithGrid();

    // Render buildings (sprites on top of tilemap)
    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        const cell = this.grid[y]?.[x];
        if (!cell) continue;

        if (
          cell.type === TileType.Building &&
          cell.isOrigin &&
          cell.buildingId
        ) {
          this.renderBuilding(x, y, cell.buildingId, cell.buildingOrientation);
        }
      }
    }

    // Render props on buildings (after buildings so they appear on top)
    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        const cell = this.grid[y]?.[x];
        if (!cell) continue;

        if (cell.propId && cell.propOriginX === x && cell.propOriginY === y) {
          this.renderPropOnBuilding(x, y, cell.propId, cell.propOrientation);
        }
      }
    }
  }

  // Sync tilemap tiles with grid cell types
  private syncTilemapWithGrid(): void {
    if (!this.groundLayer) return;

    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        const cell = this.grid[y]?.[x];
        if (!cell) continue;

        const tileIndex = this.getTileIndexForCell(cell, x, y);
        this.groundLayer.putTileAt(tileIndex, x, y);
      }
    }
  }

  // Update a single tile in the tilemap (for efficient incremental updates)
  private updateTilemapTile(x: number, y: number): void {
    if (!this.groundLayer) return;

    const cell = this.grid[y]?.[x];
    if (!cell) return;

    const tileIndex = this.getTileIndexForCell(cell, x, y);
    this.groundLayer.putTileAt(tileIndex, x, y);
  }

  // Get the tile index for a grid cell
  // Handles both quadrant tiles (road, asphalt) and non-quadrant tiles (grass, snow)
  private getTileIndexForCell(cell: GridCell, x: number, y: number): number {
    // Helper for quadrant offset (0=TL, 1=TR, 2=BL, 3=BR)
    const getQuadrant = () => (y % 2) * 2 + (x % 2);

    if (cell.type === TileType.Sidewalk || cell.type === TileType.Tile) {
      // Quadrant tile
      return TileIndex.RoadTL + getQuadrant();
    } else if (
      cell.type === TileType.Asphalt ||
      cell.type === TileType.RoadLane ||
      cell.type === TileType.RoadTurn
    ) {
      // Quadrant tile - road lanes render as asphalt
      return TileIndex.AsphaltTL + getQuadrant();
    } else if (cell.type === TileType.Snow) {
      // Non-quadrant, but with variants
      const variant = ((x * 7 + y * 13) % 3);
      return TileIndex.Snow1 + variant;
    } else if (cell.type === TileType.Building) {
      // For buildings, check if it preserves underlying tile
      if (cell.buildingId) {
        const building = getBuilding(cell.buildingId);
        const preservesTile =
          building && (building.category === "props" || building.isDecoration);
        if (preservesTile && cell.underlyingTileType) {
          if (cell.underlyingTileType === TileType.Tile ||
              cell.underlyingTileType === TileType.Sidewalk) {
            return TileIndex.RoadTL + getQuadrant();
          } else if (cell.underlyingTileType === TileType.Asphalt) {
            return TileIndex.AsphaltTL + getQuadrant();
          } else if (cell.underlyingTileType === TileType.Snow) {
            const variant = ((x * 7 + y * 13) % 3);
            return TileIndex.Snow1 + variant;
          }
        } else if (!preservesTile) {
          // Non-decorative buildings show road underneath
          return TileIndex.RoadTL + getQuadrant();
        }
      }
      return TileIndex.Grass;
    }
    return TileIndex.Grass;
  }

  // Remove a building and all its vertical slices (see renderBuilding for slice docs)
  // Buildings are stored as: "building_X,Y" (main) + "building_X,Y_s1", "_s2", etc. (slices)
  private removeBuildingSprites(buildingKey: string): void {
    // Remove main sprite
    const sprite = this.buildingSprites.get(buildingKey);
    if (sprite) {
      sprite.destroy();
      this.buildingSprites.delete(buildingKey);
    }

    // Remove all slices (up to 20 should be more than enough)
    for (let i = 1; i < 20; i++) {
      const sliceKey = `${buildingKey}_s${i}`;
      const sliceSprite = this.buildingSprites.get(sliceKey);
      if (sliceSprite) {
        sliceSprite.destroy();
        this.buildingSprites.delete(sliceKey);
      } else {
        break; // No more slices
      }
    }

    // Remove glow if exists
    const glow = this.glowSprites.get(buildingKey);
    if (glow) {
      glow.destroy();
      this.glowSprites.delete(buildingKey);
    }
  }

  // Render a prop placed on a building's prop slot
  private renderPropOnBuilding(
    originX: number,
    originY: number,
    propId: string,
    orientation?: Direction
  ): void {
    const prop = getBuilding(propId);
    if (!prop) {
      console.warn(`Prop not found in registry: ${propId}`);
      return;
    }

    const key = `prop_${originX},${originY}`;
    const textureKey = this.getBuildingTextureKey(prop, orientation);

    if (!this.textures.exists(textureKey)) {
      console.warn(`Prop texture not found: ${textureKey}`);
      return;
    }

    // Get footprint for positioning
    const footprint = getBuildingFootprint(prop, orientation);

    // Front corner is at the SE corner of the footprint
    const frontX = originX + footprint.width - 1;
    const frontY = originY + footprint.height - 1;
    const screenPos = this.gridToScreen(frontX, frontY);
    const bottomY = screenPos.y + SUBTILE_HEIGHT;

    // Create the prop sprite
    const sprite = this.add.image(screenPos.x, bottomY, textureKey);
    sprite.setOrigin(0.5, 1); // Bottom-center anchor

    // Apply tint if needed (like flower bush)
    if (propId === "flower-bush") {
      sprite.setTint(0xbbddbb);
    }

    // Props on buildings render slightly above buildings (0.07 layer)
    const depth = this.depthFromSortPoint(screenPos.x, bottomY, 0.07);
    sprite.setDepth(depth);

    this.propOnBuildingSprites.set(key, sprite);
  }

  private renderBuilding(
    originX: number,
    originY: number,
    buildingId: string,
    orientation?: Direction
  ): void {
    const building = getBuilding(buildingId);
    if (!building) {
      console.warn(`Building not found in registry: ${buildingId}`);
      return;
    }

    const key = `building_${originX},${originY}`;
    const textureKey = this.getBuildingTextureKey(building, orientation);

    if (!this.textures.exists(textureKey)) {
      console.warn(`Texture not found: ${textureKey}`);
      return;
    }

    // Get footprint based on orientation (in subtile units)
    const footprint = getBuildingFootprint(building, orientation);

    // Get render size for slicing (use renderSize if available, else footprint)
    const renderSize = building.renderSize || footprint;
    // Front corner is at the SE corner of the footprint
    const frontX = originX + footprint.width - 1;
    const frontY = originY + footprint.height - 1;
    const screenPos = this.gridToScreen(frontX, frontY);
    // Building sprites have anchor at (256, 512) - bottom of 512x512 sprite
    // Bottom of the front tile diamond is screenPos.y + SUBTILE_HEIGHT
    const bottomY = screenPos.y + SUBTILE_HEIGHT;

    // Calculate tint for props (needed for each slice)
    let tint: number | null = null;
    if (buildingId === "flower-bush") {
      tint = 0xbbddbb;
    }

    // ========================================================================
    // DEPTH LAYER SYSTEM - Layer offsets for correct render ordering
    // ========================================================================
    //
    // Depth formula: sortY * 10000 + sortX + layerOffset
    //
    // Layer offsets control render order for items at the same grid position:
    //   0.00 - Ground tiles (grass, road, asphalt)
    //   0.04 - Lamp glow effects (behind lamps)
    //   0.05 - Buildings (regular structures)
    //   0.06 - Extended decorations (trees with foliage beyond footprint)
    //   0.10 - Cars
    //   0.20 - Characters
    //
    // FUTURE: When adding fences, traffic lights, etc., use this render order:
    //   1. Back-left fence   (layer ~0.03, before building)
    //   2. Back-right fence  (layer ~0.03, before building)
    //   3. Building          (layer 0.05)
    //   4. Props/trees       (layer 0.06)
    //   5. Front-left fence  (layer ~0.07, after building/props)
    //   6. Front-right fence (layer ~0.07, after building/props)
    //
    // FENCES: Determine which edge of the tile the fence is on (N, S, E, W)
    //   - Back edges (N, W in isometric) render BEFORE the building
    //   - Front edges (S, E in isometric) render AFTER the building
    //   - Use the tile's grid position for depth, with appropriate layer offset
    //
    // TRAFFIC LIGHTS: These are tricky because they overhang the road!
    //   - The pole sits on one tile (e.g., corner of intersection)
    //   - The overhang/light extends over an adjacent road tile
    //   - Cars need to pass UNDER the overhang, not behind it
    //
    //   Solution: Slice the traffic light into TWO parts with different depths:
    //   1. POLE portion: Use the pole's actual tile position for depth
    //      - Renders normally based on where it's planted
    //   2. OVERHANG portion: Use the ROAD tile's position for depth anchor
    //      - This makes cars on that road tile render BEHIND the overhang
    //      - The overhang slice depth = road tile's depth + small offset (~0.09)
    //      - Cars have layer 0.10, so they appear UNDER the light
    //
    //   Example: Traffic light at (5,5) with overhang over road at (6,5)
    //   - Pole slice: depth based on grid (5,5)
    //   - Overhang slice: depth based on grid (6,5) + 0.09 layer offset
    //   - Car on (6,5): depth based on grid (6,5) + 0.10 layer offset
    //   - Result: pole -> overhang -> car (overhang appears above car!)
    //
    // ========================================================================

    // Check if this is a decoration with visual extending beyond footprint (like trees)
    // For these, we use uniform depth for all slices to prevent clipping by adjacent buildings
    const isExtendedDecoration =
      building.isDecoration &&
      building.renderSize &&
      (building.renderSize.width > footprint.width ||
        building.renderSize.height > footprint.height);

    // Pre-calculate depth for extended decorations (trees with foliage beyond footprint)
    // Use footprint position + 1/4 the render extension as a balanced middle ground:
    // - Not too far back (would get clipped by nearby buildings)
    // - Not too far forward (would render over buildings in front)
    const extendX = (renderSize.width - footprint.width) / 4;
    const extendY = (renderSize.height - footprint.height) / 4;
    const balancedFrontX = frontX + extendX;
    const balancedFrontY = frontY + extendY;
    const balancedGridSum = balancedFrontX + balancedFrontY;
    const balancedScreenY = GRID_OFFSET_Y + (balancedGridSum * SUBTILE_HEIGHT) / 2;
    const decorationDepth = this.depthFromSortPoint(
      screenPos.x,
      balancedScreenY + SUBTILE_HEIGHT / 2,
      0.06
    );

    // ========================================================================
    // VERTICAL SLICE RENDERING FOR CORRECT ISOMETRIC DEPTH SORTING
    // ========================================================================
    //
    // Problem: In isometric view, a single building sprite can't have one depth
    // value because characters/props walking through the building's footprint
    // need to appear IN FRONT of some parts and BEHIND others.
    //
    // Solution: Slice the building sprite into vertical strips. Each strip
    // corresponds to one "diagonal" of tiles and gets its own depth value.
    //
    // Building sprites are 512x512 with the front corner at (256, 512).
    // Tiles are 64px wide in screen space, so each diagonal is 32px offset.
    //
    // For a 4x4 building (width=4, height=4), we create 8 slices:
    //   - 4 LEFT slices (for width): tiles going WEST from front corner
    //   - 4 RIGHT slices (for height): tiles going NORTH from front corner
    //
    //   Sprite layout (512px wide):
    //   ┌────────────────────────────────────────────────────────────────┐
    //   │                        BUILDING                                │
    //   │                                                                │
    //   │  ←── LEFT slices ──→│←── RIGHT slices ──→                     │
    //   │  (width tiles)      │ (height tiles)                          │
    //   │                     │                                          │
    //   │  srcX: 168 190 212 234 256 278 300 322                        │
    //   │        ↓   ↓   ↓   ↓   ↓   ↓   ↓   ↓                          │
    //   │        [4] [3] [2] [1] [1] [2] [3] [4]  ← depth offset        │
    //   │                     ↑                                          │
    //   │               FRONT CORNER (256)                               │
    //   └────────────────────────────────────────────────────────────────┘
    //
    // Depth: Each slice's depth = what it would be if a 1x1 tile existed there.
    // This allows characters to correctly interleave with building parts.
    // ========================================================================

    const SLICE_WIDTH = 32; // Half tile width - isometric diagonal offset (64/2)
    const SPRITE_CENTER = 256; // Front corner X in sprite space
    const SPRITE_HEIGHT = 512;

    let sliceIndex = 0;

    // LEFT slices: cover tiles going WEST from front corner (decreasing grid X)
    // i=0 is closest to center (frontmost depth), i=width-1 is furthest left (backmost)
    // Use renderSize for slicing (visual size), not footprint (collision size)
    for (let i = 0; i < renderSize.width; i++) {
      const srcX = SPRITE_CENTER - (i + 1) * SLICE_WIDTH;

      const slice = this.add.image(screenPos.x, bottomY, textureKey);
      slice.setOrigin(0.5, 1);
      slice.setCrop(srcX, 0, SLICE_WIDTH, SPRITE_HEIGHT);

      if (tint !== null) {
        slice.setTint(tint);
      }

      // Depth: For extended decorations (like trees), use uniform footprint-based depth
      // to prevent clipping. For regular buildings, calculate per-slice depth.
      if (isExtendedDecoration) {
        slice.setDepth(decorationDepth);
      } else {
        // This slice represents tile column (frontX - i)
        // Frontmost tile in this column is at (frontX - i, frontY)
        // gridSum = (frontX - i) + frontY
        const sliceGridSum = frontX - i + frontY;
        const sliceScreenY = GRID_OFFSET_Y + (sliceGridSum * SUBTILE_HEIGHT) / 2;
        slice.setDepth(
          this.depthFromSortPoint(
            screenPos.x,
            sliceScreenY + SUBTILE_HEIGHT / 2,
            0.05
          )
        );
      }

      if (sliceIndex === 0) {
        this.buildingSprites.set(key, slice);
      } else {
        this.buildingSprites.set(`${key}_s${sliceIndex}`, slice);
      }
      sliceIndex++;
    }

    // RIGHT slices: cover tiles going NORTH from front corner (decreasing grid Y)
    // i=0 is at center (frontmost depth), i=height-1 is furthest right (backmost)
    // Use renderSize for slicing (visual size), not footprint (collision size)
    for (let i = 0; i < renderSize.height; i++) {
      const srcX = SPRITE_CENTER + i * SLICE_WIDTH;

      const slice = this.add.image(screenPos.x, bottomY, textureKey);
      slice.setOrigin(0.5, 1);
      slice.setCrop(srcX, 0, SLICE_WIDTH, SPRITE_HEIGHT);

      if (tint !== null) {
        slice.setTint(tint);
      }

      // Depth: For extended decorations (like trees), use uniform footprint-based depth
      // to prevent clipping. For regular buildings, calculate per-slice depth.
      if (isExtendedDecoration) {
        slice.setDepth(decorationDepth);
      } else {
        // This slice represents tile row (frontY - i)
        // Frontmost tile in this row is at (frontX, frontY - i)
        // gridSum = frontX + (frontY - i)
        const sliceGridSum = frontX + frontY - i;
        const sliceScreenY = GRID_OFFSET_Y + (sliceGridSum * SUBTILE_HEIGHT) / 2;
        slice.setDepth(
          this.depthFromSortPoint(
            screenPos.x,
            sliceScreenY + SUBTILE_HEIGHT / 2,
            0.05
          )
        );
      }

      this.buildingSprites.set(`${key}_s${sliceIndex}`, slice);
      sliceIndex++;
    }

    // Add glow effect for christmas lamps
    if (buildingId === "christmas-lamp") {
      this.addLampGlow(key, screenPos.x, screenPos.y);
    }
  }

  private addLampGlow(key: string, x: number, tileY: number): void {
    // Position glow at lampshade height (offset up from tile)
    const lampshadeOffsetY = -45; // Pixels above the tile base
    const glowY = tileY + SUBTILE_HEIGHT / 2 + lampshadeOffsetY;

    // Create pixelated glow texture if it doesn't exist
    if (!this.textures.exists("lamp_glow")) {
      this.createPixelatedGlowTexture();
    }

    // Create glow sprite using the pixelated texture
    const glow = this.add.image(x, glowY, "lamp_glow");
    glow.setBlendMode(Phaser.BlendModes.ADD);
    glow.setDepth(this.depthFromSortPoint(x, tileY + SUBTILE_HEIGHT / 2, 0.04)); // Just behind lamp

    // Add subtle pulsing animation
    this.tweens.add({
      targets: glow,
      alpha: { from: 0.7, to: 1.0 },
      duration: 2000,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    this.glowSprites.set(key, glow);
  }

  private createPixelatedGlowTexture(): void {
    const size = 96; // Larger texture size
    const graphics = this.make.graphics({ x: 0, y: 0 });

    // Create pixelated rings with subtle fading opacity (from center out)
    const rings = [
      { radius: 6, alpha: 0.15 },
      { radius: 12, alpha: 0.12 },
      { radius: 20, alpha: 0.08 },
      { radius: 30, alpha: 0.05 },
      { radius: 40, alpha: 0.03 },
      { radius: 48, alpha: 0.015 },
    ];

    const centerX = size / 2;
    const centerY = size / 2;
    const glowColor = 0xffcc66; // Warm yellow-orange

    // Draw rings from outside in so inner ones overlap
    for (let i = rings.length - 1; i >= 0; i--) {
      const ring = rings[i];
      graphics.fillStyle(glowColor, ring.alpha);

      // Draw pixelated diamond/square shape for isometric style
      const r = ring.radius;
      graphics.beginPath();
      graphics.moveTo(centerX, centerY - r); // Top
      graphics.lineTo(centerX + r, centerY); // Right
      graphics.lineTo(centerX, centerY + r); // Bottom
      graphics.lineTo(centerX - r, centerY); // Left
      graphics.closePath();
      graphics.fillPath();
    }

    // Generate texture from graphics
    graphics.generateTexture("lamp_glow", size, size);
    graphics.destroy();
  }

  private getBuildingTextureKey(
    building: BuildingDefinition,
    orientation?: Direction
  ): string {
    const dirMap: Record<Direction, string> = {
      [Direction.Down]: "south",
      [Direction.Up]: "north",
      [Direction.Left]: "west",
      [Direction.Right]: "east",
    };

    const dir = orientation ? dirMap[orientation] : "south";

    if (building.sprites[dir as keyof typeof building.sprites]) {
      return `${building.id}_${dir}`;
    }

    if (building.sprites.south) {
      return `${building.id}_south`;
    }

    const firstDir = Object.keys(building.sprites)[0];
    return `${building.id}_${firstDir}`;
  }

  // Car rendering
  private renderCars(): void {
    const cars = this.trafficManager.getCars();
    const currentCarIds = new Set(cars.map((c) => c.id));

    // Remove sprites for cars that no longer exist
    this.carSprites.forEach((sprite, id) => {
      if (!currentCarIds.has(id)) {
        sprite.destroy();
        this.carSprites.delete(id);
      }
    });

    // Update or create car sprites
    for (const car of cars) {
      // Use gridToScreen for proper alignment with tilemap
      const screenPos = this.gridToScreen(car.x, car.y);
      // Add offset to align cars with road center visually
      const groundY = screenPos.y + SUBTILE_HEIGHT;
      const textureKey = this.getCarTextureKey(car.carType, car.direction);

      let sprite = this.carSprites.get(car.id);
      if (!sprite) {
        sprite = this.add.sprite(screenPos.x, groundY, textureKey);
        sprite.setOrigin(0.5, 1);
        this.carSprites.set(car.id, sprite);
      } else {
        sprite.setPosition(screenPos.x, groundY);
        sprite.setTexture(textureKey);
      }
      sprite.setDepth(this.depthFromSortPoint(screenPos.x, groundY, 0.1));
    }
  }

  private getCarTextureKey(carType: CarType, direction: Direction): string {
    const dirMap: Record<Direction, string> = {
      [Direction.Up]: "n",
      [Direction.Down]: "s",
      [Direction.Left]: "w",
      [Direction.Right]: "e",
    };
    return `${carType}_${dirMap[direction]}`;
  }

  private renderCharacters(): void {
    const currentCharIds = new Set(this.characters.map((c) => c.id));
    this.characterSprites.forEach((sprite, id) => {
      if (!currentCharIds.has(id)) {
        sprite.destroy();
        this.characterSprites.delete(id);
      }
    });

    for (const char of this.characters) {
      // Use gridToScreen for proper alignment with tilemap
      const screenPos = this.gridToScreen(char.x, char.y);
      const centerY = screenPos.y + SUBTILE_HEIGHT / 2;
      const textureKey = this.getCharacterTextureKey(
        char.characterType,
        char.direction
      );

      let sprite = this.characterSprites.get(char.id);
      if (!sprite) {
        if (this.gifsLoaded && this.textures.exists(textureKey)) {
          sprite = this.add.sprite(screenPos.x, centerY, textureKey, 0);
        } else {
          sprite = this.add.sprite(screenPos.x, centerY, "__DEFAULT");
          sprite.setVisible(false);
        }
        sprite.setOrigin(0.5, 1);
        this.characterSprites.set(char.id, sprite);
      } else {
        sprite.setPosition(screenPos.x, centerY);
      }

      if (this.gifsLoaded && this.textures.exists(textureKey)) {
        sprite.setVisible(true);
        playGifAnimation(sprite, textureKey);
      }

      sprite.setDepth(this.depthFromSortPoint(screenPos.x, centerY, 0.2));
    }
  }

  private getCharacterTextureKey(
    charType: CharacterType,
    direction: Direction
  ): string {
    const dirMap: Record<Direction, string> = {
      [Direction.Up]: "north",
      [Direction.Down]: "south",
      [Direction.Left]: "west",
      [Direction.Right]: "east",
    };
    return `${charType}_${dirMap[direction]}`;
  }

  private clearPreview(): void {
    this.previewSprites.forEach((s) => s.destroy());
    this.previewSprites = [];
    this.lotPreviewSprites.forEach((s) => s.destroy());
    this.lotPreviewSprites = [];
  }

  // Draw a direction arrow at screen position (used for road lane preview)
  private drawDirectionArrow(
    screenX: number,
    screenY: number,
    direction: Direction,
    color: number = 0x00ff00,
    alpha: number = 0.9
  ): void {
    const graphics = this.add.graphics();
    graphics.setDepth(2_000_000); // Above everything

    const arrowLength = 12;
    const arrowHeadSize = 5;

    // Direction vectors
    let dx = 0, dy = 0;
    switch (direction) {
      case Direction.Right: dx = 1; dy = 0.5; break;  // Isometric right (SE)
      case Direction.Left: dx = -1; dy = -0.5; break; // Isometric left (NW)
      case Direction.Down: dx = -1; dy = 0.5; break;  // Isometric down (SW)
      case Direction.Up: dx = 1; dy = -0.5; break;    // Isometric up (NE)
    }

    // Normalize and scale
    const len = Math.sqrt(dx * dx + dy * dy);
    dx = (dx / len) * arrowLength;
    dy = (dy / len) * arrowLength;

    // Arrow line
    const startX = screenX - dx * 0.5;
    const startY = screenY - dy * 0.5;
    const endX = screenX + dx * 0.5;
    const endY = screenY + dy * 0.5;

    graphics.lineStyle(2, color, alpha);
    graphics.beginPath();
    graphics.moveTo(startX, startY);
    graphics.lineTo(endX, endY);
    graphics.strokePath();

    // Arrow head (two lines forming a V)
    const headAngle = Math.atan2(dy, dx);
    const headAngle1 = headAngle + Math.PI * 0.75;
    const headAngle2 = headAngle - Math.PI * 0.75;

    graphics.beginPath();
    graphics.moveTo(endX, endY);
    graphics.lineTo(
      endX + Math.cos(headAngle1) * arrowHeadSize,
      endY + Math.sin(headAngle1) * arrowHeadSize
    );
    graphics.strokePath();

    graphics.beginPath();
    graphics.moveTo(endX, endY);
    graphics.lineTo(
      endX + Math.cos(headAngle2) * arrowHeadSize,
      endY + Math.sin(headAngle2) * arrowHeadSize
    );
    graphics.strokePath();

    // Add to preview sprites so it gets cleaned up
    this.previewSprites.push(graphics);
  }

  private updatePreview(): void {
    this.clearPreview();

    if (!this.hoverTile) return;
    if (this.selectedTool === ToolType.None) return;

    const { x, y } = this.hoverTile;

    if (
      this.selectedTool === ToolType.RoadLane ||
      this.selectedTool === ToolType.RoadTurn
    ) {
      // Get lanes to preview - either drag set or just hover lane
      const lanesToPreview: Array<{ x: number; y: number }> = [];
      if (this.isDragging && this.dragTiles.size > 0) {
        // When dragging, show preview for all lanes in drag set
        this.dragTiles.forEach((key) => {
          const [laneX, laneY] = key.split(",").map(Number);
          lanesToPreview.push({ x: laneX, y: laneY });
        });
      } else if (x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT) {
        // Single hover - show preview for hovered lane (snapped to 2x2 grid)
        const laneOrigin = getRoadLaneOrigin(x, y);
        lanesToPreview.push({ x: laneOrigin.x, y: laneOrigin.y });
      }

      for (const lane of lanesToPreview) {
        const laneOrigin = { x: lane.x, y: lane.y };
        const placementCheck = canPlaceRoadLane(
          this.grid,
          laneOrigin.x,
          laneOrigin.y
        );
        const hasCollision = !placementCheck.valid;

        // Draw 2x2 asphalt tiles for the lane
        for (let dy = 0; dy < ROAD_LANE_SIZE; dy++) {
          for (let dx = 0; dx < ROAD_LANE_SIZE; dx++) {
            const px = laneOrigin.x + dx;
            const py = laneOrigin.y + dy;
            if (px < GRID_WIDTH && py < GRID_HEIGHT) {
              const screenPos = this.gridToScreen(px, py);
              const preview = this.add.image(screenPos.x, screenPos.y, "asphalt");
              preview.setOrigin(0.5, 0);
              preview.setScale(SUBTILE_WIDTH / preview.width, SUBTILE_HEIGHT / preview.height);
              preview.setAlpha(hasCollision ? 0.3 : 0.7);
              if (hasCollision) preview.setTint(0xff0000);
              preview.setDepth(this.depthFromSortPoint(screenPos.x, screenPos.y, 1_000_000));
              this.previewSprites.push(preview);
            }
          }
        }

        // Draw direction arrow in center of lane
        const centerX = laneOrigin.x + ROAD_LANE_SIZE / 2;
        const centerY = laneOrigin.y + ROAD_LANE_SIZE / 2;
        const centerScreen = this.gridToScreen(centerX, centerY);

        // Main direction (straight)
        this.drawDirectionArrow(
          centerScreen.x,
          centerScreen.y,
          this.roadLaneDirection,
          hasCollision ? 0xff0000 : 0x00ff00,
          hasCollision ? 0.5 : 0.9
        );

        // For turn tiles, also draw the turn direction (right turn)
        if (this.selectedTool === ToolType.RoadTurn) {
          const turnDir = rightTurnDirection[this.roadLaneDirection];
          this.drawDirectionArrow(
            centerScreen.x,
            centerScreen.y,
            turnDir,
            hasCollision ? 0xff6666 : 0x66ff66,
            hasCollision ? 0.4 : 0.7
          );
        }
      }
    } else if (this.selectedTool === ToolType.Tile) {
      // Get tiles to preview - either drag set or just hover tile
      const tilesToPreview: Array<{ x: number; y: number }> = [];
      if (this.isDragging && this.dragTiles.size > 0) {
        this.dragTiles.forEach((key) => {
          const [tx, ty] = key.split(",").map(Number);
          tilesToPreview.push({ x: tx, y: ty });
        });
      } else if (x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT) {
        tilesToPreview.push({ x, y });
      }

      for (const tile of tilesToPreview) {
        const tx = tile.x;
        const ty = tile.y;
        if (tx >= 0 && tx < GRID_WIDTH && ty >= 0 && ty < GRID_HEIGHT) {
          const cell = this.grid[ty]?.[tx];
          // Allow placing tile on grass, snow, or under decorations
          let hasCollision = false;
          if (cell) {
            if (cell.type === TileType.Building && cell.buildingId) {
              const existingBuilding = getBuilding(cell.buildingId);
              hasCollision =
                !existingBuilding ||
                (!existingBuilding.isDecoration &&
                  existingBuilding.category !== "props");
            } else if (
              cell.type !== TileType.Grass &&
              cell.type !== TileType.Snow
            ) {
              hasCollision = true;
            }
          }
          const screenPos = this.gridToScreen(tx, ty);
          const preview = this.add.image(screenPos.x, screenPos.y, "road");
          preview.setOrigin(0.5, 0);
          // Scale to fit subtile size (handles different source sizes)
          preview.setScale(SUBTILE_WIDTH / preview.width, SUBTILE_HEIGHT / preview.height);
          preview.setAlpha(hasCollision ? 0.3 : 0.7);
          if (hasCollision) preview.setTint(0xff0000);
          preview.setDepth(
            this.depthFromSortPoint(screenPos.x, screenPos.y, 1_000_000)
          );
          this.previewSprites.push(preview);
        }
      }
    } else if (this.selectedTool === ToolType.Asphalt) {
      // Get tiles to preview - either drag set or just hover tile
      const tilesToPreview: Array<{ x: number; y: number }> = [];
      if (this.isDragging && this.dragTiles.size > 0) {
        this.dragTiles.forEach((key) => {
          const [tx, ty] = key.split(",").map(Number);
          tilesToPreview.push({ x: tx, y: ty });
        });
      } else if (x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT) {
        tilesToPreview.push({ x, y });
      }

      for (const tile of tilesToPreview) {
        const tx = tile.x;
        const ty = tile.y;
        if (tx >= 0 && tx < GRID_WIDTH && ty >= 0 && ty < GRID_HEIGHT) {
          const cell = this.grid[ty]?.[tx];
          // Allow placing asphalt on grass, snow, tile, or under decorations
          let hasCollision = false;
          if (cell) {
            if (cell.type === TileType.Building && cell.buildingId) {
              const existingBuilding = getBuilding(cell.buildingId);
              hasCollision =
                !existingBuilding ||
                (!existingBuilding.isDecoration &&
                  existingBuilding.category !== "props");
            } else if (
              cell.type !== TileType.Grass &&
              cell.type !== TileType.Snow &&
              cell.type !== TileType.Tile
            ) {
              hasCollision = true;
            }
          }
          const screenPos = this.gridToScreen(tx, ty);
          const preview = this.add.image(screenPos.x, screenPos.y, "asphalt");
          preview.setOrigin(0.5, 0);
          preview.setScale(SUBTILE_WIDTH / preview.width, SUBTILE_HEIGHT / preview.height);
          preview.setAlpha(hasCollision ? 0.3 : 0.7);
          if (hasCollision) preview.setTint(0xff0000);
          preview.setDepth(
            this.depthFromSortPoint(screenPos.x, screenPos.y, 1_000_000)
          );
          this.previewSprites.push(preview);
        }
      }
    } else if (this.selectedTool === ToolType.Snow) {
      // Get tiles to preview - either drag set or just hover tile
      const tilesToPreview: Array<{ x: number; y: number }> = [];
      if (this.isDragging && this.dragTiles.size > 0) {
        this.dragTiles.forEach((key) => {
          const [tx, ty] = key.split(",").map(Number);
          tilesToPreview.push({ x: tx, y: ty });
        });
      } else if (x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT) {
        tilesToPreview.push({ x, y });
      }

      for (const tile of tilesToPreview) {
        const tx = tile.x;
        const ty = tile.y;
        if (tx >= 0 && tx < GRID_WIDTH && ty >= 0 && ty < GRID_HEIGHT) {
          const cell = this.grid[ty]?.[tx];
          // Allow placing snow on grass, tile, or under decorations
          let hasCollision = false;
          if (cell) {
            if (cell.type === TileType.Building && cell.buildingId) {
              const existingBuilding = getBuilding(cell.buildingId);
              hasCollision =
                !existingBuilding ||
                (!existingBuilding.isDecoration &&
                  existingBuilding.category !== "props");
            } else if (
              cell.type !== TileType.Grass &&
              cell.type !== TileType.Tile
            ) {
              hasCollision = true;
            }
          }
          const screenPos = this.gridToScreen(tx, ty);
          const preview = this.add.image(
            screenPos.x,
            screenPos.y,
            getSnowTextureKey(tx, ty)
          );
          preview.setOrigin(0.5, 0);
          preview.setScale(SUBTILE_WIDTH / preview.width, SUBTILE_HEIGHT / preview.height);
          preview.setAlpha(hasCollision ? 0.3 : 0.7);
          if (hasCollision) preview.setTint(0xff0000);
          preview.setDepth(
            this.depthFromSortPoint(screenPos.x, screenPos.y, 1_000_000)
          );
          this.previewSprites.push(preview);
        }
      }
    } else if (
      this.selectedTool === ToolType.Building &&
      this.selectedBuildingId
    ) {
      const building = getBuilding(this.selectedBuildingId);
      if (!building) return;

      // Get footprint based on current orientation
      const footprint = getBuildingFootprint(
        building,
        this.buildingOrientation
      );
      const originX = x - footprint.width + 1;
      const originY = y - footprint.height + 1;

      const isDecoration =
        building.category === "props" || building.isDecoration;
      let footprintCollision = false;
      for (let dy = 0; dy < footprint.height; dy++) {
        for (let dx = 0; dx < footprint.width; dx++) {
          const tileX = originX + dx;
          const tileY = originY + dy;
          if (
            tileX < 0 ||
            tileY < 0 ||
            tileX >= GRID_WIDTH ||
            tileY >= GRID_HEIGHT
          ) {
            footprintCollision = true;
          } else {
            const cell = this.grid[tileY]?.[tileX];
            if (cell) {
              const cellType = cell.type;
              if (isDecoration) {
                // Props/decorations collide with any building (including other props)
                if (cellType === TileType.Building) {
                  footprintCollision = true;
                } else if (
                  cellType !== TileType.Grass &&
                  cellType !== TileType.Tile &&
                  cellType !== TileType.Snow
                ) {
                  footprintCollision = true;
                }
              } else {
                if (cellType !== TileType.Grass) {
                  footprintCollision = true;
                }
              }
            }
          }
        }
      }

      // Only show lot tiles for non-decorative buildings (decorations preserve underlying tile)
      if (!isDecoration) {
        for (let dy = 0; dy < footprint.height; dy++) {
          for (let dx = 0; dx < footprint.width; dx++) {
            const tileX = originX + dx;
            const tileY = originY + dy;
            if (
              tileX >= 0 &&
              tileY >= 0 &&
              tileX < GRID_WIDTH &&
              tileY < GRID_HEIGHT
            ) {
              const screenPos = this.gridToScreen(tileX, tileY);
              const lotTile = this.add.image(screenPos.x, screenPos.y, "road");
              lotTile.setOrigin(0.5, 0);
              lotTile.setScale(SUBTILE_WIDTH / lotTile.width, SUBTILE_HEIGHT / lotTile.height);
              lotTile.setAlpha(footprintCollision ? 0.3 : 0.5);
              if (footprintCollision) lotTile.setTint(0xff0000);
              lotTile.setDepth(
                this.depthFromSortPoint(screenPos.x, screenPos.y, 1_000_000)
              );
              this.previewSprites.push(lotTile);
            }
          }
        }
      }

      // Always show building preview, but tint red if collision
      const textureKey = this.getBuildingTextureKey(
        building,
        this.buildingOrientation
      );
      if (this.textures.exists(textureKey)) {
        const frontX = originX + footprint.width - 1;
        const frontY = originY + footprint.height - 1;
        const screenPos = this.gridToScreen(frontX, frontY);
        const bottomY = screenPos.y + SUBTILE_HEIGHT;
        const frontGroundY = screenPos.y + SUBTILE_HEIGHT / 2;

        const buildingPreview = this.add.image(
          screenPos.x,
          bottomY,
          textureKey
        );
        buildingPreview.setOrigin(0.5, 1);
        buildingPreview.setAlpha(0.7);

        // Apply red tint if collision, otherwise apply prop tints
        if (footprintCollision) {
          buildingPreview.setTint(0xff0000); // Red tint for invalid placement
        } else if (this.selectedBuildingId === "flower-bush") {
          buildingPreview.setTint(0xbbddbb);
        }

        buildingPreview.setDepth(
          this.depthFromSortPoint(screenPos.x, frontGroundY, 1_000_000)
        );
        this.previewSprites.push(buildingPreview);
      }
    } else if (this.selectedTool === ToolType.Eraser) {
      // Get tiles to preview - either drag set or just hover tile
      const tilesToPreview: Array<{ x: number; y: number }> = [];
      if (this.isDragging && this.dragTiles.size > 0) {
        this.dragTiles.forEach((key) => {
          const [tx, ty] = key.split(",").map(Number);
          tilesToPreview.push({ x: tx, y: ty });
        });
      } else {
        tilesToPreview.push({ x, y });
      }

      // Track which tiles we've already shown preview for (to avoid duplicates)
      const previewedTiles = new Set<string>();

      for (const tile of tilesToPreview) {
        const tx = tile.x;
        const ty = tile.y;
        if (tx < 0 || tx >= GRID_WIDTH || ty < 0 || ty >= GRID_HEIGHT) continue;

        const cell = this.grid[ty]?.[tx];

        if (!cell || cell.type === TileType.Grass) {
          // Show faded red grass for empty tiles
          if (!previewedTiles.has(`${tx},${ty}`)) {
            previewedTiles.add(`${tx},${ty}`);
            const screenPos = this.gridToScreen(tx, ty);
            const preview = this.add.image(screenPos.x, screenPos.y, "grass");
            preview.setOrigin(0.5, 0);
            preview.setScale(SUBTILE_WIDTH / preview.width, SUBTILE_HEIGHT / preview.height);
            preview.setAlpha(0.3);
            preview.setTint(0xff0000);
            preview.setDepth(
              this.depthFromSortPoint(screenPos.x, screenPos.y, 1_000_000)
            );
            this.previewSprites.push(preview);
          }
        } else {
          // For non-grass tiles, show the whole object (building/road segment)
          const originX = cell.originX ?? tx;
          const originY = cell.originY ?? ty;
          const cellType = cell.type;

          // Check if this is a road lane
          const isRoadLane =
            originX % ROAD_LANE_SIZE === 0 &&
            originY % ROAD_LANE_SIZE === 0 &&
            cellType === TileType.RoadLane;

          if (isRoadLane) {
            // Show entire road lane (2x2)
            for (let dy = 0; dy < ROAD_LANE_SIZE; dy++) {
              for (let dx = 0; dx < ROAD_LANE_SIZE; dx++) {
                const px = originX + dx;
                const py = originY + dy;
                if (
                  px < GRID_WIDTH &&
                  py < GRID_HEIGHT &&
                  !previewedTiles.has(`${px},${py}`)
                ) {
                  previewedTiles.add(`${px},${py}`);
                  const tileCell = this.grid[py]?.[px];
                  if (tileCell && tileCell.type !== TileType.Grass) {
                    const screenPos = this.gridToScreen(px, py);
                    const preview = this.add.image(
                      screenPos.x,
                      screenPos.y,
                      "asphalt"
                    );
                    preview.setOrigin(0.5, 0);
                    preview.setScale(SUBTILE_WIDTH / preview.width, SUBTILE_HEIGHT / preview.height);
                    preview.setAlpha(0.7);
                    preview.setTint(0xff0000);
                    preview.setDepth(
                      this.depthFromSortPoint(
                        screenPos.x,
                        screenPos.y,
                        1_000_000
                      )
                    );
                    this.previewSprites.push(preview);
                  }
                }
              }
            }
          } else if (cellType === TileType.Building && cell.buildingId) {
            // Show entire building footprint
            const building = getBuilding(cell.buildingId);
            if (!building) continue;

            const footprint = getBuildingFootprint(
              building,
              cell.buildingOrientation
            );
            const buildingKey = `building_${originX},${originY}`;

            if (!previewedTiles.has(buildingKey)) {
              previewedTiles.add(buildingKey);

              for (let dy = 0; dy < footprint.height; dy++) {
                for (let dx = 0; dx < footprint.width; dx++) {
                  const px = originX + dx;
                  const py = originY + dy;
                  if (px < GRID_WIDTH && py < GRID_HEIGHT) {
                    previewedTiles.add(`${px},${py}`);
                    const screenPos = this.gridToScreen(px, py);
                    const preview = this.add.image(
                      screenPos.x,
                      screenPos.y,
                      "road"
                    );
                    preview.setOrigin(0.5, 0);
                    preview.setScale(SUBTILE_WIDTH / preview.width, SUBTILE_HEIGHT / preview.height);
                    preview.setAlpha(0.7);
                    preview.setTint(0xff0000);
                    preview.setDepth(
                      this.depthFromSortPoint(
                        screenPos.x,
                        screenPos.y,
                        1_000_000
                      )
                    );
                    this.previewSprites.push(preview);
                  }
                }
              }

              // Show building sprite in red
              const textureKey = this.getBuildingTextureKey(
                building,
                cell.buildingOrientation
              );
              if (this.textures.exists(textureKey)) {
                const frontX = originX + footprint.width - 1;
                const frontY = originY + footprint.height - 1;
                const screenPos = this.gridToScreen(frontX, frontY);
                const bottomY = screenPos.y + SUBTILE_HEIGHT;
                const frontGroundY = screenPos.y + SUBTILE_HEIGHT / 2;

                const buildingPreview = this.add.image(
                  screenPos.x,
                  bottomY,
                  textureKey
                );
                buildingPreview.setOrigin(0.5, 1);
                buildingPreview.setAlpha(0.7);
                buildingPreview.setTint(0xff0000);
                buildingPreview.setDepth(
                  this.depthFromSortPoint(screenPos.x, frontGroundY, 1_000_000)
                );
                this.previewSprites.push(buildingPreview);
              }
            }
          } else {
            // Show single tile (snow, tile, etc.)
            if (!previewedTiles.has(`${tx},${ty}`)) {
              previewedTiles.add(`${tx},${ty}`);
              const screenPos = this.gridToScreen(tx, ty);
              let textureKey = "grass";
              if (cellType === TileType.Asphalt) textureKey = "asphalt";
              else if (cellType === TileType.Sidewalk || cellType === TileType.Tile)
                textureKey = "road";
              else if (cellType === TileType.Snow)
                textureKey = getSnowTextureKey(tx, ty);
              const preview = this.add.image(
                screenPos.x,
                screenPos.y,
                textureKey
              );
              preview.setOrigin(0.5, 0);
              preview.setScale(SUBTILE_WIDTH / preview.width, SUBTILE_HEIGHT / preview.height);
              preview.setAlpha(0.7);
              preview.setTint(0xff0000);
              preview.setDepth(
                this.depthFromSortPoint(screenPos.x, screenPos.y, 1_000_000)
              );
              this.previewSprites.push(preview);
            }
          }
        }
      }
    }
  }
}
