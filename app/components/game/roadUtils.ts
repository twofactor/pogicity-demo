import { TileType, GridCell, GRID_WIDTH, GRID_HEIGHT } from "./types";

// Road segment size (4x4 grid cells)
export const ROAD_SEGMENT_SIZE = 4;

// Check if placing a road segment at (segmentX, segmentY) would be valid
export function canPlaceRoadSegment(
  grid: GridCell[][],
  segmentX: number,
  segmentY: number
): { valid: boolean; reason?: string } {
  // Check bounds
  if (
    segmentX < 0 ||
    segmentY < 0 ||
    segmentX + ROAD_SEGMENT_SIZE > GRID_WIDTH ||
    segmentY + ROAD_SEGMENT_SIZE > GRID_HEIGHT
  ) {
    return { valid: false, reason: "out_of_bounds" };
  }

  // Check each cell in the proposed segment
  for (let dy = 0; dy < ROAD_SEGMENT_SIZE; dy++) {
    for (let dx = 0; dx < ROAD_SEGMENT_SIZE; dx++) {
      const px = segmentX + dx;
      const py = segmentY + dy;
      const cell = grid[py]?.[px];
      
      if (!cell) continue;
      
      // Can only place on grass
      if (cell.type !== TileType.Grass) {
        return { valid: false, reason: "blocked" };
      }
    }
  }
  
  return { valid: true };
}

// Direction flags for road connections
export enum RoadConnection {
  None = 0,
  North = 1 << 0, // -Y direction in grid
  South = 1 << 1, // +Y direction in grid
  East = 1 << 2, // +X direction in grid
  West = 1 << 3, // -X direction in grid
}

// Road segment types based on connections
export enum RoadSegmentType {
  Isolated = "isolated", // No connections - 4-way intersection default
  DeadEndNorth = "deadEndNorth",
  DeadEndSouth = "deadEndSouth",
  DeadEndEast = "deadEndEast",
  DeadEndWest = "deadEndWest",
  Horizontal = "horizontal", // East-West
  Vertical = "vertical", // North-South
  CornerNE = "cornerNE",
  CornerNW = "cornerNW",
  CornerSE = "cornerSE",
  CornerSW = "cornerSW",
  TeeNorth = "teeNorth", // T facing north (missing south)
  TeeSouth = "teeSouth",
  TeeEast = "teeEast",
  TeeWest = "teeWest",
  Intersection = "intersection", // 4-way
}

// Get the road segment origin (top-left of 4x4 block) for any grid position
// Roads snap to a 4x4 grid for clean connections
export function getRoadSegmentOrigin(
  x: number,
  y: number
): { x: number; y: number } {
  return {
    x: Math.floor(x / ROAD_SEGMENT_SIZE) * ROAD_SEGMENT_SIZE,
    y: Math.floor(y / ROAD_SEGMENT_SIZE) * ROAD_SEGMENT_SIZE,
  };
}

// Check if a 4x4 area contains a road segment at exact position
export function hasRoadSegment(
  grid: GridCell[][],
  segmentX: number,
  segmentY: number
): boolean {
  // Check if this segment origin is within bounds
  if (
    segmentX < 0 ||
    segmentY < 0 ||
    segmentX >= GRID_WIDTH ||
    segmentY >= GRID_HEIGHT
  ) {
    return false;
  }

  // Check if the origin cell is marked as a road segment
  const cell = grid[segmentY]?.[segmentX];
  return (
    cell?.isOrigin === true &&
    cell?.originX === segmentX &&
    cell?.originY === segmentY &&
    (cell?.type === TileType.Road || cell?.type === TileType.Asphalt)
  );
}

// Find all road segment origins in the grid
export function findAllRoadSegments(grid: GridCell[][]): Array<{ x: number; y: number }> {
  const segments: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < GRID_HEIGHT; y++) {
    for (let x = 0; x < GRID_WIDTH; x++) {
      const cell = grid[y]?.[x];
      if (
        cell?.isOrigin === true &&
        cell?.originX === x &&
        cell?.originY === y &&
        (cell?.type === TileType.Road || cell?.type === TileType.Asphalt)
      ) {
        segments.push({ x, y });
      }
    }
  }
  return segments;
}

