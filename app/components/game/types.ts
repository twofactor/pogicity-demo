export enum TileType {
  Grass = "grass",
  Sidewalk = "sidewalk", // Renamed from "road" - pedestrian walkway
  Asphalt = "asphalt", // Plain asphalt texture (decorative)
  RoadLane = "roadLane", // 2x2 lane with direction (for traffic)
  RoadTurn = "roadTurn", // 2x2 lane: can go straight OR turn right (rotate for other directions)
  Tile = "tile",
  Snow = "snow",
  Cobblestone = "cobblestone", // Cobblestone/brick paving
  Building = "building",
}

// Simplified tool types - Building is now generic, actual building selected separately
export enum ToolType {
  None = "none",
  RoadLane = "roadLane", // 2x2 lane placement with direction (1-way)
  RoadTurn = "roadTurn", // 2x2 lane: straight or right turn (rotate for all directions)
  TwoWayRoad = "twoWayRoad", // Two parallel lanes with opposite directions + sidewalks
  SidewalklessRoad = "sidewalklessRoad", // Two parallel lanes without sidewalks
  Asphalt = "asphalt", // Plain asphalt (decorative)
  Sidewalk = "sidewalk", // Pedestrian walkway
  Tile = "tile",
  Cobblestone = "cobblestone", // Cobblestone/brick paving
  Snow = "snow",
  Building = "building", // Generic - actual building ID stored separately
  Eraser = "eraser",
}

export interface GridCell {
  type: TileType;
  x: number;
  y: number;
  // For multi-tile objects, marks the origin (top-left in grid coords)
  isOrigin?: boolean;
  originX?: number;
  originY?: number;
  // For buildings, specify the ID (from building registry)
  buildingId?: string;
  // For rotatable buildings, specify the orientation (defaults to Down/South)
  buildingOrientation?: Direction;
  // For props, store the underlying tile type (so props don't render their own floor)
  underlyingTileType?: TileType;
  // For road lanes, the direction of traffic flow
  laneDirection?: Direction;
  // For building tiles that allow props on top (e.g., porch areas)
  allowsProp?: boolean;
  // For props placed on building tiles (prop layer)
  propId?: string;
  propOriginX?: number;
  propOriginY?: number;
  propOrientation?: Direction;
}

export enum Direction {
  Up = "up",
  Down = "down",
  Left = "left",
  Right = "right",
}

export enum LightingType {
  Day = "day",
  Night = "night",
  Sunset = "sunset",
}

export enum CharacterType {
  Banana = "banana",
  Apple = "apple",
}

export interface Character {
  id: string;
  x: number;
  y: number;
  direction: Direction;
  speed: number;
  characterType: CharacterType;
  // Crosswalk state - once in crosswalk, character continues until they exit
  inCrosswalk?: boolean;
}

export enum CarType {
  Jeep = "jeep",
  Taxi = "taxi",
  Waymo = "waymo",
  Robotaxi = "robotaxi",
  Zoox = "zoox",
}

export type TurnType = "left" | "right" | "straight" | "none";

export interface Car {
  id: string;
  x: number;
  y: number;
  direction: Direction;
  speed: number;
  waiting: number;
  carType: CarType;
  lastTurn?: TurnType;  // Prevent consecutive same-direction turns
  inIntersection?: boolean;  // Already committed to direction in intersection
}

// Grid hierarchy (SC4/RCT style):
// - LOT: 8x8 subtiles (building placement unit)
// - TILE: 2x2 subtiles (car-sized unit, 64x32 pixels)
// - SUBTILE: 1x1 (finest unit, 32x16 pixels - characters, fine props)

// Subtile dimensions (base unit for tilemap)
export const SUBTILE_WIDTH = 32;
export const SUBTILE_HEIGHT = 16;

// Tile dimensions (2x2 subtiles, car-sized)
export const TILE_WIDTH = 64;  // 2 * SUBTILE_WIDTH
export const TILE_HEIGHT = 32; // 2 * SUBTILE_HEIGHT

// Lot dimensions in subtiles (8x8 subtiles = 4x4 tiles)
export const LOT_SIZE = 8;

// Road lane size in subtiles (2x2 subtiles per lane)
export const ROAD_LANE_SIZE = 2;

// Grid is measured in SUBTILES (finest unit)
export const GRID_WIDTH = 192;  // 24 lots * 8 subtiles
export const GRID_HEIGHT = 192;

export const CAR_SPEED = 0.05;

// Tile sizes for different types (in grid cells/subtiles) - this is the FOOTPRINT
export const TILE_SIZES: Record<TileType, { w: number; h: number }> = {
  [TileType.Grass]: { w: 1, h: 1 },
  [TileType.Sidewalk]: { w: 1, h: 1 },
  [TileType.Asphalt]: { w: 1, h: 1 },
  [TileType.RoadLane]: { w: 2, h: 2 }, // 2x2 subtiles per lane
  [TileType.RoadTurn]: { w: 2, h: 2 }, // 2x2 turn tile (straight or right turn)
  [TileType.Tile]: { w: 1, h: 1 },
  [TileType.Snow]: { w: 1, h: 1 },
  [TileType.Cobblestone]: { w: 1, h: 1 },
  [TileType.Building]: { w: 4, h: 4 }, // Default, actual size from building registry
};

// Character movement constants
export const CHARACTER_PIXELS_PER_FRAME_X = 13 / 58;
export const CHARACTER_PIXELS_PER_FRAME_Y = 5 / 58;
export const CHARACTER_SPEED = 0.015;

// Convert subtile grid coordinates to isometric screen coordinates
export function gridToIso(
  gridX: number,
  gridY: number
): { x: number; y: number } {
  return {
    x: (gridX - gridY) * (SUBTILE_WIDTH / 2),
    y: (gridX + gridY) * (SUBTILE_HEIGHT / 2),
  };
}

// Convert isometric screen coordinates back to subtile grid coordinates
export function isoToGrid(
  isoX: number,
  isoY: number
): { x: number; y: number } {
  return {
    x: (isoX / (SUBTILE_WIDTH / 2) + isoY / (SUBTILE_HEIGHT / 2)) / 2,
    y: (isoY / (SUBTILE_HEIGHT / 2) - isoX / (SUBTILE_WIDTH / 2)) / 2,
  };
}

// Tile indices for tilemap (must match tileset order)
// All tiles are now native 32x16 resolution
export enum TileIndex {
  // Base tiles
  Grass = 0,
  Snow1 = 1,
  Snow2 = 2,
  Snow3 = 3,
  Sidewalk = 4,      // Pedestrian sidewalk
  Road = 5,          // Plain road (center, no sidewalk edge)
  Asphalt = 6,       // Generic asphalt
  Cobblestone = 7,   // Cobblestone/brick

  // Road tiles with sidewalk edges (for road-sidewalk borders)
  RoadEdgeNorth = 8,  // Road with sidewalk curb on north edge
  RoadEdgeSouth = 9,  // Road with sidewalk curb on south edge
  RoadEdgeEast = 10,  // Road with sidewalk curb on east edge
  RoadEdgeWest = 11,  // Road with sidewalk curb on west edge
}
