import { TileType, GridCell, Direction, GRID_WIDTH, GRID_HEIGHT, ROAD_LANE_SIZE, LOT_SIZE, getLotOrigin } from "./types";

// ============================================
// CONSTANTS
// ============================================

export { ROAD_LANE_SIZE };

// Direction vectors for movement
export const directionVectors: Record<Direction, { dx: number; dy: number }> = {
  [Direction.Up]: { dx: 0, dy: -1 },
  [Direction.Down]: { dx: 0, dy: 1 },
  [Direction.Left]: { dx: -1, dy: 0 },
  [Direction.Right]: { dx: 1, dy: 0 },
};

// Opposite directions
export const oppositeDirection: Record<Direction, Direction> = {
  [Direction.Up]: Direction.Down,
  [Direction.Down]: Direction.Up,
  [Direction.Left]: Direction.Right,
  [Direction.Right]: Direction.Left,
};

// Right turn: clockwise rotation
export const rightTurnDirection: Record<Direction, Direction> = {
  [Direction.Up]: Direction.Right,
  [Direction.Right]: Direction.Down,
  [Direction.Down]: Direction.Left,
  [Direction.Left]: Direction.Up,
};

// Left turn: counter-clockwise rotation
export const leftTurnDirection: Record<Direction, Direction> = {
  [Direction.Up]: Direction.Left,
  [Direction.Right]: Direction.Up,
  [Direction.Down]: Direction.Right,
  [Direction.Left]: Direction.Down,
};

// Check if a tile type is a road (any lane type)
export function isRoadTileType(type: TileType): boolean {
  return type === TileType.RoadLane || type === TileType.RoadTurn;
}

// ============================================
// CORE LANE FUNCTIONS
// ============================================

// Get the road lane origin (top-left of 2x2 block) for any grid position
export function getRoadLaneOrigin(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.floor(x / ROAD_LANE_SIZE) * ROAD_LANE_SIZE,
    y: Math.floor(y / ROAD_LANE_SIZE) * ROAD_LANE_SIZE,
  };
}

// Check if placing a road lane at (laneX, laneY) would be valid
export function canPlaceRoadLane(
  grid: GridCell[][],
  laneX: number,
  laneY: number,
  allowOverlap: boolean = false
): { valid: boolean; reason?: string } {
  if (
    laneX < 0 ||
    laneY < 0 ||
    laneX + ROAD_LANE_SIZE > GRID_WIDTH ||
    laneY + ROAD_LANE_SIZE > GRID_HEIGHT
  ) {
    return { valid: false, reason: "out_of_bounds" };
  }

  for (let dy = 0; dy < ROAD_LANE_SIZE; dy++) {
    for (let dx = 0; dx < ROAD_LANE_SIZE; dx++) {
      const px = laneX + dx;
      const py = laneY + dy;
      const cell = grid[py]?.[px];

      if (!cell) continue;

      const canPlace =
        cell.type === TileType.Grass ||
        cell.type === TileType.Asphalt ||
        cell.type === TileType.Sidewalk ||  // Allow placing over sidewalks (road replaces them)
        (allowOverlap && isRoadTileType(cell.type));

      if (!canPlace) {
        return { valid: false, reason: "blocked" };
      }
    }
  }

  return { valid: true };
}

// Check if a 2x2 area contains a road lane at exact position
export function hasRoadLane(
  grid: GridCell[][],
  laneX: number,
  laneY: number
): boolean {
  if (
    laneX < 0 ||
    laneY < 0 ||
    laneX >= GRID_WIDTH ||
    laneY >= GRID_HEIGHT
  ) {
    return false;
  }

  const cell = grid[laneY]?.[laneX];
  return (
    isRoadTileType(cell?.type) &&
    cell?.isOrigin === true &&
    cell?.originX === laneX &&
    cell?.originY === laneY
  );
}

// Get arrow rotation angle for a direction (in degrees, for rendering)
export function getDirectionAngle(direction: Direction): number {
  switch (direction) {
    case Direction.Up: return -90;
    case Direction.Down: return 90;
    case Direction.Left: return 180;
    case Direction.Right: return 0;
  }
}

// Cycle through directions (for R key rotation)
export function cycleDirection(direction: Direction): Direction {
  switch (direction) {
    case Direction.Up: return Direction.Right;
    case Direction.Right: return Direction.Down;
    case Direction.Down: return Direction.Left;
    case Direction.Left: return Direction.Up;
  }
}