// Get connection flags for a road segment based on neighboring segments
// Simple: just check the 4 cardinal neighbors at ROAD_SEGMENT_SIZE distance
export function getRoadConnections(
  grid: GridCell[][],
  segmentX: number,
  segmentY: number
): number {
  let connections = RoadConnection.None;

  // Check north (-Y)
  if (hasRoadSegment(grid, segmentX, segmentY - ROAD_SEGMENT_SIZE)) {
    connections |= RoadConnection.North;
  }
  // Check south (+Y)
  if (hasRoadSegment(grid, segmentX, segmentY + ROAD_SEGMENT_SIZE)) {
    connections |= RoadConnection.South;
  }
  // Check east (+X)
  if (hasRoadSegment(grid, segmentX + ROAD_SEGMENT_SIZE, segmentY)) {
    connections |= RoadConnection.East;
  }
  // Check west (-X)
  if (hasRoadSegment(grid, segmentX - ROAD_SEGMENT_SIZE, segmentY)) {
    connections |= RoadConnection.West;
  }

  return connections;
}

// Determine road segment type from connections
export function getSegmentType(connections: number): RoadSegmentType {
  const n = (connections & RoadConnection.North) !== 0;
  const s = (connections & RoadConnection.South) !== 0;
  const e = (connections & RoadConnection.East) !== 0;
  const w = (connections & RoadConnection.West) !== 0;

  const count = (n ? 1 : 0) + (s ? 1 : 0) + (e ? 1 : 0) + (w ? 1 : 0);

  if (count === 0) return RoadSegmentType.Isolated;
  if (count === 4) return RoadSegmentType.Intersection;

  if (count === 1) {
    if (n) return RoadSegmentType.DeadEndNorth;
    if (s) return RoadSegmentType.DeadEndSouth;
    if (e) return RoadSegmentType.DeadEndEast;
    if (w) return RoadSegmentType.DeadEndWest;
  }

  if (count === 2) {
    if (n && s) return RoadSegmentType.Vertical;
    if (e && w) return RoadSegmentType.Horizontal;
    if (n && e) return RoadSegmentType.CornerNE;
    if (n && w) return RoadSegmentType.CornerNW;
    if (s && e) return RoadSegmentType.CornerSE;
    if (s && w) return RoadSegmentType.CornerSW;
  }

  if (count === 3) {
    if (!s) return RoadSegmentType.TeeNorth;
    if (!n) return RoadSegmentType.TeeSouth;
    if (!w) return RoadSegmentType.TeeEast;
    if (!e) return RoadSegmentType.TeeWest;
  }

  return RoadSegmentType.Intersection;
}

