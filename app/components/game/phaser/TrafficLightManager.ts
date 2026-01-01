/**
 * TrafficLightManager - Manages traffic lights and crosswalks at intersections
 *
 * Intersection Detection:
 * - Finds where perpendicular road flows meet (RoadTurn tiles)
 * - Groups adjacent RoadTurn tiles into intersection zones
 *
 * Traffic Light States:
 * - NS_GREEN: North-South has green, East-West has red
 * - NS_YELLOW: North-South has yellow, East-West has red
 * - EW_GREEN: East-West has green, North-South has red
 * - EW_YELLOW: East-West has yellow, North-South has red
 *
 * Car Integration:
 * - Cars check canProceed() before entering intersection
 * - Returns false if their direction has red light
 *
 * Crosswalk System:
 * - Crosswalks are in the 2-tile zone before each intersection approach
 * - Pedestrians can cross during ALL_RED phases (exclusive pedestrian time)
 * - Cars MUST yield to any pedestrian in a crosswalk (absolute rule)
 * - Pedestrians won't enter crosswalks when cars have green
 */

import {
  GridCell,
  TileType,
  Direction,
  GRID_WIDTH,
  GRID_HEIGHT,
  ROAD_LANE_SIZE,
} from "../types";
import { getRoadLaneOrigin, isRoadTileType } from "../roadUtils";

// Traffic light phases
export enum TrafficPhase {
  NS_GREEN = "ns_green",     // North-South green, East-West red
  NS_YELLOW = "ns_yellow",   // North-South yellow, East-West red
  ALL_RED_1 = "all_red_1",   // All red (clearing phase before EW green)
  EW_GREEN = "ew_green",     // East-West green, North-South red
  EW_YELLOW = "ew_yellow",   // East-West yellow, North-South red
  ALL_RED_2 = "all_red_2",   // All red (clearing phase before NS green)
}

// Light color for a specific direction
export type LightColor = "green" | "yellow" | "red";

// Timing constants in MILLISECONDS (frame-rate independent)
const GREEN_DURATION_MS = 10000;   // 10 seconds - plenty of time for cars AND perpendicular pedestrians
const YELLOW_DURATION_MS = 2000;   // 2 seconds - warning to stop
const ALL_RED_DURATION_MS = 3000;  // 3 seconds - let everyone clear

// Minimum time required to safely start crossing (pedestrians need ~5 seconds to cross)
const MIN_CROSSING_TIME_MS = 5000;

export interface Intersection {
  id: string;
  // Center of the intersection (average of all RoadTurn tile origins)
  centerX: number;
  centerY: number;
  // All RoadTurn tile origins that make up this intersection
  tiles: Array<{ x: number; y: number }>;
  // Current traffic light phase
  phase: TrafficPhase;
  // Timer countdown to next phase
  timer: number;
  // Directions that have traffic flowing through this intersection
  hasNS: boolean;  // Has north-south traffic
  hasEW: boolean;  // Has east-west traffic
  // Crosswalk zones (2-tile areas before intersection on each approach)
  crosswalks: Crosswalk[];
}

// Crosswalk zone at an intersection approach
export interface Crosswalk {
  // Grid bounds of the crosswalk area
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  // Direction cars approach from (crosswalk is perpendicular to this)
  approachDirection: Direction;
  // IDs of pedestrians currently in this crosswalk
  pedestrianIds: Set<string>;
}

// Generate unique ID
const generateId = () => Math.random().toString(36).substring(2, 9);

export class TrafficLightManager {
  private intersections: Map<string, Intersection> = new Map();
  private grid: GridCell[][] = [];
  // Map from tile origin key "x,y" to intersection ID for fast lookup
  private tileToIntersection: Map<string, string> = new Map();

  constructor() {}

  // Update grid reference and detect intersections
  setGrid(grid: GridCell[][]): void {
    this.grid = grid;
    this.detectIntersections();
  }

  // Get all intersections (for rendering)
  getIntersections(): Intersection[] {
    return Array.from(this.intersections.values());
  }

  // Update all traffic lights (call each frame with delta time in ms)
  update(deltaMs: number = 16.67): void {
    for (const intersection of this.intersections.values()) {
      intersection.timer -= deltaMs;

      if (intersection.timer <= 0) {
        // Advance to next phase
        intersection.phase = this.getNextPhase(intersection.phase);
        intersection.timer = this.getPhaseDuration(intersection.phase);
      }
    }
  }

