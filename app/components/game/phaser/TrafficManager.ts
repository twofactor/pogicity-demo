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

    // ABSOLUTE RULE: Cars NEVER hit pedestrians in crosswalks
    // Check if there's a pedestrian in the crosswalk ahead
    if (this.trafficLightManager && !this.trafficLightManager.canCarEnterCrosswalkZone(x, y, direction)) {
      // Pedestrian in crosswalk - car must wait
      return { ...car, waiting: Math.min(waiting + 1, 120) };
    }

    // Check if there's a red light ahead (we'll use this later to prevent crossing)
    // The crosswalk zone is the RoadLane immediately before the intersection (RoadTurn)
    // So we need to stop BEFORE entering that RoadLane
    let redLightAhead = false;
    let stopLineCenter: { x: number; y: number } | null = null;

    if (currentLane.type === TileType.RoadLane && this.trafficLightManager) {
      const nextLane = this.getNextLane(currentLane.originX, currentLane.originY, direction);

      if (nextLane) {
        // Case 1: Next lane is intersection - we're ON the crosswalk, stop at our current center
        if (nextLane.type === TileType.RoadTurn) {
          const canProceed = this.trafficLightManager.canProceed(nextLane.originX, nextLane.originY, direction);
          if (!canProceed) {
            redLightAhead = true;
            // Already in crosswalk zone - stop at current lane center
            const center = this.getLaneCenter(currentLane.originX, currentLane.originY);
            stopLineCenter = {
              x: Math.round(center.x * 100) / 100,
              y: Math.round(center.y * 100) / 100,
            };
          }
        }
        // Case 2: Next lane is RoadLane, check if THAT leads to intersection (crosswalk ahead)
        else if (nextLane.type === TileType.RoadLane) {
          const nextNextLane = this.getNextLane(nextLane.originX, nextLane.originY, direction);
          if (nextNextLane && nextNextLane.type === TileType.RoadTurn) {
            const canProceed = this.trafficLightManager.canProceed(nextNextLane.originX, nextNextLane.originY, direction);
            if (!canProceed) {
              redLightAhead = true;
              // Stop at current lane center - this is BEFORE the crosswalk (next lane)
              const center = this.getLaneCenter(currentLane.originX, currentLane.originY);
              stopLineCenter = {
                x: Math.round(center.x * 100) / 100,
                y: Math.round(center.y * 100) / 100,
              };
            }
          }
        }
      }
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
        const pickResult = this.pickNextDirection(car, currentLane);
        const altLane = this.getNextLane(currentLane.originX, currentLane.originY, pickResult.dir);

        if (altLane && this.canEnterLane(altLane, pickResult.dir)) {
          // Can turn - snap to center and change direction
          newDirection = pickResult.dir;
          nextX = laneCenter.x;
          nextY = laneCenter.y;
          // Update lastTurn for this car
          car = { ...car, lastTurn: pickResult.turn };
        } else {
          // Dead end - stay at center
          return { ...car, x: laneCenter.x, y: laneCenter.y, direction, waiting: newWaiting };
        }
      } else if (currentLane.type === TileType.RoadTurn) {
        // At a turn tile with valid straight path - randomly decide to turn
        // RULE: Only 1 turn allowed per intersection - if lastTurn is "left" or "right", go straight
        const alreadyTurned = car.lastTurn === "left" || car.lastTurn === "right";

        if (!alreadyTurned) {
          // Haven't turned yet in this intersection - check available turn lanes
          const turnOptions: Array<{ dir: Direction; turn: "left" | "right" }> = [];

          // Check right turn lane availability (ignore pedestrians for now)
          const rightDir = rightTurnDirection[direction];
          const rightLane = this.getNextLane(currentLane.originX, currentLane.originY, rightDir);
          if (rightLane && this.canEnterLane(rightLane, rightDir)) {
            turnOptions.push({ dir: rightDir, turn: "right" });
          }

          // Check left turn lane availability (ignore pedestrians for now)
          const leftDir = leftTurnDirection[direction];
          const leftLane = this.getNextLane(currentLane.originX, currentLane.originY, leftDir);
          if (leftLane && this.canEnterLane(leftLane, leftDir)) {
            turnOptions.push({ dir: leftDir, turn: "left" });
          }

          // Decide if car wants to turn (based on car ID for consistent behavior)
          if (turnOptions.length > 0) {
            const hashBase = car.id.charCodeAt(0) + car.id.charCodeAt(1) * 256;
            const positionFactor = Math.floor(x * 7 + y * 13) % 100;
            const turnChance = ((hashBase + positionFactor) % 100) / 100;

            if (turnChance < 0.3) {
              // Car wants to turn - pick which direction
              const choiceIndex = (hashBase + Math.floor(x + y)) % turnOptions.length;
              const chosen = turnOptions[choiceIndex];

              // Check if pedestrians are in the crosswalk in the turn direction
              const pathClear = !this.trafficLightManager ||
                this.trafficLightManager.canCarEnterCrosswalkZone(x, y, chosen.dir);

              if (!pathClear) {
                // Pedestrian in crosswalk - wait briefly, but don't block traffic forever
                // After waiting too long, give up the turn and go straight
                if (waiting > 60) {
                  // Give up on turning - just go straight to avoid blocking traffic
                  car = { ...car, lastTurn: "straight" };
                  // Continue with straight movement below
                } else {
                  // Wait for pedestrian to clear
                  return { ...car, x: laneCenter.x, y: laneCenter.y, direction, waiting: Math.min(waiting + 1, 120) };
                }
              } else {
                // Path is clear - execute the turn
                newDirection = chosen.dir;
                nextX = laneCenter.x;
                nextY = laneCenter.y;
                car = { ...car, lastTurn: chosen.turn };
              }
            }
          }
        }
        // If already turned, just continue straight (direction unchanged)
      } else {
        // On RoadLane (not intersection) - reset lastTurn so car can turn at next intersection
        if (car.lastTurn !== "straight" && car.lastTurn !== "none") {
          car = { ...car, lastTurn: "straight" };
        }
      }
    }

    // Move in current direction
    const moveVec = directionVectors[newDirection];
    nextX += moveVec.dx * speed;
    nextY += moveVec.dy * speed;

    // If red light ahead, don't let car cross the stop line
    if (redLightAhead && stopLineCenter) {
      // Check if car is already at stop line (use speed as threshold to catch it in one frame)
      const atStopLine = Math.abs(x - stopLineCenter.x) < speed * 1.5 && Math.abs(y - stopLineCenter.y) < speed * 1.5;
      const wouldCross = this.wouldCrossStopLine(x, y, nextX, nextY, stopLineCenter, newDirection);
      if (atStopLine || wouldCross) {
        // Stay at stop line - car waits for green (snap to exact position to prevent jitter)
        return { ...car, x: stopLineCenter.x, y: stopLineCenter.y, direction: newDirection, waiting: Math.min(waiting + 1, 120) };
      }
    }

    // Verify still on road after move
    const newLane = this.getLaneAt(nextX, nextY);
    if (!newLane) {
      // Would go off road - snap to center and stop
      return { ...car, x: laneCenter.x, y: laneCenter.y, direction: newDirection, waiting: newWaiting };
    }

    return { ...car, x: nextX, y: nextY, direction: newDirection, waiting: newWaiting };
  }

  // Check if movement would cross the stop line
  private wouldCrossStopLine(
    fromX: number, fromY: number,
    toX: number, toY: number,
    stopLine: { x: number; y: number },
    direction: Direction
  ): boolean {
    // Check based on direction of travel
    switch (direction) {
      case Direction.Right:
        return fromX < stopLine.x && toX >= stopLine.x;
      case Direction.Left:
        return fromX > stopLine.x && toX <= stopLine.x;
      case Direction.Down:
        return fromY < stopLine.y && toY >= stopLine.y;
      case Direction.Up:
        return fromY > stopLine.y && toY <= stopLine.y;
    }
  }

  // Pick next direction at a lane (used when car can't go straight)
  // Returns direction and turn type for lastTurn tracking
  // RoadLane = straight only
  // RoadTurn = straight, right turn, left turn (if lastTurn != "left"), or U-turn (at dead ends)
  private pickNextDirection(car: Car, currentLane: { originX: number; originY: number; direction: Direction; type: TileType }): { dir: Direction; turn: TurnType } {
    const laneDir = currentLane.direction;
    const rightDir = rightTurnDirection[laneDir];
    const leftDir = leftTurnDirection[laneDir];

    // U-turn direction: perpendicular toward the parallel lane
    // Right-hand traffic layout:
    //   Horizontal: Left(←) is top, Right(→) is bottom
    //   Vertical: Down(↓) is left, Up(↑) is right
    const uTurnMoveDir: Record<Direction, Direction> = {
      [Direction.Right]: Direction.Up,     // → lane is bottom, parallel ← is above
      [Direction.Left]: Direction.Down,    // ← lane is top, parallel → is below
      [Direction.Down]: Direction.Right,   // ↓ lane is left, parallel ↑ is to the right
      [Direction.Up]: Direction.Left,      // ↑ lane is right, parallel ↓ is to the left
    };

    // Get possible directions based on tile type
    const possibleOptions: Array<{ dir: Direction; turn: TurnType }> = [];

    // Straight is always an option (if lane exists)
    if (this.canGoDirection(currentLane, laneDir)) {
      possibleOptions.push({ dir: laneDir, turn: "straight" });
    }

    // Turn options only available on RoadTurn tiles AND if car hasn't already turned
    // RULE: Only 1 turn allowed per intersection
    const alreadyTurned = car.lastTurn === "left" || car.lastTurn === "right";
    if (currentLane.type === TileType.RoadTurn && !alreadyTurned) {
      // Right turn
      if (this.canGoDirection(currentLane, rightDir)) {
        possibleOptions.push({ dir: rightDir, turn: "right" });
      }
      // Left turn
      if (this.canGoDirection(currentLane, leftDir)) {
        possibleOptions.push({ dir: leftDir, turn: "left" });
      }
    }

    // U-turn available on RoadTurn at dead ends
    // Only if no forward, right, or left options exist
    if (currentLane.type === TileType.RoadTurn && possibleOptions.length === 0) {
      const uDir = uTurnMoveDir[laneDir];
      if (this.canGoDirection(currentLane, uDir)) {
        possibleOptions.push({ dir: uDir, turn: "none" });
      }
    }

    if (possibleOptions.length === 0) {
      // True dead end - return lane direction (car will stop)
      return { dir: laneDir, turn: "none" };
    }

    if (possibleOptions.length === 1) {
      return possibleOptions[0];
    }

    // Multiple options - prefer straight (70%), else pick randomly
    const straightOption = possibleOptions.find(o => o.turn === "straight");
    if (straightOption && Math.random() < 0.7) {
      return straightOption;
    }

    return possibleOptions[Math.floor(Math.random() * possibleOptions.length)];
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