// Generate the 4x4 tile pattern for a road segment
// Returns array of { dx, dy, type } for each tile relative to segment origin
export function generateRoadPattern(
  segmentType: RoadSegmentType
): Array<{ dx: number; dy: number; type: TileType }> {
  const pattern: Array<{ dx: number; dy: number; type: TileType }> = [];

  // Helper to determine if a position should be asphalt based on segment type
  // Road layout:
  // - For Horizontal: rows 0,3 = sidewalk, rows 1,2 = asphalt
  // - For Vertical: cols 0,3 = sidewalk, cols 1,2 = asphalt
  // - For Intersection: center 2x2 = asphalt, corners = sidewalk, edges = asphalt connecting
  // - For corners/tees: blend based on connections

  for (let dy = 0; dy < ROAD_SEGMENT_SIZE; dy++) {
    for (let dx = 0; dx < ROAD_SEGMENT_SIZE; dx++) {
      const isEdgeX = dx === 0 || dx === ROAD_SEGMENT_SIZE - 1;
      const isEdgeY = dy === 0 || dy === ROAD_SEGMENT_SIZE - 1;
      const isCenterX = dx === 1 || dx === 2;
      const isCenterY = dy === 1 || dy === 2;

      let type: TileType = TileType.Road; // Default to sidewalk

      switch (segmentType) {
        case RoadSegmentType.Isolated:
          // Intersection pattern for isolated (allows future connections)
          if (isCenterX && isCenterY) {
            type = TileType.Asphalt;
          }
          break;

        case RoadSegmentType.Horizontal:
          // Sidewalk on top/bottom rows, asphalt in middle
          if (isCenterY) {
            type = TileType.Asphalt;
          }
          break;

        case RoadSegmentType.Vertical:
          // Sidewalk on left/right columns, asphalt in middle
          if (isCenterX) {
            type = TileType.Asphalt;
          }
          break;

        case RoadSegmentType.Intersection:
          // Full intersection - asphalt in center and extending to edges
          if (isCenterX || isCenterY) {
            type = TileType.Asphalt;
          }
          break;

        case RoadSegmentType.DeadEndNorth:
          // Road goes north, dead end at bottom
          if (isCenterX && (dy < 3)) {
            type = TileType.Asphalt;
          }
          break;

        case RoadSegmentType.DeadEndSouth:
          // Road goes south, dead end at top
          if (isCenterX && (dy > 0)) {
            type = TileType.Asphalt;
          }
          break;

        case RoadSegmentType.DeadEndEast:
          // Road goes east, dead end at left
          if (isCenterY && (dx > 0)) {
            type = TileType.Asphalt;
          }
          break;

        case RoadSegmentType.DeadEndWest:
          // Road goes west, dead end at right
          if (isCenterY && (dx < 3)) {
            type = TileType.Asphalt;
          }
          break;

        case RoadSegmentType.CornerNE:
          // North-East corner
          if ((isCenterX && dy <= 2) || (isCenterY && dx >= 1)) {
            type = TileType.Asphalt;
          }
          break;

        case RoadSegmentType.CornerNW:
          // North-West corner
          if ((isCenterX && dy <= 2) || (isCenterY && dx <= 2)) {
            type = TileType.Asphalt;
          }
          break;

        case RoadSegmentType.CornerSE:
          // South-East corner
          if ((isCenterX && dy >= 1) || (isCenterY && dx >= 1)) {
            type = TileType.Asphalt;
          }
          break;

        case RoadSegmentType.CornerSW:
          // South-West corner
          if ((isCenterX && dy >= 1) || (isCenterY && dx <= 2)) {
            type = TileType.Asphalt;
          }
          break;

        case RoadSegmentType.TeeNorth:
          // T-junction, open to N/E/W (closed south)
          if (isCenterX && dy <= 2) {
            type = TileType.Asphalt;
          } else if (isCenterY) {
            type = TileType.Asphalt;
          }
          break;

        case RoadSegmentType.TeeSouth:
          // T-junction, open to S/E/W (closed north)
          if (isCenterX && dy >= 1) {
            type = TileType.Asphalt;
          } else if (isCenterY) {
            type = TileType.Asphalt;
          }
          break;

        case RoadSegmentType.TeeEast:
          // T-junction, open to N/S/E (closed west)
          if (isCenterY && dx >= 1) {
            type = TileType.Asphalt;
          } else if (isCenterX) {
            type = TileType.Asphalt;
          }
          break;

        case RoadSegmentType.TeeWest:
          // T-junction, open to N/S/W (closed east)
          if (isCenterY && dx <= 2) {
            type = TileType.Asphalt;
          } else if (isCenterX) {
            type = TileType.Asphalt;
          }
          break;
      }

      pattern.push({ dx, dy, type });
    }
  }

  return pattern;
}

// Get all segment origins that need updating when a segment changes
// Simple: just return the segment and its 4 cardinal neighbors
export function getAffectedSegments(
  segmentX: number,
  segmentY: number
): Array<{ x: number; y: number }> {
  const affected: Array<{ x: number; y: number }> = [];

  // The segment itself
  affected.push({ x: segmentX, y: segmentY });

  // All 4 neighbors
  const neighbors = [
    { x: segmentX, y: segmentY - ROAD_SEGMENT_SIZE }, // North
    { x: segmentX, y: segmentY + ROAD_SEGMENT_SIZE }, // South
    { x: segmentX + ROAD_SEGMENT_SIZE, y: segmentY }, // East
    { x: segmentX - ROAD_SEGMENT_SIZE, y: segmentY }, // West
  ];

  for (const n of neighbors) {
    if (n.x >= 0 && n.y >= 0 && n.x < GRID_WIDTH && n.y < GRID_HEIGHT) {
      affected.push(n);
    }
  }

  return affected;
}

// Get the preferred lane direction for a car at a given position
// Returns the direction the car should be traveling on this lane
// Returns null if position is not on a lane or at an intersection (any dir ok)
import { Direction } from "./types";

