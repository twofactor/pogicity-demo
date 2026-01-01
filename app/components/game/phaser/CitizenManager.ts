/**
 * CitizenManager - Pedestrian movement and pathfinding
 *
 * This manager handles all pedestrian/citizen logic independently of rendering.
 * MainScene owns the sprites; this manager owns the data and movement logic.
 *
 * Current Features:
 * - Random wandering on sidewalks/walkable tiles
 * - Crosswalk crossing with signal awareness
 * - Car yielding (pedestrians register in crosswalks so cars see them)
 *
 * Future Extensibility:
 * - Pathfinding to destinations (home → work → shop → home)
 * - Different citizen types (workers, tourists, joggers)
 * - Public transit integration (bus stops, train stations)
 * - Bike lanes (CitizenManager could spawn cyclists too)
 * - Building entry/exit (citizens entering stores, offices)
 *
 * Design Principles:
 * - Data-oriented: Characters are plain objects, not class instances
 * - Manager owns state: Array of characters, movement logic
 * - Phaser-agnostic: No Phaser imports, just pure logic
 * - TrafficLightManager integration for crosswalk signals
 */

import {
  GridCell,
  Character,
  CharacterType,
  TileType,
  Direction,
  GRID_WIDTH,
  GRID_HEIGHT,
  CHARACTER_SPEED,
} from "../types";
import { directionVectors, oppositeDirection } from "../roadUtils";
import { TrafficLightManager } from "./TrafficLightManager";

// All possible directions for iteration
const allDirections: Direction[] = [
  Direction.Up,
  Direction.Down,
  Direction.Left,
  Direction.Right,
];

// Generate unique ID
const generateId = () => Math.random().toString(36).substring(2, 9);

// Available character types for spawning
const SPAWN_CHARACTER_TYPES = [CharacterType.Banana, CharacterType.Apple];

export class CitizenManager {
  private characters: Character[] = [];
  private grid: GridCell[][] = [];
  private trafficLightManager: TrafficLightManager | null = null;

  constructor() {}

  // ============================================
  // EXTERNAL INTERFACE
  // ============================================

  /** Update grid reference (called when grid changes) */
  setGrid(grid: GridCell[][]): void {
    this.grid = grid;
  }

  /** Set traffic light manager for crosswalk integration */
  setTrafficLightManager(manager: TrafficLightManager): void {
    this.trafficLightManager = manager;
  }

  /** Get all characters (for rendering) */
  getCharacters(): Character[] {
    return this.characters;
  }

  /** Get character count */
  getCharacterCount(): number {
    return this.characters.length;
  }

  /** Clear all characters */
  clearCharacters(): void {
    // Unregister from crosswalks before clearing
    if (this.trafficLightManager) {
      for (const char of this.characters) {
        this.trafficLightManager.removeFromAllCrosswalks(char.id);
      }
    }
    this.characters = [];
  }

  // ============================================
  // SPAWNING
  // ============================================