// ============================================
// INTERSECTION DETECTION
// ============================================

// Get the direction of a lane (from its origin cell)
export function getLaneDirection(grid: GridCell[][], laneX: number, laneY: number): Direction | null {
  const cell = grid[laneY]?.[laneX];
  if (!cell || !isRoadTileType(cell.type) || !cell.isOrigin) return null;
  return cell.laneDirection || null;
}

// Check if two directions are perpendicular
export function isPerpendicular(dir1: Direction, dir2: Direction): boolean {
  const horizontal = [Direction.Left, Direction.Right];
  const vertical = [Direction.Up, Direction.Down];
  return (horizontal.includes(dir1) && vertical.includes(dir2)) ||
         (vertical.includes(dir1) && horizontal.includes(dir2));
}

// Find adjacent lane origins in the 4 cardinal directions
export function getAdjacentLanes(
  grid: GridCell[][],
  laneX: number,
  laneY: number
): { direction: Direction; x: number; y: number; laneDir: Direction }[] {
  const adjacent: { direction: Direction; x: number; y: number; laneDir: Direction }[] = [];

  // Check in each direction (2 tiles away since lanes are 2x2)
  const checks: { dir: Direction; dx: number; dy: number }[] = [
    { dir: Direction.Up, dx: 0, dy: -ROAD_LANE_SIZE },
    { dir: Direction.Down, dx: 0, dy: ROAD_LANE_SIZE },
    { dir: Direction.Left, dx: -ROAD_LANE_SIZE, dy: 0 },
    { dir: Direction.Right, dx: ROAD_LANE_SIZE, dy: 0 },
  ];

  for (const { dir, dx, dy } of checks) {
    const checkX = laneX + dx;
    const checkY = laneY + dy;
    if (hasRoadLane(grid, checkX, checkY)) {
      const laneDir = getLaneDirection(grid, checkX, checkY);
      if (laneDir) {
        adjacent.push({ direction: dir, x: checkX, y: checkY, laneDir });
      }
    }
  }

  return adjacent;
}

// Check if a lane is at an intersection (has perpendicular adjacent lanes)
export function isAtIntersection(grid: GridCell[][], laneX: number, laneY: number): boolean {
  const cell = grid[laneY]?.[laneX];
  if (!cell || !isRoadTileType(cell.type) || !cell.isOrigin) return false;

  const laneDir = cell.laneDirection;
  if (!laneDir) return false;

  const adjacent = getAdjacentLanes(grid, laneX, laneY);

  // An intersection exists if there's an adjacent lane with perpendicular direction
  return adjacent.some(adj => isPerpendicular(laneDir, adj.laneDir));
}

// Update lanes to RoadTurn at intersections
// Call this after placing new roads to detect and update intersections
export function updateIntersections(
  grid: GridCell[][],
  changedLanes: Array<{ x: number; y: number }>
): Array<{ x: number; y: number }> {
  const updatedTiles: Array<{ x: number; y: number }> = [];
  const checkedLanes = new Set<string>();

  // Check each changed lane and its neighbors
  for (const { x: laneX, y: laneY } of changedLanes) {
    const laneKey = `${laneX},${laneY}`;
    if (checkedLanes.has(laneKey)) continue;
    checkedLanes.add(laneKey);

    // Get origin of this lane
    const origin = getRoadLaneOrigin(laneX, laneY);
    if (!hasRoadLane(grid, origin.x, origin.y)) continue;

    // Check if this lane is now at an intersection
    if (isAtIntersection(grid, origin.x, origin.y)) {
      const cell = grid[origin.y]?.[origin.x];
      if (cell && cell.type !== TileType.RoadTurn) {
        // Convert to turn tile
        for (let dy = 0; dy < ROAD_LANE_SIZE; dy++) {
          for (let dx = 0; dx < ROAD_LANE_SIZE; dx++) {
            const px = origin.x + dx;
            const py = origin.y + dy;
            if (grid[py]?.[px]) {
              grid[py][px].type = TileType.RoadTurn;
              updatedTiles.push({ x: px, y: py });
            }
          }
        }
      }
    }

    // Also check adjacent lanes
    const adjacent = getAdjacentLanes(grid, origin.x, origin.y);
    for (const adj of adjacent) {
      const adjKey = `${adj.x},${adj.y}`;
      if (checkedLanes.has(adjKey)) continue;
      checkedLanes.add(adjKey);

      if (isAtIntersection(grid, adj.x, adj.y)) {
        const adjCell = grid[adj.y]?.[adj.x];
        if (adjCell && adjCell.type !== TileType.RoadTurn) {
          // Convert adjacent to turn tile
          for (let dy = 0; dy < ROAD_LANE_SIZE; dy++) {
            for (let dx = 0; dx < ROAD_LANE_SIZE; dx++) {
              const px = adj.x + dx;
              const py = adj.y + dy;
              if (grid[py]?.[px]) {
                grid[py][px].type = TileType.RoadTurn;
                updatedTiles.push({ x: px, y: py });
              }
            }
          }
        }
      }
    }
  }

  return updatedTiles;
}

