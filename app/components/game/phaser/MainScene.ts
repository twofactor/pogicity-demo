import Phaser from "phaser";
import {
  GridCell,
  Character,
  Car,
  TileType,
  Direction,
  CharacterType,
  CarType,
  GRID_WIDTH,
  GRID_HEIGHT,
  TILE_WIDTH,
  TILE_HEIGHT,
  ToolType,
  CHARACTER_SPEED,
  CAR_SPEED,
} from "../types";
import { GRID_OFFSET_X, GRID_OFFSET_Y } from "./gameConfig";
import {
  ROAD_SEGMENT_SIZE,
  getRoadSegmentOrigin,
  hasRoadSegment,
  getRoadConnections,
  getSegmentType,
  generateRoadPattern,
  canPlaceRoadSegment,
  getLaneDirection,
  isAtIntersection,
  canTurnAtTile,
  getUTurnDirection,
} from "../roadUtils";
import {
  BUILDINGS,
  getBuilding,
  getBuildingFootprint,
  BuildingDefinition,
} from "@/app/data/buildings";
import { loadGifAsAnimation, playGifAnimation } from "./GifLoader";

// Event types for React communication
export interface SceneEvents {
  onTileClick: (x: number, y: number) => void;
  onTileHover: (x: number | null, y: number | null) => void;
  onTilesDrag?: (tiles: Array<{ x: number; y: number }>) => void;
  onEraserDrag?: (tiles: Array<{ x: number; y: number }>) => void;
  onRoadDrag?: (segments: Array<{ x: number; y: number }>) => void;
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

// Opposite directions
const oppositeDirection: Record<Direction, Direction> = {
  [Direction.Up]: Direction.Down,
  [Direction.Down]: Direction.Up,
  [Direction.Left]: Direction.Right,
  [Direction.Right]: Direction.Left,
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

  // Sprite containers
  private tileSprites: Map<string, Phaser.GameObjects.Image> = new Map();
  private buildingSprites: Map<string, Phaser.GameObjects.Image> = new Map();
  private glowSprites: Map<string, Phaser.GameObjects.GameObject> = new Map();
  private carSprites: Map<string, Phaser.GameObjects.Sprite> = new Map();
  private characterSprites: Map<string, Phaser.GameObjects.Sprite> = new Map();
  private previewSprites: Phaser.GameObjects.Image[] = [];
  private lotPreviewSprites: Phaser.GameObjects.Image[] = [];

  // Game state (owned by Phaser, not React)
  private grid: GridCell[][] = [];
  private characters: Character[] = [];
  private cars: Car[] = [];

  // Tool state (synced from React)
  private selectedTool: ToolType = ToolType.RoadNetwork;
  private selectedBuildingId: string | null = null;
  private buildingOrientation: Direction = Direction.Down;
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

  // Driving mode state
  private isPlayerDriving: boolean = false;
  private playerCar: Car | null = null;
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
    // Load tile textures
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

    // Load car textures
    const carTypes = ["jeep", "taxi"];
    const directions = ["n", "s", "e", "w"];
    for (const car of carTypes) {
      for (const dir of directions) {
        this.load.image(`${car}_${dir}`, `/cars/${car}${dir}.png`);
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
        if (this.isPlayerDriving) {
          const key = event.key.toLowerCase();
          if (
            [
              "arrowup",
              "arrowdown",
              "arrowleft",
              "arrowright",
              "w",
              "a",
              "s",
              "d",
            ].includes(key)
          ) {
            this.pressedKeys.add(key);
          }
        }
      });

      this.input.keyboard.on("keyup", (event: KeyboardEvent) => {
        const key = event.key.toLowerCase();
        this.pressedKeys.delete(key);
      });
    }

    // Initialize empty grid
    this.initializeGrid();

    // Mark scene as ready
    this.isReady = true;

    // Enable input
    this.input.on("pointermove", this.handlePointerMove, this);
    this.input.on("pointerdown", this.handlePointerDown, this);
    this.input.on("pointerup", this.handlePointerUp, this);

    // Mouse wheel zoom - handled directly in Phaser for correct coordinates
    // Based on: https://phaser.io/examples/v3.85.0/tilemap/view/mouse-wheel-zoom
    this.input.on("wheel", this.handleWheel, this);

    // Initial render
    this.renderGrid();

    // Load character GIF animations asynchronously
    this.loadCharacterAnimations();