  /** Spawn a character on a random walkable tile */
  spawnCharacter(): Character | null {
    const walkableTiles: { x: number; y: number }[] = [];

    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        const tile = this.grid[y]?.[x];
        if (tile && this.isWalkableSurface(tile.type)) {
          walkableTiles.push({ x, y });
        }
      }
    }

    if (walkableTiles.length === 0) return null;

    const tile = walkableTiles[Math.floor(Math.random() * walkableTiles.length)];
    const characterType = SPAWN_CHARACTER_TYPES[
      Math.floor(Math.random() * SPAWN_CHARACTER_TYPES.length)
    ];

    const char: Character = {
      id: generateId(),
      x: tile.x + 0.5,
      y: tile.y + 0.5,
      direction: allDirections[Math.floor(Math.random() * allDirections.length)],
      speed: CHARACTER_SPEED + (Math.random() - 0.5) * 0.005,
      characterType,
      inCrosswalk: false,
    };

    this.characters.push(char);
    return char;
  }

  /** Remove a character by ID */
  removeCharacter(id: string): void {
    const index = this.characters.findIndex(c => c.id === id);
    if (index !== -1) {
      if (this.trafficLightManager) {
        this.trafficLightManager.removeFromAllCrosswalks(id);
      }
      this.characters.splice(index, 1);
    }
  }

  // ============================================
  // UPDATE LOOP
  // ============================================

  /** Update all characters (call once per frame) */
  update(): void {
    for (let i = 0; i < this.characters.length; i++) {
      this.characters[i] = this.updateSingleCharacter(this.characters[i]);
    }
  }

  /** Update a single character's position and state */
  private updateSingleCharacter(char: Character): Character {
    const { x, y, direction, speed, inCrosswalk } = char;
    const vec = directionVectors[direction];
    const tileX = Math.floor(x);
    const tileY = Math.floor(y);
    const tileType = this.grid[tileY]?.[tileX]?.type;

    // "Crossing mode" = pedestrian is on road tiles (crosswalk or intersection)
    // Once in crossing mode, they MUST continue until they reach sidewalk
    const wasInCrossingMode = inCrosswalk || false;
    const onRoadTile = tileType === TileType.RoadLane || tileType === TileType.RoadTurn;
    const nowInCrossingMode = onRoadTile;

    // Track crosswalk registration for car yielding
    this.updateCrosswalkRegistration(char.id, x, y, tileX, tileY, tileType, wasInCrossingMode, onRoadTile);

    // Check if current tile is walkable
    const currentlyWalkable = this.isWalkable(tileX, tileY);
    const canStayHere = currentlyWalkable || (wasInCrossingMode && onRoadTile);

    if (!canStayHere) {
      // Relocate to a random walkable tile
      return this.relocateToWalkable(char);
    }

    // Movement logic
    const inTileX = x - tileX;
    const inTileY = y - tileY;
    const threshold = speed * 3;
    const nearCenter = Math.abs(inTileX - 0.5) < threshold && Math.abs(inTileY - 0.5) < threshold;

    let newDirection = direction;
    let nextX = x;
    let nextY = y;

    if (nearCenter) {
      const result = this.handleCenterDecision(
        char, tileX, tileY, vec, wasInCrossingMode, nowInCrossingMode
      );
      if (result.wait) {
        return { ...char, x: tileX + 0.5, y: tileY + 0.5, direction, inCrosswalk: result.inCrosswalk };
      }
      newDirection = result.direction;
      nextX = result.snapToCenter ? tileX + 0.5 : x;
      nextY = result.snapToCenter ? tileY + 0.5 : y;
    }

    // Apply movement
    const moveVec = directionVectors[newDirection];
    nextX += moveVec.dx * speed;
    nextY += moveVec.dy * speed;

    // Soft collision avoidance - try not to overlap other characters
    const nearbyChar = this.getCharacterAhead(char, nextX, nextY);
    if (nearbyChar) {
      // In crosswalk: keep moving (don't block traffic flow)
      // On sidewalk: 70% chance to wait, 30% chance to squeeze by
      if (!nowInCrossingMode && Math.random() < 0.7) {
        // Try a different direction instead of waiting
        const altDir = this.findAlternateDirection(char, tileX, tileY, newDirection);
        if (altDir) {
          const altVec = directionVectors[altDir];
          nextX = x + altVec.dx * speed;
          nextY = y + altVec.dy * speed;
          newDirection = altDir;
        } else {
          // No alternate path, just wait briefly
          return { ...char, direction: newDirection, inCrosswalk: nowInCrossingMode };
        }
      }
      // Otherwise squeeze by (allow some overlap)
    }

    // Validate final position
    const finalTileX = Math.floor(nextX);
    const finalTileY = Math.floor(nextY);
    const finalTileType = this.grid[finalTileY]?.[finalTileX]?.type;
    const finalIsRoad = finalTileType === TileType.RoadLane || finalTileType === TileType.RoadTurn;

    const finalWalkable = this.isWalkable(finalTileX, finalTileY) || (wasInCrossingMode && finalIsRoad);
    const canEnterFinal = this.canEnterCrosswalk(nextX, nextY, wasInCrossingMode);

    if (!finalWalkable || !canEnterFinal) {
      return { ...char, x: tileX + 0.5, y: tileY + 0.5, direction: newDirection, inCrosswalk: nowInCrossingMode };
    }

    return { ...char, x: nextX, y: nextY, direction: newDirection, inCrosswalk: finalIsRoad };
  }

  // ============================================
  // COLLISION AVOIDANCE
  // ============================================

  /** Check if another character is near the target position */
  private getCharacterAhead(char: Character, targetX: number, targetY: number): Character | null {
    const collisionDist = 0.4; // How close is "too close"

    for (const other of this.characters) {
      if (other.id === char.id) continue;

      const dx = other.x - targetX;
      const dy = other.y - targetY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < collisionDist) {
        return other;
      }
    }
    return null;
  }

  /** Find an alternate walkable direction that avoids the blocked direction */
  private findAlternateDirection(char: Character, tileX: number, tileY: number, blockedDir: Direction): Direction | null {
    const validDirs = this.getValidDirections(tileX, tileY);
    const opposite = oppositeDirection[blockedDir];

    // Filter out blocked direction and prefer not going backwards
    const alternatives = validDirs.filter(d => d !== blockedDir && d !== opposite);

    // Check each alternative for other characters
    for (const dir of alternatives) {
      const vec = directionVectors[dir];
      const testX = char.x + vec.dx * 0.5;
      const testY = char.y + vec.dy * 0.5;

      if (!this.getCharacterAhead(char, testX, testY)) {
        return dir;
      }
    }

    return null;
  }

  // ============================================
  // CROSSWALK & SIGNAL LOGIC
  // ============================================

  /** Update crosswalk registration for car yielding
   * ONLY register pedestrians on crosswalk tiles (RoadLane in crosswalk zone)
   * NOT at intersection tiles (controlled by traffic lights)
   * NOT waiting pedestrians on sidewalks
   * IMPORTANT: Clear old registrations to prevent "ghost" pedestrians in passed crosswalks
   */
  private updateCrosswalkRegistration(
    charId: string,
    x: number, y: number,
    _tileX: number, _tileY: number,
    _tileType: TileType | undefined,
    wasInCrossingMode: boolean,
    onRoadTile: boolean
  ): void {
    if (!this.trafficLightManager) return;

    const currentCrosswalk = this.trafficLightManager.getCrosswalkAt(x, y);
    if (onRoadTile) {
      if (currentCrosswalk) {
        // Clear ALL old registrations first, then register in current crosswalk only
        this.trafficLightManager.removeFromAllCrosswalks(charId);
        this.trafficLightManager.enterCrosswalk(charId, x, y);
      } else {
        // On intersection tile (RoadTurn) - not in any crosswalk, clear registrations
        this.trafficLightManager.removeFromAllCrosswalks(charId);
      }
    }

    if (wasInCrossingMode && !onRoadTile) {
      this.trafficLightManager.removeFromAllCrosswalks(charId);
    }
  }

  /** Check if pedestrian can enter a crosswalk based on signal */
  private canEnterCrosswalk(x: number, y: number, alreadyInCrossingMode: boolean): boolean {
    if (!this.trafficLightManager) return true;

    const crosswalkResult = this.trafficLightManager.getCrosswalkAt(x, y);
    if (!crosswalkResult) return true;

    // Must finish crossing once started
    if (alreadyInCrossingMode) return true;

    return this.trafficLightManager.canCrossAtCrosswalk(
      crosswalkResult.intersection,
      crosswalkResult.crosswalk
    );
  }

  // ============================================
  // WALKABILITY CHECKS
  // ============================================

  /** Check if a tile type is a walkable surface (not requiring signal) */
  private isWalkableSurface(type: TileType): boolean {
    return type === TileType.Sidewalk || type === TileType.Tile || type === TileType.Cobblestone;
  }

  /** Check if a position is walkable (including signal-dependent crosswalks) */
  private isWalkable(x: number, y: number): boolean {
    const gx = Math.floor(x);
    const gy = Math.floor(y);
    if (gx < 0 || gx >= GRID_WIDTH || gy < 0 || gy >= GRID_HEIGHT) return false;

    const tileType = this.grid[gy][gx].type;

    // Regular walkable surfaces
    if (this.isWalkableSurface(tileType)) return true;

    // Intersection tiles - check traffic signal
    if (tileType === TileType.RoadTurn && this.trafficLightManager) {
      return this.trafficLightManager.canWalkThroughIntersection(gx, gy);
    }

    // Road lane in crosswalk zone
    if (tileType === TileType.RoadLane && this.trafficLightManager) {
      const crosswalkResult = this.trafficLightManager.getCrosswalkAt(x, y);
      if (crosswalkResult) return true;
    }

    return false;
  }

  // ============================================
  // DIRECTION & PATHFINDING
  // ============================================

  /** Get all valid directions from a tile */
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

  /** Pick a new direction (prefers forward, avoids backtracking) */
  private pickNewDirection(tileX: number, tileY: number, currentDir: Direction): Direction | null {
    const validDirs = this.getValidDirections(tileX, tileY);
    if (validDirs.length === 0) return null;

    const opposite = oppositeDirection[currentDir];
    const preferredDirs = validDirs.filter(d => d !== opposite);

    // 60% chance to continue straight
    if (preferredDirs.includes(currentDir) && Math.random() < 0.6) {
      return currentDir;
    }

    const choices = preferredDirs.length > 0 ? preferredDirs : validDirs;
    return choices[Math.floor(Math.random() * choices.length)];
  }

  /** Handle decision-making at tile center */
  private handleCenterDecision(
    char: Character,
    tileX: number, tileY: number,
    vec: { dx: number; dy: number },
    wasInCrossingMode: boolean,
    nowInCrossingMode: boolean
  ): { direction: Direction; wait: boolean; snapToCenter: boolean; inCrosswalk: boolean } {
    const { direction } = char;
    const nextTileX = tileX + vec.dx;
    const nextTileY = tileY + vec.dy;
    const nextTileType = this.grid[nextTileY]?.[nextTileX]?.type;
    const nextIsRoad = nextTileType === TileType.RoadLane || nextTileType === TileType.RoadTurn;

    const nextWalkable = this.isWalkable(nextTileX, nextTileY) || (wasInCrossingMode && nextIsRoad);
    const canEnterNext = this.canEnterCrosswalk(nextTileX + 0.5, nextTileY + 0.5, wasInCrossingMode);

    if (!nextWalkable || !canEnterNext) {
      // Can't proceed forward
      if (!canEnterNext && nextWalkable) {
        // Waiting for signal
        return { direction, wait: true, snapToCenter: true, inCrosswalk: nowInCrossingMode };
      }

      // In crossing mode - must wait, don't turn around
      if (nowInCrossingMode) {
        return { direction, wait: true, snapToCenter: true, inCrosswalk: true };
      }

      // Try to turn
      const newDir = this.pickNewDirection(tileX, tileY, direction);
      return {
        direction: newDir || direction,
        wait: false,
        snapToCenter: true,
        inCrosswalk: nowInCrossingMode,
      };
    }

    // Random direction change at intersections (not while crossing)
    if (!nowInCrossingMode) {
      const validDirs = this.getValidDirections(tileX, tileY);
      if (validDirs.length > 2 && Math.random() < 0.1) {
        const newDir = this.pickNewDirection(tileX, tileY, direction);
        if (newDir) {
          return { direction: newDir, wait: false, snapToCenter: true, inCrosswalk: false };
        }
      }
    }

    return { direction, wait: false, snapToCenter: false, inCrosswalk: nowInCrossingMode };
  }

  /** Relocate character to a random walkable tile */
  private relocateToWalkable(char: Character): Character {
    if (this.trafficLightManager) {
      this.trafficLightManager.removeFromAllCrosswalks(char.id);
    }

    const walkableTiles: { x: number; y: number }[] = [];
    for (let gy = 0; gy < GRID_HEIGHT; gy++) {
      for (let gx = 0; gx < GRID_WIDTH; gx++) {
        const tile = this.grid[gy]?.[gx];
        if (tile && this.isWalkableSurface(tile.type)) {
          walkableTiles.push({ x: gx, y: gy });
        }
      }
    }

    if (walkableTiles.length > 0) {
      const newTile = walkableTiles[Math.floor(Math.random() * walkableTiles.length)];
      return {
        ...char,
        x: newTile.x + 0.5,
        y: newTile.y + 0.5,
        direction: allDirections[Math.floor(Math.random() * allDirections.length)],
        inCrosswalk: false,
      };
    }

    return { ...char, inCrosswalk: false };
  }
}