  // Get the light color for a specific direction at a position
  // Returns null if no traffic light at that position
  getLightColor(x: number, y: number, direction: Direction): LightColor | null {
    // Get the lane origin for this position
    const origin = getRoadLaneOrigin(Math.floor(x), Math.floor(y));
    const key = `${origin.x},${origin.y}`;

    const intersectionId = this.tileToIntersection.get(key);
    if (!intersectionId) return null;

    const intersection = this.intersections.get(intersectionId);
    if (!intersection) return null;

    // Determine if this direction is NS or EW
    const isNS = direction === Direction.Up || direction === Direction.Down;

    return this.getColorForDirection(intersection.phase, isNS);
  }

  // Check if a car can proceed through an intersection
  // x, y = car position, direction = car's travel direction
  canProceed(x: number, y: number, direction: Direction): boolean {
    const color = this.getLightColor(x, y, direction);

    // No traffic light = can proceed
    if (color === null) return true;

    // Green or yellow = can proceed (yellow = already in intersection)
    // Red = must stop
    return color !== "red";
  }

  // Check if car should stop (for yellow light decision)
  // distanceToIntersection = how far the car is from intersection center
  shouldStop(x: number, y: number, direction: Direction, distanceToIntersection: number): boolean {
    const color = this.getLightColor(x, y, direction);

    if (color === null) return false;
    if (color === "red") return true;
    if (color === "green") return false;

    // Yellow light - stop if far enough away (more than 2 tiles)
    return distanceToIntersection > 2;
  }

  // ============================================
  // INTERSECTION DETECTION
  // ============================================