export function getLaneDirection(x: number, y: number, grid?: GridCell[][]): Direction | null {
  const tileX = Math.floor(x);
  const tileY = Math.floor(y);
  const localX = tileX % ROAD_SEGMENT_SIZE;
  const localY = tileY % ROAD_SEGMENT_SIZE;

  // Check lane positions
  const isHorizontalLane = localY === 1 || localY === 2;
  const isVerticalLane = localX === 1 || localX === 2;
  const isCenterTile = isHorizontalLane && isVerticalLane;

  if (!grid) {
    // No grid - use simple position-based rules
    if (isVerticalLane) {
      return localX === 1 ? Direction.Down : Direction.Up;
    }
    if (isHorizontalLane) {
      return localY === 1 ? Direction.Left : Direction.Right;
    }
    return null;
  }

  // Get segment connections
  const segmentX = Math.floor(tileX / ROAD_SEGMENT_SIZE) * ROAD_SEGMENT_SIZE;
  const segmentY = Math.floor(tileY / ROAD_SEGMENT_SIZE) * ROAD_SEGMENT_SIZE;
  
  const hasNorth = hasRoadSegment(grid, segmentX, segmentY - ROAD_SEGMENT_SIZE);
  const hasSouth = hasRoadSegment(grid, segmentX, segmentY + ROAD_SEGMENT_SIZE);
  const hasEast = hasRoadSegment(grid, segmentX + ROAD_SEGMENT_SIZE, segmentY);
  const hasWest = hasRoadSegment(grid, segmentX - ROAD_SEGMENT_SIZE, segmentY);
  
  const hasVerticalConnections = hasNorth || hasSouth;
  const hasHorizontalConnections = hasEast || hasWest;
  const connectionCount = (hasNorth ? 1 : 0) + (hasSouth ? 1 : 0) + (hasEast ? 1 : 0) + (hasWest ? 1 : 0);
  
  // 3+ connections = true intersection
  if (connectionCount >= 3) {
    // At intersections, center tiles allow any direction
    if (isCenterTile) {
      return null;
    }
    // Edge tiles at intersections: follow the direction of the road they're part of
    if (isHorizontalLane && !isVerticalLane) {
      // Top/bottom edges - horizontal traffic
      return localY === 1 ? Direction.Left : Direction.Right;
    }
    if (isVerticalLane && !isHorizontalLane) {
      // Left/right edges - vertical traffic
      return localX === 1 ? Direction.Down : Direction.Up;
    }
    return null;
  }
  
  // Straight vertical road (N-S connections only)
  if (hasVerticalConnections && !hasHorizontalConnections) {
    // All tiles on vertical road go up/down based on lane
    if (isVerticalLane) {
      return localX === 1 ? Direction.Down : Direction.Up;
    }
    // Edge tiles shouldn't have asphalt on pure vertical road, but just in case
    return localX <= 1 ? Direction.Down : Direction.Up;
  }
  
  // Straight horizontal road (E-W connections only)
  if (hasHorizontalConnections && !hasVerticalConnections) {
    // All tiles on horizontal road go left/right based on lane
    if (isHorizontalLane) {
      return localY === 1 ? Direction.Left : Direction.Right;
    }
    // Edge tiles shouldn't have asphalt on pure horizontal road, but just in case
    return localY <= 1 ? Direction.Left : Direction.Right;
  }
  
  // Corners - exactly 2 perpendicular connections
  if (connectionCount === 2 && hasVerticalConnections && hasHorizontalConnections) {
    // Center tiles at corners = turning zone, allow any direction
    if (isCenterTile) {
      return null;
    }
    
    // Edge tiles follow the road direction they're on
    // Horizontal edge tiles (localX = 0 or 3, on horizontal lane)
    if (isHorizontalLane && !isVerticalLane) {
      return localY === 1 ? Direction.Left : Direction.Right;
    }
    // Vertical edge tiles (localY = 0 or 3, on vertical lane)
    if (isVerticalLane && !isHorizontalLane) {
      return localX === 1 ? Direction.Down : Direction.Up;
    }
    
    return null;
  }
  
  // Isolated segment or dead end - use position-based default
  if (isVerticalLane) {
    return localX === 1 ? Direction.Down : Direction.Up;
  }
  if (isHorizontalLane) {
    return localY === 1 ? Direction.Left : Direction.Right;
  }

  return null;
}