// ============================================
// DEAD END DETECTION (for U-turns)
// ============================================

// Check if a lane is a dead end (no continuing lane in its direction)
export function isDeadEnd(grid: GridCell[][], laneX: number, laneY: number): boolean {
  const cell = grid[laneY]?.[laneX];
  if (!cell || !isRoadTileType(cell.type) || !cell.isOrigin) return false;

  const laneDir = cell.laneDirection;
  if (!laneDir) return false;

  // Check if there's a lane ahead in the direction of travel
  const vec = directionVectors[laneDir];
  const aheadX = laneX + vec.dx * ROAD_LANE_SIZE;
  const aheadY = laneY + vec.dy * ROAD_LANE_SIZE;

  // Not a dead end if there's a lane ahead
  if (hasRoadLane(grid, aheadX, aheadY)) return false;

  // Check if adjacent perpendicular lanes exist (intersection = not dead end)
  const adjacent = getAdjacentLanes(grid, laneX, laneY);
  const hasPerpendicular = adjacent.some(adj => isPerpendicular(laneDir, adj.laneDir));
  if (hasPerpendicular) return false;

  return true;
}

// Update dead-end lanes to RoadTurn for U-turn capability
export function updateDeadEnds(
  grid: GridCell[][],
  changedLanes: Array<{ x: number; y: number }>
): Array<{ x: number; y: number }> {
  const updatedTiles: Array<{ x: number; y: number }> = [];
  const checkedLanes = new Set<string>();

  for (const { x: laneX, y: laneY } of changedLanes) {
    const origin = getRoadLaneOrigin(laneX, laneY);
    const laneKey = `${origin.x},${origin.y}`;
    if (checkedLanes.has(laneKey)) continue;
    checkedLanes.add(laneKey);

    if (!hasRoadLane(grid, origin.x, origin.y)) continue;

    if (isDeadEnd(grid, origin.x, origin.y)) {
      const cell = grid[origin.y]?.[origin.x];
      if (cell && cell.type !== TileType.RoadTurn) {
        // Convert to turn tile for U-turn
        for (let dy = 0; dy < ROAD_LANE_SIZE; dy++) {
          for (let dx = 0; dx < ROAD_LANE_SIZE; dx++) {
            const px = origin.x + dx;
            const py = origin.y + dy;
            if (grid[py]?.[px]) {
              grid[py][px].type = TileType.RoadTurn;
              updatedTiles.push({ x: px, y: py });
            }
          }
        }
      }
    }
  }

  return updatedTiles;
}

// ============================================
// SIMPLE NAVIGATION HELPERS
// ============================================

// Check if a position is walkable (sidewalk, tile, or cobblestone)
export function isWalkable(grid: GridCell[][], x: number, y: number): boolean {
  const cell = grid[Math.floor(y)]?.[Math.floor(x)];
  return cell?.type === TileType.Sidewalk || cell?.type === TileType.Tile || cell?.type === TileType.Cobblestone;
}

// Check if a position is drivable (road lane or asphalt)
export function isDrivable(grid: GridCell[][], x: number, y: number): boolean {
  const cell = grid[Math.floor(y)]?.[Math.floor(x)];
  return isRoadTileType(cell?.type) || cell?.type === TileType.Asphalt;
}

// ============================================
// LOT-BASED ROAD PLACEMENT
// ============================================

