// Building Registry - Single source of truth for all buildings
// Adding a new building = just add an entry here!

export type BuildingCategory =
  | "residential"
  | "commercial"
  | "civic"
  | "landmark"
  | "props"
  | "christmas";

export interface BuildingDefinition {
  id: string;
  name: string;
  category: BuildingCategory;
  footprint: { width: number; height: number };
  // For buildings where rotation changes the footprint (e.g., 3x4 becomes 4x3)
  footprintByOrientation?: {
    south?: { width: number; height: number };
    north?: { width: number; height: number };
    east?: { width: number; height: number };
    west?: { width: number; height: number };
  };
  // For sprites that are visually larger than their footprint (e.g., trees)
  // Used for slicing/depth calculations, not collision
  renderSize?: { width: number; height: number };
  sprites: {
    south: string;
    west?: string;
    north?: string;
    east?: string;
  };
  icon: string; // Emoji for UI
  supportsRotation?: boolean;
  isDecoration?: boolean; // If true, preserves underlying tile (like props)
  // Tiles within footprint that allow props to be placed on top (e.g., porch areas)
  // Coordinates relative to building origin (top-left)
  propSlots?: Array<{ x: number; y: number }>;
  // For buildings where prop slots change position with rotation
  propSlotsByOrientation?: {
    south?: Array<{ x: number; y: number }>;
    north?: Array<{ x: number; y: number }>;
    east?: Array<{ x: number; y: number }>;
    west?: Array<{ x: number; y: number }>;
  };
}

// Helper to get prop slots for a building based on orientation
export function getPropSlots(
  building: BuildingDefinition,
  orientation?: string
): Array<{ x: number; y: number }> {
  if (!building.propSlots && !building.propSlotsByOrientation) {
    return [];
  }

  if (!building.propSlotsByOrientation || !orientation) {
    return building.propSlots || [];
  }

  const dirMap: Record<string, "south" | "north" | "east" | "west"> = {
    down: "south",
    up: "north",
    right: "east",
    left: "west",
  };

  const dir = dirMap[orientation];
  if (!dir) {
    return building.propSlots || [];
  }
  return building.propSlotsByOrientation[dir] || building.propSlots || [];
}

// Helper to get the correct footprint for a building based on orientation
// Returns footprint in SUBTILE units (32x16 pixels) - same as definition values
export function getBuildingFootprint(
  building: BuildingDefinition,
  orientation?: string
): { width: number; height: number } {
  if (!building.footprintByOrientation || !orientation) {
    return building.footprint;
  }

  const dirMap: Record<string, "south" | "north" | "east" | "west"> = {
    down: "south",
    up: "north",
    right: "east",
    left: "west",
  };

  const dir = dirMap[orientation];
  if (!dir) {
    return building.footprint;
  }
  return building.footprintByOrientation[dir] || building.footprint;
}

