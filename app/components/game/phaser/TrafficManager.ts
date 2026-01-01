/**
 * TrafficManager - Simple car movement along road lanes
 *
 * Cars follow explicit lane directions (no precomputation needed):
 * - RoadLane: follow the laneDirection straight
 * - RoadTurn: can go straight OR turn right (random choice)
 * - Dead ends: cars stop
 * - Collision: cars queue behind each other
 */

import {
  GridCell,
  Car,
  CarType,
  TileType,
  Direction,
  TurnType,
  GRID_WIDTH,
  GRID_HEIGHT,
  CAR_SPEED,
  ROAD_LANE_SIZE,
} from "../types";
import {
  getRoadLaneOrigin,
  directionVectors,
  oppositeDirection,
  rightTurnDirection,
  leftTurnDirection,
  isRoadTileType,
} from "../roadUtils";
import { TrafficLightManager } from "./TrafficLightManager";

// Generate unique ID
const generateId = () => Math.random().toString(36).substring(2, 9);

// Available car types for spawning
const SPAWN_CAR_TYPES = [CarType.Jeep, CarType.Taxi, CarType.Waymo, CarType.Robotaxi, CarType.Zoox];

export class TrafficManager {
  private cars: Car[] = [];
  private grid: GridCell[][] = [];
  private trafficLightManager: TrafficLightManager | null = null;

  constructor() {}

  // Update grid reference (called when grid changes)
  setGrid(grid: GridCell[][]): void {
    this.grid = grid;
  }

  // Set traffic light manager reference
  setTrafficLightManager(manager: TrafficLightManager): void {
    this.trafficLightManager = manager;
  }

  // Get all cars (for rendering)
  getCars(): Car[] {
    return this.cars;
  }

  getCarCount(): number {
    return this.cars.length;
  }

  clearCars(): void {
    this.cars = [];
  }

  // ============================================
  // LANE HELPERS
  // ============================================

  // Get lane info at a position (returns origin and direction)
  private getLaneAt(x: number, y: number): { originX: number; originY: number; direction: Direction; type: TileType } | null {
    const gx = Math.floor(x);
    const gy = Math.floor(y);

    if (gx < 0 || gx >= GRID_WIDTH || gy < 0 || gy >= GRID_HEIGHT) return null;

    const cell = this.grid[gy]?.[gx];
    if (!cell || !isRoadTileType(cell.type)) return null;

    // Get lane origin (top-left of 2x2 block)
    const originX = cell.originX ?? getRoadLaneOrigin(gx, gy).x;
    const originY = cell.originY ?? getRoadLaneOrigin(gx, gy).y;

    // Get the origin cell for direction info
    const originCell = this.grid[originY]?.[originX];
    if (!originCell || !originCell.laneDirection) return null;

    return {
      originX,
      originY,
      direction: originCell.laneDirection,
      type: originCell.type,
    };
  }

  // Get lane center position (center of 2x2 block)
  private getLaneCenter(laneOriginX: number, laneOriginY: number): { x: number; y: number } {
    return {
      x: laneOriginX + ROAD_LANE_SIZE / 2,  // Center of 2x2 = origin + 1
      y: laneOriginY + ROAD_LANE_SIZE / 2,
    };
  }

  // Check if there's a valid lane in the given direction from a lane origin
  private getNextLane(fromOriginX: number, fromOriginY: number, dir: Direction): { originX: number; originY: number; direction: Direction; type: TileType } | null {
    const vec = directionVectors[dir];
    // Move one full lane (2 subtiles) in the direction
    const nextOriginX = fromOriginX + vec.dx * ROAD_LANE_SIZE;
    const nextOriginY = fromOriginY + vec.dy * ROAD_LANE_SIZE;

    // Check if that position has a road lane
    if (nextOriginX < 0 || nextOriginX >= GRID_WIDTH || nextOriginY < 0 || nextOriginY >= GRID_HEIGHT) {
      return null;
    }

    const nextCell = this.grid[nextOriginY]?.[nextOriginX];

    if (!nextCell || !isRoadTileType(nextCell.type) || !nextCell.isOrigin) {
      return null;
    }

    if (!nextCell.laneDirection) return null;

    return {
      originX: nextOriginX,
      originY: nextOriginY,
      direction: nextCell.laneDirection,
      type: nextCell.type,
    };
  }