// Check if a lot contains any road infrastructure
export function hasRoadInLot(grid: GridCell[][], lotX: number, lotY: number): boolean {
  for (let dy = 0; dy < LOT_SIZE; dy++) {
    for (let dx = 0; dx < LOT_SIZE; dx++) {
      const cell = grid[lotY + dy]?.[lotX + dx];
      if (cell && (cell.type === TileType.RoadLane || cell.type === TileType.RoadTurn)) {
        return true;
      }
    }
  }
  return false;
}

// Get which adjacent lots have roads
export interface AdjacentRoads {
  north: boolean;
  south: boolean;
  east: boolean;
  west: boolean;
}

export function getAdjacentRoadLots(grid: GridCell[][], lotX: number, lotY: number): AdjacentRoads {
  return {
    north: lotY >= LOT_SIZE && hasRoadInLot(grid, lotX, lotY - LOT_SIZE),
    south: lotY + LOT_SIZE < GRID_HEIGHT && hasRoadInLot(grid, lotX, lotY + LOT_SIZE),
    east: lotX + LOT_SIZE < GRID_WIDTH && hasRoadInLot(grid, lotX + LOT_SIZE, lotY),
    west: lotX >= LOT_SIZE && hasRoadInLot(grid, lotX - LOT_SIZE, lotY),
  };
}

