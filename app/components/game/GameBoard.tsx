"use client";

/**
 * GRID MUTATION PATTERN
 * =====================
 *
 * The grid uses a mutable ref pattern for O(1) updates instead of immutable
 * state copies. This is critical for performance with 128x128 (16,384) cells.
 *
 * HOW IT WORKS:
 * 1. gridRef.current holds the actual grid data (mutated directly)
 * 2. gridVersion (from useReducer) triggers React re-renders
 * 3. markTilesDirty() tells Phaser which tiles changed
 *
 * WHEN ADDING NEW FEATURES (buildings, construction, abandonment, etc.):
 *
 * 1. Create a dirtyTiles array at the start of your handler:
 *    const dirtyTiles: Array<{ x: number; y: number }> = [];
 *
 * 2. When you mutate a cell, push its coordinates:
 *    grid[y][x].type = TileType.Building;
 *    dirtyTiles.push({ x, y });
 *
 * 3. After all mutations, notify Phaser and trigger re-render:
 *    if (dirtyTiles.length > 0) {
 *      phaserGameRef.current?.markTilesDirty(dirtyTiles);
 *    }
 *    forceGridUpdate();
 *
 * WHY THIS MATTERS:
 * - Without markTilesDirty(), Phaser won't know which tiles to redraw
 * - Without forceGridUpdate(), React won't re-render
 * - The old pattern copied all 16,384 cells on every change (700ms delay!)
 *
 * EXAMPLES IN THIS FILE:
 * - handleTileClick: Single tile/building placement
 * - handleTilesDrag: Batch tile placement (snow/tile/asphalt)
 * - handleRoadDrag: Road segment placement with neighbor updates
 * - performDeletion: Bulk deletion with building/road cleanup
 * - handleLoadGame: Full grid replacement (marks ALL tiles dirty)
 */

import { useState, useEffect, useCallback, useRef, useReducer } from "react";
import {
  TileType,
  ToolType,
  GridCell,
  Direction,
  LightingType,
  GRID_WIDTH,
  GRID_HEIGHT,
} from "./types";
import {
  ROAD_LANE_SIZE,
  getRoadLaneOrigin,
  hasRoadLane,
  canPlaceRoadLane,
  updateDeadEnds,
  isRoadTileType,
} from "./roadUtils";
import { getBuilding, getBuildingFootprint, getPropSlots } from "@/app/data/buildings";
import dynamic from "next/dynamic";
import type { PhaserGameHandle } from "./phaser/PhaserGame";
import {
  playDestructionSound,
  playBuildSound,
  playBuildRoadSound,
  playOpenSound,
  playDoubleClickSound,
} from "@/app/utils/sounds";

// Dynamically import PhaserGame (no SSR - Phaser needs browser APIs)
const PhaserGame = dynamic(() => import("./phaser/PhaserGame"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        color: "white",
        fontSize: 18,
      }}
    >
      Loading game...
    </div>
  ),
});

import ToolWindow from "../ui/ToolWindow";
import MusicPlayer from "../ui/MusicPlayer";
import DebugWindow, { VisualSettings } from "../ui/DebugWindow";
import LoadWindow from "../ui/LoadWindow";
import Modal from "../ui/Modal";
import PromptModal from "../ui/PromptModal";

// Initialize empty grid
const createEmptyGrid = (): GridCell[][] => {
  return Array.from({ length: GRID_HEIGHT }, (_, y) =>
    Array.from({ length: GRID_WIDTH }, (_, x) => ({
      type: TileType.Grass,
      x,
      y,
      isOrigin: true,
    }))
  );
};

// Migrate old saves to new grid size (backwards compatibility)
const migrateGrid = (oldGrid: GridCell[][]): GridCell[][] => {
  const oldHeight = oldGrid.length;
  const oldWidth = oldGrid[0]?.length || 0;

  // If already correct size, return as-is
  if (oldHeight === GRID_HEIGHT && oldWidth === GRID_WIDTH) {
    return oldGrid;
  }

  console.log(`Migrating grid from ${oldWidth}x${oldHeight} to ${GRID_WIDTH}x${GRID_HEIGHT}`);

  // Create new empty grid
  const newGrid = createEmptyGrid();

  // Calculate offset to place old grid in corner (0,0)
  // Could center it instead: Math.floor((GRID_WIDTH - oldWidth) / 2)
  const offsetX = 0;
  const offsetY = 0;

  // Copy old grid data into new grid
  for (let y = 0; y < oldHeight && y + offsetY < GRID_HEIGHT; y++) {
    for (let x = 0; x < oldWidth && x + offsetX < GRID_WIDTH; x++) {
      const oldCell = oldGrid[y][x];
      const newX = x + offsetX;
      const newY = y + offsetY;

      // Copy cell data, updating coordinates
      newGrid[newY][newX] = {
        ...oldCell,
        x: newX,
        y: newY,
        // Update origin references for buildings
        originX: oldCell.originX !== undefined ? oldCell.originX + offsetX : undefined,
        originY: oldCell.originY !== undefined ? oldCell.originY + offsetY : undefined,
      };
    }
  }

  return newGrid;
};

// Discrete zoom levels matching the button zoom levels
const ZOOM_LEVELS = [0.25, 0.5, 1, 2, 4];
const SCROLL_THRESHOLD = 100; // Amount of scroll needed to change zoom level

// Helper function to find closest zoom level index
const findClosestZoomIndex = (zoomValue: number): number => {
  let closestIndex = 0;
  let minDiff = Math.abs(zoomValue - ZOOM_LEVELS[0]);
  for (let i = 1; i < ZOOM_LEVELS.length; i++) {
    const diff = Math.abs(zoomValue - ZOOM_LEVELS[i]);
    if (diff < minDiff) {
      minDiff = diff;
      closestIndex = i;
    }
  }
  return closestIndex;
};