// Check if a position is at an intersection (where turning is allowed)
// This checks for SEGMENT-level connections, not just adjacent tiles
export function isAtIntersection(x: number, y: number, grid?: GridCell[][]): boolean {
  const tileX = Math.floor(x);
  const tileY = Math.floor(y);
  const localX = tileX % ROAD_SEGMENT_SIZE;
  const localY = tileY % ROAD_SEGMENT_SIZE;
  
  const isHorizontalLane = localY === 1 || localY === 2;
  const isVerticalLane = localX === 1 || localX === 2;
  
  // Must be at center of segment (potential intersection point)
  if (!isHorizontalLane || !isVerticalLane) {
    return false;
  }
  
  // If no grid provided, assume not an intersection
  if (!grid) {
    return false;
  }
  
  // Get the segment origin for this tile
  const segmentX = Math.floor(tileX / ROAD_SEGMENT_SIZE) * ROAD_SEGMENT_SIZE;
  const segmentY = Math.floor(tileY / ROAD_SEGMENT_SIZE) * ROAD_SEGMENT_SIZE;
  
  // Check for connections to OTHER road segments (not just adjacent tiles)
  // A true intersection requires road segments in perpendicular directions
  const hasNorthSegment = hasRoadSegment(grid, segmentX, segmentY - ROAD_SEGMENT_SIZE);
  const hasSouthSegment = hasRoadSegment(grid, segmentX, segmentY + ROAD_SEGMENT_SIZE);
  const hasEastSegment = hasRoadSegment(grid, segmentX + ROAD_SEGMENT_SIZE, segmentY);
  const hasWestSegment = hasRoadSegment(grid, segmentX - ROAD_SEGMENT_SIZE, segmentY);
  
  const hasVerticalConnection = hasNorthSegment || hasSouthSegment;
  const hasHorizontalConnection = hasEastSegment || hasWestSegment;
  
  // Only a true intersection if segments connect in BOTH directions
  return hasVerticalConnection && hasHorizontalConnection;
}

// Check if a car can turn to a specific direction from current position
// Turns should only happen at the correct tile where lanes connect
export function canTurnAtTile(
  tileX: number, 
  tileY: number, 
  currentDir: Direction, 
  targetDir: Direction
): boolean {
  const localX = tileX % ROAD_SEGMENT_SIZE;
  const localY = tileY % ROAD_SEGMENT_SIZE;
  
  // Going straight is always allowed
  if (currentDir === targetDir) return true;
  
  // U-turns are handled separately at dead ends
  const opposite: Record<Direction, Direction> = {
    [Direction.Up]: Direction.Down,
    [Direction.Down]: Direction.Up,
    [Direction.Left]: Direction.Right,
    [Direction.Right]: Direction.Left,
  };
  if (targetDir === opposite[currentDir]) return false; // No U-turns at intersections
  
  // Specific turn points based on lane positions:
  // - Row 1 (localY=1) = westbound lane
  // - Row 2 (localY=2) = eastbound lane  
  // - Col 1 (localX=1) = southbound lane
  // - Col 2 (localX=2) = northbound lane
  
  // Right turns (from driver's perspective) happen at the "inner" corner
  // Left turns happen at the "outer" corner
  
  switch (currentDir) {
    case Direction.Right: // Eastbound on row 2
      if (targetDir === Direction.Up) {
        // Right turn onto northbound - turn at (2, 2)
        return localX === 2 && localY === 2;
      }
      if (targetDir === Direction.Down) {
        // Left turn onto southbound - turn at (1, 2)
        return localX === 1 && localY === 2;
      }
      break;
      
    case Direction.Left: // Westbound on row 1
      if (targetDir === Direction.Down) {
        // Right turn onto southbound - turn at (1, 1)
        return localX === 1 && localY === 1;
      }
      if (targetDir === Direction.Up) {
        // Left turn onto northbound - turn at (2, 1)
        return localX === 2 && localY === 1;
      }
      break;
      
    case Direction.Up: // Northbound on col 2
      if (targetDir === Direction.Left) {
        // Right turn onto westbound - turn at (2, 1)
        return localX === 2 && localY === 1;
      }
      if (targetDir === Direction.Right) {
        // Left turn onto eastbound - turn at (2, 2)
        return localX === 2 && localY === 2;
      }
      break;
      
    case Direction.Down: // Southbound on col 1
      if (targetDir === Direction.Right) {
        // Right turn onto eastbound - turn at (1, 2)
        return localX === 1 && localY === 2;
      }
      if (targetDir === Direction.Left) {
        // Left turn onto westbound - turn at (1, 1)
        return localX === 1 && localY === 1;
      }
      break;
  }
  
  return false;
}