// Place a complete road lot with proper lane structure
// Returns list of modified tiles
export function placeRoadLot(
  grid: GridCell[][],
  lotX: number,
  lotY: number,
  adj?: AdjacentRoads
): Array<{ x: number; y: number }> {
  const dirtyTiles: Array<{ x: number; y: number }> = [];

  // Get adjacent roads if not provided
  if (!adj) {
    adj = getAdjacentRoadLots(grid, lotX, lotY);
  }

  // Count connections
  const connectionCount = [adj.north, adj.south, adj.east, adj.west].filter(Boolean).length;

  // Clear the lot first - fill with grass
  for (let dy = 0; dy < LOT_SIZE; dy++) {
    for (let dx = 0; dx < LOT_SIZE; dx++) {
      const x = lotX + dx;
      const y = lotY + dy;
      if (x < GRID_WIDTH && y < GRID_HEIGHT && grid[y]?.[x]) {
        grid[y][x] = { type: TileType.Grass, x, y };
      }
    }
  }

  // Determine road configuration based on adjacent lots
  // Default to horizontal road if isolated or ambiguous
  const hasHorizontal = adj.east || adj.west || connectionCount === 0;
  const hasVertical = adj.north || adj.south;
  const isIntersection = hasHorizontal && hasVertical;
  const isVertical = hasVertical && !hasHorizontal;
  // isHorizontal is the default (including isolated lots)

  // Road layout within 8x8 lot:
  // - Center lanes: columns 2-5, rows 2-5 (4x4 area, four 2x2 lane blocks)
  // - Edge extensions: when connected, lanes extend to lot edge
  // - Sidewalks: fill remaining space on non-connected edges

  // Place center road lanes (always present)
  if (isIntersection) {
    // Intersection: 4 turn tiles allowing straight or right turn
    placeLane2x2(grid, lotX + 2, lotY + 2, Direction.Down, TileType.RoadTurn, dirtyTiles);
    placeLane2x2(grid, lotX + 4, lotY + 2, Direction.Left, TileType.RoadTurn, dirtyTiles);
    placeLane2x2(grid, lotX + 2, lotY + 4, Direction.Right, TileType.RoadTurn, dirtyTiles);
    placeLane2x2(grid, lotX + 4, lotY + 4, Direction.Up, TileType.RoadTurn, dirtyTiles);
  } else if (isVertical) {
    // Vertical road: lanes going down (left column) and up (right column)
    placeLane2x2(grid, lotX + 2, lotY + 2, Direction.Down, TileType.RoadLane, dirtyTiles);
    placeLane2x2(grid, lotX + 4, lotY + 2, Direction.Up, TileType.RoadLane, dirtyTiles);
    placeLane2x2(grid, lotX + 2, lotY + 4, Direction.Down, TileType.RoadLane, dirtyTiles);
    placeLane2x2(grid, lotX + 4, lotY + 4, Direction.Up, TileType.RoadLane, dirtyTiles);
  } else {
    // Horizontal road: lanes going left (top row) and right (bottom row)
    placeLane2x2(grid, lotX + 2, lotY + 2, Direction.Left, TileType.RoadLane, dirtyTiles);
    placeLane2x2(grid, lotX + 4, lotY + 2, Direction.Left, TileType.RoadLane, dirtyTiles);
    placeLane2x2(grid, lotX + 2, lotY + 4, Direction.Right, TileType.RoadLane, dirtyTiles);
    placeLane2x2(grid, lotX + 4, lotY + 4, Direction.Right, TileType.RoadLane, dirtyTiles);
  }

  // Extend lanes to edges where connections exist
  // West edge (columns 0-1, rows 2-5) - extend horizontal lanes
  if (adj.west || isIntersection || !isVertical) {
    if (adj.west) {
      // Connected west: extend lanes to edge
      placeLane2x2(grid, lotX + 0, lotY + 2, Direction.Left, TileType.RoadLane, dirtyTiles);
      placeLane2x2(grid, lotX + 0, lotY + 4, Direction.Right, TileType.RoadLane, dirtyTiles);
    } else {
      // Not connected: place sidewalk
      for (let dy = 2; dy < 6; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          placeSidewalk(grid, lotX + dx, lotY + dy, dirtyTiles);
        }
      }
    }
  } else {
    // Vertical road, no west connection: sidewalk
    for (let dy = 2; dy < 6; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        placeSidewalk(grid, lotX + dx, lotY + dy, dirtyTiles);
      }
    }
  }

  // East edge (columns 6-7, rows 2-5) - extend horizontal lanes
  if (adj.east || isIntersection || !isVertical) {
    if (adj.east) {
      // Connected east: extend lanes to edge
      placeLane2x2(grid, lotX + 6, lotY + 2, Direction.Left, TileType.RoadLane, dirtyTiles);
      placeLane2x2(grid, lotX + 6, lotY + 4, Direction.Right, TileType.RoadLane, dirtyTiles);
    } else {
      // Not connected: place sidewalk
      for (let dy = 2; dy < 6; dy++) {
        for (let dx = 6; dx < 8; dx++) {
          placeSidewalk(grid, lotX + dx, lotY + dy, dirtyTiles);
        }
      }
    }
  } else {
    // Vertical road, no east connection: sidewalk
    for (let dy = 2; dy < 6; dy++) {
      for (let dx = 6; dx < 8; dx++) {
        placeSidewalk(grid, lotX + dx, lotY + dy, dirtyTiles);
      }
    }
  }

  // North edge (rows 0-1, columns 2-5) - extend vertical lanes
  if (adj.north || isIntersection || isVertical) {
    if (adj.north) {
      // Connected north: extend lanes to edge
      placeLane2x2(grid, lotX + 2, lotY + 0, Direction.Down, TileType.RoadLane, dirtyTiles);
      placeLane2x2(grid, lotX + 4, lotY + 0, Direction.Up, TileType.RoadLane, dirtyTiles);
    } else {
      // Not connected: place sidewalk
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 2; dx < 6; dx++) {
          placeSidewalk(grid, lotX + dx, lotY + dy, dirtyTiles);
        }
      }
    }
  } else {
    // Horizontal road, no north connection: sidewalk
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 2; dx < 6; dx++) {
        placeSidewalk(grid, lotX + dx, lotY + dy, dirtyTiles);
      }
    }
  }

  // South edge (rows 6-7, columns 2-5) - extend vertical lanes
  if (adj.south || isIntersection || isVertical) {
    if (adj.south) {
      // Connected south: extend lanes to edge
      placeLane2x2(grid, lotX + 2, lotY + 6, Direction.Down, TileType.RoadLane, dirtyTiles);
      placeLane2x2(grid, lotX + 4, lotY + 6, Direction.Up, TileType.RoadLane, dirtyTiles);
    } else {
      // Not connected: place sidewalk
      for (let dy = 6; dy < 8; dy++) {
        for (let dx = 2; dx < 6; dx++) {
          placeSidewalk(grid, lotX + dx, lotY + dy, dirtyTiles);
        }
      }
    }
  } else {
    // Horizontal road, no south connection: sidewalk
    for (let dy = 6; dy < 8; dy++) {
      for (let dx = 2; dx < 6; dx++) {
        placeSidewalk(grid, lotX + dx, lotY + dy, dirtyTiles);
      }
    }
  }

  // Corner sidewalks (always present - 2x2 areas at each corner)
  // Top-left corner
  for (let dy = 0; dy < 2; dy++) {
    for (let dx = 0; dx < 2; dx++) {
      placeSidewalk(grid, lotX + dx, lotY + dy, dirtyTiles);
    }
  }
  // Top-right corner
  for (let dy = 0; dy < 2; dy++) {
    for (let dx = 6; dx < 8; dx++) {
      placeSidewalk(grid, lotX + dx, lotY + dy, dirtyTiles);
    }
  }
  // Bottom-left corner
  for (let dy = 6; dy < 8; dy++) {
    for (let dx = 0; dx < 2; dx++) {
      placeSidewalk(grid, lotX + dx, lotY + dy, dirtyTiles);
    }
  }
  // Bottom-right corner
  for (let dy = 6; dy < 8; dy++) {
    for (let dx = 6; dx < 8; dx++) {
      placeSidewalk(grid, lotX + dx, lotY + dy, dirtyTiles);
    }
  }

  // Track all dirty tiles
  for (let dy = 0; dy < LOT_SIZE; dy++) {
    for (let dx = 0; dx < LOT_SIZE; dx++) {
      dirtyTiles.push({ x: lotX + dx, y: lotY + dy });
    }
  }

  return dirtyTiles;
}