export default function GameBoard() {
  // Grid stored in ref for O(1) mutations (no copy on every change)
  const gridRef = useRef<GridCell[][]>(createEmptyGrid());
  // Force re-render when grid changes (cheap - just increments a number)
  // gridVersion is passed to PhaserGame so it knows when to update
  const [gridVersion, forceGridUpdate] = useReducer((x) => x + 1, 0);
  // Convenience getter for the grid
  const grid = gridRef.current;

  // UI state
  const [selectedTool, setSelectedTool] = useState<ToolType>(ToolType.None);
  const [zoom, setZoom] = useState(1);
  const [debugPaths, setDebugPaths] = useState(false);
  const [showStats, setShowStats] = useState(true);
  const [isToolWindowVisible, setIsToolWindowVisible] = useState(false);
  const [buildingOrientation, setBuildingOrientation] = useState<Direction>(
    Direction.Down
  );
  const [isPlayerDriving, setIsPlayerDriving] = useState(false);
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(
    null
  );
  const [isDebugWindowVisible, setIsDebugWindowVisible] = useState(false);
  const [isLoadWindowVisible, setIsLoadWindowVisible] = useState(false);
  const [modalState, setModalState] = useState<{
    isVisible: boolean;
    title: string;
    message: string;
    showCancel?: boolean;
    onConfirm?: (() => void) | null;
  }>({
    isVisible: false,
    title: "",
    message: "",
    showCancel: false,
    onConfirm: null,
  });
  const [promptState, setPromptState] = useState<{
    isVisible: boolean;
    title: string;
    message: string;
    defaultValue: string;
    onConfirm: ((value: string) => void) | null;
  }>({
    isVisible: false,
    title: "",
    message: "",
    defaultValue: "",
    onConfirm: null,
  });
  const [visualSettings, setVisualSettings] = useState<VisualSettings>({
    blueness: 0,
    contrast: 1.0,
    saturation: 1.0,
    brightness: 1.0,
  });

  // Mobile warning state
  const [isMobile, setIsMobile] = useState(false);
  const [mobileWarningDismissed, setMobileWarningDismissed] = useState(false);

  // Detect mobile device
  useEffect(() => {
    const checkMobile = () => {
      const isTouchDevice =
        "ontouchstart" in window || navigator.maxTouchPoints > 0;
      const isSmallScreen = window.innerWidth < 768;
      setIsMobile(isTouchDevice || isSmallScreen);
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Ref to Phaser game for spawning entities
  const phaserGameRef = useRef<PhaserGameHandle>(null);

  // Ref to track accumulated scroll delta for zoom
  const scrollAccumulatorRef = useRef(0);
  const scrollDirectionRef = useRef<number | null>(null); // Track scroll direction: positive = down, negative = up

  // Reset building orientation to south when switching buildings
  useEffect(() => {
    if (selectedBuildingId) {
      const building = getBuilding(selectedBuildingId);
      if (building?.supportsRotation) {
        setBuildingOrientation(Direction.Down);
      }
    }
  }, [selectedBuildingId]);

  // Handle keyboard rotation for buildings
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle rotation if user is typing in an input field
      const activeElement = document.activeElement;
      const isTyping =
        activeElement &&
        (activeElement.tagName === "INPUT" ||
          activeElement.tagName === "TEXTAREA" ||
          (activeElement as HTMLElement)?.isContentEditable);

      if (isTyping) {
        return;
      }

      if (selectedTool === ToolType.Building && selectedBuildingId) {
        const building = getBuilding(selectedBuildingId);
        if (building?.supportsRotation && (e.key === "r" || e.key === "R")) {
          e.preventDefault();
          setBuildingOrientation((prev) => {
            switch (prev) {
              case Direction.Down:
                return Direction.Right;
              case Direction.Right:
                return Direction.Up;
              case Direction.Up:
                return Direction.Left;
              case Direction.Left:
                return Direction.Down;
              default:
                return Direction.Down;
            }
          });
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedTool, selectedBuildingId]);

  // Handle ESC key to deselect tool
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle ESC if user is typing in an input field
      const activeElement = document.activeElement;
      const isTyping =
        activeElement &&
        (activeElement.tagName === "INPUT" ||
          activeElement.tagName === "TEXTAREA" ||
          (activeElement as HTMLElement)?.isContentEditable);

      if (isTyping) {
        return;
      }

      if (e.key === "Escape") {
        if (selectedTool !== ToolType.None) {
          setSelectedTool(ToolType.None);
        }
        // Close tool window if it's open
        if (isToolWindowVisible) {
          setIsToolWindowVisible(false);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedTool, isToolWindowVisible]);

  // Sync driving state with Phaser
  useEffect(() => {
    if (phaserGameRef.current) {
      phaserGameRef.current.setDrivingState(isPlayerDriving);
    }
  }, [isPlayerDriving]);

  // Handle tile click (grid modifications)
  const handleTileClick = useCallback(
    (x: number, y: number) => {
      // Direct mutation - no more O(n²) copy!
      const grid = gridRef.current;
      const dirtyTiles: Array<{ x: number; y: number }> = [];

      switch (selectedTool) {
          case ToolType.None: {
            break;
          }
          case ToolType.RoadLane: {
            // Road lanes are placed via drag callback (handleRoadLaneDrag)
            // Single-click placement also uses drag callback with single lane
            break;
          }
          case ToolType.Tile: {
            if (x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT) {
              const cell = grid[y][x];
              if (cell.type === TileType.Building && cell.buildingId) {
                // Can place tile below any building
                grid[y][x].underlyingTileType = TileType.Tile;
                dirtyTiles.push({ x, y });
              } else if (
                cell.type === TileType.Grass ||
                cell.type === TileType.Snow ||
                cell.type === TileType.Cobblestone
              ) {
                grid[y][x].type = TileType.Tile;
                grid[y][x].isOrigin = true;
                grid[y][x].originX = x;
                grid[y][x].originY = y;
                dirtyTiles.push({ x, y });
              } else {
                break;
              }
              playBuildRoadSound();
            }
            break;
          }
          case ToolType.Asphalt: {
            if (x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT) {
              const cell = grid[y][x];
              if (cell.type === TileType.Building && cell.buildingId) {
                // Can place asphalt below any building
                grid[y][x].underlyingTileType = TileType.Asphalt;
                dirtyTiles.push({ x, y });
              } else if (
                cell.type === TileType.Grass ||
                cell.type === TileType.Snow ||
                cell.type === TileType.Tile ||
                cell.type === TileType.Cobblestone
              ) {
                grid[y][x].type = TileType.Asphalt;
                grid[y][x].isOrigin = true;
                grid[y][x].originX = x;
                grid[y][x].originY = y;
                dirtyTiles.push({ x, y });
              } else {
                break;
              }
              playBuildRoadSound();
            }
            break;
          }
          case ToolType.Snow: {
            if (x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT) {
              const cell = grid[y][x];
              if (cell.type === TileType.Building && cell.buildingId) {
                // Can place snow below any building
                grid[y][x].underlyingTileType = TileType.Snow;
                dirtyTiles.push({ x, y });
              } else if (
                cell.type === TileType.Grass ||
                cell.type === TileType.Tile ||
                cell.type === TileType.Cobblestone
              ) {
                grid[y][x].type = TileType.Snow;
                grid[y][x].isOrigin = true;
                grid[y][x].originX = x;
                grid[y][x].originY = y;
                dirtyTiles.push({ x, y });
              } else {
                break;
              }
              playBuildRoadSound();
            }
            break;
          }
          case ToolType.Cobblestone: {
            if (x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT) {
              const cell = grid[y][x];
              if (cell.type === TileType.Building && cell.buildingId) {
                // Can place cobblestone below any building
                grid[y][x].underlyingTileType = TileType.Cobblestone;
                dirtyTiles.push({ x, y });
              } else if (
                cell.type === TileType.Grass ||
                cell.type === TileType.Snow ||
                cell.type === TileType.Tile ||
                cell.type === TileType.Sidewalk ||
                cell.type === TileType.Asphalt
              ) {
                grid[y][x].type = TileType.Cobblestone;
                grid[y][x].isOrigin = true;
                grid[y][x].originX = x;
                grid[y][x].originY = y;
                dirtyTiles.push({ x, y });
              } else {
                break;
              }
              playBuildRoadSound();
            }
            break;
          }
          case ToolType.Building: {
            if (!selectedBuildingId) break;

            const building = getBuilding(selectedBuildingId);
            if (!building) break;

            // Get footprint based on current orientation
            const footprint = getBuildingFootprint(
              building,
              buildingOrientation
            );
            const bOriginX = x - footprint.width + 1;
            const bOriginY = y - footprint.height + 1;

            if (
              bOriginX < 0 ||
              bOriginY < 0 ||
              bOriginX + footprint.width > GRID_WIDTH ||
              bOriginY + footprint.height > GRID_HEIGHT
            ) {
              break;
            }

            const isDecoration =
              building.category === "props" || building.isDecoration;
            let buildingHasCollision = false;
            let placingOnPropSlot = false; // Track if placing on building's prop slot

            for (
              let dy = 0;
              dy < footprint.height && !buildingHasCollision;
              dy++
            ) {
              for (
                let dx = 0;
                dx < footprint.width && !buildingHasCollision;
                dx++
              ) {
                const px = bOriginX + dx;
                const py = bOriginY + dy;
                if (px < GRID_WIDTH && py < GRID_HEIGHT) {
                  const cell = grid[py][px];
                  const cellType = cell.type;
                  if (isDecoration) {
                    // Decorations can be placed on grass, tile, snow, sidewalk, cobblestone, OR building prop slots
                    if (
                      cellType !== TileType.Grass &&
                      cellType !== TileType.Tile &&
                      cellType !== TileType.Snow &&
                      cellType !== TileType.Sidewalk &&
                      cellType !== TileType.Cobblestone
                    ) {
                      // Check if it's a building tile that allows props
                      if (cellType === TileType.Building && cell.allowsProp && !cell.propId) {
                        placingOnPropSlot = true;
                      } else {
                        buildingHasCollision = true;
                      }
                    }
                  } else {
                    // Buildings can be placed on any ground tile, but not on other buildings or roads
                    if (cellType === TileType.Building || cellType === TileType.RoadLane || cellType === TileType.RoadTurn) {
                      buildingHasCollision = true;
                    }
                  }
                }
              }
            }
            if (buildingHasCollision) break;

            // Get prop slots for this building (tiles that allow props on top)
            const propSlots = getPropSlots(building, buildingOrientation);
            const propSlotSet = new Set(propSlots.map(s => `${s.x},${s.y}`));

            for (let dy = 0; dy < footprint.height; dy++) {
              for (let dx = 0; dx < footprint.width; dx++) {
                const px = bOriginX + dx;
                const py = bOriginY + dy;
                if (px < GRID_WIDTH && py < GRID_HEIGHT) {
                  if (placingOnPropSlot && isDecoration) {
                    // Placing a prop on a building's prop slot - store in prop layer
                    grid[py][px].propId = selectedBuildingId;
                    grid[py][px].propOriginX = bOriginX;
                    grid[py][px].propOriginY = bOriginY;
                    if (building.supportsRotation) {
                      grid[py][px].propOrientation = buildingOrientation;
                    }
                  } else {
                    // Normal placement - modify the tile itself
                    // Preserve existing tile type OR existing underlyingTileType for all buildings
                    const currentType = grid[py][px].type;
                    const existingUnderlying = grid[py][px].underlyingTileType;
                    const underlyingType = existingUnderlying || (currentType !== TileType.Building ? currentType : undefined);

                    grid[py][px].type = TileType.Building;
                    grid[py][px].buildingId = selectedBuildingId;
                    grid[py][px].isOrigin = dx === 0 && dy === 0;
                    grid[py][px].originX = bOriginX;
                    grid[py][px].originY = bOriginY;
                    // Preserve underlying tile for ALL buildings (not just decorations)
                    if (underlyingType && underlyingType !== TileType.Grass) {
                      grid[py][px].underlyingTileType = underlyingType;
                    } else {
                      grid[py][px].underlyingTileType = undefined;
                    }
                    if (building.supportsRotation) {
                      grid[py][px].buildingOrientation = buildingOrientation;
                    }
                    // Mark tiles that allow props on top
                    grid[py][px].allowsProp = propSlotSet.has(`${dx},${dy}`);
                  }
                  dirtyTiles.push({ x: px, y: py });
                }
              }
            }
            playBuildSound();
            // Trigger screen shake effect (like SimCity 4)
            if (phaserGameRef.current) {
              phaserGameRef.current.shakeScreen("y", 0.6, 150);
            }
            break;
          }
          case ToolType.Eraser: {
            const cell = grid[y][x];

            // First, check if there's a prop on this tile (prop layer)
            if (cell.propId) {
              // Clear the prop from all tiles it occupies
              const propBuilding = getBuilding(cell.propId);
              if (propBuilding && cell.propOriginX !== undefined && cell.propOriginY !== undefined) {
                const propFootprint = getBuildingFootprint(propBuilding, cell.propOrientation);
                for (let dy = 0; dy < propFootprint.height; dy++) {
                  for (let dx = 0; dx < propFootprint.width; dx++) {
                    const px = cell.propOriginX + dx;
                    const py = cell.propOriginY + dy;
                    if (px < GRID_WIDTH && py < GRID_HEIGHT) {
                      grid[py][px].propId = undefined;
                      grid[py][px].propOriginX = undefined;
                      grid[py][px].propOriginY = undefined;
                      grid[py][px].propOrientation = undefined;
                      dirtyTiles.push({ x: px, y: py });
                    }
                  }
                }
              } else {
                // Single tile prop - just clear this tile
                grid[y][x].propId = undefined;
                grid[y][x].propOriginX = undefined;
                grid[y][x].propOriginY = undefined;
                grid[y][x].propOrientation = undefined;
                dirtyTiles.push({ x, y });
              }
              playDestructionSound();
              phaserGameRef.current?.shakeScreen("x", 0.4, 100);
              break;
            }

            const originX = cell.originX;
            const originY = cell.originY;
            const cellType = cell.type;

            const shouldPlaySound = cellType !== TileType.Grass;

            if (originX !== undefined && originY !== undefined) {
              // Road lane deletion (2x2) - handles both RoadLane and RoadTurn
              // Also detects and deletes full 2-way road segments (both lanes + sidewalks)
              const isRoadTile =
                cellType === TileType.RoadLane || cellType === TileType.RoadTurn;

              if (isRoadTile) {
                // Helper to delete a 2x2 block
                const delete2x2Block = (bx: number, by: number) => {
                  for (let dy = 0; dy < ROAD_LANE_SIZE; dy++) {
                    for (let dx = 0; dx < ROAD_LANE_SIZE; dx++) {
                      const px = bx + dx;
                      const py = by + dy;
                      if (px >= 0 && px < GRID_WIDTH && py >= 0 && py < GRID_HEIGHT) {
                        grid[py][px].type = TileType.Grass;
                        grid[py][px].isOrigin = true;
                        grid[py][px].originX = undefined;
                        grid[py][px].originY = undefined;
                        grid[py][px].laneDirection = undefined;
                        grid[py][px].buildingId = undefined;
                        dirtyTiles.push({ x: px, y: py });
                      }
                    }
                  }
                };

                // Check if this is part of a 2-way road by looking for parallel lane
                const laneDir = cell.laneDirection;
                let isTwoWayRoad = false;
                let parallelLaneOrigin: { x: number; y: number } | null = null;
                let sidewalk1Origin: { x: number; y: number } | null = null;
                let sidewalk2Origin: { x: number; y: number } | null = null;

                if (laneDir === Direction.Right || laneDir === Direction.Left) {
                  // Horizontal road - check for parallel lane above or below
                  const checkY = laneDir === Direction.Right ? originY - ROAD_LANE_SIZE : originY + ROAD_LANE_SIZE;
                  const parallelCell = grid[checkY]?.[originX];
                  if (parallelCell && isRoadTileType(parallelCell.type) && parallelCell.isOrigin) {
                    const expectedDir = laneDir === Direction.Right ? Direction.Left : Direction.Right;
                    if (parallelCell.laneDirection === expectedDir) {
                      isTwoWayRoad = true;
                      parallelLaneOrigin = { x: originX, y: checkY };
                      // Sidewalks: above the top lane and below the bottom lane
                      const topY = Math.min(originY, checkY);
                      const bottomY = Math.max(originY, checkY) + ROAD_LANE_SIZE;
                      sidewalk1Origin = { x: originX, y: topY - ROAD_LANE_SIZE };
                      sidewalk2Origin = { x: originX, y: bottomY };
                    }
                  }
                } else if (laneDir === Direction.Down || laneDir === Direction.Up) {
                  // Vertical road - check for parallel lane left or right
                  const checkX = laneDir === Direction.Down ? originX + ROAD_LANE_SIZE : originX - ROAD_LANE_SIZE;
                  const parallelCell = grid[originY]?.[checkX];
                  if (parallelCell && isRoadTileType(parallelCell.type) && parallelCell.isOrigin) {
                    const expectedDir = laneDir === Direction.Down ? Direction.Up : Direction.Down;
                    if (parallelCell.laneDirection === expectedDir) {
                      isTwoWayRoad = true;
                      parallelLaneOrigin = { x: checkX, y: originY };
                      // Sidewalks: left of the left lane and right of the right lane
                      const leftX = Math.min(originX, checkX);
                      const rightX = Math.max(originX, checkX) + ROAD_LANE_SIZE;
                      sidewalk1Origin = { x: leftX - ROAD_LANE_SIZE, y: originY };
                      sidewalk2Origin = { x: rightX, y: originY };
                    }
                  }
                }

                // Delete the primary lane
                delete2x2Block(originX, originY);

                if (isTwoWayRoad) {
                  // Delete parallel lane
                  if (parallelLaneOrigin) {
                    delete2x2Block(parallelLaneOrigin.x, parallelLaneOrigin.y);
                  }
                  // Delete sidewalks if they exist
                  if (sidewalk1Origin) {
                    const s1Cell = grid[sidewalk1Origin.y]?.[sidewalk1Origin.x];
                    if (s1Cell?.type === TileType.Sidewalk) {
                      delete2x2Block(sidewalk1Origin.x, sidewalk1Origin.y);
                    }
                  }
                  if (sidewalk2Origin) {
                    const s2Cell = grid[sidewalk2Origin.y]?.[sidewalk2Origin.x];
                    if (s2Cell?.type === TileType.Sidewalk) {
                      delete2x2Block(sidewalk2Origin.x, sidewalk2Origin.y);
                    }
                  }
                }

                if (shouldPlaySound) {
                  playDestructionSound();
                  phaserGameRef.current?.shakeScreen("x", 0.6, 150);
                }
              } else {
                const cellBuildingId = cell.buildingId;
                let sizeW = 1;
                let sizeH = 1;

                if (cellType === TileType.Building && cellBuildingId) {
                  const building = getBuilding(cellBuildingId);
                  if (building) {
                    // Get footprint based on stored orientation
                    const footprint = getBuildingFootprint(
                      building,
                      cell.buildingOrientation
                    );
                    sizeW = footprint.width;
                    sizeH = footprint.height;
                  }
                }

                for (let dy = 0; dy < sizeH; dy++) {
                  for (let dx = 0; dx < sizeW; dx++) {
                    const px = originX + dx;
                    const py = originY + dy;
                    if (px < GRID_WIDTH && py < GRID_HEIGHT) {
                      grid[py][px].type = TileType.Grass;
                      grid[py][px].buildingId = undefined;
                      grid[py][px].isOrigin = true;
                      grid[py][px].originX = undefined;
                      grid[py][px].originY = undefined;
                      // Clear prop slot and prop layer fields
                      grid[py][px].allowsProp = undefined;
                      grid[py][px].propId = undefined;
                      grid[py][px].propOriginX = undefined;
                      grid[py][px].propOriginY = undefined;
                      grid[py][px].propOrientation = undefined;
                      dirtyTiles.push({ x: px, y: py });
                    }
                  }
                }

                if (shouldPlaySound) {
                  playDestructionSound();
                  // Horizontal shake on deletion
                  phaserGameRef.current?.shakeScreen("x", 0.6, 150);
                }
              }
            } else if (cellType !== TileType.Grass) {
              grid[y][x].type = TileType.Grass;
              grid[y][x].isOrigin = true;
              dirtyTiles.push({ x, y });
              playDestructionSound();
              // Horizontal shake on deletion
              phaserGameRef.current?.shakeScreen("x", 0.6, 150);
            }
            break;
          }
        }

      // Tell Phaser which tiles changed, then trigger re-render
      if (dirtyTiles.length > 0) {
        phaserGameRef.current?.markTilesDirty(dirtyTiles);
      }
      forceGridUpdate();
    },
    [selectedTool, selectedBuildingId, buildingOrientation]
  );

  // Handle batch tile placement from drag operations (snow/tile tools)
  const handleTilesDrag = useCallback(
    (tiles: Array<{ x: number; y: number }>) => {
      if (tiles.length === 0) return;

      // Direct mutation - no copy!
      const grid = gridRef.current;
      const dirtyTiles: Array<{ x: number; y: number }> = [];

      for (const { x, y } of tiles) {
        if (x < 0 || x >= GRID_WIDTH || y < 0 || y >= GRID_HEIGHT) continue;

        const cell = grid[y][x];

        if (selectedTool === ToolType.Snow) {
          if (cell.type === TileType.Building && cell.buildingId) {
            // Can place snow below any building
            grid[y][x].underlyingTileType = TileType.Snow;
            dirtyTiles.push({ x, y });
          } else if (
            cell.type === TileType.Grass ||
            cell.type === TileType.Tile ||
            cell.type === TileType.Cobblestone
          ) {
            grid[y][x].type = TileType.Snow;
            grid[y][x].isOrigin = true;
            grid[y][x].originX = x;
            grid[y][x].originY = y;
            dirtyTiles.push({ x, y });
          }
        } else if (selectedTool === ToolType.Tile) {
          if (cell.type === TileType.Building && cell.buildingId) {
            // Can place tile below any building
            grid[y][x].underlyingTileType = TileType.Tile;
            dirtyTiles.push({ x, y });
          } else if (
            cell.type === TileType.Grass ||
            cell.type === TileType.Snow ||
            cell.type === TileType.Cobblestone
          ) {
            grid[y][x].type = TileType.Tile;
            grid[y][x].isOrigin = true;
            grid[y][x].originX = x;
            grid[y][x].originY = y;
            dirtyTiles.push({ x, y });
          }
        } else if (selectedTool === ToolType.Asphalt) {
          if (cell.type === TileType.Building && cell.buildingId) {
            // Can place asphalt below any building
            grid[y][x].underlyingTileType = TileType.Asphalt;
            dirtyTiles.push({ x, y });
          } else if (
            cell.type === TileType.Grass ||
            cell.type === TileType.Snow ||
            cell.type === TileType.Tile ||
            cell.type === TileType.Cobblestone
          ) {
            grid[y][x].type = TileType.Asphalt;
            grid[y][x].isOrigin = true;
            grid[y][x].originX = x;
            grid[y][x].originY = y;
            dirtyTiles.push({ x, y });
          }
        } else if (selectedTool === ToolType.Cobblestone) {
          if (cell.type === TileType.Building && cell.buildingId) {
            // Can place cobblestone below any building
            grid[y][x].underlyingTileType = TileType.Cobblestone;
            dirtyTiles.push({ x, y });
          } else if (
            cell.type === TileType.Grass ||
            cell.type === TileType.Snow ||
            cell.type === TileType.Tile ||
            cell.type === TileType.Sidewalk ||
            cell.type === TileType.Asphalt
          ) {
            grid[y][x].type = TileType.Cobblestone;
            grid[y][x].isOrigin = true;
            grid[y][x].originX = x;
            grid[y][x].originY = y;
            dirtyTiles.push({ x, y });
          }
        }
      }

      if (dirtyTiles.length > 0) {
        phaserGameRef.current?.markTilesDirty(dirtyTiles);
        playBuildRoadSound();
        forceGridUpdate();
      }
    },
    [selectedTool]
  );

  // Handle road lane placement from drag operations (new 2x2 lane system)
  const handleRoadLaneDrag = useCallback(
    (lanes: Array<{ x: number; y: number }>, direction: Direction, tileType: TileType) => {
      if (lanes.length === 0) return;

      // Direct mutation - no copy!
      const grid = gridRef.current;
      const dirtyTiles: Array<{ x: number; y: number }> = [];

      // Place all road lanes
      for (const { x: laneX, y: laneY } of lanes) {
        const placementCheck = canPlaceRoadLane(grid, laneX, laneY);
        if (!placementCheck.valid) continue;

        // Place 2x2 road lane (RoadLane or RoadTurn)
        for (let dy = 0; dy < ROAD_LANE_SIZE; dy++) {
          for (let dx = 0; dx < ROAD_LANE_SIZE; dx++) {
            const px = laneX + dx;
            const py = laneY + dy;
            if (px < GRID_WIDTH && py < GRID_HEIGHT) {
              grid[py][px].type = tileType;
              grid[py][px].isOrigin = dx === 0 && dy === 0;
              grid[py][px].originX = laneX;
              grid[py][px].originY = laneY;
              grid[py][px].laneDirection = direction;
              dirtyTiles.push({ x: px, y: py });
            }
          }
        }
      }

      if (dirtyTiles.length > 0) {
        // No auto-conversion for 1-way roads - user places turn tiles manually
        phaserGameRef.current?.markTilesDirty(dirtyTiles);
        playBuildRoadSound();
        forceGridUpdate();
      }
    },
    []
  );

  // Handle 2-way road placement with sidewalks
  // Complete road structure (6 subtiles wide):
  //   Horizontal: sidewalk row, lane (right), lane (left), sidewalk row
  //   Vertical: sidewalk col, lane (down), lane (up), sidewalk col
  const handleTwoWayRoadDrag = useCallback(
    (lanes: Array<{ x: number; y: number }>, orientation: "horizontal" | "vertical", includeSidewalks: boolean = true) => {
      if (lanes.length === 0) return;

      const grid = gridRef.current;
      const dirtyTiles: Array<{ x: number; y: number }> = [];
      const placedLanes = new Set<string>();

      // First pass: place all lanes (allow overlap for intersections)
      for (const { x: laneX, y: laneY } of lanes) {
        const placementCheck = canPlaceRoadLane(grid, laneX, laneY, true);
        if (!placementCheck.valid) continue;

        // Determine direction based on position within the 2-way road
        // Right-hand traffic: stay on the right side of road
        let direction: Direction;
        if (orientation === "horizontal") {
          // Top lane goes Left (←westbound), bottom lane goes Right (→eastbound)
          const hasLaneBelow = lanes.some(l => l.x === laneX && l.y === laneY + ROAD_LANE_SIZE);
          direction = hasLaneBelow ? Direction.Left : Direction.Right;
        } else {
          // Left lane goes Down (↓southbound), right lane goes Up (↑northbound)
          const hasLaneRight = lanes.some(l => l.y === laneY && l.x === laneX + ROAD_LANE_SIZE);
          direction = hasLaneRight ? Direction.Down : Direction.Up;
        }

        // Place 2x2 road lane
        const existingCell = grid[laneY]?.[laneX];
        const existingDir = existingCell?.laneDirection;

        // Only treat as intersection if roads are PERPENDICULAR
        // (extending a road in same/opposite direction is NOT an intersection)
        const isHorizontal = (d: Direction) => d === Direction.Right || d === Direction.Left;
        const isVertical = (d: Direction) => d === Direction.Down || d === Direction.Up;
        const isPerpendicular = existingDir && (
          (isHorizontal(existingDir) && isVertical(direction)) ||
          (isVertical(existingDir) && isHorizontal(direction))
        );
        const isIntersection = existingCell && isRoadTileType(existingCell.type) && isPerpendicular;

        if (isIntersection && existingDir) {
          // At PERPENDICULAR intersection: assign direction based on quadrant
          //
          // 4-way intersection pattern (rotated turn tiles for right-hand traffic):
          //   ↓  ←   (top-left=Down, top-right=Left)
          //   →  ↑   (bottom-left=Right, bottom-right=Up)
          //
          // Each cell's direction = the direction traffic ENTERS from that side
          // RoadTurn allows going straight OR turning right
          //
          // Horizontal lanes: Right=top, Left=bottom
          // Vertical lanes: Down=left, Up=right
          const existingIsHorizontal = existingDir === Direction.Right || existingDir === Direction.Left;

          let isTopLane: boolean;
          let isLeftLane: boolean;

          if (existingIsHorizontal) {
            // Existing is horizontal, new is vertical
            // Horizontal: Left(←)=top, Right(→)=bottom
            // Vertical: Down(↓)=left, Up(↑)=right
            isTopLane = existingDir === Direction.Left;
            isLeftLane = direction === Direction.Down;
          } else {
            // Existing is vertical, new is horizontal
            isTopLane = direction === Direction.Left;
            isLeftLane = existingDir === Direction.Down;
          }

          // Pattern for right-hand traffic (enter cell, go straight or turn right):
          //   ↓  ←   (top-left=Down for ↓traffic, top-right=Left for ←traffic)
          //   →  ↑   (bottom-left=Right for →traffic, bottom-right=Up for ↑traffic)
          let intersectionDir: Direction;
          if (isTopLane && isLeftLane) intersectionDir = Direction.Down;
          else if (isTopLane && !isLeftLane) intersectionDir = Direction.Left;
          else if (!isTopLane && isLeftLane) intersectionDir = Direction.Right;
          else intersectionDir = Direction.Up;

          for (let dy = 0; dy < ROAD_LANE_SIZE; dy++) {
            for (let dx = 0; dx < ROAD_LANE_SIZE; dx++) {
              const px = laneX + dx;
              const py = laneY + dy;
              if (px < GRID_WIDTH && py < GRID_HEIGHT) {
                grid[py][px].type = TileType.RoadTurn;
                grid[py][px].isOrigin = dx === 0 && dy === 0;
                grid[py][px].originX = laneX;
                grid[py][px].originY = laneY;
                grid[py][px].laneDirection = intersectionDir;
                dirtyTiles.push({ x: px, y: py });
              }
            }
          }
        } else {
          // Normal lane placement
          for (let dy = 0; dy < ROAD_LANE_SIZE; dy++) {
            for (let dx = 0; dx < ROAD_LANE_SIZE; dx++) {
              const px = laneX + dx;
              const py = laneY + dy;
              if (px < GRID_WIDTH && py < GRID_HEIGHT) {
                grid[py][px].type = TileType.RoadLane;
                grid[py][px].isOrigin = dx === 0 && dy === 0;
                grid[py][px].originX = laneX;
                grid[py][px].originY = laneY;
                grid[py][px].laneDirection = direction;
                dirtyTiles.push({ x: px, y: py });
              }
            }
          }
        }
        placedLanes.add(`${laneX},${laneY}`);
      }

      // Second pass: place 2x2 sidewalk blocks on outer edges (matching lane size)
      // Only if includeSidewalks is true (TwoWayRoad has them, SidewalklessRoad doesn't)
      if (includeSidewalks && orientation === "horizontal") {
        // Group lanes by x position to find road segments
        const lanesByX = new Map<number, number[]>();
        for (const { x: laneX, y: laneY } of lanes) {
          if (!placedLanes.has(`${laneX},${laneY}`)) continue;
          if (!lanesByX.has(laneX)) lanesByX.set(laneX, []);
          lanesByX.get(laneX)!.push(laneY);
        }

        for (const [x, ys] of lanesByX) {
          const minY = Math.min(...ys);
          const maxY = Math.max(...ys);

          // Sidewalk block above top lane (2x2 block at y = minY - 2)
          for (let sy = 0; sy < ROAD_LANE_SIZE; sy++) {
            for (let dx = 0; dx < ROAD_LANE_SIZE; dx++) {
              const px = x + dx;
              const py = minY - ROAD_LANE_SIZE + sy;
              if (py >= 0 && px < GRID_WIDTH && grid[py]?.[px]?.type === TileType.Grass) {
                grid[py][px].type = TileType.Sidewalk;
                dirtyTiles.push({ x: px, y: py });
              }
            }
          }

          // Sidewalk block below bottom lane (2x2 block at y = maxY + ROAD_LANE_SIZE)
          for (let sy = 0; sy < ROAD_LANE_SIZE; sy++) {
            for (let dx = 0; dx < ROAD_LANE_SIZE; dx++) {
              const px = x + dx;
              const py = maxY + ROAD_LANE_SIZE + sy;
              if (py < GRID_HEIGHT && px < GRID_WIDTH && grid[py]?.[px]?.type === TileType.Grass) {
                grid[py][px].type = TileType.Sidewalk;
                dirtyTiles.push({ x: px, y: py });
              }
            }
          }
        }
      } else if (includeSidewalks && orientation === "vertical") {
        // Vertical road - group lanes by y position
        const lanesByY = new Map<number, number[]>();
        for (const { x: laneX, y: laneY } of lanes) {
          if (!placedLanes.has(`${laneX},${laneY}`)) continue;
          if (!lanesByY.has(laneY)) lanesByY.set(laneY, []);
          lanesByY.get(laneY)!.push(laneX);
        }

        for (const [y, xs] of lanesByY) {
          const minX = Math.min(...xs);
          const maxX = Math.max(...xs);

          // Sidewalk block left of left lane (2x2 block at x = minX - 2)
          for (let sx = 0; sx < ROAD_LANE_SIZE; sx++) {
            for (let dy = 0; dy < ROAD_LANE_SIZE; dy++) {
              const px = minX - ROAD_LANE_SIZE + sx;
              const py = y + dy;
              if (px >= 0 && py < GRID_HEIGHT && grid[py]?.[px]?.type === TileType.Grass) {
                grid[py][px].type = TileType.Sidewalk;
                dirtyTiles.push({ x: px, y: py });
              }
            }
          }

          // Sidewalk block right of right lane (2x2 block at x = maxX + ROAD_LANE_SIZE)
          for (let sx = 0; sx < ROAD_LANE_SIZE; sx++) {
            for (let dy = 0; dy < ROAD_LANE_SIZE; dy++) {
              const px = maxX + ROAD_LANE_SIZE + sx;
              const py = y + dy;
              if (px < GRID_WIDTH && py < GRID_HEIGHT && grid[py]?.[px]?.type === TileType.Grass) {
                grid[py][px].type = TileType.Sidewalk;
                dirtyTiles.push({ x: px, y: py });
              }
            }
          }
        }
      }

      if (dirtyTiles.length > 0) {
        // NOTE: Intersection detection is handled during placement above (perpendicular overlap = RoadTurn)
        // Do NOT call updateIntersections here - it incorrectly converts approach lanes to RoadTurn
        // because they have perpendicular neighbors (the intersection itself)

        // Detect and update dead ends (convert to RoadTurn for U-turns)
        const deadEndTiles = updateDeadEnds(grid, dirtyTiles);
        dirtyTiles.push(...deadEndTiles);

        phaserGameRef.current?.markTilesDirty(dirtyTiles);
        playBuildRoadSound();
        forceGridUpdate();
      }
    },
    []
  );

  // Perform the actual deletion of tiles
  const performDeletion = useCallback(
    (tiles: Array<{ x: number; y: number }>) => {
      const grid = gridRef.current;
      const dirtyTiles: Array<{ x: number; y: number }> = [];
      const deletedOrigins = new Set<string>();

      for (const { x, y } of tiles) {
        if (x < 0 || x >= GRID_WIDTH || y < 0 || y >= GRID_HEIGHT) continue;

        const cell = grid[y][x];
        if (cell.type === TileType.Grass) continue;

        const originX = cell.originX ?? x;
        const originY = cell.originY ?? y;
        const originKey = `${originX},${originY}`;

        if (deletedOrigins.has(originKey)) continue;
        deletedOrigins.add(originKey);

        const cellType = cell.type;

        if (cellType === TileType.RoadLane || cellType === TileType.RoadTurn) {
          // Check if this is part of a 2-way road by looking for parallel lane
          const laneDir = cell.laneDirection;
          let isTwoWayRoad = false;
          let parallelLaneOrigin: { x: number; y: number } | null = null;
          let sidewalk1Origin: { x: number; y: number } | null = null;
          let sidewalk2Origin: { x: number; y: number } | null = null;

          if (laneDir === Direction.Right || laneDir === Direction.Left) {
            // Horizontal road - check for parallel lane above or below
            const checkY = laneDir === Direction.Right ? originY + ROAD_LANE_SIZE : originY - ROAD_LANE_SIZE;
            const parallelCell = grid[checkY]?.[originX];
            if (parallelCell && isRoadTileType(parallelCell.type) && parallelCell.isOrigin) {
              const expectedDir = laneDir === Direction.Right ? Direction.Left : Direction.Right;
              if (parallelCell.laneDirection === expectedDir) {
                isTwoWayRoad = true;
                parallelLaneOrigin = { x: originX, y: checkY };
                // Sidewalks: above the top lane and below the bottom lane
                const topY = Math.min(originY, checkY);
                const bottomY = Math.max(originY, checkY) + ROAD_LANE_SIZE;
                sidewalk1Origin = { x: originX, y: topY - ROAD_LANE_SIZE };
                sidewalk2Origin = { x: originX, y: bottomY };
              }
            }
          } else if (laneDir === Direction.Down || laneDir === Direction.Up) {
            // Vertical road - check for parallel lane left or right
            const checkX = laneDir === Direction.Down ? originX + ROAD_LANE_SIZE : originX - ROAD_LANE_SIZE;
            const parallelCell = grid[originY]?.[checkX];
            if (parallelCell && isRoadTileType(parallelCell.type) && parallelCell.isOrigin) {
              const expectedDir = laneDir === Direction.Down ? Direction.Up : Direction.Down;
              if (parallelCell.laneDirection === expectedDir) {
                isTwoWayRoad = true;
                parallelLaneOrigin = { x: checkX, y: originY };
                // Sidewalks: left of the left lane and right of the right lane
                const leftX = Math.min(originX, checkX);
                const rightX = Math.max(originX, checkX) + ROAD_LANE_SIZE;
                sidewalk1Origin = { x: leftX - ROAD_LANE_SIZE, y: originY };
                sidewalk2Origin = { x: rightX, y: originY };
              }
            }
          }

          // Helper to delete a 2x2 block
          const delete2x2Block = (bx: number, by: number) => {
            for (let dy = 0; dy < ROAD_LANE_SIZE; dy++) {
              for (let dx = 0; dx < ROAD_LANE_SIZE; dx++) {
                const px = bx + dx;
                const py = by + dy;
                if (px >= 0 && px < GRID_WIDTH && py >= 0 && py < GRID_HEIGHT) {
                  grid[py][px].type = TileType.Grass;
                  grid[py][px].isOrigin = true;
                  grid[py][px].originX = undefined;
                  grid[py][px].originY = undefined;
                  grid[py][px].laneDirection = undefined;
                  grid[py][px].buildingId = undefined;
                  dirtyTiles.push({ x: px, y: py });
                }
              }
            }
          };

          // Delete the primary lane
          delete2x2Block(originX, originY);

          if (isTwoWayRoad) {
            // Delete parallel lane
            if (parallelLaneOrigin) {
              const pKey = `${parallelLaneOrigin.x},${parallelLaneOrigin.y}`;
              if (!deletedOrigins.has(pKey)) {
                deletedOrigins.add(pKey);
                delete2x2Block(parallelLaneOrigin.x, parallelLaneOrigin.y);
              }
            }
            // Delete sidewalks if they exist
            if (sidewalk1Origin) {
              const s1Cell = grid[sidewalk1Origin.y]?.[sidewalk1Origin.x];
              if (s1Cell?.type === TileType.Sidewalk) {
                const s1Key = `${sidewalk1Origin.x},${sidewalk1Origin.y}`;
                if (!deletedOrigins.has(s1Key)) {
                  deletedOrigins.add(s1Key);
                  delete2x2Block(sidewalk1Origin.x, sidewalk1Origin.y);
                }
              }
            }
            if (sidewalk2Origin) {
              const s2Cell = grid[sidewalk2Origin.y]?.[sidewalk2Origin.x];
              if (s2Cell?.type === TileType.Sidewalk) {
                const s2Key = `${sidewalk2Origin.x},${sidewalk2Origin.y}`;
                if (!deletedOrigins.has(s2Key)) {
                  deletedOrigins.add(s2Key);
                  delete2x2Block(sidewalk2Origin.x, sidewalk2Origin.y);
                }
              }
            }
          }
        } else if (cellType === TileType.Building && cell.buildingId) {
          // Delete building
          const building = getBuilding(cell.buildingId);
          let sizeW = 1;
          let sizeH = 1;

          if (building) {
            const footprint = getBuildingFootprint(
              building,
              cell.buildingOrientation
            );
            sizeW = footprint.width;
            sizeH = footprint.height;
          }

          for (let dy = 0; dy < sizeH; dy++) {
            for (let dx = 0; dx < sizeW; dx++) {
              const px = originX + dx;
              const py = originY + dy;
              if (px < GRID_WIDTH && py < GRID_HEIGHT) {
                grid[py][px].type = TileType.Grass;
                grid[py][px].buildingId = undefined;
                grid[py][px].isOrigin = true;
                grid[py][px].originX = undefined;
                grid[py][px].originY = undefined;
                dirtyTiles.push({ x: px, y: py });
              }
            }
          }
        } else {
          // Snow, Tile, or other single tiles
          grid[y][x].type = TileType.Grass;
          grid[y][x].isOrigin = true;
          grid[y][x].originX = undefined;
          grid[y][x].originY = undefined;
          dirtyTiles.push({ x, y });
        }
      }

      if (dirtyTiles.length > 0) {
        phaserGameRef.current?.markTilesDirty(dirtyTiles);
      }
      playDestructionSound();
      // Horizontal shake on deletion (eraser drag / bulk delete path)
      phaserGameRef.current?.shakeScreen("x", 0.6, 150);
      forceGridUpdate();
    },
    []
  );

  // Handle eraser drag with confirmation modal
  const handleEraserDrag = useCallback(
    (tiles: Array<{ x: number; y: number }>) => {
      if (tiles.length === 0) return;

      // Count unique items that would be deleted
      const itemsToDelete = new Set<string>();
      const processedOrigins = new Set<string>();

      for (const { x, y } of tiles) {
        if (x < 0 || x >= GRID_WIDTH || y < 0 || y >= GRID_HEIGHT) continue;

        const cell = grid[y]?.[x];
        if (!cell || cell.type === TileType.Grass) continue;

        const originX = cell.originX ?? x;
        const originY = cell.originY ?? y;
        const originKey = `${originX},${originY}`;

        if (processedOrigins.has(originKey)) continue;
        processedOrigins.add(originKey);

        if (cell.type === TileType.Building && cell.buildingId) {
          const building = getBuilding(cell.buildingId);
          itemsToDelete.add(
            `building:${originKey}:${building?.name || "Building"}`
          );
        } else if (cell.type === TileType.RoadLane || cell.type === TileType.RoadTurn) {
          itemsToDelete.add(`roadlane:${originKey}`);
        } else {
          itemsToDelete.add(`tile:${x},${y}`);
        }
      }

      if (itemsToDelete.size === 0) return;

      // Show confirmation modal for multiple items
      if (itemsToDelete.size > 1) {
        // Store tiles for deletion after confirmation
        const tilesToDelete = [...tiles];
        setModalState({
          isVisible: true,
          title: "Confirm Deletion",
          message: `Are you sure you want to delete ${itemsToDelete.size} items?`,
          showCancel: true,
          onConfirm: () => performDeletion(tilesToDelete),
        });
        return;
      }

      // Single item - delete immediately without confirmation
      performDeletion(tiles);
    },
    [grid, performDeletion]
  );

  // Spawn handlers (delegate to Phaser)
  const handleSpawnCharacter = useCallback(() => {
    if (phaserGameRef.current) {
      const success = phaserGameRef.current.spawnCharacter();
      if (!success) {
        setModalState({
          isVisible: true,
          title: "Cannot Spawn Character",
          message: "Please place some roads first!",
        });
      }
    }
  }, []);

  const handleSpawnCar = useCallback(() => {
    if (phaserGameRef.current) {
      const success = phaserGameRef.current.spawnCar();
      if (!success) {
        setModalState({
          isVisible: true,
          title: "Cannot Spawn Car",
          message: "Please place some road lanes first!",
        });
      }
    }
  }, []);

  // Save/Load functions
  interface GameSaveData {
    grid: GridCell[][];
    characterCount: number;
    carCount: number;
    zoom?: number;
    visualSettings?: VisualSettings;
    timestamp: number;
  }

  const handleSaveGame = useCallback(() => {
    const characterCount = phaserGameRef.current?.getCharacterCount() ?? 0;
    const carCount = phaserGameRef.current?.getCarCount() ?? 0;

    // Check if there are any existing saves
    const existingSaves: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("pogicity_save_")) {
        existingSaves.push(key.replace("pogicity_save_", ""));
      }
    }

    if (existingSaves.length === 0) {
      // First save - prompt for name
      setPromptState({
        isVisible: true,
        title: "Save Game",
        message: "Enter a name for this save:",
        defaultValue: "",
        onConfirm: (saveName: string) => {
          const saveData: GameSaveData = {
            grid,
            characterCount,
            carCount,
            zoom,
            visualSettings,
            timestamp: Date.now(),
          };

          try {
            localStorage.setItem(
              `pogicity_save_${saveName}`,
              JSON.stringify(saveData)
            );
            setModalState({
              isVisible: true,
              title: "Game Saved",
              message: `Game saved as "${saveName}"!`,
            });
            playDoubleClickSound();
          } catch (error) {
            setModalState({
              isVisible: true,
              title: "Save Failed",
              message: "Failed to save game!",
            });
            console.error("Save error:", error);
          }
        },
      });
    } else {
      // Use default name or prompt
      const defaultName = `Save ${existingSaves.length + 1}`;
      setPromptState({
        isVisible: true,
        title: "Save Game",
        message: `Enter a name for this save:\n(Leave empty for "${defaultName}")`,
        defaultValue: defaultName,
        onConfirm: (saveName: string) => {
          const finalName =
            saveName.trim() === "" ? defaultName : saveName.trim();
          const saveData: GameSaveData = {
            grid,
            characterCount,
            carCount,
            zoom,
            visualSettings,
            timestamp: Date.now(),
          };

          try {
            localStorage.setItem(
              `pogicity_save_${finalName}`,
              JSON.stringify(saveData)
            );
            setModalState({
              isVisible: true,
              title: "Game Saved",
              message: `Game saved as "${finalName}"!`,
            });
            playDoubleClickSound();
          } catch (error) {
            setModalState({
              isVisible: true,
              title: "Save Failed",
              message: "Failed to save game!",
            });
            console.error("Save error:", error);
          }
        },
      });
    }
  }, [grid, zoom, visualSettings]);

  const handleLoadGame = useCallback((saveData: GameSaveData) => {
    try {
      // Restore grid (with migration for old saves)
      const migratedGrid = migrateGrid(saveData.grid);
      gridRef.current = migratedGrid;

      // Mark ALL tiles dirty since we're replacing the entire grid
      const allTiles: Array<{ x: number; y: number }> = [];
      for (let y = 0; y < GRID_HEIGHT; y++) {
        for (let x = 0; x < GRID_WIDTH; x++) {
          allTiles.push({ x, y });
        }
      }
      phaserGameRef.current?.markTilesDirty(allTiles);
      forceGridUpdate();

      // Clear existing characters and cars
      phaserGameRef.current?.clearCharacters();
      phaserGameRef.current?.clearCars();

      // Restore UI state
      if (saveData.zoom !== undefined) {
        setZoom(saveData.zoom);
      }
      if (saveData.visualSettings) {
        setVisualSettings(saveData.visualSettings);
      }

      // Wait for grid/zoom to update, then center camera and spawn entities
      setTimeout(() => {
        // Center camera AFTER zoom is applied
        phaserGameRef.current?.centerCameraOnMap();

        for (let i = 0; i < (saveData.characterCount ?? 0); i++) {
          phaserGameRef.current?.spawnCharacter();
        }
        for (let i = 0; i < (saveData.carCount ?? 0); i++) {
          phaserGameRef.current?.spawnCar();
        }
      }, 100);

      setModalState({
        isVisible: true,
        title: "Game Loaded",
        message: "Game loaded successfully!",
      });
      playDoubleClickSound();
    } catch (error) {
      setModalState({
        isVisible: true,
        title: "Load Failed",
        message: "Failed to load game!",
      });
      console.error("Load error:", error);
    }
  }, []);

  // Zoom controls
  const handleZoomIn = useCallback(() => {
    scrollAccumulatorRef.current = 0; // Reset accumulator when using buttons
    setZoom((prev) => {
      const currentIndex = ZOOM_LEVELS.indexOf(prev);
      if (currentIndex === -1) {
        // If current zoom doesn't match exactly, find closest and go up
        const closestIndex = findClosestZoomIndex(prev);
        return ZOOM_LEVELS[Math.min(closestIndex + 1, ZOOM_LEVELS.length - 1)];
      }
      return ZOOM_LEVELS[Math.min(currentIndex + 1, ZOOM_LEVELS.length - 1)];
    });
  }, []);

  const handleZoomOut = useCallback(() => {
    scrollAccumulatorRef.current = 0; // Reset accumulator when using buttons
    setZoom((prev) => {
      const currentIndex = ZOOM_LEVELS.indexOf(prev);
      if (currentIndex === -1) {
        // If current zoom doesn't match exactly, find closest and go down
        const closestIndex = findClosestZoomIndex(prev);
        return ZOOM_LEVELS[Math.max(closestIndex - 1, 0)];
      }
      return ZOOM_LEVELS[Math.max(currentIndex - 1, 0)];
    });
  }, []);

  // Zoom is now handled directly in Phaser for correct pointer coordinates
  // This callback just syncs React state when Phaser emits a zoom change
  const handleZoomChange = useCallback((newZoom: number) => {
    setZoom(newZoom);
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        width: "100vw",
        overflow: "hidden",
        position: "relative",
        background: "#4a5d6a",
      }}
    >
      {/* Top Left - Save/Load and Zoom buttons */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 2, // Slight margin so border doesn't touch edge
          zIndex: 1000,
          display: "flex",
          gap: 0,
        }}
        onWheel={(e) => e.stopPropagation()}
      >
        {/* Save button */}
        <button
          onClick={() => {
            handleSaveGame();
            playDoubleClickSound();
          }}
          title="Save Game"
          className="rct-blue-button-interactive"
          style={{
            background: "#B0B0B0",
            border: "2px solid",
            borderColor: "#D0D0D0 #707070 #707070 #D0D0D0",
            padding: 0,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 0,
            borderTop: "none",
            boxShadow: "1px 1px 0px #505050",
            imageRendering: "pixelated",
            transition: "filter 0.1s",
            width: 48,
            height: 48,
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.filter = "brightness(1.1)")
          }
          onMouseLeave={(e) => (e.currentTarget.style.filter = "none")}
          onMouseDown={(e) => {
            e.currentTarget.style.filter = "brightness(0.9)";
            e.currentTarget.style.borderColor =
              "#707070 #D0D0D0 #D0D0D0 #707070";
            e.currentTarget.style.transform = "translate(1px, 1px)";
            e.currentTarget.style.boxShadow = "inset 1px 1px 0px #505050";
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.filter = "brightness(1.1)";
            e.currentTarget.style.borderColor =
              "#D0D0D0 #707070 #707070 #D0D0D0";
            e.currentTarget.style.transform = "none";
            e.currentTarget.style.boxShadow = "1px 1px 0px #505050";
          }}
        >
          <img
            src="/UI/save.png"
            alt="Save"
            style={{
              width: 48,
              height: 48,
              display: "block",
            }}
          />
        </button>
        {/* Load button */}
        <button
          onClick={() => {
            setIsLoadWindowVisible(true);
            playDoubleClickSound();
          }}
          title="Load Game"
          className="rct-blue-button-interactive"
          style={{
            background: "#B0B0B0",
            border: "2px solid",
            borderColor: "#D0D0D0 #707070 #707070 #D0D0D0",
            padding: 0,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 0,
            borderTop: "none",
            boxShadow: "1px 1px 0px #505050",
            imageRendering: "pixelated",
            transition: "filter 0.1s",
            width: 48,
            height: 48,
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.filter = "brightness(1.1)")
          }
          onMouseLeave={(e) => (e.currentTarget.style.filter = "none")}
          onMouseDown={(e) => {
            e.currentTarget.style.filter = "brightness(0.9)";
            e.currentTarget.style.borderColor =
              "#707070 #D0D0D0 #D0D0D0 #707070";
            e.currentTarget.style.transform = "translate(1px, 1px)";
            e.currentTarget.style.boxShadow = "inset 1px 1px 0px #505050";
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.filter = "brightness(1.1)";
            e.currentTarget.style.borderColor =
              "#D0D0D0 #707070 #707070 #D0D0D0";
            e.currentTarget.style.transform = "none";
            e.currentTarget.style.boxShadow = "1px 1px 0px #505050";
          }}
        >
          <img
            src="/UI/load.png"
            alt="Load"
            style={{
              width: 48,
              height: 48,
              display: "block",
            }}
          />
        </button>
        <button
          onClick={() => {
            handleZoomOut();
            playDoubleClickSound();
          }}
          title="Zoom Out"
          className="rct-blue-button-interactive"
          style={{
            background: "#6CA6E8",
            border: "2px solid",
            borderColor: "#A3CDF9 #366BA8 #366BA8 #A3CDF9", // Light, Dark, Dark, Light
            padding: 0,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 0, // No rounded corners
            borderTop: "none", // Remove top border to attach to edge
            boxShadow: "1px 1px 0px #244B7A",
            imageRendering: "pixelated",
            transition: "filter 0.1s",
            width: 48,
            height: 48,
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.filter = "brightness(1.1)")
          }
          onMouseLeave={(e) => (e.currentTarget.style.filter = "none")}
          onMouseDown={(e) => {
            e.currentTarget.style.filter = "brightness(0.9)";
            e.currentTarget.style.borderColor =
              "#366BA8 #A3CDF9 #A3CDF9 #366BA8"; // Inverted
            e.currentTarget.style.transform = "translate(1px, 1px)";
            e.currentTarget.style.boxShadow = "inset 1px 1px 0px #244B7A";
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.filter = "brightness(1.1)";
            e.currentTarget.style.borderColor =
              "#A3CDF9 #366BA8 #366BA8 #A3CDF9"; // Reset
            e.currentTarget.style.transform = "none";
            e.currentTarget.style.boxShadow = "1px 1px 0px #244B7A";
          }}
        >
          <img
            src="/UI/zoomout.png"
            alt="Zoom Out"
            style={{
              width: 48,
              height: 48,
              display: "block",
            }}
          />
        </button>
        <button
          onClick={() => {
            handleZoomIn();
            playDoubleClickSound();
          }}
          title="Zoom In"
          className="rct-blue-button-interactive"
          style={{
            background: "#6CA6E8",
            border: "2px solid",
            borderColor: "#A3CDF9 #366BA8 #366BA8 #A3CDF9", // Light, Dark, Dark, Light
            padding: 0,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 0, // No rounded corners
            borderTop: "none", // Remove top border
            boxShadow: "1px 1px 0px #244B7A",
            imageRendering: "pixelated",
            transition: "filter 0.1s",
            width: 48,
            height: 48,
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.filter = "brightness(1.1)")
          }
          onMouseLeave={(e) => (e.currentTarget.style.filter = "none")}
          onMouseDown={(e) => {
            e.currentTarget.style.filter = "brightness(0.9)";
            e.currentTarget.style.borderColor =
              "#366BA8 #A3CDF9 #A3CDF9 #366BA8"; // Inverted
            e.currentTarget.style.transform = "translate(1px, 1px)";
            e.currentTarget.style.boxShadow = "inset 1px 1px 0px #244B7A";
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.filter = "brightness(1.1)";
            e.currentTarget.style.borderColor =
              "#A3CDF9 #366BA8 #366BA8 #A3CDF9"; // Reset
            e.currentTarget.style.transform = "none";
            e.currentTarget.style.boxShadow = "1px 1px 0px #244B7A";
          }}
        >
          <img
            src="/UI/zoomin.png"
            alt="Zoom In"
            style={{
              width: 48,
              height: 48,
              display: "block",
            }}
          />
        </button>
      </div>

      {/* Top Right - Build and Eraser buttons */}
      <div
        style={{
          position: "absolute",
          top: 0,
          right: 2,
          zIndex: 1000,
          display: "flex",
          gap: 0,
        }}
        onWheel={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => {
            const willOpen = !isToolWindowVisible;
            setIsToolWindowVisible(willOpen);
            // Close destroy mode when opening build menu
            if (willOpen && selectedTool === ToolType.Eraser) {
              setSelectedTool(ToolType.None);
            }
            // Exit build mode when closing build menu
            if (!willOpen && selectedTool === ToolType.Building) {
              setSelectedTool(ToolType.None);
              setSelectedBuildingId(null);
            }
            if (willOpen) {
              playOpenSound();
            } else {
              playDoubleClickSound();
            }
          }}
          className={`rct-maroon-button-interactive ${
            isToolWindowVisible ? "active" : ""
          }`}
          title="Build Menu"
          style={{
            background: isToolWindowVisible ? "#4a1a1a" : "#6b2a2a",
            border: "2px solid",
            borderColor: isToolWindowVisible
              ? "#4a1a1a #ab6a6a #ab6a6a #4a1a1a" // Inverted for active
              : "#ab6a6a #4a1a1a #4a1a1a #ab6a6a", // Normal
            padding: 0,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 0,
            borderTop: "none",
            boxShadow: isToolWindowVisible
              ? "inset 1px 1px 0px #2a0a0a"
              : "1px 1px 0px #2a0a0a",
            imageRendering: "pixelated",
            transition: "filter 0.1s",
            transform: isToolWindowVisible ? "translate(1px, 1px)" : "none",
          }}
          onMouseEnter={(e) =>
            !isToolWindowVisible &&
            (e.currentTarget.style.filter = "brightness(1.1)")
          }
          onMouseLeave={(e) =>
            !isToolWindowVisible && (e.currentTarget.style.filter = "none")
          }
          onMouseDown={(e) => {
            if (isToolWindowVisible) return;
            e.currentTarget.style.filter = "brightness(0.9)";
            e.currentTarget.style.borderColor =
              "#4a1a1a #ab6a6a #ab6a6a #4a1a1a";
            e.currentTarget.style.transform = "translate(1px, 1px)";
            e.currentTarget.style.boxShadow = "inset 1px 1px 0px #2a0a0a";
          }}
          onMouseUp={(e) => {
            if (isToolWindowVisible) return;
            e.currentTarget.style.filter = "brightness(1.1)";
            e.currentTarget.style.borderColor =
              "#ab6a6a #4a1a1a #4a1a1a #ab6a6a";
            e.currentTarget.style.transform = "none";
            e.currentTarget.style.boxShadow = "1px 1px 0px #2a0a0a";
          }}
        >
          <img
            src="/UI/build.png"
            alt="Build"
            style={{
              width: 48,
              height: 48,
              display: "block",
            }}
          />
        </button>
        <button
          onClick={() => {
            // Close build menu when activating destroy mode
            if (isToolWindowVisible) {
              setIsToolWindowVisible(false);
            }
            if (selectedTool === ToolType.Eraser) {
              setSelectedTool(ToolType.None);
            } else {
              setSelectedTool(ToolType.Eraser);
            }
            playDoubleClickSound();
          }}
          className={`rct-maroon-button-interactive ${
            selectedTool === ToolType.Eraser ? "active" : ""
          }`}
          title="Eraser (Esc to deselect)"
          style={{
            background:
              selectedTool === ToolType.Eraser ? "#4a1a1a" : "#6b2a2a",
            border: "2px solid",
            borderColor:
              selectedTool === ToolType.Eraser
                ? "#4a1a1a #ab6a6a #ab6a6a #4a1a1a"
                : "#ab6a6a #4a1a1a #4a1a1a #ab6a6a",
            padding: 0,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 0,
            borderTop: "none",
            boxShadow:
              selectedTool === ToolType.Eraser
                ? "inset 1px 1px 0px #2a0a0a"
                : "1px 1px 0px #2a0a0a",
            imageRendering: "pixelated",
            transition: "filter 0.1s",
            transform:
              selectedTool === ToolType.Eraser ? "translate(1px, 1px)" : "none",
          }}
          onMouseEnter={(e) =>
            selectedTool !== ToolType.Eraser &&
            (e.currentTarget.style.filter = "brightness(1.1)")
          }
          onMouseLeave={(e) =>
            selectedTool !== ToolType.Eraser &&
            (e.currentTarget.style.filter = "none")
          }
          onMouseDown={(e) => {
            if (selectedTool === ToolType.Eraser) return;
            e.currentTarget.style.filter = "brightness(0.9)";
            e.currentTarget.style.borderColor =
              "#4a1a1a #ab6a6a #ab6a6a #4a1a1a";
            e.currentTarget.style.transform = "translate(1px, 1px)";
            e.currentTarget.style.boxShadow = "inset 1px 1px 0px #2a0a0a";
          }}
          onMouseUp={(e) => {
            if (selectedTool === ToolType.Eraser) return;
            e.currentTarget.style.filter = "brightness(1.1)";
            e.currentTarget.style.borderColor =
              "#ab6a6a #4a1a1a #4a1a1a #ab6a6a";
            e.currentTarget.style.transform = "none";
            e.currentTarget.style.boxShadow = "1px 1px 0px #2a0a0a";
          }}
        >
          <img
            src="/UI/bulldozer.png"
            alt="Bulldozer"
            style={{
              width: 48,
              height: 48,
              display: "block",
            }}
          />
        </button>
      </div>

      {/* Bottom right - Music player */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          right: 0,
          zIndex: 1000,
        }}
        onWheel={(e) => e.stopPropagation()}
      >
        <MusicPlayer />
      </div>

      {/* Bottom left - Debug/Drive buttons (secondary) - HIDDEN FOR NOW */}
      {/* <div
        style={{
          position: "absolute",
          bottom: 16,
          left: 16,
          zIndex: 1000,
          display: "flex",
          gap: 8,
        }}
        onWheel={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => {
            setIsPlayerDriving((prev) => !prev);
            playDoubleClickSound();
          }}
          className={`rct-button ${isPlayerDriving ? "active" : ""}`}
          style={{
            width: 36,
            height: 32,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 18,
            padding: 0,
          }}
          title={
            isPlayerDriving
              ? "Exit driving mode (WASD/Arrow keys)"
              : "Enter driving mode (WASD/Arrow keys)"
          }
        >
          🚗
        </button>
        <button
          onClick={() => {
              const willOpen = !isDebugWindowVisible;
              setIsDebugWindowVisible(willOpen);
              if (willOpen) {
                playOpenSound();
              } else {
                playDoubleClickSound();
              }
            }}
          className={`rct-button ${isDebugWindowVisible ? "active" : ""}`}
          style={{
            width: 36,
            height: 32,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 18,
            padding: 0,
          }}
          title="Visual debug settings"
        >
          🎨
        </button>
      </div> */}

      {/* Main game area */}
      <div
        style={{
          flex: 1,
          position: "relative",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* Map container - Phaser canvas */}
        <div
          style={{
            position: "relative",
            overflow: "auto",
            maxWidth: "100%",
            maxHeight: "100%",
            borderRadius: 0,
            width: "100%",
            height: "100%",
            filter: `
              hue-rotate(${visualSettings.blueness}deg)
              contrast(${visualSettings.contrast})
              saturate(${visualSettings.saturation})
              brightness(${visualSettings.brightness})
            `,
          }}
        >
          <PhaserGame
            ref={phaserGameRef}
            grid={grid}
            gridVersion={gridVersion}
            selectedTool={selectedTool}
            selectedBuildingId={selectedBuildingId}
            buildingOrientation={buildingOrientation}
            zoom={zoom}
            onTileClick={handleTileClick}
            onTilesDrag={handleTilesDrag}
            onEraserDrag={handleEraserDrag}
            onRoadLaneDrag={handleRoadLaneDrag}
            onTwoWayRoadDrag={handleTwoWayRoadDrag}
            onZoomChange={handleZoomChange}
            showPaths={debugPaths}
            showStats={showStats}
          />
        </div>

        {/* Floating tool window */}
        <ToolWindow
          selectedTool={selectedTool}
          selectedBuildingId={selectedBuildingId}
          onToolSelect={setSelectedTool}
          onBuildingSelect={(id) => {
            setSelectedBuildingId(id);
            setSelectedTool(ToolType.Building);
          }}
          onSpawnCharacter={handleSpawnCharacter}
          onSpawnCar={handleSpawnCar}
          onRotate={() => {
            if (selectedTool === ToolType.Building && selectedBuildingId) {
              const building = getBuilding(selectedBuildingId);
              if (building?.supportsRotation) {
                setBuildingOrientation((prev) => {
                  switch (prev) {
                    case Direction.Down:
                      return Direction.Right;
                    case Direction.Right:
                      return Direction.Up;
                    case Direction.Up:
                      return Direction.Left;
                    case Direction.Left:
                      return Direction.Down;
                    default:
                      return Direction.Down;
                  }
                });
              }
            }
          }}
          isVisible={isToolWindowVisible}
          onClose={() => {
            setIsToolWindowVisible(false);
            // Turn off build mode when closing build menu
            if (selectedTool === ToolType.Building) {
              setSelectedTool(ToolType.None);
              setSelectedBuildingId(null);
            }
          }}
        />

        {/* Floating debug window - HIDDEN FOR NOW */}
        {/* <DebugWindow
          settings={visualSettings}
          onSettingsChange={setVisualSettings}
          showPaths={debugPaths}
          onShowPathsChange={setDebugPaths}
          showStats={showStats}
          onShowStatsChange={setShowStats}
          isVisible={isDebugWindowVisible}
          onClose={() => setIsDebugWindowVisible(false)}
        /> */}

        {/* Load window */}
        <LoadWindow
          isVisible={isLoadWindowVisible}
          onClose={() => setIsLoadWindowVisible(false)}
          onLoad={handleLoadGame}
        />

        {/* Modal */}
        <Modal
          isVisible={modalState.isVisible}
          title={modalState.title}
          message={modalState.message}
          showCancel={modalState.showCancel}
          onConfirm={modalState.onConfirm ?? undefined}
          onClose={() =>
            setModalState({ ...modalState, isVisible: false, onConfirm: null })
          }
        />

        {/* Prompt Modal */}
        <PromptModal
          isVisible={promptState.isVisible}
          title={promptState.title}
          message={promptState.message}
          defaultValue={promptState.defaultValue}
          onClose={() => setPromptState({ ...promptState, isVisible: false })}
          onConfirm={(value) => {
            if (promptState.onConfirm) {
              promptState.onConfirm(value);
            }
            setPromptState({ ...promptState, isVisible: false });
          }}
        />

        {/* Mobile Warning Banner */}
        {isMobile && !mobileWarningDismissed && (
          <div
            style={{
              position: "absolute",
              bottom: 100,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 2000,
              background: "rgba(0, 0, 0, 0.95)",
              color: "#fff",
              padding: "10px 16px",
              borderRadius: 0,
              display: "flex",
              alignItems: "center",
              gap: 12,
              fontSize: 14,
              maxWidth: "90%",
              textAlign: "center",
              boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            }}
          >
            <span>
              📱 Best experienced on desktop — mobile may be a bit janky!
            </span>
            <button
              onClick={() => setMobileWarningDismissed(true)}
              style={{
                background: "transparent",
                border: "1px solid rgba(255,255,255,0.3)",
                color: "#fff",
                padding: "4px 10px",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 13,
                whiteSpace: "nowrap",
              }}
            >
              Got it
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
