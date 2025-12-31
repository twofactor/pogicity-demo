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
  isRoadTileType,
} from "../roadUtils";

// Generate unique ID
const generateId = () => Math.random().toString(36).substring(2, 9);

// Available car types for spawning
const SPAWN_CAR_TYPES = [CarType.Jeep, CarType.Taxi, CarType.Waymo, CarType.Robotaxi, CarType.Zoox];

export class TrafficManager {
  private cars: Car[] = [];
  private grid: GridCell[][] = [];

  constructor() {}

  // Update grid reference (called when grid changes)
  setGrid(grid: GridCell[][]): void {
    this.grid = grid;
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
    // Find all road lane origins
    const laneOrigins: { x: number; y: number; direction: Direction }[] = [];

    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        const cell = this.grid[y]?.[x];
        if (cell && isRoadTileType(cell.type) && cell.isOrigin && cell.laneDirection) {
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
      if (dist < 1.5) return false; // Too close to existing car
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

  private updateSingleCar(car: Car): Car {
    const { x, y, direction, speed, waiting } = car;

    // Get current lane info
    const currentLane = this.getLaneAt(x, y);

    // If not on a road, relocate to a valid road
    if (!currentLane) {
      return this.relocateCarToRoad(car);
    }

    // Check if blocked by another car
    if (this.isBlockedByOtherCar(car)) {
      return { ...car, waiting: Math.min(waiting + 1, 120) };
    }

    // Reset waiting counter
    const newWaiting = waiting > 0 ? 0 : waiting;

    // Get lane center (center of 2x2 block)
    const laneCenter = this.getLaneCenter(currentLane.originX, currentLane.originY);

    // Check if near lane center (like old code: check position within lane)
    const inLaneX = x - currentLane.originX;  // 0 to 2 within lane
    const inLaneY = y - currentLane.originY;  // 0 to 2 within lane
    const laneCenterOffset = ROAD_LANE_SIZE / 2;  // 1.0
    const threshold = speed * 2;
    const nearCenter =
      Math.abs(inLaneX - laneCenterOffset) < threshold &&
      Math.abs(inLaneY - laneCenterOffset) < threshold;

    let newDirection = direction;
    let nextX = x;
    let nextY = y;

    if (nearCenter) {
      // At lane center - make turn/direction decisions here
      const vec = directionVectors[direction];
      const nextLane = this.getNextLane(currentLane.originX, currentLane.originY, direction);

      if (!nextLane || !this.canEnterLane(nextLane, direction)) {
        // Can't continue straight - need to turn or stop
        const newDir = this.pickNextDirection(car, currentLane);
        const altLane = this.getNextLane(currentLane.originX, currentLane.originY, newDir);

        if (altLane && this.canEnterLane(altLane, newDir)) {
          // Can turn - snap to center and change direction
          newDirection = newDir;
          nextX = laneCenter.x;
          nextY = laneCenter.y;
        } else {
          // Dead end - stay at center
          return { ...car, x: laneCenter.x, y: laneCenter.y, direction, waiting: newWaiting };
        }
      } else if (currentLane.type === TileType.RoadTurn) {
        // At a turn tile with valid straight path - randomly decide to turn
        const rightDir = rightTurnDirection[currentLane.direction];
        const rightLane = this.getNextLane(currentLane.originX, currentLane.originY, rightDir);

        if (rightLane && this.canEnterLane(rightLane, rightDir) && Math.random() < 0.3) {
          // Take the turn
          newDirection = rightDir;
          nextX = laneCenter.x;
          nextY = laneCenter.y;
        }
        // Otherwise continue straight (direction unchanged)
      }
    }

    // Move in current direction
    const moveVec = directionVectors[newDirection];
    nextX += moveVec.dx * speed;
    nextY += moveVec.dy * speed;

    // Verify still on road after move
    const newLane = this.getLaneAt(nextX, nextY);
    if (!newLane) {
      // Would go off road - snap to center and stop
      return { ...car, x: laneCenter.x, y: laneCenter.y, direction: newDirection, waiting: newWaiting };
    }

    return { ...car, x: nextX, y: nextY, direction: newDirection, waiting: newWaiting };
  }

  // Pick next direction at a lane
  // RoadLane = straight only, RoadTurn = straight OR right turn
  private pickNextDirection(car: Car, currentLane: { originX: number; originY: number; direction: Direction; type: TileType }): Direction {
    const laneDir = currentLane.direction;
    const rightDir = rightTurnDirection[laneDir];

    // Get possible directions based on tile type
    const possibleDirs: Direction[] = [];

    // Straight is always an option (if lane exists)
    if (this.canGoDirection(currentLane, laneDir)) {
      possibleDirs.push(laneDir);
    }

    // Right turn only available on RoadTurn tiles
    if (currentLane.type === TileType.RoadTurn) {
      if (this.canGoDirection(currentLane, rightDir)) {
        possibleDirs.push(rightDir);
      }
    }

    if (possibleDirs.length === 0) {
      // Dead end - return lane direction (car will stop)
      return laneDir;
    }

    if (possibleDirs.length === 1) {
      return possibleDirs[0];
    }

    // Multiple options - prefer straight (70%), else turn
    if (possibleDirs.includes(laneDir) && Math.random() < 0.7) {
      return laneDir;
    }

    return possibleDirs[Math.floor(Math.random() * possibleDirs.length)];
  }

  // Check if we can go in a direction from a lane
  private canGoDirection(fromLane: { originX: number; originY: number }, dir: Direction): boolean {
    const nextLane = this.getNextLane(fromLane.originX, fromLane.originY, dir);
    if (!nextLane) return false;
    return this.canEnterLane(nextLane, dir);
  }

  // Check if blocked by another car ahead
  private isBlockedByOtherCar(car: Car): boolean {
    const vec = directionVectors[car.direction];
    const checkDist = 1.5; // Check 1.5 units ahead
    const aheadX = car.x + vec.dx * checkDist;
    const aheadY = car.y + vec.dy * checkDist;

    for (const other of this.cars) {
      if (other.id === car.id) continue;

      const dx = other.x - aheadX;
      const dy = other.y - aheadY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 1.0) {
        // Check if the other car is actually ahead of us
        const dotProduct = (other.x - car.x) * vec.dx + (other.y - car.y) * vec.dy;
        if (dotProduct > 0) {
          return true;
        }
      }
    }

    return false;
  }

  // Relocate a car that's not on a road to a valid road
  private relocateCarToRoad(car: Car): Car {
    const laneOrigins: { x: number; y: number; direction: Direction }[] = [];

    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        const cell = this.grid[y]?.[x];
        if (cell && isRoadTileType(cell.type) && cell.isOrigin && cell.laneDirection) {
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