  private detectIntersections(): void {
    this.intersections.clear();
    this.tileToIntersection.clear();

    // Find all RoadTurn tile origins
    const turnTiles: Array<{ x: number; y: number; dir: Direction }> = [];

    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        const cell = this.grid[y]?.[x];
        if (cell?.type === TileType.RoadTurn && cell.isOrigin && cell.laneDirection) {
          turnTiles.push({ x, y, dir: cell.laneDirection });
        }
      }
    }

    // Group adjacent turn tiles into intersections
    // Two turn tiles are part of the same intersection if they're within 2*ROAD_LANE_SIZE of each other
    const visited = new Set<string>();

    for (const tile of turnTiles) {
      const key = `${tile.x},${tile.y}`;
      if (visited.has(key)) continue;

      // BFS to find all connected turn tiles
      const intersectionTiles: Array<{ x: number; y: number; dir: Direction }> = [];
      const queue = [tile];
      visited.add(key);

      while (queue.length > 0) {
        const current = queue.shift()!;
        intersectionTiles.push(current);

        // Check all adjacent lane positions
        for (const other of turnTiles) {
          const otherKey = `${other.x},${other.y}`;
          if (visited.has(otherKey)) continue;

          // Check if adjacent (within one lane width in any direction)
          const dx = Math.abs(other.x - current.x);
          const dy = Math.abs(other.y - current.y);

          if (dx <= ROAD_LANE_SIZE * 2 && dy <= ROAD_LANE_SIZE * 2) {
            visited.add(otherKey);
            queue.push(other);
          }
        }
      }

      // Only create intersection if there are turn tiles from perpendicular directions
      const hasNS = intersectionTiles.some(t => t.dir === Direction.Up || t.dir === Direction.Down);
      const hasEW = intersectionTiles.some(t => t.dir === Direction.Left || t.dir === Direction.Right);

      if (hasNS && hasEW && intersectionTiles.length >= 2) {
        // Calculate center and bounds
        const centerX = intersectionTiles.reduce((sum, t) => sum + t.x + ROAD_LANE_SIZE / 2, 0) / intersectionTiles.length;
        const centerY = intersectionTiles.reduce((sum, t) => sum + t.y + ROAD_LANE_SIZE / 2, 0) / intersectionTiles.length;

        // Find bounds of intersection
        const minTileX = Math.min(...intersectionTiles.map(t => t.x));
        const maxTileX = Math.max(...intersectionTiles.map(t => t.x)) + ROAD_LANE_SIZE;
        const minTileY = Math.min(...intersectionTiles.map(t => t.y));
        const maxTileY = Math.max(...intersectionTiles.map(t => t.y)) + ROAD_LANE_SIZE;

        // Create crosswalk zones (2 tiles before intersection on each approach)
        // IMPORTANT: Crosswalks must NOT overlap with the intersection itself
        const crosswalks: Crosswalk[] = [];
        const crosswalkDepth = 2; // 2 tiles deep for crosswalk

        // North approach (cars coming from north, going south)
        // Crosswalk is ABOVE the intersection (y < minTileY)
        crosswalks.push({
          minX: minTileX,
          maxX: maxTileX - 1,  // Exclusive of right edge
          minY: minTileY - crosswalkDepth,
          maxY: minTileY - 1,  // Exclusive of intersection
          approachDirection: Direction.Down,
          pedestrianIds: new Set(),
        });

        // South approach (cars coming from south, going north)
        // Crosswalk is BELOW the intersection (y >= maxTileY)
        crosswalks.push({
          minX: minTileX,
          maxX: maxTileX - 1,
          minY: maxTileY,
          maxY: maxTileY + crosswalkDepth - 1,
          approachDirection: Direction.Up,
          pedestrianIds: new Set(),
        });

        // West approach (cars coming from west, going east)
        // Crosswalk is LEFT of the intersection (x < minTileX)
        crosswalks.push({
          minX: minTileX - crosswalkDepth,
          maxX: minTileX - 1,  // Exclusive of intersection
          minY: minTileY,
          maxY: maxTileY - 1,
          approachDirection: Direction.Right,
          pedestrianIds: new Set(),
        });

        // East approach (cars coming from east, going west)
        // Crosswalk is RIGHT of the intersection (x >= maxTileX)
        crosswalks.push({
          minX: maxTileX,
          maxX: maxTileX + crosswalkDepth - 1,
          minY: minTileY,
          maxY: maxTileY - 1,
          approachDirection: Direction.Left,
          pedestrianIds: new Set(),
        });

        const intersection: Intersection = {
          id: generateId(),
          centerX,
          centerY,
          tiles: intersectionTiles.map(t => ({ x: t.x, y: t.y })),
          phase: TrafficPhase.NS_GREEN,
          timer: GREEN_DURATION_MS,
          hasNS,
          hasEW,
          crosswalks,
        };

        this.intersections.set(intersection.id, intersection);

        // Map tiles to intersection
        for (const t of intersectionTiles) {
          this.tileToIntersection.set(`${t.x},${t.y}`, intersection.id);
        }
      }
    }
  }

  // ============================================
  // PHASE HELPERS
  // ============================================

  private getNextPhase(current: TrafficPhase): TrafficPhase {
    switch (current) {
      case TrafficPhase.NS_GREEN: return TrafficPhase.NS_YELLOW;
      case TrafficPhase.NS_YELLOW: return TrafficPhase.ALL_RED_1;
      case TrafficPhase.ALL_RED_1: return TrafficPhase.EW_GREEN;
      case TrafficPhase.EW_GREEN: return TrafficPhase.EW_YELLOW;
      case TrafficPhase.EW_YELLOW: return TrafficPhase.ALL_RED_2;
      case TrafficPhase.ALL_RED_2: return TrafficPhase.NS_GREEN;
    }
  }

  private getPhaseDuration(phase: TrafficPhase): number {
    switch (phase) {
      case TrafficPhase.NS_GREEN:
      case TrafficPhase.EW_GREEN:
        return GREEN_DURATION_MS;
      case TrafficPhase.NS_YELLOW:
      case TrafficPhase.EW_YELLOW:
        return YELLOW_DURATION_MS;
      case TrafficPhase.ALL_RED_1:
      case TrafficPhase.ALL_RED_2:
        return ALL_RED_DURATION_MS;
    }
  }

  private getColorForDirection(phase: TrafficPhase, isNorthSouth: boolean): LightColor {
    if (isNorthSouth) {
      // North-South direction
      switch (phase) {
        case TrafficPhase.NS_GREEN: return "green";
        case TrafficPhase.NS_YELLOW: return "yellow";
        case TrafficPhase.ALL_RED_1: return "red";
        case TrafficPhase.EW_GREEN: return "red";
        case TrafficPhase.EW_YELLOW: return "red";
        case TrafficPhase.ALL_RED_2: return "red";
      }
    } else {
      // East-West direction
      switch (phase) {
        case TrafficPhase.NS_GREEN: return "red";
        case TrafficPhase.NS_YELLOW: return "red";
        case TrafficPhase.ALL_RED_1: return "red";
        case TrafficPhase.EW_GREEN: return "green";
        case TrafficPhase.EW_YELLOW: return "yellow";
        case TrafficPhase.ALL_RED_2: return "red";
      }
    }
    return "red"; // Default fallback
  }

  // Get intersection at a specific tile (for rendering)
  getIntersectionAt(x: number, y: number): Intersection | null {
    const origin = getRoadLaneOrigin(x, y);
    const key = `${origin.x},${origin.y}`;
    const id = this.tileToIntersection.get(key);
    if (!id) return null;
    return this.intersections.get(id) || null;
  }

  // ============================================
  // CROSSWALK SYSTEM
  // ============================================

  // Check if pedestrian can cross at a specific crosswalk
  // SIMPLE RULES (like real life):
  // - GREEN only: Cross when the perpendicular traffic is stopped
  // - Must have enough time remaining: At least 5 seconds to safely cross
  // - YELLOW: Don't start crossing (traffic about to change)
  // - ALL_RED: Don't start crossing (traffic about to start)
  //
  // Crosswalk naming:
  // - North/South crosswalks: Cars approach from N/S (NS traffic uses these)
  // - East/West crosswalks: Cars approach from E/W (EW traffic uses these)
  //
  // During NS_GREEN: NS cars moving → N/S crosswalks blocked, E/W crosswalks OPEN
  // During EW_GREEN: EW cars moving → E/W crosswalks blocked, N/S crosswalks OPEN
  canCrossAtCrosswalk(intersection: Intersection, crosswalk: Crosswalk): boolean {
    const phase = intersection.phase;
    const timeRemaining = intersection.timer;

    // Yellow and ALL_RED: Don't start new crossings (traffic changing soon)
    if (phase === TrafficPhase.NS_YELLOW ||
        phase === TrafficPhase.EW_YELLOW ||
        phase === TrafficPhase.ALL_RED_1 ||
        phase === TrafficPhase.ALL_RED_2) {
      return false;
    }

    // Must have enough time remaining to safely cross
    // Don't start crossing if light is about to change
    if (timeRemaining < MIN_CROSSING_TIME_MS) {
      return false;
    }

    // Determine which traffic uses this crosswalk
    // approachDirection Up/Down = NS traffic approaches here
    // approachDirection Left/Right = EW traffic approaches here
    const isNSCrosswalk = crosswalk.approachDirection === Direction.Up ||
                          crosswalk.approachDirection === Direction.Down;

    // NS_GREEN: NS traffic is moving through N/S crosswalks
    // → Block N/S crosswalks (cars passing), Allow E/W crosswalks (EW stopped)
    if (phase === TrafficPhase.NS_GREEN) {
      return !isNSCrosswalk; // E/W crosswalks open
    }

    // EW_GREEN: EW traffic is moving through E/W crosswalks
    // → Block E/W crosswalks (cars passing), Allow N/S crosswalks (NS stopped)
    if (phase === TrafficPhase.EW_GREEN) {
      return isNSCrosswalk; // N/S crosswalks open
    }

    return false;
  }

  // Legacy method - use canCrossAtCrosswalk instead
  canPedestriansCross(intersectionId: string): boolean {
    const intersection = this.intersections.get(intersectionId);
    if (!intersection) return false;
    // During green phases, SOME crosswalks are open (depends on direction)
    return intersection.phase === TrafficPhase.NS_GREEN ||
           intersection.phase === TrafficPhase.EW_GREEN;
  }

  // Check if a pedestrian can walk through an intersection tile (RoadTurn)
  // Returns true during GREEN phases only (when perpendicular traffic is stopped)
  // Pedestrians already crossing are handled by the "crossing mode" logic in MainScene
  canWalkThroughIntersection(x: number, y: number): boolean {
    const intersection = this.getIntersectionAt(x, y);
    if (!intersection) return false; // Not an intersection tile

    // Only allow during green phases (not yellow, not ALL_RED)
    return intersection.phase === TrafficPhase.NS_GREEN ||
           intersection.phase === TrafficPhase.EW_GREEN;
  }

  // Check if a position is within any crosswalk, returns the crosswalk if so
  // IMPORTANT: Floor coordinates to tile indices for consistent bounds checking
  // This ensures all positions within a tile (10.0 to 10.99) map to tile 10
  getCrosswalkAt(x: number, y: number): { intersection: Intersection; crosswalk: Crosswalk } | null {
    const tileX = Math.floor(x);
    const tileY = Math.floor(y);
    for (const intersection of this.intersections.values()) {
      for (const crosswalk of intersection.crosswalks) {
        if (tileX >= crosswalk.minX && tileX <= crosswalk.maxX &&
            tileY >= crosswalk.minY && tileY <= crosswalk.maxY) {
          return { intersection, crosswalk };
        }
      }
    }
    return null;
  }

  // Register a pedestrian entering a crosswalk
  enterCrosswalk(pedestrianId: string, x: number, y: number): void {
    const result = this.getCrosswalkAt(x, y);
    if (result) {
      result.crosswalk.pedestrianIds.add(pedestrianId);
    }
  }

  // Unregister a pedestrian leaving a crosswalk
  leaveCrosswalk(pedestrianId: string, x: number, y: number): void {
    const result = this.getCrosswalkAt(x, y);
    if (result) {
      result.crosswalk.pedestrianIds.delete(pedestrianId);
    }
  }

  // Remove pedestrian from ALL crosswalks (when they finish crossing or despawn)
  removeFromAllCrosswalks(pedestrianId: string): void {
    for (const intersection of this.intersections.values()) {
      for (const crosswalk of intersection.crosswalks) {
        crosswalk.pedestrianIds.delete(pedestrianId);
      }
    }
  }

  // Register pedestrian at an intersection tile (RoadTurn)
  // This registers them in ALL crosswalks of that intersection
  // so cars approaching from ANY direction will see them
  registerPedestrianAtIntersection(pedestrianId: string, tileX: number, tileY: number): void {
    const intersection = this.getIntersectionAt(tileX, tileY);
    if (!intersection) return;

    // Register in ALL crosswalks of this intersection
    for (const crosswalk of intersection.crosswalks) {
      crosswalk.pedestrianIds.add(pedestrianId);
    }
  }

  // Check if any crosswalk in a car's path has pedestrians
  // direction = car's travel direction, x/y = position of the crosswalk to check
  hasPedestriansInCrosswalk(x: number, y: number, direction: Direction): boolean {
    const result = this.getCrosswalkAt(x, y);
    if (!result) return false;
    return result.crosswalk.pedestrianIds.size > 0;
  }

  // Check if car can enter crosswalk area (no pedestrians)
  // This is the ABSOLUTE RULE - cars never hit pedestrians
  canCarEnterCrosswalkZone(carX: number, carY: number, direction: Direction): boolean {
    // Check crosswalk 2-3 tiles ahead in car's direction
    const vec = { dx: 0, dy: 0 };
    switch (direction) {
      case Direction.Up: vec.dy = -1; break;
      case Direction.Down: vec.dy = 1; break;
      case Direction.Left: vec.dx = -1; break;
      case Direction.Right: vec.dx = 1; break;
    }

    // Check positions 1-3 tiles ahead for crosswalk
    for (let i = 1; i <= 3; i++) {
      const checkX = carX + vec.dx * i;
      const checkY = carY + vec.dy * i;
      const result = this.getCrosswalkAt(checkX, checkY);
      if (result && result.crosswalk.pedestrianIds.size > 0) {
        return false; // Pedestrian in crosswalk - car MUST stop
      }
    }
    return true;
  }

  // Get all crosswalks for rendering
  getAllCrosswalks(): Array<{ intersection: Intersection; crosswalk: Crosswalk }> {
    const result: Array<{ intersection: Intersection; crosswalk: Crosswalk }> = [];
    for (const intersection of this.intersections.values()) {
      for (const crosswalk of intersection.crosswalks) {
        result.push({ intersection, crosswalk });
      }
    }
    return result;
  }

  // Clear ALL pedestrian registrations from ALL crosswalks
  // Call this when clearing characters or to fix stale registrations
  clearAllPedestrianRegistrations(): void {
    for (const intersection of this.intersections.values()) {
      for (const crosswalk of intersection.crosswalks) {
        crosswalk.pedestrianIds.clear();
      }
    }
  }

  // Debug: Get total registered pedestrians across all crosswalks
  getTotalRegisteredPedestrians(): number {
    let total = 0;
    for (const intersection of this.intersections.values()) {
      for (const crosswalk of intersection.crosswalks) {
        total += crosswalk.pedestrianIds.size;
      }
    }
    return total;
  }
}