  // Check if a direction is valid to enter a lane
  // Simplified: just check we're not going directly AGAINST the lane (opposite direction)
  private canEnterLane(nextLane: { direction: Direction; type: TileType }, enteringFrom: Direction): boolean {
    // Don't allow entering a lane going the exact opposite direction (head-on collision)
    if (nextLane.direction === oppositeDirection[enteringFrom]) {
      return false;
    }
    // Otherwise allow entry - cars will align to lane direction once inside
    return true;
  }

  // ============================================
  // CAR SPAWNING
  // ============================================

  spawnCar(): boolean {
    // Find all road lane origins (RoadLane ONLY - not intersections)
    const laneOrigins: { x: number; y: number; direction: Direction }[] = [];

    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        const cell = this.grid[y]?.[x];
        // Only spawn on RoadLane tiles, NOT RoadTurn (intersections)
        // Cars spawned in intersections get stuck
        if (cell && cell.type === TileType.RoadLane && cell.isOrigin && cell.laneDirection) {
          laneOrigins.push({ x, y, direction: cell.laneDirection });
        }
      }
    }

    if (laneOrigins.length === 0) return false;

    // Pick a random lane
    const lane = laneOrigins[Math.floor(Math.random() * laneOrigins.length)];
    const center = this.getLaneCenter(lane.x, lane.y);

    // Check if there's already a car at this position
    for (const car of this.cars) {
      const dist = Math.sqrt(Math.pow(car.x - center.x, 2) + Math.pow(car.y - center.y, 2));
      if (dist < 2.5) return false; // Too close to existing car (room for trucks)
    }

    // Pick random car type
    const carType = SPAWN_CAR_TYPES[Math.floor(Math.random() * SPAWN_CAR_TYPES.length)];

    const newCar: Car = {
      id: generateId(),
      x: center.x,
      y: center.y,
      direction: lane.direction,
      speed: CAR_SPEED + (Math.random() - 0.5) * 0.01, // Slight speed variation
      waiting: 0,
      carType,
    };

    this.cars.push(newCar);
    return true;
  }

  // ============================================
  // CAR UPDATE LOGIC
  // ============================================

  update(): void {
    for (let i = 0; i < this.cars.length; i++) {
      this.cars[i] = this.updateSingleCar(this.cars[i]);
    }
  }

  /**
   * SIMPLE CAR UPDATE RULES:
   * 1. Cars move forward on road tiles
   * 2. At intersections, cars can turn or go straight
   * 3. RED/YELLOW light = don't enter intersection
   * 4. Cars in intersection keep moving until they exit
   * 5. Cars yield to pedestrians in crosswalks
   * NO SNAPPING - cars just stop where they are
   */
  private updateSingleCar(car: Car): Car {
    const { x, y, direction, speed } = car;

    // Get current tile (which 2x2 lane block we're in)
    const currentLane = this.getLaneAt(x, y);
    if (!currentLane) {
      return this.relocateCarToRoad(car);
    }

    // Get lane center (for decisions only, NOT for snapping)
    const laneCenter = this.getLaneCenter(currentLane.originX, currentLane.originY);

    // Check if we're at the decision point (center of lane)
    const atCenter = Math.abs(x - laneCenter.x) < speed * 2 &&
                     Math.abs(y - laneCenter.y) < speed * 2;

    // Track if we're currently in an intersection
    const inIntersection = currentLane.type === TileType.RoadTurn;

    // ========== RULE 1: Check for cars ahead ==========
    if (this.isBlockedByOtherCar(car)) {
      // If stuck for too long in intersection, try to find any exit (deadlock recovery)
      if (car.waiting > 60 && inIntersection) {
        const escapeDir = this.findAnyExit(car, currentLane);
        if (escapeDir && escapeDir !== direction) {
          return { ...car, direction: escapeDir, waiting: 0, inIntersection: true };
        }
      }
      // Just stop, no snapping - preserve intersection state
      return { ...car, waiting: car.waiting + 1, inIntersection: inIntersection ? car.inIntersection : false };
    }

    // ========== RULE 2: Traffic lights (check 2 lanes ahead - stop BEFORE crosswalk) ==========
    if (atCenter && currentLane.type === TileType.RoadLane && this.trafficLightManager) {
      const nextLane = this.getNextLane(currentLane.originX, currentLane.originY, direction);
      const nextNextLane = nextLane ? this.getNextLane(nextLane.originX, nextLane.originY, direction) : null;

      // Check if intersection is 1 or 2 lanes ahead
      const intersectionAhead =
        (nextLane && nextLane.type === TileType.RoadTurn) ||
        (nextNextLane && nextNextLane.type === TileType.RoadTurn);

      if (intersectionAhead) {
        // Get the intersection position
        const intersectionLane = nextLane?.type === TileType.RoadTurn ? nextLane : nextNextLane;
        if (intersectionLane) {
          const lightColor = this.trafficLightManager.getLightColor(
            intersectionLane.originX, intersectionLane.originY, direction
          );

          if (lightColor === "red" || lightColor === "yellow") {
            // Stop - no snapping, just don't move
            return { ...car, waiting: car.waiting + 1, inIntersection: false };
          }
        }
      }
    }

    // TODO: Cars should yield to pedestrians in crosswalks when turning
    // Currently disabled - pedestrian detection needs fixing
    // The check was incorrectly stopping cars for pedestrians waiting on sidewalks

    // ========== RULE 4: Decide direction at lane center ==========
    let newDirection = direction;
    let newInIntersection = car.inIntersection || false;

    if (atCenter) {
      const nextLane = this.getNextLane(currentLane.originX, currentLane.originY, direction);
      const canGoStraight = nextLane && this.canEnterLane(nextLane, direction);

      if (!canGoStraight) {
        // Must turn - find an exit
        const exit = this.findExit(currentLane, direction);
        if (exit) {
          newDirection = exit;
        } else {
          // Dead end - just stop
          return { ...car, waiting: 0, inIntersection };
        }
      } else if (inIntersection && !car.inIntersection) {
        // Just entered intersection - decide ONCE whether to turn (40% chance)
        newInIntersection = true;
        if (Math.random() < 0.4) {
          const turnDir = this.findTurnDirection(currentLane, direction);
          if (turnDir) {
            newDirection = turnDir;
          }
        }
      }
    }

    // Clear intersection flag when we exit to a regular road lane
    if (!inIntersection) {
      newInIntersection = false;
    }

    // ========== RULE 5: Move forward ==========
    const vec = directionVectors[newDirection];
    const newX = x + vec.dx * speed;
    const newY = y + vec.dy * speed;

    // Check if new position is valid
    const newLane = this.getLaneAt(newX, newY);
    if (!newLane) {
      // Would go off road - just stop
      return { ...car, direction: newDirection, waiting: 0, inIntersection: newInIntersection };
    }

    return { ...car, x: newX, y: newY, direction: newDirection, waiting: 0, inIntersection: newInIntersection };
  }

  // Find a valid exit direction from current position
  private findExit(
    lane: { originX: number; originY: number; direction: Direction; type: TileType },
    currentDir: Direction
  ): Direction | null {
    // Try directions in order: straight, right, left, back
    const directions = [
      currentDir,
      rightTurnDirection[currentDir],
      leftTurnDirection[currentDir],
      oppositeDirection[currentDir]
    ];

    for (const dir of directions) {
      const nextLane = this.getNextLane(lane.originX, lane.originY, dir);
      if (nextLane && this.canEnterLane(nextLane, dir)) {
        return dir;
      }
    }
    return null;
  }

  // Find a turn direction (right or left) - specifically NOT straight
  // Only returns a turn if the target lane is clear of cars
  private findTurnDirection(
    lane: { originX: number; originY: number; direction: Direction; type: TileType },
    currentDir: Direction
  ): Direction | null {
    // Randomly prefer right or left turn
    const turnDirections = Math.random() < 0.5
      ? [rightTurnDirection[currentDir], leftTurnDirection[currentDir]]
      : [leftTurnDirection[currentDir], rightTurnDirection[currentDir]];

    for (const dir of turnDirections) {
      const nextLane = this.getNextLane(lane.originX, lane.originY, dir);
      if (nextLane && this.canEnterLane(nextLane, dir)) {
        // Check if the target lane is clear of cars (prevent gridlock)
        const targetCenter = this.getLaneCenter(nextLane.originX, nextLane.originY);
        if (!this.isLaneOccupied(targetCenter.x, targetCenter.y)) {
          return dir;
        }
      }
    }
    return null;
  }

  // Check if a position has a car nearby (for turn safety)
  private isLaneOccupied(x: number, y: number): boolean {
    for (const car of this.cars) {
      const dx = car.x - x;
      const dy = car.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 2.0) { // Room for larger vehicles like trucks
        return true;
      }
    }
    return false;
  }

  // Find any clear exit direction (for deadlock recovery)
  private findAnyExit(
    car: Car,
    lane: { originX: number; originY: number; direction: Direction; type: TileType }
  ): Direction | null {
    const directions = [
      Direction.Up, Direction.Down, Direction.Left, Direction.Right
    ];

    // Shuffle to add randomness
    for (let i = directions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [directions[i], directions[j]] = [directions[j], directions[i]];
    }

    for (const dir of directions) {
      if (dir === car.direction) continue; // Already tried this direction

      const nextLane = this.getNextLane(lane.originX, lane.originY, dir);
      if (nextLane && this.canEnterLane(nextLane, dir)) {
        const targetCenter = this.getLaneCenter(nextLane.originX, nextLane.originY);
        if (!this.isLaneOccupied(targetCenter.x, targetCenter.y)) {
          return dir;
        }
      }
    }
    return null;
  }

  // Check for pedestrians actually on road tiles ahead (not waiting on sidewalk)
  private checkForPedestriansOnRoad(carX: number, carY: number, direction: Direction): boolean {
    if (!this.trafficLightManager) return false;

    // Use the crosswalk pedestrian registry - these are ONLY pedestrians on road tiles
    // The CitizenManager only registers pedestrians when they're on RoadLane/RoadTurn tiles
    const vec = directionVectors[direction];

    // Check 2-4 subtiles ahead (where crosswalk would be)
    for (let i = 2; i <= 4; i++) {
      const checkX = carX + vec.dx * i;
      const checkY = carY + vec.dy * i;
      const crosswalk = this.trafficLightManager.getCrosswalkAt(checkX, checkY);

      if (crosswalk && crosswalk.crosswalk.pedestrianIds.size > 0) {
        return true; // Pedestrian is on the road in crosswalk
      }
    }

    return false;
  }

  // Check if blocked by another car ahead
  private isBlockedByOtherCar(car: Car): boolean {
    const vec = directionVectors[car.direction];
    const checkDist = 2.0; // Check 2 units ahead (room for larger vehicles)
    const aheadX = car.x + vec.dx * checkDist;
    const aheadY = car.y + vec.dy * checkDist;

    for (const other of this.cars) {
      if (other.id === car.id) continue;

      const dx = other.x - aheadX;
      const dy = other.y - aheadY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 1.5) {
        // Check if the other car is actually ahead of us
        const dotProduct = (other.x - car.x) * vec.dx + (other.y - car.y) * vec.dy;
        if (dotProduct > 0) {
          return true;
        }
      }
    }

    return false;
  }

  // Relocate a car that's not on a road to a valid road lane
  private relocateCarToRoad(car: Car): Car {
    const laneOrigins: { x: number; y: number; direction: Direction }[] = [];

    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        const cell = this.grid[y]?.[x];
        // Only relocate to RoadLane tiles, NOT intersections (RoadTurn)
        if (cell && cell.type === TileType.RoadLane && cell.isOrigin && cell.laneDirection) {
          laneOrigins.push({ x, y, direction: cell.laneDirection });
        }
      }
    }

    if (laneOrigins.length === 0) {
      // No roads - keep car where it is (it will just sit there)
      return car;
    }

    const lane = laneOrigins[Math.floor(Math.random() * laneOrigins.length)];
    const center = this.getLaneCenter(lane.x, lane.y);

    return {
      ...car,
      x: center.x,
      y: center.y,
      direction: lane.direction,
      waiting: 0,
    };
  }
}