// Helper: Place a 2x2 lane block
function placeLane2x2(
  grid: GridCell[][],
  originX: number,
  originY: number,
  direction: Direction,
  tileType: TileType.RoadLane | TileType.RoadTurn,
  dirtyTiles: Array<{ x: number; y: number }>
): void {
  for (let dy = 0; dy < ROAD_LANE_SIZE; dy++) {
    for (let dx = 0; dx < ROAD_LANE_SIZE; dx++) {
      const x = originX + dx;
      const y = originY + dy;
      if (x < GRID_WIDTH && y < GRID_HEIGHT && grid[y]?.[x]) {
        grid[y][x] = {
          type: tileType,
          x,
          y,
          isOrigin: dx === 0 && dy === 0,
          originX,
          originY,
          laneDirection: direction,
        };
      }
    }
  }
}

// Helper: Place a single sidewalk tile
function placeSidewalk(
  grid: GridCell[][],
  x: number,
  y: number,
  dirtyTiles: Array<{ x: number; y: number }>
): void {
  if (x < GRID_WIDTH && y < GRID_HEIGHT && grid[y]?.[x]) {
    // Only place if not already a road
    const cell = grid[y][x];
    if (cell.type !== TileType.RoadLane && cell.type !== TileType.RoadTurn) {
      grid[y][x] = { type: TileType.Sidewalk, x, y };
    }
  }
}

// Remove all road infrastructure from a lot
export function removeRoadLot(
  grid: GridCell[][],
  lotX: number,
  lotY: number
): Array<{ x: number; y: number }> {
  const dirtyTiles: Array<{ x: number; y: number }> = [];

  for (let dy = 0; dy < LOT_SIZE; dy++) {
    for (let dx = 0; dx < LOT_SIZE; dx++) {
      const x = lotX + dx;
      const y = lotY + dy;
      if (x < GRID_WIDTH && y < GRID_HEIGHT && grid[y]?.[x]) {
        grid[y][x] = { type: TileType.Grass, x, y };
        dirtyTiles.push({ x, y });
      }
    }
  }

  return dirtyTiles;
}

// Update a road lot and its neighbors (call after placing or removing a lot)
export function updateLotAndNeighbors(
  grid: GridCell[][],
  lotX: number,
  lotY: number
): Array<{ x: number; y: number }> {
  const dirtyTiles: Array<{ x: number; y: number }> = [];

  // Update the lot itself if it has roads
  if (hasRoadInLot(grid, lotX, lotY)) {
    dirtyTiles.push(...placeRoadLot(grid, lotX, lotY));
  }

  // Update adjacent lots
  const neighbors = [
    { x: lotX, y: lotY - LOT_SIZE }, // North
    { x: lotX, y: lotY + LOT_SIZE }, // South
    { x: lotX + LOT_SIZE, y: lotY }, // East
    { x: lotX - LOT_SIZE, y: lotY }, // West
  ];

  for (const neighbor of neighbors) {
    if (neighbor.x >= 0 && neighbor.y >= 0 &&
        neighbor.x < GRID_WIDTH && neighbor.y < GRID_HEIGHT &&
        hasRoadInLot(grid, neighbor.x, neighbor.y)) {
      dirtyTiles.push(...placeRoadLot(grid, neighbor.x, neighbor.y));
    }
  }

  return dirtyTiles;
}
