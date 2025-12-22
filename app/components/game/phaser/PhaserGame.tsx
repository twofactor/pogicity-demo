"use client";

import {
  useEffect,
  useRef,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from "react";
import Phaser from "phaser";
import { MainScene, SceneEvents } from "./MainScene";
import { createGameConfig } from "./gameConfig";
import { GridCell, ToolType, Direction, Car } from "../types";

// Exposed methods for parent component
export interface PhaserGameHandle {
  spawnCharacter: () => boolean;
  spawnCar: () => boolean;
  setDrivingState: (isDriving: boolean) => void;
  getPlayerCar: () => Car | null;
  isPlayerDriving: () => boolean;
  getCharacterCount: () => number;
  getCarCount: () => number;
  clearCharacters: () => void;
  clearCars: () => void;
  shakeScreen: (axis?: "x" | "y", intensity?: number, duration?: number) => void;
  zoomAtPoint: (zoom: number, screenX: number, screenY: number) => void;
}

interface PhaserGameProps {
  grid: GridCell[][];
  selectedTool: ToolType;
  selectedBuildingId: string | null;
  buildingOrientation: Direction;
  zoom: number;
  onTileClick: (x: number, y: number) => void;
  onTileHover?: (x: number | null, y: number | null) => void;
  onTilesDrag?: (tiles: Array<{ x: number; y: number }>) => void;
  onEraserDrag?: (tiles: Array<{ x: number; y: number }>) => void;
  onRoadDrag?: (segments: Array<{ x: number; y: number }>) => void;
  onZoomChange?: (zoom: number) => void;
  showPaths?: boolean;
  showStats?: boolean;
}

const PhaserGame = forwardRef<PhaserGameHandle, PhaserGameProps>(
  function PhaserGame(
    {
      grid,
      selectedTool,
      selectedBuildingId,
      buildingOrientation,
      zoom,
      onTileClick,
      onTileHover,
      onTilesDrag,
      onEraserDrag,
      onRoadDrag,
      onZoomChange,
      showPaths = false,
      showStats = true,
    },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const gameRef = useRef<Phaser.Game | null>(null);
    const sceneRef = useRef<MainScene | null>(null);
    // Track zoom value set via zoomAtPoint to skip re-centering in useEffect
    const zoomFromAtPoint = useRef<number | null>(null);

    // Expose methods to parent via ref
    useImperativeHandle(
      ref,
      () => ({
        spawnCharacter: () => {
          if (sceneRef.current) {
            return sceneRef.current.spawnCharacter();
          }
          return false;
        },
        spawnCar: () => {
          if (sceneRef.current) {
            return sceneRef.current.spawnCar();
          }
          return false;
        },
        setDrivingState: (isDriving: boolean) => {
          if (sceneRef.current) {
            sceneRef.current.setDrivingState(isDriving);
          }
        },
        getPlayerCar: () => {
          if (sceneRef.current) {
            return sceneRef.current.getPlayerCar();
          }
          return null;
        },
        isPlayerDriving: () => {
          if (sceneRef.current) {
            return sceneRef.current.isPlayerDrivingMode();
          }
          return false;
        },
        getCharacterCount: () => {
          if (sceneRef.current) {
            return sceneRef.current.getCharacterCount();
          }
          return 0;
        },
        getCarCount: () => {
          if (sceneRef.current) {
            return sceneRef.current.getCarCount();
          }
          return 0;
        },
        clearCharacters: () => {
          if (sceneRef.current) {
            sceneRef.current.clearCharacters();
          }
        },
        clearCars: () => {
          if (sceneRef.current) {
            sceneRef.current.clearCars();
          }
        },
        shakeScreen: (axis?: "x" | "y", intensity?: number, duration?: number) => {
          if (sceneRef.current) {
            sceneRef.current.shakeScreen(axis, intensity, duration);
          }
        },
        zoomAtPoint: (zoom: number, screenX: number, screenY: number) => {
          if (sceneRef.current) {
            zoomFromAtPoint.current = zoom; // Track this zoom value to skip re-centering
            sceneRef.current.zoomAtPoint(zoom, screenX, screenY);
          }
        },
      }),
      []
    );

    // Initialize Phaser game
    useEffect(() => {
      if (!containerRef.current || gameRef.current) return;

      const scene = new MainScene();
      sceneRef.current = scene;

      const config = createGameConfig(containerRef.current, scene);
      const game = new Phaser.Game(config);
      gameRef.current = game;

      // Wait for the game to boot and scene to be ready
      game.events.once("ready", () => {
        // Set up event callbacks once scene is created
        const events: SceneEvents = {
          onTileClick: (x, y) => onTileClick(x, y),
          onTileHover: (x, y) => onTileHover?.(x, y),
          onTilesDrag: (tiles) => onTilesDrag?.(tiles),
          onEraserDrag: (tiles) => onEraserDrag?.(tiles),
          onRoadDrag: (segments) => onRoadDrag?.(segments),
        };
        scene.setEventCallbacks(events);

        // Listen for zoom changes from Phaser (wheel zoom handled in scene)
        scene.events.on("zoomChanged", (newZoom: number) => {
          onZoomChange?.(newZoom);
        });
      });

      return () => {
        gameRef.current?.destroy(true);
        gameRef.current = null;
        sceneRef.current = null;
      };
    }, []); // Only run once on mount

    // Update grid when it changes (differential update in scene)
    useEffect(() => {
      if (sceneRef.current && grid.length > 0) {
        sceneRef.current.updateGrid(grid);
      }
    }, [grid]);

    // Update selected tool
    useEffect(() => {
      if (sceneRef.current) {
        sceneRef.current.setSelectedTool(selectedTool);
      }
    }, [selectedTool]);

    // Update selected building
    useEffect(() => {
      if (sceneRef.current) {
        sceneRef.current.setSelectedBuilding(selectedBuildingId);
      }
    }, [selectedBuildingId]);

    // Update building orientation
    useEffect(() => {
      if (sceneRef.current) {
        sceneRef.current.setBuildingOrientation(buildingOrientation);
      }
    }, [buildingOrientation]);

    // Update zoom (skip if zoomAtPoint already handled it)
    useEffect(() => {
      if (zoomFromAtPoint.current === zoom) {
        zoomFromAtPoint.current = null;
        return;
      }
      zoomFromAtPoint.current = null;
      if (sceneRef.current) {
        sceneRef.current.setZoom(zoom);
      }
    }, [zoom]);

    // Update show paths debug mode
    useEffect(() => {
      if (sceneRef.current) {
        sceneRef.current.setShowPaths(showPaths);
      }
    }, [showPaths]);

    // Update show stats
    useEffect(() => {
      if (sceneRef.current) {
        sceneRef.current.setShowStats(showStats);
      }
    }, [showStats]);

    // Update event callbacks when they change
    useEffect(() => {
      if (sceneRef.current) {
        const events: SceneEvents = {
          onTileClick: (x, y) => onTileClick(x, y),
          onTileHover: (x, y) => onTileHover?.(x, y),
          onTilesDrag: (tiles) => onTilesDrag?.(tiles),
          onEraserDrag: (tiles) => onEraserDrag?.(tiles),
          onRoadDrag: (segments) => onRoadDrag?.(segments),
        };
        sceneRef.current.setEventCallbacks(events);
      }
    }, [onTileClick, onTileHover, onTilesDrag, onEraserDrag, onRoadDrag]);

    return (
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%",
          overflow: "auto",
        }}
      >
        <style jsx global>{`
          canvas {
            image-rendering: pixelated;
            image-rendering: -moz-crisp-edges;
            image-rendering: crisp-edges;
          }
        `}</style>
      </div>
    );
  }
);

export default PhaserGame;