// All buildings defined in one place
// Sprite standard: 512x512 with front (SE) corner at bottom-center (256, 512)
export const BUILDINGS: Record<string, BuildingDefinition> = {
  // ===== PROPS (kept) =====
  "flower-bush": {
    id: "flower-bush",
    name: "Flower Bush",
    category: "props",
    footprint: { width: 1, height: 1 },
    sprites: {
      south: "/Props/1x1flowerbush.png",
    },
    icon: "🌺",
    isDecoration: true,
  },
  // Trees - 1x1 footprint but rendered as 4x4 for visual size
  "tree-1": {
    id: "tree-1",
    name: "Oak Tree",
    category: "props",
    footprint: { width: 1, height: 1 },
    renderSize: { width: 4, height: 4 },
    sprites: {
      south: "/Props/1x1tree1.png",
    },
    icon: "🌳",
    isDecoration: true,
  },
  "tree-2": {
    id: "tree-2",
    name: "Maple Tree",
    category: "props",
    footprint: { width: 1, height: 1 },
    renderSize: { width: 4, height: 4 },
    sprites: {
      south: "/Props/1x1tree2.png",
    },
    icon: "🌲",
    isDecoration: true,
  },
  "tree-3": {
    id: "tree-3",
    name: "Elm Tree",
    category: "props",
    footprint: { width: 1, height: 1 },
    renderSize: { width: 4, height: 4 },
    sprites: {
      south: "/Props/1x1tree3.png",
    },
    icon: "🌴",
    isDecoration: true,
  },
  "tree-4": {
    id: "tree-4",
    name: "Birch Tree",
    category: "props",
    footprint: { width: 1, height: 1 },
    renderSize: { width: 4, height: 4 },
    sprites: {
      south: "/Props/1x1tree4.png",
    },
    icon: "🎋",
    isDecoration: true,
  },

  // ===== CHRISTMAS (template + lamp) =====
  "christmas-lamp": {
    id: "christmas-lamp",
    name: "Christmas Lamp",
    category: "christmas",
    footprint: { width: 1, height: 1 },
    sprites: {
      south: "/Props/1x1christmas_lamp_south.png",
      west: "/Props/1x1christmas_lamp_west.png",
    },
    icon: "🪔",
    supportsRotation: true,
    isDecoration: true,
  },
  "christmas-tree": {
    id: "christmas-tree",
    name: "Christmas Tree",
    category: "christmas",
    footprint: { width: 2, height: 2 },
    sprites: {
      south: "/Props/2x2christmas_tree.png",
    },
    icon: "🎄",
    isDecoration: true,
  },

  // ===== RESIDENTIAL =====
  "80s-apartment": {
    id: "80s-apartment",
    name: "80s Apartment",
    category: "residential",
    footprint: { width: 3, height: 3 },
    sprites: {
      south: "/Building/residential/3x380s_small_apartment_building_south.png",
      north: "/Building/residential/3x380s_small_apartment_building_north.png",
      east: "/Building/residential/3x380s_small_apartment_building_east.png",
      west: "/Building/residential/3x380s_small_apartment_building_west.png",
    },
    icon: "🏢",
    supportsRotation: true,
  },
  "berkeley-shingle-house": {
    id: "berkeley-shingle-house",
    name: "Berkeley Shingle House",
    category: "residential",
    footprint: { width: 4, height: 5 },
    footprintByOrientation: {
      south: { width: 4, height: 5 },
      north: { width: 4, height: 5 },
      east: { width: 5, height: 4 },
      west: { width: 5, height: 4 },
    },
    sprites: {
      south: "/Building/residential/4x5berkeley_shingle_house_south.png",
      north: "/Building/residential/4x5berkeley_shingle_house_north.png",
      east: "/Building/residential/5x4berkeley_shingle_house_east.png",
      west: "/Building/residential/5x4berkeley_shingle_house_west.png",
    },
    icon: "🏠",
    supportsRotation: true,
    // DISABLED - testing depth sorting
    // propSlotsByOrientation: {
    //   south: [{ x: 0, y: 3 }, { x: 1, y: 3 }],
    //   north: [{ x: 2, y: 1 }, { x: 3, y: 1 }],
    //   east: [{ x: 3, y: 0 }, { x: 3, y: 1 }],
    //   west: [{ x: 1, y: 2 }, { x: 1, y: 3 }],
    // },
  },

  // ===== COMMERCIAL (template) =====
  checkers: {
    id: "checkers",
    name: "Checkers",
    category: "commercial",
    footprint: { width: 2, height: 2 },
    sprites: {
      south: "/Building/commercial/2x2checkers_south.png",
      north: "/Building/commercial/2x2checkers_north.png",
      east: "/Building/commercial/2x2checkers_east.png",
      west: "/Building/commercial/2x2checkers_west.png",
    },
    icon: "🍔",
    supportsRotation: true,
  },

  // ===== CIVIC (template) =====
  "private-school": {
    id: "private-school",
    name: "Private School",
    category: "civic",
    footprint: { width: 6, height: 3 },
    footprintByOrientation: {
      south: { width: 6, height: 3 },
      north: { width: 6, height: 3 },
      east: { width: 3, height: 6 },
      west: { width: 3, height: 6 },
    },
    sprites: {
      south: "/Building/civic/6x3private_school_south.png",
      north: "/Building/civic/6x3private_school_north.png",
      east: "/Building/civic/3x6private_school_east.png",
      west: "/Building/civic/3x6private_school_west.png",
    },
    icon: "🏫",
    supportsRotation: true,
  },

  // ===== LANDMARK (template) =====
  church: {
    id: "church",
    name: "Church",
    category: "landmark",
    footprint: { width: 6, height: 6 },
    sprites: {
      south: "/Building/landmark/6x6church_south2.png",
      north: "/Building/landmark/6x6church_north.png",
      east: "/Building/landmark/6x6church_east.png",
      west: "/Building/landmark/6x6church_west.png",
    },
    icon: "⛪",
    supportsRotation: true,
  },
};

// Helper to get building by ID
export function getBuilding(id: string): BuildingDefinition | undefined {
  return BUILDINGS[id];
}

// Helper to get all buildings in a category
export function getBuildingsByCategory(
  category: BuildingCategory
): BuildingDefinition[] {
  return Object.values(BUILDINGS).filter((b) => b.category === category);
}

// Helper to get all categories that have buildings (in display order)
const CATEGORY_ORDER: BuildingCategory[] = [
  "residential",
  "commercial",
  "props",
  "christmas",
  "civic",
  "landmark",
];

export function getCategories(): BuildingCategory[] {
  const usedCategories = new Set(
    Object.values(BUILDINGS).map((b) => b.category)
  );
  return CATEGORY_ORDER.filter((cat) => usedCategories.has(cat));
}

// Category display names
export const CATEGORY_NAMES: Record<BuildingCategory, string> = {
  residential: "Residential",
  commercial: "Commercial",
  civic: "Civic",
  landmark: "Landmarks",
  props: "Props",
  christmas: "🎄 Christmas",
};
