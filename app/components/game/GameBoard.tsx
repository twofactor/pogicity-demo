"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
  ROAD_SEGMENT_SIZE,
  getRoadSegmentOrigin,
  hasRoadSegment,
  getRoadConnections,
  getSegmentType,
  generateRoadPattern,
  getAffectedSegments,
  canPlaceRoadSegment,
} from "./roadUtils";
import { getBuilding, getBuildingFootprint } from "@/app/data/buildings";
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
  // Grid state (only thing React manages now)
  const [grid, setGrid] = useState<GridCell[][]>(createEmptyGrid);

  // UI state
  const [selectedTool, setSelectedTool] = useState<ToolType>(ToolType.None);
  const [zoom, setZoom] = useState(1);
  const [debugPaths, setDebugPaths] = useState(false);
  const [showStats, setShowStats] = useState(false);
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
      setGrid((prevGrid) => {
        const newGrid = prevGrid.map((row) => row.map((cell) => ({ ...cell })));

        switch (selectedTool) {
          case ToolType.None: {
            break;
          }
          case ToolType.RoadNetwork: {
            const segmentOrigin = getRoadSegmentOrigin(x, y);
            const placementCheck = canPlaceRoadSegment(
              newGrid,
              segmentOrigin.x,
              segmentOrigin.y
            );
            if (!placementCheck.valid) break;

            for (let dy = 0; dy < ROAD_SEGMENT_SIZE; dy++) {
              for (let dx = 0; dx < ROAD_SEGMENT_SIZE; dx++) {
                const px = segmentOrigin.x + dx;
                const py = segmentOrigin.y + dy;
                if (px < GRID_WIDTH && py < GRID_HEIGHT) {
                  newGrid[py][px].isOrigin = dx === 0 && dy === 0;
                  newGrid[py][px].originX = segmentOrigin.x;
                  newGrid[py][px].originY = segmentOrigin.y;
                  newGrid[py][px].type = TileType.Road;
                }
              }
            }

            const affectedSegments = getAffectedSegments(
              segmentOrigin.x,
              segmentOrigin.y
            );

            for (const seg of affectedSegments) {
              if (!hasRoadSegment(newGrid, seg.x, seg.y)) continue;

              const connections = getRoadConnections(newGrid, seg.x, seg.y);
              const segmentType = getSegmentType(connections);
              const pattern = generateRoadPattern(segmentType);

              for (const tile of pattern) {
                const px = seg.x + tile.dx;
                const py = seg.y + tile.dy;
                if (px < GRID_WIDTH && py < GRID_HEIGHT) {
                  newGrid[py][px].type = tile.type;
                }
              }
            }
            playBuildRoadSound();
            break;
          }
          case ToolType.Tile: {
            if (x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT) {
              const cell = newGrid[y][x];
              if (cell.type === TileType.Building && cell.buildingId) {
                const building = getBuilding(cell.buildingId);
                if (
                  building &&
                  (building.category === "props" || building.isDecoration)
                ) {
                  newGrid[y][x].underlyingTileType = TileType.Tile;
                } else {
                  break;
                }
              } else if (
                cell.type === TileType.Grass ||
                cell.type === TileType.Snow
              ) {
                newGrid[y][x].type = TileType.Tile;
                newGrid[y][x].isOrigin = true;
                newGrid[y][x].originX = x;
                newGrid[y][x].originY = y;
              } else {
                break;
              }
              playBuildRoadSound();
            }
            break;
          }
          case ToolType.Asphalt: {
            if (x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT) {
              const cell = newGrid[y][x];
              if (cell.type === TileType.Building && cell.buildingId) {
                const building = getBuilding(cell.buildingId);
                if (
                  building &&
                  (building.category === "props" || building.isDecoration)
                ) {
                  newGrid[y][x].underlyingTileType = TileType.Asphalt;
                } else {
                  break;
                }
              } else if (
                cell.type === TileType.Grass ||
                cell.type === TileType.Snow ||
                cell.type === TileType.Tile
              ) {
                newGrid[y][x].type = TileType.Asphalt;
                newGrid[y][x].isOrigin = true;
                newGrid[y][x].originX = x;
                newGrid[y][x].originY = y;
              } else {
                break;
              }
              playBuildRoadSound();
            }
            break;
          }
          case ToolType.Snow: {
            if (x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT) {
              const cell = newGrid[y][x];
              if (cell.type === TileType.Building && cell.buildingId) {
                const building = getBuilding(cell.buildingId);
                if (
                  building &&
                  (building.category === "props" || building.isDecoration)
                ) {
                  newGrid[y][x].underlyingTileType = TileType.Snow;
                } else {
                  break;
                }
              } else if (
                cell.type === TileType.Grass ||
                cell.type === TileType.Tile
              ) {
                newGrid[y][x].type = TileType.Snow;
                newGrid[y][x].isOrigin = true;
                newGrid[y][x].originX = x;
                newGrid[y][x].originY = y;
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
                  const cellType = newGrid[py][px].type;
                  if (isDecoration) {
                    // Decorations can be placed on grass, tile, or snow
                    if (
                      cellType !== TileType.Grass &&
                      cellType !== TileType.Tile &&
                      cellType !== TileType.Snow
                    ) {
                      buildingHasCollision = true;
                    }
                  } else {
                    if (cellType !== TileType.Grass) {
                      buildingHasCollision = true;
                    }
                  }
                }
              }
            }
            if (buildingHasCollision) break;

            for (let dy = 0; dy < footprint.height; dy++) {
              for (let dx = 0; dx < footprint.width; dx++) {
                const px = bOriginX + dx;
                const py = bOriginY + dy;
                if (px < GRID_WIDTH && py < GRID_HEIGHT) {
                  const underlyingType = isDecoration
                    ? newGrid[py][px].type
                    : undefined;
                  newGrid[py][px].type = TileType.Building;
                  newGrid[py][px].buildingId = selectedBuildingId;
                  newGrid[py][px].isOrigin = dx === 0 && dy === 0;
                  newGrid[py][px].originX = bOriginX;
                  newGrid[py][px].originY = bOriginY;
                  if (isDecoration) {
                    newGrid[py][px].underlyingTileType = underlyingType;
                  }
                  if (building.supportsRotation) {
                    newGrid[py][px].buildingOrientation = buildingOrientation;
                  }
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
            const cell = newGrid[y][x];
            const originX = cell.originX;
            const originY = cell.originY;
            const cellType = cell.type;

            const shouldPlaySound = cellType !== TileType.Grass;

            if (originX !== undefined && originY !== undefined) {
              const isRoadSegment =
                hasRoadSegment(newGrid, originX, originY) &&
                (cellType === TileType.Road || cellType === TileType.Asphalt);

              if (isRoadSegment) {
                const neighbors = getAffectedSegments(originX, originY).filter(
                  (seg) => seg.x !== originX || seg.y !== originY
                );

                for (let dy = 0; dy < ROAD_SEGMENT_SIZE; dy++) {
                  for (let dx = 0; dx < ROAD_SEGMENT_SIZE; dx++) {
                    const px = originX + dx;
                    const py = originY + dy;
                    if (px < GRID_WIDTH && py < GRID_HEIGHT) {
                      newGrid[py][px].type = TileType.Grass;
                      newGrid[py][px].isOrigin = true;
                      newGrid[py][px].originX = undefined;
                      newGrid[py][px].originY = undefined;
                    }
                  }
                }

                for (const seg of neighbors) {
                  if (!hasRoadSegment(newGrid, seg.x, seg.y)) continue;

                  const connections = getRoadConnections(newGrid, seg.x, seg.y);
                  const segmentType = getSegmentType(connections);
                  const pattern = generateRoadPattern(segmentType);

                  for (const tile of pattern) {
                    const px = seg.x + tile.dx;
                    const py = seg.y + tile.dy;
                    if (px < GRID_WIDTH && py < GRID_HEIGHT) {
                      newGrid[py][px].type = tile.type;
                    }
                  }
                }

                if (shouldPlaySound) {
                  playDestructionSound();
                  // Horizontal shake on deletion
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
                      newGrid[py][px].type = TileType.Grass;
                      newGrid[py][px].buildingId = undefined;
                      newGrid[py][px].isOrigin = true;
                      newGrid[py][px].originX = undefined;
                      newGrid[py][px].originY = undefined;
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
              newGrid[y][x].type = TileType.Grass;
              newGrid[y][x].isOrigin = true;
              playDestructionSound();
              // Horizontal shake on deletion
              phaserGameRef.current?.shakeScreen("x", 0.6, 150);
            }
            break;
          }
        }

        return newGrid;
      });
    },
    [selectedTool, selectedBuildingId, buildingOrientation]
  );

  // Handle batch tile placement from drag operations (snow/tile tools)
  const handleTilesDrag = useCallback(
    (tiles: Array<{ x: number; y: number }>) => {
      if (tiles.length === 0) return;

      setGrid((prevGrid) => {
        const newGrid = prevGrid.map((row) => row.map((cell) => ({ ...cell })));
        let anyPlaced = false;

        for (const { x, y } of tiles) {
          if (x < 0 || x >= GRID_WIDTH || y < 0 || y >= GRID_HEIGHT) continue;

          const cell = newGrid[y][x];

          if (selectedTool === ToolType.Snow) {
            if (cell.type === TileType.Building && cell.buildingId) {
              const building = getBuilding(cell.buildingId);
              if (
                building &&
                (building.category === "props" || building.isDecoration)
              ) {
                newGrid[y][x].underlyingTileType = TileType.Snow;
                anyPlaced = true;
              }
            } else if (
              cell.type === TileType.Grass ||
              cell.type === TileType.Tile
            ) {
              newGrid[y][x].type = TileType.Snow;
              newGrid[y][x].isOrigin = true;
              newGrid[y][x].originX = x;
              newGrid[y][x].originY = y;
              anyPlaced = true;
            }
          } else if (selectedTool === ToolType.Tile) {
            if (cell.type === TileType.Building && cell.buildingId) {
              const building = getBuilding(cell.buildingId);
              if (
                building &&
                (building.category === "props" || building.isDecoration)
              ) {
                newGrid[y][x].underlyingTileType = TileType.Tile;
                anyPlaced = true;
              }
            } else if (
              cell.type === TileType.Grass ||
              cell.type === TileType.Snow
            ) {
              newGrid[y][x].type = TileType.Tile;
              newGrid[y][x].isOrigin = true;
              newGrid[y][x].originX = x;
              newGrid[y][x].originY = y;
              anyPlaced = true;
            }
          } else if (selectedTool === ToolType.Asphalt) {
            if (cell.type === TileType.Building && cell.buildingId) {
              const building = getBuilding(cell.buildingId);
              if (
                building &&
                (building.category === "props" || building.isDecoration)
              ) {
                newGrid[y][x].underlyingTileType = TileType.Asphalt;
                anyPlaced = true;
              }
            } else if (
              cell.type === TileType.Grass ||
              cell.type === TileType.Snow ||
              cell.type === TileType.Tile
            ) {
              newGrid[y][x].type = TileType.Asphalt;
              newGrid[y][x].isOrigin = true;
              newGrid[y][x].originX = x;
              newGrid[y][x].originY = y;
              anyPlaced = true;
            }
          }
        }

        if (anyPlaced) {
          playBuildRoadSound();
        }

        return newGrid;
      });
    },
    [selectedTool]
  );

  // Handle batch road segment placement from drag operations
  const handleRoadDrag = useCallback(
    (segments: Array<{ x: number; y: number }>) => {
      if (segments.length === 0) return;

      setGrid((prevGrid) => {
        const newGrid = prevGrid.map((row) => row.map((cell) => ({ ...cell })));
        let anyPlaced = false;

        // Place all road segments
        for (const { x: segmentX, y: segmentY } of segments) {
          const placementCheck = canPlaceRoadSegment(
            newGrid,
            segmentX,
            segmentY
          );
          if (!placementCheck.valid) continue;

          for (let dy = 0; dy < ROAD_SEGMENT_SIZE; dy++) {
            for (let dx = 0; dx < ROAD_SEGMENT_SIZE; dx++) {
              const px = segmentX + dx;
              const py = segmentY + dy;
              if (px < GRID_WIDTH && py < GRID_HEIGHT) {
                newGrid[py][px].isOrigin = dx === 0 && dy === 0;
                newGrid[py][px].originX = segmentX;
                newGrid[py][px].originY = segmentY;
                newGrid[py][px].type = TileType.Road;
                anyPlaced = true;
              }
            }
          }
        }

        if (anyPlaced) {
          // Update all affected segments (including neighbors)
          const allAffectedSegments = new Set<string>();
          for (const { x: segmentX, y: segmentY } of segments) {
            const affectedSegments = getAffectedSegments(segmentX, segmentY);
            for (const seg of affectedSegments) {
              allAffectedSegments.add(`${seg.x},${seg.y}`);
            }
          }

          for (const segKey of allAffectedSegments) {
            const [segX, segY] = segKey.split(",").map(Number);
            if (!hasRoadSegment(newGrid, segX, segY)) continue;

            const connections = getRoadConnections(newGrid, segX, segY);
            const segmentType = getSegmentType(connections);
            const pattern = generateRoadPattern(segmentType);

            for (const tile of pattern) {
              const px = segX + tile.dx;
              const py = segY + tile.dy;
              if (px < GRID_WIDTH && py < GRID_HEIGHT) {
                newGrid[py][px].type = tile.type;
              }
            }
          }

          playBuildRoadSound();
        }

        return newGrid;
      });
    },
    []
  );

  // Perform the actual deletion of tiles
  const performDeletion = useCallback(
    (tiles: Array<{ x: number; y: number }>) => {
      setGrid((prevGrid) => {
        const newGrid = prevGrid.map((row) => row.map((cell) => ({ ...cell })));
        const deletedOrigins = new Set<string>();

        for (const { x, y } of tiles) {
          if (x < 0 || x >= GRID_WIDTH || y < 0 || y >= GRID_HEIGHT) continue;

          const cell = newGrid[y][x];
          if (cell.type === TileType.Grass) continue;

          const originX = cell.originX ?? x;
          const originY = cell.originY ?? y;
          const originKey = `${originX},${originY}`;

          if (deletedOrigins.has(originKey)) continue;
          deletedOrigins.add(originKey);

          const cellType = cell.type;

          if (cellType === TileType.Road || cellType === TileType.Asphalt) {
            const isRoadSegment = hasRoadSegment(newGrid, originX, originY);

            if (isRoadSegment) {
              // Delete road segment
              const neighbors = getAffectedSegments(originX, originY).filter(
                (seg) => seg.x !== originX || seg.y !== originY
              );

              for (let dy = 0; dy < ROAD_SEGMENT_SIZE; dy++) {
                for (let dx = 0; dx < ROAD_SEGMENT_SIZE; dx++) {
                  const px = originX + dx;
                  const py = originY + dy;
                  if (px < GRID_WIDTH && py < GRID_HEIGHT) {
                    newGrid[py][px].type = TileType.Grass;
                    newGrid[py][px].isOrigin = true;
                    newGrid[py][px].originX = undefined;
                    newGrid[py][px].originY = undefined;
                  }
                }
              }

              // Update neighboring road segments
              for (const seg of neighbors) {
                if (!hasRoadSegment(newGrid, seg.x, seg.y)) continue;

                const connections = getRoadConnections(newGrid, seg.x, seg.y);
                const segmentType = getSegmentType(connections);
                const pattern = generateRoadPattern(segmentType);

                for (const tile of pattern) {
                  const px = seg.x + tile.dx;
                  const py = seg.y + tile.dy;
                  if (px < GRID_WIDTH && py < GRID_HEIGHT) {
                    newGrid[py][px].type = tile.type;
                  }
                }
              }
            } else {
              // Single tile
              newGrid[y][x].type = TileType.Grass;
              newGrid[y][x].isOrigin = true;
              newGrid[y][x].originX = undefined;
              newGrid[y][x].originY = undefined;
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
                  newGrid[py][px].type = TileType.Grass;
                  newGrid[py][px].buildingId = undefined;
                  newGrid[py][px].isOrigin = true;
                  newGrid[py][px].originX = undefined;
                  newGrid[py][px].originY = undefined;
                }
              }
            }
          } else {
            // Snow, Tile, or other single tiles
            newGrid[y][x].type = TileType.Grass;
            newGrid[y][x].isOrigin = true;
            newGrid[y][x].originX = undefined;
            newGrid[y][x].originY = undefined;
          }
        }

        playDestructionSound();
        // Horizontal shake on deletion (eraser drag / bulk delete path)
        phaserGameRef.current?.shakeScreen("x", 0.6, 150);
        return newGrid;
      });
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
        } else if (
          cell.type === TileType.Road ||
          cell.type === TileType.Asphalt
        ) {
          const isRoadSegment = hasRoadSegment(grid, originX, originY);
          if (isRoadSegment) {
            itemsToDelete.add(`road:${originKey}`);
          } else {
            itemsToDelete.add(`tile:${x},${y}`);
          }
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
          message: "Please place some roads with asphalt first!",
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
      // Restore grid
      setGrid(saveData.grid);

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

      // Wait for grid to update, then spawn characters and cars
      setTimeout(() => {
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
            selectedTool={selectedTool}
            selectedBuildingId={selectedBuildingId}
            buildingOrientation={buildingOrientation}
            zoom={zoom}
            onTileClick={handleTileClick}
            onTilesDrag={handleTilesDrag}
            onEraserDrag={handleEraserDrag}
            onRoadDrag={handleRoadDrag}
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