// Get the correct direction for a U-turn at a dead end
// Returns the sequence of moves needed to turn around
export function getUTurnDirection(
  tileX: number,
  tileY: number,
  currentDir: Direction,
  grid: GridCell[][]
): Direction | null {
  const localX = tileX % ROAD_SEGMENT_SIZE;
  const localY = tileY % ROAD_SEGMENT_SIZE;
  
  // Check what directions are available
  const hasNorth = tileY > 0 && grid[tileY - 1]?.[tileX]?.type === TileType.Asphalt;
  const hasSouth = tileY < GRID_HEIGHT - 1 && grid[tileY + 1]?.[tileX]?.type === TileType.Asphalt;
  const hasWest = tileX > 0 && grid[tileY]?.[tileX - 1]?.type === TileType.Asphalt;
  const hasEast = tileX < GRID_WIDTH - 1 && grid[tileY]?.[tileX + 1]?.type === TileType.Asphalt;
  
  // At a dead end, we need to cross to the other lane then go back
  // Dead end patterns vary by direction we came from
  
  switch (currentDir) {
    case Direction.Right: // Hit dead end going east
      // Need to go down to row 1, then go left (west)
      if (localY === 2 && hasSouth) {
        // Not at the turn point yet, but we need to go to the other row
        // Actually at dead end, we should go to row 1 via the available path
        if (hasNorth) return Direction.Up;
        if (hasSouth) return Direction.Down;
      }
      if (localY === 1) return Direction.Left; // Now on westbound lane
      break;
      
    case Direction.Left: // Hit dead end going west
      if (localY === 1 && hasNorth) {
        if (hasSouth) return Direction.Down;
        if (hasNorth) return Direction.Up;
      }
      if (localY === 2) return Direction.Right; // Now on eastbound lane
      break;
      
    case Direction.Up: // Hit dead end going north
      if (localX === 2 && hasWest) {
        if (hasWest) return Direction.Left;
        if (hasEast) return Direction.Right;
      }
      if (localX === 1) return Direction.Down; // Now on southbound lane
      break;
      
    case Direction.Down: // Hit dead end going south
      if (localX === 1 && hasEast) {
        if (hasEast) return Direction.Right;
        if (hasWest) return Direction.Left;
      }
      if (localX === 2) return Direction.Up; // Now on northbound lane
      break;
  }
  
  // Fallback: just try any available direction
  if (hasNorth && currentDir !== Direction.Down) return Direction.Up;
  if (hasSouth && currentDir !== Direction.Up) return Direction.Down;
  if (hasEast && currentDir !== Direction.Left) return Direction.Right;
  if (hasWest && currentDir !== Direction.Right) return Direction.Left;
  
  return null;
}

// Get the correct lane position for a given direction entering a road segment
// This helps cars snap to the correct lane when spawning or recovering
export function getLanePositionForDirection(
  segmentX: number, 
  segmentY: number, 
  direction: Direction
): { x: number; y: number } {
  // Cars drive on the right side of the road
  switch (direction) {
    case Direction.Up:
      // Northbound: use column 2 (right side when going north)
      return { x: segmentX + 2 + 0.5, y: segmentY + 2 + 0.5 };
    case Direction.Down:
      // Southbound: use column 1 (right side when going south)
      return { x: segmentX + 1 + 0.5, y: segmentY + 1 + 0.5 };
    case Direction.Left:
      // Westbound: use row 2 (right side when going west)
      return { x: segmentX + 2 + 0.5, y: segmentY + 2 + 0.5 };
    case Direction.Right:
      // Eastbound: use row 1 (right side when going east)
      return { x: segmentX + 1 + 0.5, y: segmentY + 1 + 0.5 };
  }
}

