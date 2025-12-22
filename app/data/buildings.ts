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
}

// Helper to get the correct footprint for a building based on orientation
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
  "bus-shelter": {
    id: "bus-shelter",
    name: "Bus Shelter",
    category: "props",
    footprint: { width: 2, height: 1 },
    sprites: {
      south: "/Props/2x1busshelter.png",
    },
    icon: "🚏",
  },
  "flower-bush": {
    id: "flower-bush",
    name: "Flower Bush",
    category: "props",
    footprint: { width: 1, height: 1 },
    sprites: {
      south: "/Props/1x1flowerbush.png",
    },
    icon: "🌺",
  },
  "park-table": {
    id: "park-table",
    name: "Park Table",
    category: "props",
    footprint: { width: 1, height: 1 },
    sprites: {
      south: "/Props/1x1park_table.png",
    },
    icon: "🪑",
  },
  fountain: {
    id: "fountain",
    name: "Fountain",
    category: "props",
    footprint: { width: 2, height: 2 },
    sprites: {
      south: "/Props/2x2fountain.png",
    },
    icon: "⛲",
  },
  statue: {
    id: "statue",
    name: "Statue",
    category: "props",
    footprint: { width: 1, height: 2 },
    sprites: {
      south: "/Props/1x2statue.png",
    },
    icon: "🗽",
  },
  // 🎄 CHRISTMAS COLLECTION 🎄
  "santas-sleigh": {
    id: "santas-sleigh",
    name: "Santa's Sleigh",
    category: "christmas",
    footprint: { width: 2, height: 2 },
    sprites: {
      south: "/Props/2x2sleigh_south.png",
      north: "/Props/2x2sleigh_north.png",
      east: "/Props/2x2sleigh_east.png",
      west: "/Props/2x2sleigh_west.png",
    },
    icon: "🛷",
    supportsRotation: true,
    isDecoration: true,
  },
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
  "christmas-town-hall": {
    id: "christmas-town-hall",
    name: "Christmas Town Hall",
    category: "christmas",
    footprint: { width: 4, height: 3 }, // Default (south)
    footprintByOrientation: {
      south: { width: 4, height: 3 },
      north: { width: 4, height: 3 },
      east: { width: 3, height: 4 },
      west: { width: 3, height: 4 },
    },
    sprites: {
      south: "/Building/christmas/4x3town_hall_south.png",
      north: "/Building/christmas/4x3town_hall_north.png",
      east: "/Building/christmas/3x4town_hall_east.png",
      west: "/Building/christmas/3x4town_hall_west.png",
    },
    icon: "🏛️",
    supportsRotation: true,
  },
  "christmas-clock-tower": {
    id: "christmas-clock-tower",
    name: "Christmas Clock Tower",
    category: "christmas",
    footprint: { width: 2, height: 2 },
    sprites: {
      south: "/Building/christmas/2x2clock_tower_south.png",
      north: "/Building/christmas/2x2clock_tower_north.png",
      east: "/Building/christmas/2x2clock_tower_east.png",
      west: "/Building/christmas/2x2clock_tower_west.png",
    },
    icon: "🕰️",
    supportsRotation: true,
    isDecoration: true,
  },
  "christmas-cottage": {
    id: "christmas-cottage",
    name: "Christmas Cottage",
    category: "christmas",
    footprint: { width: 2, height: 2 },
    sprites: {
      south: "/Building/christmas/2x2christmas_cottage_south.png",
      north: "/Building/christmas/2x2christmas_cottage_north.png",
      east: "/Building/christmas/2x2christmas_cottage_east.png",
      west: "/Building/christmas/2x2christmas_cottage_west.png",
    },
    icon: "🏠",
    supportsRotation: true,
    isDecoration: true,
  },
  "christmas-bakery": {
    id: "christmas-bakery",
    name: "Christmas Bakery",
    category: "christmas",
    footprint: { width: 3, height: 2 },
    footprintByOrientation: {
      south: { width: 3, height: 2 },
      north: { width: 3, height: 2 },
      east: { width: 2, height: 3 },
      west: { width: 2, height: 3 },
    },
    sprites: {
      south: "/Building/christmas/3x2christmas_bakery_south.png",
      north: "/Building/christmas/3x2christmas_bakery_north.png",
      east: "/Building/christmas/2x3christmas_bakery_east.png",
      west: "/Building/christmas/2x3christmas_bakery_west.png",
    },
    icon: "🥐",
    supportsRotation: true,
    isDecoration: true,
  },
  "christmas-gift-shop": {
    id: "christmas-gift-shop",
    name: "Christmas Gift Shop",
    category: "christmas",
    footprint: { width: 3, height: 2 },
    footprintByOrientation: {
      south: { width: 3, height: 2 },
      north: { width: 3, height: 2 },
      east: { width: 2, height: 3 },
      west: { width: 2, height: 3 },
    },
    sprites: {
      south: "/Building/christmas/3x2christmas_gift_shop_south.png",
      north: "/Building/christmas/3x2christmas_gift_shop_north.png",
      east: "/Building/christmas/2x3christmas_gift_shop_east.png",
      west: "/Building/christmas/2x3christmas_gift_shop_west.png",
    },
    icon: "🎁",
    supportsRotation: true,
    isDecoration: true,
  },
  "christmas-cocoa-shop": {
    id: "christmas-cocoa-shop",
    name: "Christmas Cocoa Shop",
    category: "christmas",
    footprint: { width: 3, height: 2 },
    footprintByOrientation: {
      south: { width: 3, height: 2 },
      north: { width: 3, height: 2 },
      east: { width: 2, height: 3 },
      west: { width: 2, height: 3 },
    },
    sprites: {
      south: "/Building/christmas/3x2christmas_cafe_south.png",
      north: "/Building/christmas/3x2christmas_cafe_north.png",
      east: "/Building/christmas/2x3christmas_cafe_east.png",
      west: "/Building/christmas/2x3christmas_cafe_west.png",
    },
    icon: "☕",
    supportsRotation: true,
    isDecoration: true,
  },
  "christmas-cafe": {
    id: "christmas-cafe",
    name: "Christmas Cafe",
    category: "christmas",
    footprint: { width: 2, height: 2 },
    sprites: {
      south: "/Building/christmas/2x2christmas_cafe_s_south.png",
      north: "/Building/christmas/2x2christmas_cafe_s_north.png",
      east: "/Building/christmas/2x2christmas_cafe_s_east.png",
      west: "/Building/christmas/2x2christmas_cafe_s_west.png",
    },
    icon: "☕",
    supportsRotation: true,
    isDecoration: true,
  },
  "santas-workshop": {
    id: "santas-workshop",
    name: "Santa's Workshop",
    category: "christmas",
    footprint: { width: 4, height: 4 },
    sprites: {
      south: "/Building/christmas/4x4santas_workshop_south.png",
      north: "/Building/christmas/4x4santas_workshop_north.png",
      east: "/Building/christmas/4x4santas_workshop_east.png",
      west: "/Building/christmas/4x4santas_workshop_west.png",
    },
    icon: "🎅",
    supportsRotation: true,
    isDecoration: true,
  },
  "ice-skating-rink": {
    id: "ice-skating-rink",
    name: "Ice Skating Rink",
    category: "christmas",
    footprint: { width: 4, height: 4 },
    sprites: {
      south: "/Building/christmas/4x4ice_skating_rink_north.png",
      north: "/Building/christmas/4x4ice_skating_rink_south.png",
      east: "/Building/christmas/4x4ice_skating_rink_west.png",
      west: "/Building/christmas/4x4ice_skating_rink_east.png",
    },
    icon: "⛸️",
    supportsRotation: true,
    isDecoration: true,
  },
  "christmas-toy-store": {
    id: "christmas-toy-store",
    name: "Christmas Toy Store",
    category: "christmas",
    footprint: { width: 3, height: 2 },
    footprintByOrientation: {
      south: { width: 3, height: 2 },
      north: { width: 3, height: 2 },
      east: { width: 2, height: 3 },
      west: { width: 2, height: 3 },
    },
    sprites: {
      south: "/Building/christmas/3x2toy_store_south.png",
      north: "/Building/christmas/3x2toy_store_north.png",
      east: "/Building/christmas/2x3toy_store_east.png",
      west: "/Building/christmas/2x3toy_store_west.png",
    },
    icon: "🧸",
    supportsRotation: true,
  },
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
  popeyes: {
    id: "popeyes",
    name: "Popeyes",
    category: "commercial",
    footprint: { width: 2, height: 2 },
    sprites: {
      south: "/Building/commercial/2x2popeyes_south.png",
      north: "/Building/commercial/2x2popeyes_north.png",
      east: "/Building/commercial/2x2popeyes_east.png",
      west: "/Building/commercial/2x2popeyes_west.png",
    },
    icon: "🍗",
    supportsRotation: true,
  },
  dunkin: {
    id: "dunkin",
    name: "Dunkin",
    category: "commercial",
    footprint: { width: 2, height: 2 },
    sprites: {
      south: "/Building/commercial/2x2dunkin_south.png",
      north: "/Building/commercial/2x2dunkin_north.png",
      east: "/Building/commercial/2x2dunkin_east.png",
      west: "/Building/commercial/2x2dunkin_west.png",
    },
    icon: "🍩",
    supportsRotation: true,
  },
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
  "row-houses": {
    id: "row-houses",
    name: "Row Houses",
    category: "residential",
    footprint: { width: 3, height: 2 },
    footprintByOrientation: {
      south: { width: 3, height: 2 },
      north: { width: 3, height: 2 },
      east: { width: 2, height: 3 },
      west: { width: 2, height: 3 },
    },
    sprites: {
      south: "/Building/residential/3x2small_rowhouses_south.png",
      north: "/Building/residential/3x2small_rowhouses_north.png",
      east: "/Building/residential/2x3small_rowhouses_east.png",
      west: "/Building/residential/2x3small_rowhouses_west.png",
    },
    icon: "🏘️",
    supportsRotation: true,
  },
  bookstore: {
    id: "bookstore",
    name: "Bookstore",
    category: "commercial",
    footprint: { width: 4, height: 4 },
    sprites: {
      south: "/Building/commercial/4x4bookstore_south.png",
      north: "/Building/commercial/4x4bookstore_north.png",
      east: "/Building/commercial/4x4bookstore_east.png",
      west: "/Building/commercial/4x4bookstore_west.png",
    },
    icon: "📚",
    supportsRotation: true,
  },
  "medium-apartments": {
    id: "medium-apartments",
    name: "Medium Apartments",
    category: "residential",
    footprint: { width: 4, height: 4 },
    sprites: {
      south: "/Building/residential/4x4medium_apartments_south.png",
      north: "/Building/residential/4x4medium_apartments_north.png",
      east: "/Building/residential/4x4medium_apartments_east.png",
      west: "/Building/residential/4x4medium_apartments_west.png",
    },
    icon: "🏢",
    supportsRotation: true,
  },
  "modern-terra-condos": {
    id: "modern-terra-condos",
    name: "Modern Terra Condos",
    category: "residential",
    footprint: { width: 6, height: 5 },
    footprintByOrientation: {
      south: { width: 6, height: 5 },
      north: { width: 6, height: 5 },
      east: { width: 5, height: 6 },
      west: { width: 5, height: 6 },
    },
    sprites: {
      south: "/Building/residential/6x5modern_terracotta_condos_south.png",
      north: "/Building/residential/6x5modern_terracotta_condos_north.png",
      east: "/Building/residential/5x6modern_terracotta_condos_east.png",
      west: "/Building/residential/5x6modern_terracotta_condos_west.png",
    },
    icon: "🏢",
    supportsRotation: true,
  },
  "large-apartments-20s": {
    id: "large-apartments-20s",
    name: "20s Apartments",
    category: "residential",
    footprint: { width: 7, height: 7 },
    sprites: {
      south: "/Building/residential/7x7large_apartments_20s_south.png",
      north: "/Building/residential/7x7large_apartments_20s_north.png",
      east: "/Building/residential/7x7large_apartments_20s_east.png",
      west: "/Building/residential/7x7large_apartments_20s_west.png",
    },
    icon: "🏛️",
    supportsRotation: true,
  },
  "large-apartments-60s": {
    id: "large-apartments-60s",
    name: "60s Apartments",
    category: "residential",
    footprint: { width: 8, height: 7 },
    footprintByOrientation: {
      south: { width: 8, height: 7 },
      north: { width: 8, height: 7 },
      east: { width: 7, height: 8 },
      west: { width: 7, height: 8 },
    },
    sprites: {
      south: "/Building/residential/8x7large_apartments_60s_south.png",
      north: "/Building/residential/8x7large_apartments_60s_north.png",
      east: "/Building/residential/7x8large_apartments_60s_east.png",
      west: "/Building/residential/7x8large_apartments_60s_west.png",
    },
    icon: "🏬",
    supportsRotation: true,
  },
  "the-dakota": {
    id: "the-dakota",
    name: "The Dakota",
    category: "residential",
    footprint: { width: 8, height: 8 },
    sprites: {
      south: "/Building/residential/8x8the_dakota_south.png",
      north: "/Building/residential/8x8the_dakota_north.png",
      east: "/Building/residential/8x8the_dakota_east.png",
      west: "/Building/residential/8x8the_dakota_west.png",
    },
    icon: "🏛️",
    supportsRotation: true,
  },
  "martini-bar": {
    id: "martini-bar",
    name: "Martini Bar",
    category: "commercial",
    footprint: { width: 2, height: 2 },
    sprites: {
      south: "/Building/commercial/2x2martini_bar_south.png",
      north: "/Building/commercial/2x2martini_bar_north.png",
      east: "/Building/commercial/2x2martini_bar_east.png",
      west: "/Building/commercial/2x2martini_bar_west.png",
    },
    icon: "🍸",
    supportsRotation: true,
  },
  snowman: {
    id: "snowman",
    name: "Snowman",
    category: "christmas",
    footprint: { width: 1, height: 1 },
    sprites: {
      south: "/Props/1x1snowman_south.png",
      north: "/Props/1x1snowman_north.png",
      east: "/Props/1x1snowman_east.png",
      west: "/Props/1x1snowman_west.png",
    },
    icon: "⛄",
    supportsRotation: true,
    isDecoration: true,
  },
  "modern-bench": {
    id: "modern-bench",
    name: "Modern Bench",
    category: "props",
    footprint: { width: 1, height: 1 },
    sprites: {
      south: "/Props/1x1modern_bench_south.png",
      north: "/Props/1x1modern_bench_north.png",
      east: "/Props/1x1modern_bench_east.png",
      west: "/Props/1x1modern_bench_west.png",
    },
    icon: "🪑",
    supportsRotation: true,
    isDecoration: true,
  },
  "victorian-bench": {
    id: "victorian-bench",
    name: "Victorian Bench",
    category: "props",
    footprint: { width: 1, height: 1 },
    sprites: {
      south: "/Props/1x1victorian_bench_south.png",
      north: "/Props/1x1victorian_bench_north.png",
      east: "/Props/1x1victorian_bench_east.png",
      west: "/Props/1x1victorian_bench_west.png",
    },
    icon: "🛋️",
    supportsRotation: true,
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
  // New residential buildings
  "yellow-apartments": {
    id: "yellow-apartments",
    name: "Yellow Apartments",
    category: "residential",
    footprint: { width: 2, height: 2 },
    sprites: {
      south: "/Building/residential/2x2yellow_apartments_south.png",
      north: "/Building/residential/2x2yellow_apartments_north.png",
      east: "/Building/residential/2x2yellow_apartments_east.png",
      west: "/Building/residential/2x2yellow_apartments_west.png",
    },
    icon: "🏢",
    supportsRotation: true,
  },
  "english-townhouse": {
    id: "english-townhouse",
    name: "English Townhouse",
    category: "residential",
    footprint: { width: 2, height: 2 },
    sprites: {
      south: "/Building/residential/2x2english_townhouse_south.png",
      north: "/Building/residential/2x2english_townhouse_north.png",
      east: "/Building/residential/2x2english_townhouse_east.png",
      west: "/Building/residential/2x2english_townhouse_west.png",
    },
    icon: "🏘️",
    supportsRotation: true,
  },
  brownstone: {
    id: "brownstone",
    name: "Brownstone",
    category: "residential",
    footprint: { width: 2, height: 3 },
    footprintByOrientation: {
      south: { width: 2, height: 3 },
      north: { width: 2, height: 3 },
      east: { width: 3, height: 2 },
      west: { width: 3, height: 2 },
    },
    sprites: {
      south: "/Building/residential/2x3brownstone_south.png",
      north: "/Building/residential/2x3brownstone_north.png",
      east: "/Building/residential/3x2brownstone_east.png",
      west: "/Building/residential/3x2brownstone_west.png",
    },
    icon: "🏠",
    supportsRotation: true,
  },
  "leafy-apartments": {
    id: "leafy-apartments",
    name: "Leafy Apartments",
    category: "residential",
    footprint: { width: 3, height: 2 },
    footprintByOrientation: {
      south: { width: 3, height: 2 },
      north: { width: 3, height: 2 },
      east: { width: 2, height: 3 },
      west: { width: 2, height: 3 },
    },
    sprites: {
      south: "/Building/residential/3x2leafy_apartments_south.png",
      north: "/Building/residential/3x2leafy_apartments_north.png",
      east: "/Building/residential/2x3leafy_apartments_east.png",
      west: "/Building/residential/2x3leafy_apartments_west.png",
    },
    icon: "🏢",
    supportsRotation: true,
  },
  "gothic-apartments": {
    id: "gothic-apartments",
    name: "Gothic Apartments",
    category: "residential",
    footprint: { width: 6, height: 6 },
    sprites: {
      south: "/Building/residential/6x6gothic_apartments_south.png",
      north: "/Building/residential/6x6gothic_apartments_north.png",
      east: "/Building/residential/6x6gothic_apartments_east.png",
      west: "/Building/residential/6x6gothic_apartments_west.png",
    },
    icon: "🏛️",
    supportsRotation: true,
  },
  "alternate-brownstone": {
    id: "alternate-brownstone",
    name: "Alternate Brownstone",
    category: "residential",
    footprint: { width: 2, height: 4 },
    footprintByOrientation: {
      south: { width: 2, height: 4 },
      north: { width: 2, height: 4 },
      east: { width: 4, height: 2 },
      west: { width: 4, height: 2 },
    },
    sprites: {
      south: "/Building/residential/2x4alternate_brownstone_south.png",
      north: "/Building/residential/2x4alternate_brownstone_north.png",
      east: "/Building/residential/4x2alternate_brownstone_east.png",
      west: "/Building/residential/4x2alternate_brownstone_west.png",
    },
    icon: "🏠",
    supportsRotation: true,
  },
  "strange-townhouse": {
    id: "strange-townhouse",
    name: "Strange Townhouse",
    category: "residential",
    footprint: { width: 2, height: 2 },
    sprites: {
      south: "/Building/residential/2x2strange_townhouse_south.png",
      north: "/Building/residential/2x2strange_townhouse_north.png",
      east: "/Building/residential/2x2strange_townhouse_east.png",
      west: "/Building/residential/2x2strange_townhouse_west.png",
    },
    icon: "🏘️",
    supportsRotation: true,
  },
  "romanesque-townhouse": {
    id: "romanesque-townhouse",
    name: "Romanesque Townhouse",
    category: "residential",
    footprint: { width: 2, height: 3 },
    footprintByOrientation: {
      south: { width: 2, height: 3 },
      north: { width: 2, height: 3 },
      east: { width: 3, height: 2 },
      west: { width: 3, height: 2 },
    },
    sprites: {
      south: "/Building/residential/2x3romanesque_townhouse_south.png",
      north: "/Building/residential/2x3romanesque_townhouse_north.png",
      east: "/Building/residential/3x2romanesque_townhouse_east.png",
      west: "/Building/residential/3x2romanesque_townhouse_west.png",
    },
    icon: "🏘️",
    supportsRotation: true,
  },
  "romanesque-duplex": {
    id: "romanesque-duplex",
    name: "Romanesque Duplex",
    category: "residential",
    footprint: { width: 3, height: 3 },
    sprites: {
      south: "/Building/residential/3x3romanesque_duplex_south.png",
      north: "/Building/residential/3x3romanesque_duplex_north.png",
      east: "/Building/residential/3x3romanesque_duplex_east.png",
      west: "/Building/residential/3x3romanesque_duplex_west.png",
    },
    icon: "🏘️",
    supportsRotation: true,
  },
  "romanesque-2": {
    id: "romanesque-2",
    name: "Romanesque Townhouse 2",
    category: "residential",
    footprint: { width: 2, height: 2 },
    sprites: {
      south: "/Building/residential/2x2romanesque_2_south.png",
      north: "/Building/residential/2x2romanesque_2_north.png",
      east: "/Building/residential/2x2romanesque_2_east.png",
      west: "/Building/residential/2x2romanesque_2_west.png",
    },
    icon: "🏠",
    supportsRotation: true,
  },
  "romanesque-3": {
    id: "romanesque-3",
    name: "Romanesque Townhouse 3",
    category: "residential",
    footprint: { width: 2, height: 2 },
    sprites: {
      south: "/Building/residential/2x2romanesque_3_south.png",
      north: "/Building/residential/2x2romanesque_3_north.png",
      east: "/Building/residential/2x2romanesque_3_east.png",
      west: "/Building/residential/2x2romanesque_3_west.png",
    },
    icon: "🏡",
    supportsRotation: true,
  },
  "limestone-duplex": {
    id: "limestone-duplex",
    name: "Limestone Duplex",
    category: "residential",
    footprint: { width: 3, height: 3 },
    sprites: {
      south: "/Building/residential/3x3limestones_south.png",
      north: "/Building/residential/3x3limestones_north.png",
      east: "/Building/residential/3x3limestones_east.png",
      west: "/Building/residential/3x3limestones_west.png",
    },
    icon: "🏠",
    supportsRotation: true,
  },
  limestone: {
    id: "limestone",
    name: "Limestone",
    category: "residential",
    footprint: { width: 2, height: 2 },
    sprites: {
      south: "/Building/residential/2x2limestone_south.png",
      north: "/Building/residential/2x2limestone_north.png",
      east: "/Building/residential/2x2limestone_east.png",
      west: "/Building/residential/2x2limestone_west.png",
    },
    icon: "🏛️",
    supportsRotation: true,
  },
  "sf-victorian": {
    id: "sf-victorian",
    name: "SF Victorian",
    category: "residential",
    footprint: { width: 2, height: 3 },
    footprintByOrientation: {
      south: { width: 2, height: 3 },
      north: { width: 2, height: 3 },
      east: { width: 3, height: 2 },
      west: { width: 3, height: 2 },
    },
    sprites: {
      south: "/Building/residential/2x3sf_victorian_south.png",
      north: "/Building/residential/2x3sf_victorian_north.png",
      east: "/Building/residential/3x2sf_victorian_east.png",
      west: "/Building/residential/3x2sf_victorian_west.png",
    },
    icon: "🏠",
    supportsRotation: true,
  },
  "sf-victorian-2": {
    id: "sf-victorian-2",
    name: "SF Victorian 2",
    category: "residential",
    footprint: { width: 2, height: 3 },
    footprintByOrientation: {
      south: { width: 2, height: 3 },
      north: { width: 2, height: 3 },
      east: { width: 3, height: 2 },
      west: { width: 3, height: 2 },
    },
    sprites: {
      south: "/Building/residential/2x3sf_victorian_2_south.png",
      north: "/Building/residential/2x3sf_victorian_2_north.png",
      east: "/Building/residential/3x2sf_victorian_2_east.png",
      west: "/Building/residential/3x2sf_victorian_2_west.png",
    },
    icon: "🏡",
    supportsRotation: true,
  },
  "sf-yellow-painted-lady": {
    id: "sf-yellow-painted-lady",
    name: "SF Yellow Painted Lady",
    category: "residential",
    footprint: { width: 2, height: 4 },
    footprintByOrientation: {
      south: { width: 2, height: 4 },
      north: { width: 2, height: 4 },
      east: { width: 4, height: 2 },
      west: { width: 4, height: 2 },
    },
    sprites: {
      south: "/Building/residential/2x4sf_yellow_painted_lady_south.png",
      north: "/Building/residential/2x4sf_yellow_painted_lady_north.png",
      east: "/Building/residential/4x2sf_yellow_painted_lady_east.png",
      west: "/Building/residential/4x2sf_yellow_painted_lady_west.png",
    },
    icon: "🏠",
    supportsRotation: true,
  },
  "sf-duplex": {
    id: "sf-duplex",
    name: "SF Duplex",
    category: "residential",
    footprint: { width: 3, height: 4 },
    footprintByOrientation: {
      south: { width: 3, height: 4 },
      north: { width: 3, height: 4 },
      east: { width: 4, height: 3 },
      west: { width: 4, height: 3 },
    },
    sprites: {
      south: "/Building/residential/3x4sf_duplex_north.png",
      north: "/Building/residential/3x4sf_duplex_south.png",
      east: "/Building/residential/4x3sf_duplex_west.png",
      west: "/Building/residential/4x3sf_duplex_east.png",
    },
    icon: "🏘️",
    supportsRotation: true,
  },
  "blue-painted-lady": {
    id: "blue-painted-lady",
    name: "Blue Painted Lady",
    category: "residential",
    footprint: { width: 2, height: 3 },
    footprintByOrientation: {
      south: { width: 2, height: 3 },
      north: { width: 2, height: 3 },
      east: { width: 3, height: 2 },
      west: { width: 3, height: 2 },
    },
    sprites: {
      south: "/Building/residential/2x3blue_painted_lady_south.png",
      north: "/Building/residential/2x3blue_painted_lady_north.png",
      east: "/Building/residential/3x2blue_painted_lady_east.png",
      west: "/Building/residential/3x2blue_painted_lady_west.png",
    },
    icon: "🏠",
    supportsRotation: true,
  },
  "full-house": {
    id: "full-house",
    name: "Full House",
    category: "residential",
    footprint: { width: 2, height: 3 },
    footprintByOrientation: {
      south: { width: 2, height: 3 },
      north: { width: 2, height: 3 },
      east: { width: 3, height: 2 },
      west: { width: 3, height: 2 },
    },
    sprites: {
      south: "/Building/residential/2x3full_house_house_south.png",
      north: "/Building/residential/2x3full_house_house_north.png",
      east: "/Building/residential/3x2full_house_house_east.png",
      west: "/Building/residential/3x2full_house_house_west.png",
    },
    icon: "🏡",
    supportsRotation: true,
  },
  "sf-green-apartments": {
    id: "sf-green-apartments",
    name: "SF Green Apartments",
    category: "residential",
    footprint: { width: 2, height: 2 },
    sprites: {
      south: "/Building/residential/2x2sf_green_apartments_south.png",
      north: "/Building/residential/2x2sf_green_apartments_north.png",
      east: "/Building/residential/2x2sf_green_apartments_east.png",
      west: "/Building/residential/2x2sf_green_apartments_west.png",
    },
    icon: "🏢",
    supportsRotation: true,
  },
  "sf-blue-duplex": {
    id: "sf-blue-duplex",
    name: "SF Blue Duplex",
    category: "residential",
    footprint: { width: 2, height: 4 },
    footprintByOrientation: {
      south: { width: 2, height: 4 },
      north: { width: 2, height: 4 },
      east: { width: 4, height: 2 },
      west: { width: 4, height: 2 },
    },
    sprites: {
      south: "/Building/residential/2x4sf_blue_duplex_south.png",
      north: "/Building/residential/2x4sf_blue_duplex_north.png",
      east: "/Building/residential/4x2sf_blue_duplex_east.png",
      west: "/Building/residential/4x2sf_blue_duplex_west.png",
    },
    icon: "🏘️",
    supportsRotation: true,
  },
  "sf-marina-house": {
    id: "sf-marina-house",
    name: "SF Marina House",
    category: "residential",
    footprint: { width: 2, height: 2 },
    sprites: {
      south: "/Building/residential/2x2sf_marina_house_south.png",
      north: "/Building/residential/2x2sf_marina_house_north.png",
      east: "/Building/residential/2x2sf_marina_house_east.png",
      west: "/Building/residential/2x2sf_marina_house_west.png",
    },
    icon: "🏠",
    supportsRotation: true,
  },
  "sf-green-victorian-apartments": {
    id: "sf-green-victorian-apartments",
    name: "SF Green Victorian Apartments",
    category: "residential",
    footprint: { width: 2, height: 5 },
    footprintByOrientation: {
      south: { width: 2, height: 5 },
      north: { width: 2, height: 5 },
      east: { width: 5, height: 2 },
      west: { width: 5, height: 2 },
    },
    sprites: {
      south: "/Building/residential/2x5sf_green_victorian_apartments_south.png",
      north: "/Building/residential/2x5sf_green_victorian_apartments_north.png",
      east: "/Building/residential/5x2sf_green_victorian_apartments_east.png",
      west: "/Building/residential/5x2sf_green_victorian_apartments_west.png",
    },
    icon: "🏢",
    supportsRotation: true,
  },
  "sf-yellow-victorian-apartments": {
    id: "sf-yellow-victorian-apartments",
    name: "SF Yellow Victorian Apartments",
    category: "residential",
    footprint: { width: 2, height: 3 },
    footprintByOrientation: {
      south: { width: 2, height: 3 },
      north: { width: 2, height: 3 },
      east: { width: 3, height: 2 },
      west: { width: 3, height: 2 },
    },
    sprites: {
      south:
        "/Building/residential/2x3sf_yellow_victorian_apartments_south.png",
      north:
        "/Building/residential/2x3sf_yellow_victorian_apartments_north.png",
      east: "/Building/residential/3x2sf_yellow_victorian_apartments_east.png",
      west: "/Building/residential/3x2sf_yellow_victorian_apartments_west.png",
    },
    icon: "🏢",
    supportsRotation: true,
  },
  // New commercial buildings
  "magicpath-office": {
    id: "magicpath-office",
    name: "MagicPath Office",
    category: "commercial",
    footprint: { width: 6, height: 6 },
    sprites: {
      south: "/Building/commercial/6x6magicpath_office_south.png",
      north: "/Building/commercial/6x6magicpath_office_north.png",
      east: "/Building/commercial/6x6magicpath_office_east.png",
      west: "/Building/commercial/6x6magicpath_office_west.png",
    },
    icon: "🏢",
    supportsRotation: true,
  },
  "promptlayer-office": {
    id: "promptlayer-office",
    name: "PromptLayer Office",
    category: "commercial",
    footprint: { width: 2, height: 3 },
    footprintByOrientation: {
      south: { width: 2, height: 3 },
      north: { width: 2, height: 3 },
      east: { width: 3, height: 2 },
      west: { width: 3, height: 2 },
    },
    sprites: {
      south: "/Building/commercial/2x3promptlayer_office_south.png",
      north: "/Building/commercial/2x3promptlayer_office_north.png",
      east: "/Building/commercial/3x2promptlayer_office_east.png",
      west: "/Building/commercial/3x2promptlayer_office_west.png",
    },
    icon: "🏢",
    supportsRotation: true,
  },
  "general-intelligence-office": {
    id: "general-intelligence-office",
    name: "General Intelligence Office",
    category: "commercial",
    footprint: { width: 3, height: 4 },
    footprintByOrientation: {
      south: { width: 4, height: 3 },
      north: { width: 4, height: 3 },
      east: { width: 3, height: 4 },
      west: { width: 3, height: 4 },
    },
    sprites: {
      south: "/Building/commercial/4x3general_intelligence_office_south.png",
      north: "/Building/commercial/4x3general_intelligence_office_north.png",
      east: "/Building/commercial/3x4general_intelligence_office_east.png",
      west: "/Building/commercial/3x4general_intelligence_office_west.png",
    },
    icon: "🏢",
    supportsRotation: true,
  },
  "ease-health": {
    id: "ease-health",
    name: "Ease Health",
    category: "commercial",
    footprint: { width: 3, height: 6 },
    footprintByOrientation: {
      south: { width: 3, height: 6 },
      north: { width: 3, height: 6 },
      east: { width: 6, height: 3 },
      west: { width: 6, height: 3 },
    },
    sprites: {
      south: "/Building/commercial/3x6ease_health_south.png",
      north: "/Building/commercial/3x6ease_health_north.png",
      east: "/Building/commercial/6x3ease_health_east.png",
      west: "/Building/commercial/6x3ease_health_west.png",
    },
    icon: "🏥",
    supportsRotation: true,
  },
  // New civic/landmark buildings
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
  "schwab-mansion": {
    id: "schwab-mansion",
    name: "Schwab Mansion",
    category: "landmark",
    footprint: { width: 6, height: 8 },
    footprintByOrientation: {
      south: { width: 6, height: 8 },
      north: { width: 6, height: 8 },
      east: { width: 8, height: 6 },
      west: { width: 8, height: 6 },
    },
    sprites: {
      south: "/Building/landmark/6x8schwab_mansion_south.png",
      north: "/Building/landmark/6x8schwab_mansion_north.png",
      east: "/Building/landmark/8x6schwab_mansion_east.png",
      west: "/Building/landmark/8x6schwab_mansion_west.png",
    },
    icon: "🏛️",
    supportsRotation: true,
    isDecoration: true,
  },
  "carnegie-mansion": {
    id: "carnegie-mansion",
    name: "Carnegie Mansion",
    category: "landmark",
    footprint: { width: 6, height: 3 },
    footprintByOrientation: {
      south: { width: 6, height: 3 },
      north: { width: 6, height: 3 },
      east: { width: 3, height: 6 },
      west: { width: 3, height: 6 },
    },
    sprites: {
      south: "/Building/landmark/6x3carnagie_mansion_south.png",
      north: "/Building/landmark/6x3carnagie_mansion_north.png",
      east: "/Building/landmark/3x6carnagie_mansion_east.png",
      west: "/Building/landmark/3x6carnagie_mansion_west.png",
    },
    icon: "🏛️",
    supportsRotation: true,
  },
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
  "mushroom-kingdom-castle": {
    id: "mushroom-kingdom-castle",
    name: "Mushroom Kingdom Castle",
    category: "landmark",
    footprint: { width: 6, height: 5 },
    footprintByOrientation: {
      south: { width: 6, height: 5 },
      north: { width: 6, height: 5 },
      east: { width: 5, height: 6 },
      west: { width: 5, height: 6 },
    },
    sprites: {
      south: "/Building/landmark/6x5mushroom_kingdom_castle_south.png",
      north: "/Building/landmark/6x5mushroom_kingdom_castle_north.png",
      east: "/Building/landmark/5x6mushroom_kingdom_castle_east.png",
      west: "/Building/landmark/5x6mushroom_kingdom_castle_west.png",
    },
    icon: "🏰",
    supportsRotation: true,
    isDecoration: true,
  },
  "internet-archive": {
    id: "internet-archive",
    name: "Internet Archive",
    category: "landmark",
    footprint: { width: 6, height: 6 },
    sprites: {
      south: "/Building/landmark/6x6internet_archive_south.png",
      north: "/Building/landmark/6x6internet_archive_north.png",
      east: "/Building/landmark/6x6internet_archive_east.png",
      west: "/Building/landmark/6x6internet_archive_west.png",
    },
    icon: "📚",
    supportsRotation: true,
  },
  "palo-alto-office-center": {
    id: "palo-alto-office-center",
    name: "Palo Alto Office Center",
    category: "commercial",
    footprint: { width: 6, height: 5 },
    footprintByOrientation: {
      south: { width: 6, height: 5 },
      north: { width: 6, height: 5 },
      east: { width: 5, height: 6 },
      west: { width: 5, height: 6 },
    },
    sprites: {
      south: "/Building/commercial/6x5palo_alto_office_center_south.png",
      north: "/Building/commercial/6x5palo_alto_office_center_north.png",
      east: "/Building/commercial/5x6palo_alto_office_center_east.png",
      west: "/Building/commercial/5x6palo_alto_office_center_west.png",
    },
    icon: "🏢",
    supportsRotation: true,
  },
  "hp-house": {
    id: "hp-house",
    name: "HP House",
    category: "landmark",
    footprint: { width: 4, height: 4 },
    sprites: {
      south: "/Building/landmark/4x4hp_house_south.png",
      north: "/Building/landmark/4x4hp_house_north.png",
      east: "/Building/landmark/4x4hp_house_east.png",
      west: "/Building/landmark/4x4hp_house_west.png",
    },
    icon: "🏠",
    supportsRotation: true,
    isDecoration: true,
  },
  "palo-alto-wide-office": {
    id: "palo-alto-wide-office",
    name: "Palo Alto Wide Office",
    category: "commercial",
    footprint: { width: 6, height: 8 },
    footprintByOrientation: {
      south: { width: 6, height: 8 },
      north: { width: 6, height: 8 },
      east: { width: 8, height: 6 },
      west: { width: 8, height: 6 },
    },
    sprites: {
      south: "/Building/commercial/6x8palo_alto_wide_office_south.png",
      north: "/Building/commercial/6x8palo_alto_wide_office_north.png",
      east: "/Building/commercial/8x6palo_alto_wide_office_east.png",
      west: "/Building/commercial/8x6palo_alto_wide_office_west.png",
    },
    icon: "🏬",
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
