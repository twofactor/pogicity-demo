export enum TileType {
  Grass = "grass",
  Sidewalk = "sidewalk", // Renamed from "road" - pedestrian walkway
  Asphalt = "asphalt", // Plain asphalt texture (decorative)
  RoadLane = "roadLane", // 2x2 lane with direction (for traffic)
  RoadTurn = "roadTurn", // 2x2 lane: can go straight OR turn right (rotate for other directions)
  Tile = "tile",
  Snow = "snow",
  Building = "building",
}

// Simplified tool types - Building is now generic, actual building selected separately
export enum ToolType {
  None = "none",
  RoadLane = "roadLane", // 2x2 lane placement with direction (1-way)
  RoadTurn = "roadTurn", // 2x2 lane: straight or right turn (rotate for all directions)
  TwoWayRoad = "twoWayRoad", // 4-wide road with 2 parallel lanes (opposite directions)
  Asphalt = "asphalt", // Plain asphalt (decorative)
  Sidewalk = "sidewalk", // Pedestrian walkway
  Tile = "tile",
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
}

export enum CarType {
  Jeep = "jeep",
  Taxi = "taxi",
  Waymo = "waymo",
  Robotaxi = "robotaxi",
  Zoox = "zoox",
}

export interface Car {
  id: string;
  x: number;
  y: number;
  direction: Direction;
  speed: number;
  waiting: number;
  carType: CarType;
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
// Non-quadrant tiles: single index
// Quadrant tiles: 4 consecutive indices (TL, TR, BL, BR)
export enum TileIndex {
  // Non-quadrant tiles (scaled, single tile)
  Grass = 0,
  Snow1 = 1,
  Snow2 = 2,
  Snow3 = 3,

  // Quadrant tiles (native res, 4 tiles each) - ready for future assets
  // Road: indices 4-7 (TL, TR, BL, BR)
  RoadTL = 4,
  RoadTR = 5,
  RoadBL = 6,
  RoadBR = 7,

  // Asphalt: indices 8-11
  AsphaltTL = 8,
  AsphaltTR = 9,
  AsphaltBL = 10,
  AsphaltBR = 11,
}

// Which tile types use quadrant system (native res, position-based selection)
export const QUADRANT_TILES: Record<string, boolean> = {
  grass: false,    // Scaled for now
  sidewalk: true,  // Quadrant-based (was "road")
  asphalt: true,   // Quadrant-based
  roadLane: true,  // Quadrant-based (2x2 lanes)
  roadTurn: true,  // Same as roadLane (straight or right turn)
  snow: false,     // Scaled for now
};

// Get tile index, handling quadrant tiles based on position
export function getTileIndexForType(
  tileType: string,
  baseIndex: TileIndex,
  x: number,
  y: number
): number {
  if (QUADRANT_TILES[tileType]) {
    // Quadrant tile: pick TL/TR/BL/BR based on position
    const quadrant = (y % 2) * 2 + (x % 2); // 0=TL, 1=TR, 2=BL, 3=BR
    return baseIndex + quadrant;
  }
  // Non-quadrant: just return the base index
  return baseIndex;
}