    // Create stats display (fixed to camera, top-right corner)
    this.statsText = this.add.text(0, 0, "", {
      fontFamily: "monospace",
      fontSize: "12px",
      color: "#00ff00",
      backgroundColor: "rgba(0,0,0,0.7)",
      padding: { x: 8, y: 6 },
    });
    this.statsText.setScrollFactor(0); // Fixed to camera
    this.statsText.setDepth(2_000_000); // Always on top
    this.statsText.setOrigin(1, 0); // Anchor to top-right
    // Position will be updated in updateStatsDisplay based on camera size
  }

  private initializeGrid(): void {
    this.grid = Array.from({ length: GRID_HEIGHT }, (_, y) =>
      Array.from({ length: GRID_WIDTH }, (_, x) => ({
        type: TileType.Grass,
        x,
        y,
        isOrigin: true,
      }))
    );
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
    this.updateCars();
    this.updatePlayerCar();

    // Handle camera movement (when not driving)
    this.updateCamera(delta);

    // Render updated entities
    this.renderCars();
    this.renderCharacters();

    // Handle dirty grid updates
    if (this.gridDirty) {
      this.applyGridUpdates();
      this.gridDirty = false;
    }

    // Update stats display
    this.updateStatsDisplay();
  }

  private updateStatsDisplay(): void {
    if (!this.statsText || !this.showStats) {
      if (this.statsText) this.statsText.setVisible(false);
      return;
    }

    this.statsText.setVisible(true);

    // Position in top-right, accounting for zoom
    const camera = this.cameras.main;
    this.statsText.setPosition(camera.width - 10, 60);

    const fps = Math.round(this.game.loop.actualFps);
    const charCount = this.characters.length;
    const carCount = this.cars.length + (this.playerCar ? 1 : 0);

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

    // If in driving mode, follow the player car (sets base scroll absolutely every frame)
    if (this.isPlayerDriving && this.playerCar) {
      this.wasDriving = true;
      const screenPos = this.gridToScreen(this.playerCar.x, this.playerCar.y);
      const groundY = screenPos.y + TILE_HEIGHT / 2;
      const viewportWidth = camera.width / camera.zoom;
      const viewportHeight = camera.height / camera.zoom;
      this.baseScrollX = screenPos.x - viewportWidth / 2;
      this.baseScrollY = groundY - viewportHeight / 2;
      camera.setScroll(
        Math.round(this.baseScrollX + (this.shakeAxis === "x" ? this.shakeOffset : 0)),
        Math.round(this.baseScrollY + (this.shakeAxis === "y" ? this.shakeOffset : 0))
      );
      return;
    }

    // Transition: if we just stopped driving, freeze current camera position as the new base.
    if (this.wasDriving) {
      this.wasDriving = false;
      this.baseScrollX = camera.scrollX;
      this.baseScrollY = camera.scrollY - this.shakeOffset;
    }

    // Manual camera movement when not driving
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
    return tileType === TileType.Road || tileType === TileType.Tile;
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
          if (tileType === TileType.Road || tileType === TileType.Tile) {
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
  // CAR LOGIC (moved from React)
  // ============================================

  private updateCars(): void {
    for (let i = 0; i < this.cars.length; i++) {
      this.cars[i] = this.updateSingleCar(this.cars[i]);
    }
  }

  private isDrivable(x: number, y: number): boolean {
    const gx = Math.floor(x);
    const gy = Math.floor(y);
    if (gx < 0 || gx >= GRID_WIDTH || gy < 0 || gy >= GRID_HEIGHT) return false;
    return this.grid[gy][gx].type === TileType.Asphalt;
  }

  private getValidCarDirections(tileX: number, tileY: number): Direction[] {
    const valid: Direction[] = [];
    for (const dir of allDirections) {
      const vec = directionVectors[dir];
      if (this.isDrivable(tileX + vec.dx, tileY + vec.dy)) {
        valid.push(dir);
      }
    }
    return valid;
  }

  private isDirectionClear(
    car: Car,
    dir: Direction,
    checkDist: number = 1.2
  ): boolean {
    const vec = directionVectors[dir];
    const aheadX = car.x + vec.dx * checkDist;
    const aheadY = car.y + vec.dy * checkDist;

    const allCars = this.playerCar ? [...this.cars, this.playerCar] : this.cars;
    for (const other of allCars) {
      if (other.id === car.id) continue;
      const dist = Math.sqrt(
        Math.pow(other.x - aheadX, 2) + Math.pow(other.y - aheadY, 2)
      );
      if (dist < 0.7) return false;
    }
    return true;
  }

  private pickCarDirection(
    car: Car,
    tileX: number,
    tileY: number,
    currentDir: Direction,
    atDeadEnd: boolean = false
  ): Direction | null {
    const validDirs = this.getValidCarDirections(tileX, tileY);
    if (validDirs.length === 0) return null;

    const opposite = oppositeDirection[currentDir];
    const atIntersection = isAtIntersection(tileX, tileY, this.grid);
    const laneDir = getLaneDirection(tileX, tileY, this.grid);

    if (atDeadEnd || validDirs.length === 1) {
      const uTurnDir = getUTurnDirection(tileX, tileY, currentDir, this.grid);
      if (uTurnDir && validDirs.includes(uTurnDir)) {
        return uTurnDir;
      }
      return validDirs[0];
    }

    if (!atIntersection) {
      if (laneDir && validDirs.includes(laneDir)) {
        if (this.isDirectionClear(car, laneDir)) {
          return laneDir;
        }
        return null;
      }

      if (
        validDirs.includes(currentDir) &&
        this.isDirectionClear(car, currentDir)
      ) {
        return currentDir;
      }

      return null;
    }

    const turnableChoices = validDirs.filter((d) => {
      if (d === opposite) return false;
      return canTurnAtTile(tileX, tileY, currentDir, d);
    });

    if (
      validDirs.includes(currentDir) &&
      !turnableChoices.includes(currentDir)
    ) {
      turnableChoices.push(currentDir);
    }

    if (turnableChoices.length === 0) {
      if (
        validDirs.includes(currentDir) &&
        this.isDirectionClear(car, currentDir)
      ) {
        return currentDir;
      }
      return null;
    }

    const clearChoices = turnableChoices.filter((d) =>
      this.isDirectionClear(car, d)
    );

    if (clearChoices.length === 0) {
      return null;
    }

    if (clearChoices.includes(currentDir) && Math.random() < 0.75) {
      return currentDir;
    }

    const turnsOnly = clearChoices.filter((d) => d !== currentDir);
    if (turnsOnly.length > 0) {
      return turnsOnly[Math.floor(Math.random() * turnsOnly.length)];
    }

    return clearChoices[0];
  }

  private isCarBlocking(car: Car): boolean {
    const vec = directionVectors[car.direction];
    const MIN_CAR_SPACING = 1.8; // Increased to prevent visual overlap

    const allCars = this.playerCar ? [...this.cars, this.playerCar] : this.cars;
    for (const other of allCars) {
      if (other.id === car.id) continue;

      const dx = other.x - car.x;
      const dy = other.y - car.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > MIN_CAR_SPACING * 1.5) continue;

      const dotProduct = dx * vec.dx + dy * vec.dy;

      if (dotProduct > 0 && dist < MIN_CAR_SPACING) {
        const crossProduct = Math.abs(dx * vec.dy - dy * vec.dx);
        if (crossProduct < 0.6) {
          return true;
        }
      }
    }
    return false;
  }

  private updateSingleCar(car: Car): Car {
    const { x, y, direction, speed, waiting } = car;
    const vec = directionVectors[direction];
    const tileX = Math.floor(x);
    const tileY = Math.floor(y);

    if (!this.isDrivable(tileX, tileY)) {
      const asphaltTiles: { x: number; y: number }[] = [];
      for (let gy = 0; gy < GRID_HEIGHT; gy++) {
        for (let gx = 0; gx < GRID_WIDTH; gx++) {
          if (this.grid[gy][gx].type === TileType.Asphalt) {
            asphaltTiles.push({ x: gx, y: gy });
          }
        }
      }
      if (asphaltTiles.length > 0) {
        const newTile =
          asphaltTiles[Math.floor(Math.random() * asphaltTiles.length)];
        const laneDir = getLaneDirection(newTile.x, newTile.y, this.grid);
        return {
          ...car,
          x: newTile.x + 0.5,
          y: newTile.y + 0.5,
          direction: laneDir || Direction.Right,
          waiting: 0,
        };
      }
      return car;
    }

    const blocked = this.isCarBlocking(car);
    const MAX_WAIT_FRAMES = 60;

    if (blocked) {
      const newWaiting = waiting + 1;

      if (newWaiting > MAX_WAIT_FRAMES) {
        if (isAtIntersection(tileX, tileY, this.grid)) {
          const altDir = this.pickCarDirection(
            car,
            tileX,
            tileY,
            direction,
            true
          );
          if (altDir && altDir !== direction) {
            return {
              ...car,
              x: tileX + 0.5,
              y: tileY + 0.5,
              direction: altDir,
              waiting: 0,
            };
          }
        }
        return { ...car, waiting: 0 };
      }

      return { ...car, waiting: newWaiting };
    }

    if (waiting > 0) {
      return { ...car, waiting: 0 };
    }

    const inTileX = x - tileX;
    const inTileY = y - tileY;
    const threshold = speed * 2;
    const nearCenter =
      Math.abs(inTileX - 0.5) < threshold &&
      Math.abs(inTileY - 0.5) < threshold;

    let newDirection = direction;
    let nextX = x;
    let nextY = y;

    if (nearCenter) {
      const atIntersection = isAtIntersection(tileX, tileY, this.grid);
      const laneDir = getLaneDirection(tileX, tileY, this.grid);
      const nextTileX = tileX + vec.dx;
      const nextTileY = tileY + vec.dy;

      if (!this.isDrivable(nextTileX, nextTileY)) {
        const newDir = this.pickCarDirection(
          car,
          tileX,
          tileY,
          direction,
          true
        );
        if (newDir) {
          newDirection = newDir;
        }
        nextX = tileX + 0.5;
        nextY = tileY + 0.5;
      } else if (atIntersection) {
        const validDirs = this.getValidCarDirections(tileX, tileY);
        if (validDirs.length >= 3 && Math.random() < 0.25) {
          const newDir = this.pickCarDirection(
            car,
            tileX,
            tileY,
            direction,
            false
          );
          if (newDir) {
            newDirection = newDir;
            nextX = tileX + 0.5;
            nextY = tileY + 0.5;
          }
        }
      } else if (laneDir && laneDir !== direction) {
        if (this.getValidCarDirections(tileX, tileY).includes(laneDir)) {
          newDirection = laneDir;
          nextX = tileX + 0.5;
          nextY = tileY + 0.5;
        }
      }
    }

    const moveVec = directionVectors[newDirection];
    const pixelatedStep = Math.max(0.001, speed);
    nextX += moveVec.dx * speed;
    nextY += moveVec.dy * speed;

    nextX = Math.round(nextX / pixelatedStep) * pixelatedStep;
    nextY = Math.round(nextY / pixelatedStep) * pixelatedStep;

    const finalTileX = Math.floor(nextX);
    const finalTileY = Math.floor(nextY);

    if (!this.isDrivable(finalTileX, finalTileY)) {
      return {
        ...car,
        x: tileX + 0.5,
        y: tileY + 0.5,
        direction: newDirection,
        waiting: 0,
      };
    }

    return { ...car, x: nextX, y: nextY, direction: newDirection, waiting: 0 };
  }

  // ============================================
  // PLAYER CAR LOGIC
  // ============================================

  private updatePlayerCar(): void {
    if (!this.isPlayerDriving || !this.playerCar) return;

    const car = this.playerCar;
    let newDirection = car.direction;
    let nextX = car.x;
    let nextY = car.y;

    let desiredDir: Direction | null = null;

    if (this.pressedKeys.has("arrowup") || this.pressedKeys.has("w")) {
      desiredDir = Direction.Up;
    } else if (this.pressedKeys.has("arrowdown") || this.pressedKeys.has("s")) {
      desiredDir = Direction.Down;
    } else if (this.pressedKeys.has("arrowleft") || this.pressedKeys.has("a")) {
      desiredDir = Direction.Left;
    } else if (
      this.pressedKeys.has("arrowright") ||
      this.pressedKeys.has("d")
    ) {
      desiredDir = Direction.Right;
    }

    if (desiredDir) {
      newDirection = desiredDir;
      const vec = directionVectors[newDirection];
      const moveX = nextX + vec.dx * car.speed;
      const moveY = nextY + vec.dy * car.speed;

      if (!this.checkPlayerCarCollision(moveX, moveY)) {
        nextX = moveX;
        nextY = moveY;
      }
    }

    const pixelatedStep = Math.max(0.001, car.speed);
    nextX = Math.round(nextX / pixelatedStep) * pixelatedStep;
    nextY = Math.round(nextY / pixelatedStep) * pixelatedStep;

    this.playerCar = { ...car, x: nextX, y: nextY, direction: newDirection };
  }

  private checkPlayerCarCollision(x: number, y: number): boolean {
    const gx = Math.floor(x);
    const gy = Math.floor(y);

    if (gx < 0 || gx >= GRID_WIDTH || gy < 0 || gy >= GRID_HEIGHT) {
      return true;
    }

    const cell = this.grid[gy][gx];

    if (cell.type === TileType.Building) {
      return true;
    }

    for (const car of this.cars) {
      if (car.id === "player-car") continue;
      const carTileX = Math.floor(car.x);
      const carTileY = Math.floor(car.y);
      if (carTileX === gx && carTileY === gy) {
        return true;
      }
    }

    for (const char of this.characters) {
      const charTileX = Math.floor(char.x);
      const charTileY = Math.floor(char.y);
      if (charTileX === gx && charTileY === gy) {
        return true;
      }
    }

    return false;
  }

  // ============================================
  // PUBLIC METHODS (called from React)
  // ============================================

  // Convert grid coordinates to isometric screen position
  gridToScreen(gridX: number, gridY: number): { x: number; y: number } {
    return {
      x: GRID_OFFSET_X + (gridX - gridY) * (TILE_WIDTH / 2),
      y: GRID_OFFSET_Y + (gridX + gridY) * (TILE_HEIGHT / 2),
    };
  }

  screenToGrid(screenX: number, screenY: number): { x: number; y: number } {
    const relX = screenX - GRID_OFFSET_X;
    const relY = screenY - GRID_OFFSET_Y;

    return {
      x: (relX / (TILE_WIDTH / 2) + relY / (TILE_HEIGHT / 2)) / 2,
      y: (relY / (TILE_HEIGHT / 2) - relX / (TILE_WIDTH / 2)) / 2,
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

        // If dragging with road tool, add road segments in straight line
        if (
          this.isDragging &&
          this.selectedTool === ToolType.RoadNetwork &&
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
              // Equal movement - wait for more movement, keep initial segment
              return;
            }
          }

          // Clear and rebuild drag tiles for roads
          this.dragTiles.clear();

          // Constrain to the determined direction
          if (this.dragDirection === "horizontal") {
            // Only add segments along horizontal line
            const startX = Math.min(this.dragStartTile.x, tileX);
            const endX = Math.max(this.dragStartTile.x, tileX);
            const startSegment = getRoadSegmentOrigin(
              startX,
              this.dragStartTile.y
            );
            const endSegment = getRoadSegmentOrigin(endX, this.dragStartTile.y);

            const startSegX = Math.min(startSegment.x, endSegment.x);
            const endSegX = Math.max(startSegment.x, endSegment.x);

            for (
              let segX = startSegX;
              segX <= endSegX;
              segX += ROAD_SEGMENT_SIZE
            ) {
              this.dragTiles.add(`${segX},${startSegment.y}`);
            }
          } else if (this.dragDirection === "vertical") {
            // Only add segments along vertical line
            const startY = Math.min(this.dragStartTile.y, tileY);
            const endY = Math.max(this.dragStartTile.y, tileY);
            const startSegment = getRoadSegmentOrigin(
              this.dragStartTile.x,
              startY
            );
            const endSegment = getRoadSegmentOrigin(this.dragStartTile.x, endY);

            const startSegY = Math.min(startSegment.y, endSegment.y);
            const endSegY = Math.max(startSegment.y, endSegment.y);

            for (
              let segY = startSegY;
              segY <= endSegY;
              segY += ROAD_SEGMENT_SIZE
            ) {
              this.dragTiles.add(`${startSegment.x},${segY}`);
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
          this.selectedTool === ToolType.RoadNetwork
        ) {
          this.isDragging = true;
          this.dragTiles.clear();
          this.dragStartTile = { x: this.hoverTile.x, y: this.hoverTile.y };
          this.dragDirection = null;

          if (this.selectedTool === ToolType.RoadNetwork) {
            // For roads, add the initial segment origin
            const segmentOrigin = getRoadSegmentOrigin(
              this.hoverTile.x,
              this.hoverTile.y
            );
            this.dragTiles.add(`${segmentOrigin.x},${segmentOrigin.y}`);
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
          this.selectedTool === ToolType.RoadNetwork &&
          this.events_.onRoadDrag
        ) {
          // Road drag - segments are already in dragTiles
          this.events_.onRoadDrag(tiles);
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
  updateGrid(newGrid: GridCell[][]): void {
    // Find changed tiles and mark for update
    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        const oldCell = this.grid[y]?.[x];
        const newCell = newGrid[y]?.[x];

        if (!oldCell || !newCell) continue;

        // Check if tile changed
        if (
          oldCell.type !== newCell.type ||
          oldCell.buildingId !== newCell.buildingId ||
          oldCell.isOrigin !== newCell.isOrigin ||
          oldCell.buildingOrientation !== newCell.buildingOrientation ||
          oldCell.underlyingTileType !== newCell.underlyingTileType
        ) {
          this.gridDirtyTiles.add(`${x},${y}`);
        }
      }
    }

    // Update grid reference
    this.grid = newGrid;

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

    this.gridDirtyTiles.clear();
  }

  private updateTileSprite(x: number, y: number, cell: GridCell): void {
    const key = `${x},${y}`;
    const screenPos = this.gridToScreen(x, y);

    // Determine texture
    let textureKey = "grass";

    if (cell.type === TileType.Road) {
      textureKey = "road";
    } else if (cell.type === TileType.Asphalt) {
      textureKey = "asphalt";
    } else if (cell.type === TileType.Tile) {
      textureKey = "road";
    } else if (cell.type === TileType.Snow) {
      textureKey = getSnowTextureKey(x, y);
    } else if (cell.type === TileType.Building) {
      if (cell.buildingId) {
        const building = getBuilding(cell.buildingId);
        const preservesTile =
          building && (building.category === "props" || building.isDecoration);
        if (preservesTile && cell.underlyingTileType) {
          if (
            cell.underlyingTileType === TileType.Tile ||
            cell.underlyingTileType === TileType.Road
          ) {
            textureKey = "road";
          } else if (cell.underlyingTileType === TileType.Asphalt) {
            textureKey = "asphalt";
          } else if (cell.underlyingTileType === TileType.Snow) {
            textureKey = getSnowTextureKey(x, y);
          } else {
            textureKey = "grass";
          }
        } else if (preservesTile) {
          // No underlying tile stored, default to grass for decorations
          textureKey = "grass";
        } else {
          textureKey = "road";
        }
      } else {
        textureKey = "road";
      }
    }

    // Update or create sprite
    let tileSprite = this.tileSprites.get(key);
    // Snow tiles are 88x44 (2x size), others are 44x22 - calculate scale accordingly
    const scale = textureKey.startsWith("snow_") ? 0.5 * 1.02 : 1.02;

    if (tileSprite) {
      tileSprite.setTexture(textureKey);
      tileSprite.setScale(scale);
    } else {
      tileSprite = this.add.image(screenPos.x, screenPos.y, textureKey);
      tileSprite.setOrigin(0.5, 0);
      tileSprite.setScale(scale);
      tileSprite.setDepth(this.depthFromSortPoint(screenPos.x, screenPos.y, 0));
      this.tileSprites.set(key, tileSprite);
    }
  }

  // Spawn a character
  spawnCharacter(): boolean {
    const roadTiles: { x: number; y: number }[] = [];
    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        const tileType = this.grid[y][x].type;
        if (tileType === TileType.Road || tileType === TileType.Tile) {
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

  // Spawn a car
  spawnCar(): boolean {
    const asphaltTiles: { x: number; y: number }[] = [];
    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        if (this.grid[y][x].type === TileType.Asphalt) {
          asphaltTiles.push({ x, y });
        }
      }
    }

    if (asphaltTiles.length === 0) return false;

    const asphaltTile =
      asphaltTiles[Math.floor(Math.random() * asphaltTiles.length)];
    const validDirs = allDirections.filter((dir) => {
      const vec = directionVectors[dir];
      const nx = asphaltTile.x + vec.dx;
      const ny = asphaltTile.y + vec.dy;
      if (nx < 0 || nx >= GRID_WIDTH || ny < 0 || ny >= GRID_HEIGHT)
        return false;
      return this.grid[ny][nx].type === TileType.Asphalt;
    });

    const laneDir = getLaneDirection(asphaltTile.x, asphaltTile.y, this.grid);
    let direction: Direction;

    if (laneDir && validDirs.includes(laneDir)) {
      direction = laneDir;
    } else if (validDirs.length > 0) {
      direction = validDirs[Math.floor(Math.random() * validDirs.length)];
    } else {
      direction =
        allDirections[Math.floor(Math.random() * allDirections.length)];
    }

    const carType = Math.random() < 0.5 ? CarType.Taxi : CarType.Jeep;

    const newCar: Car = {
      id: generateId(),
      x: asphaltTile.x + 0.5,
      y: asphaltTile.y + 0.5,
      direction,
      speed: CAR_SPEED + (Math.random() - 0.5) * 0.005,
      waiting: 0,
      carType,
    };

    this.cars.push(newCar);
    return true;
  }

  // Enable/disable driving mode
  setDrivingState(isDriving: boolean): void {
    this.isPlayerDriving = isDriving;
    this.pressedKeys.clear();

    if (isDriving && !this.playerCar) {
      // Spawn player car
      const asphaltTiles: { x: number; y: number }[] = [];
      for (let y = 0; y < GRID_HEIGHT; y++) {
        for (let x = 0; x < GRID_WIDTH; x++) {
          if (this.grid[y][x].type === TileType.Asphalt) {
            asphaltTiles.push({ x, y });
          }
        }
      }

      if (asphaltTiles.length > 0) {
        const asphaltTile =
          asphaltTiles[Math.floor(Math.random() * asphaltTiles.length)];
        this.playerCar = {
          id: "player-car",
          x: asphaltTile.x + 0.5,
          y: asphaltTile.y + 0.5,
          direction: Direction.Right,
          speed: CAR_SPEED * 1.5,
          waiting: 0,
          carType: CarType.Jeep,
        };
      }
    } else if (!isDriving) {
      this.playerCar = null;
    }
  }

  getPlayerCar(): Car | null {
    return this.playerCar;
  }

  isPlayerDrivingMode(): boolean {
    return this.isPlayerDriving;
  }

  getCharacterCount(): number {
    return this.characters.length;
  }

  getCarCount(): number {
    return this.cars.length;
  }

  clearCharacters(): void {
    this.characters = [];
    this.characterSprites.forEach((sprite) => sprite.destroy());
    this.characterSprites.clear();
  }

  clearCars(): void {
    this.cars = [];
    this.carSprites.forEach((sprite) => sprite.destroy());
    this.carSprites.clear();
    // Also clear player car if exists
    if (this.playerCar) {
      this.playerCar = null;
      this.isPlayerDriving = false;
    }
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

      // Store the current center point (midPoint gives center of what camera sees)
      const centerX = camera.midPoint.x;
      const centerY = camera.midPoint.y;

      // Apply new zoom
      camera.setZoom(zoom);

      // Re-center on the same point, then round for pixel-perfect rendering
      camera.centerOn(centerX, centerY);
      camera.scrollX = Math.round(camera.scrollX);
      camera.scrollY = Math.round(camera.scrollY);

      // Update baseScroll so update() loop doesn't reset it
      this.baseScrollX = camera.scrollX;
      this.baseScrollY = camera.scrollY;
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

        if (tileType === TileType.Road) {
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
            screenPos.x + TILE_WIDTH / 2,
            screenPos.y + TILE_HEIGHT / 2
          );
          graphics.lineTo(screenPos.x, screenPos.y + TILE_HEIGHT);
          graphics.lineTo(
            screenPos.x - TILE_WIDTH / 2,
            screenPos.y + TILE_HEIGHT / 2
          );
          graphics.closePath();
          graphics.fillPath();
        }
      }
    }

    this.pathOverlaySprites = graphics;
  }

  private renderGrid(): void {
    // Initial full render
    this.tileSprites.forEach((sprite) => sprite.destroy());
    this.tileSprites.clear();
    this.buildingSprites.forEach((sprite) => sprite.destroy());
    this.buildingSprites.clear();
    this.glowSprites.forEach((sprite) => sprite.destroy());
    this.glowSprites.clear();

    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        const cell = this.grid[y]?.[x];
        if (!cell) continue;

        const screenPos = this.gridToScreen(x, y);
        const key = `${x},${y}`;

        let textureKey = "grass";

        if (cell.type === TileType.Road) {
          textureKey = "road";
        } else if (cell.type === TileType.Asphalt) {
          textureKey = "asphalt";
        } else if (cell.type === TileType.Tile) {
          textureKey = "road";
        } else if (cell.type === TileType.Snow) {
          textureKey = getSnowTextureKey(x, y);
        } else if (cell.type === TileType.Building) {
          if (cell.buildingId) {
            const building = getBuilding(cell.buildingId);
            const preservesTile =
              building &&
              (building.category === "props" || building.isDecoration);
            if (preservesTile && cell.underlyingTileType) {
              if (cell.underlyingTileType === TileType.Tile) {
                textureKey = "road";
              } else if (cell.underlyingTileType === TileType.Road) {
                textureKey = "road";
              } else if (cell.underlyingTileType === TileType.Asphalt) {
                textureKey = "asphalt";
              } else if (cell.underlyingTileType === TileType.Snow) {
                textureKey = getSnowTextureKey(x, y);
              } else {
                textureKey = "grass";
              }
            } else if (preservesTile) {
              textureKey = "grass";
            } else {
              textureKey = "road";
            }
          } else {
            textureKey = "road";
          }
        }

        const tileSprite = this.add.image(screenPos.x, screenPos.y, textureKey);
        tileSprite.setOrigin(0.5, 0);
        // Snow tiles are 88x44 (2x size), others are 44x22
        tileSprite.setScale(textureKey.startsWith("snow_") ? 0.5 * 1.02 : 1.02);
        tileSprite.setDepth(
          this.depthFromSortPoint(screenPos.x, screenPos.y, 0)
        );
        this.tileSprites.set(key, tileSprite);

        if (
          cell.type === TileType.Building &&
          cell.isOrigin &&
          cell.buildingId
        ) {
          this.renderBuilding(x, y, cell.buildingId, cell.buildingOrientation);
        }
      }
    }
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

    // Get footprint based on orientation (for positioning)
    const footprint = getBuildingFootprint(building, orientation);
    // Get render size for slicing (use renderSize if available, else footprint)
    const renderSize = building.renderSize || footprint;
    const frontX = originX + footprint.width - 1;
    const frontY = originY + footprint.height - 1;
    const screenPos = this.gridToScreen(frontX, frontY);
    const bottomY = screenPos.y + TILE_HEIGHT;

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
    const balancedScreenY = GRID_OFFSET_Y + (balancedGridSum * TILE_HEIGHT) / 2;
    const decorationDepth = this.depthFromSortPoint(
      screenPos.x,
      balancedScreenY + TILE_HEIGHT / 2,
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
    // Tiles are 44px wide in screen space, so each diagonal is 22px offset.
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

    const SLICE_WIDTH = 22; // Half tile width - isometric diagonal offset
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
        const sliceScreenY = GRID_OFFSET_Y + (sliceGridSum * TILE_HEIGHT) / 2;
        slice.setDepth(
          this.depthFromSortPoint(
            screenPos.x,
            sliceScreenY + TILE_HEIGHT / 2,
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
        const sliceScreenY = GRID_OFFSET_Y + (sliceGridSum * TILE_HEIGHT) / 2;
        slice.setDepth(
          this.depthFromSortPoint(
            screenPos.x,
            sliceScreenY + TILE_HEIGHT / 2,
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
    const glowY = tileY + TILE_HEIGHT / 2 + lampshadeOffsetY;

    // Create pixelated glow texture if it doesn't exist
    if (!this.textures.exists("lamp_glow")) {
      this.createPixelatedGlowTexture();
    }

    // Create glow sprite using the pixelated texture
    const glow = this.add.image(x, glowY, "lamp_glow");
    glow.setBlendMode(Phaser.BlendModes.ADD);
    glow.setDepth(this.depthFromSortPoint(x, tileY + TILE_HEIGHT / 2, 0.04)); // Just behind lamp

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

  private renderCars(): void {
    // Get all cars to render (AI + player)
    const allCars = this.playerCar ? [...this.cars, this.playerCar] : this.cars;
    const currentCarIds = new Set(allCars.map((c) => c.id));

    // Remove sprites for cars that no longer exist
    this.carSprites.forEach((sprite, id) => {
      if (!currentCarIds.has(id)) {
        sprite.destroy();
        this.carSprites.delete(id);
      }
    });

    // Update or create car sprites
    for (const car of allCars) {
      const screenPos = this.gridToScreen(car.x, car.y);
      const groundY = screenPos.y + TILE_HEIGHT / 2;
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
      const screenPos = this.gridToScreen(char.x, char.y);
      const centerY = screenPos.y + TILE_HEIGHT / 2;
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

  private updatePreview(): void {
    this.clearPreview();

    if (!this.hoverTile) return;
    if (this.selectedTool === ToolType.None) return;

    const { x, y } = this.hoverTile;

    if (this.selectedTool === ToolType.RoadNetwork) {
      // Get segments to preview - either drag set or just hover segment
      const segmentsToPreview: Array<{ x: number; y: number }> = [];
      if (this.isDragging && this.dragTiles.size > 0) {
        // When dragging, show preview for all segments in drag set
        this.dragTiles.forEach((key) => {
          const [segX, segY] = key.split(",").map(Number);
          segmentsToPreview.push({ x: segX, y: segY });
        });
      } else if (x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT) {
        // Single hover - show preview for hovered segment
        const segmentOrigin = getRoadSegmentOrigin(x, y);
        segmentsToPreview.push({ x: segmentOrigin.x, y: segmentOrigin.y });
      }

      for (const seg of segmentsToPreview) {
        const segmentOrigin = { x: seg.x, y: seg.y };
        const placementCheck = canPlaceRoadSegment(
          this.grid,
          segmentOrigin.x,
          segmentOrigin.y
        );
        const segmentHasCollision = !placementCheck.valid;

        const tempGrid: GridCell[][] = this.grid.map((row) =>
          row.map((cell) => ({ ...cell }))
        );

        for (let dy = 0; dy < ROAD_SEGMENT_SIZE; dy++) {
          for (let dx = 0; dx < ROAD_SEGMENT_SIZE; dx++) {
            const px = segmentOrigin.x + dx;
            const py = segmentOrigin.y + dy;
            if (px < GRID_WIDTH && py < GRID_HEIGHT) {
              tempGrid[py][px].isOrigin = dx === 0 && dy === 0;
              tempGrid[py][px].originX = segmentOrigin.x;
              tempGrid[py][px].originY = segmentOrigin.y;
              tempGrid[py][px].type = TileType.Road;
            }
          }
        }

        const connections = getRoadConnections(
          tempGrid,
          segmentOrigin.x,
          segmentOrigin.y
        );
        const segmentType = getSegmentType(connections);
        const pattern = generateRoadPattern(segmentType);

        for (const tile of pattern) {
          const px = segmentOrigin.x + tile.dx;
          const py = segmentOrigin.y + tile.dy;
          if (px < GRID_WIDTH && py < GRID_HEIGHT) {
            const screenPos = this.gridToScreen(px, py);
            const textureKey =
              tile.type === TileType.Asphalt ? "asphalt" : "road";
            const preview = this.add.image(
              screenPos.x,
              screenPos.y,
              textureKey
            );
            preview.setOrigin(0.5, 0);
            preview.setAlpha(segmentHasCollision ? 0.3 : 0.7);
            if (segmentHasCollision) preview.setTint(0xff0000);
            preview.setDepth(
              this.depthFromSortPoint(screenPos.x, screenPos.y, 1_000_000)
            );
            this.previewSprites.push(preview);
          }
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
          preview.setScale(0.5); // Snow tiles are 88x44, need to halve
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
        const bottomY = screenPos.y + TILE_HEIGHT;
        const frontGroundY = screenPos.y + TILE_HEIGHT / 2;

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

          // Check if this is a road segment
          const isRoadSegment =
            originX % ROAD_SEGMENT_SIZE === 0 &&
            originY % ROAD_SEGMENT_SIZE === 0 &&
            (cellType === TileType.Road || cellType === TileType.Asphalt);

          if (isRoadSegment) {
            // Show entire road segment
            for (let dy = 0; dy < ROAD_SEGMENT_SIZE; dy++) {
              for (let dx = 0; dx < ROAD_SEGMENT_SIZE; dx++) {
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
                    const textureKey =
                      tileCell.type === TileType.Asphalt ? "asphalt" : "road";
                    const preview = this.add.image(
                      screenPos.x,
                      screenPos.y,
                      textureKey
                    );
                    preview.setOrigin(0.5, 0);
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
                const bottomY = screenPos.y + TILE_HEIGHT;
                const frontGroundY = screenPos.y + TILE_HEIGHT / 2;

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
              else if (cellType === TileType.Road || cellType === TileType.Tile)
                textureKey = "road";
              else if (cellType === TileType.Snow)
                textureKey = getSnowTextureKey(tx, ty);
              const preview = this.add.image(
                screenPos.x,
                screenPos.y,
                textureKey
              );
              preview.setOrigin(0.5, 0);
              // Snow tiles are 88x44, need to halve
              if (textureKey.startsWith("snow_")) preview.setScale(0.5);
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
