"use client";

import { useState, useRef, useCallback, useEffect, MouseEvent } from "react";
import { ToolType } from "../game/types";
import {
  CATEGORY_NAMES,
  BuildingCategory,
  getBuildingsByCategory,
  getCategories,
  getBuilding,
  BuildingDefinition,
} from "@/app/data/buildings";
import { playDoubleClickSound, playClickSound } from "@/app/utils/sounds";

interface ToolWindowProps {
  selectedTool: ToolType;
  selectedBuildingId: string | null;
  onToolSelect: (tool: ToolType) => void;
  onBuildingSelect: (buildingId: string) => void;
  onSpawnCharacter: () => void;
  onSpawnCar: () => void;
  onRotate?: () => void;
  isVisible: boolean;
  onClose: () => void;
}

// Get the preview sprite for a building (prefer south, fall back to first available)
function getBuildingPreviewSprite(building: BuildingDefinition): string {
  return building.sprites.south || Object.values(building.sprites)[0] || "";
}

// Calculate zoom level based on building footprint size
// Smaller buildings need more zoom, larger buildings need less
function getBuildingPreviewZoom(building: BuildingDefinition): number {
  const footprintSize = Math.max(
    building.footprint.width,
    building.footprint.height
  );
  // Scale: 1x1 = 950%, 2x2 = 500%, 3x3 = 380%, 4x4 = 280%, 6x6 = 200%, 8x8 = 150%
  if (footprintSize === 1) return 950;
  if (footprintSize === 2) return 500;
  const zoom = Math.max(150, 450 - footprintSize * 40);
  return zoom;
}

// Tab icons for each category
const CATEGORY_ICONS: Record<BuildingCategory, string> = {
  residential: "🏠",
  commercial: "🏪",
  props: "🌳",
  christmas: "🎄",
  civic: "🏛️",
  landmark: "🏰",
};

export default function ToolWindow({
  selectedTool,
  selectedBuildingId,
  onToolSelect,
  onBuildingSelect,
  onSpawnCharacter,
  onSpawnCar,
  onRotate,
  isVisible,
  onClose,
}: ToolWindowProps) {
  // Calculate initial position (lazy to avoid SSR issues)
  const [position, setPosition] = useState(() => {
    if (typeof window === "undefined") {
      return { x: 10, y: 50 };
    }
    const isMobile = window.innerWidth < 768 || "ontouchstart" in window;
    if (isMobile) {
      const menuWidth = Math.min(520, window.innerWidth - 20);
      return {
        x: Math.max(10, (window.innerWidth - menuWidth) / 2),
        y: 60,
      };
    } else {
      return {
        x: Math.max(10, window.innerWidth - 530),
        y: 50,
      };
    }
  });
  const [isDragging, setIsDragging] = useState(false);
  const [activeTab, setActiveTab] = useState<"tools" | BuildingCategory>(
    "tools"
  );
  const [hoveredBuilding, setHoveredBuilding] = useState<string | null>(null);
  const [windowSize, setWindowSize] = useState({
    width: typeof window !== "undefined" ? window.innerWidth : 1000,
    height: typeof window !== "undefined" ? window.innerHeight : 800,
  });
  const dragOffset = useRef({ x: 0, y: 0 });

  // Track window resize for responsive sizing
  useEffect(() => {
    const handleResize = () => {
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    // Set initial size
    handleResize();

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const handleMouseDown = useCallback(
    (e: MouseEvent) => {
      setIsDragging(true);
      dragOffset.current = {
        x: e.clientX - position.x,
        y: e.clientY - position.y,
      };
    },
    [position]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (isDragging) {
        setPosition({
          x: e.clientX - dragOffset.current.x,
          y: e.clientY - dragOffset.current.y,
        });
      }
    },
    [isDragging]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  if (!isVisible) return null;

  // Get buildings grouped by category
  const categories = getCategories();

  // Get current tab title
  const getTabTitle = () => {
    if (activeTab === "tools") return "Tools";
    return CATEGORY_NAMES[activeTab];
  };

  // Calculate responsive width: use 520px or screen width/height (whichever is smaller)
  const baseWidth = 520;
  const responsiveWidth = Math.min(
    baseWidth,
    windowSize.width - 20,
    windowSize.height
  );

  return (
    <div
      className="rct-frame"
      style={{
        position: "absolute",
        left: Math.min(position.x, windowSize.width - responsiveWidth - 10),
        top: position.y,
        width: responsiveWidth,
        maxHeight: Math.min(400, windowSize.height - 100),
        display: "flex",
        flexDirection: "column",
        zIndex: 1000,
        userSelect: "none",
        overflow: "hidden",
      }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={(e) => e.stopPropagation()}
    >
      {/* Title bar */}
      <div className="rct-titlebar" onMouseDown={handleMouseDown}>
        <span>{getTabTitle()}</span>
        <button
          className="rct-close"
          onClick={() => {
            onClose();
            playDoubleClickSound();
          }}
        >
          ×
        </button>
      </div>

      {/* Category Tabs */}
      <div
        style={{
          display: "flex",
          gap: 2,
          padding: "4px 4px 0 4px",
          background: "var(--rct-frame-mid)",
          borderBottom: "2px solid var(--rct-frame-dark)",
        }}
      >
        {/* Tools tab */}
        <button
          onClick={() => {
            if (activeTab !== "tools") {
              setActiveTab("tools");
              playDoubleClickSound();
            }
          }}
          className={`rct-button ${activeTab === "tools" ? "active" : ""}`}
          style={{
            padding: "4px 8px",
            fontSize: 14,
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
          title="Tools"
        >
          🔧
        </button>

        {/* Category tabs */}
        {categories.map((category) => {
          const buildings = getBuildingsByCategory(category);
          if (buildings.length === 0) return null;

          // Use first building's sprite as tab icon
          const firstBuilding = buildings[0];
          const previewSprite = getBuildingPreviewSprite(firstBuilding);
          const previewZoom = getBuildingPreviewZoom(firstBuilding);

          return (
            <button
              key={category}
              onClick={() => {
                if (activeTab !== category) {
                  setActiveTab(category);
                  playDoubleClickSound();
                }
              }}
              className={`rct-button ${activeTab === category ? "active" : ""}`}
              style={{
                padding: 4,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                minWidth: 36,
                minHeight: 32,
              }}
              title={CATEGORY_NAMES[category]}
            >
              <div
                style={{
                  width: 28,
                  height: 28,
                  overflow: "hidden",
                  position: "relative",
                  display: "flex",
                  alignItems: "flex-end",
                  justifyContent: "center",
                }}
              >
                {/* Render at half size then scale up 2x for chunky pixel effect */}
                <img
                  src={previewSprite}
                  alt={CATEGORY_NAMES[category]}
                  style={{
                    width: `${previewZoom / 2}%`,
                    height: `${previewZoom / 2}%`,
                    objectFit: "cover",
                    objectPosition: "center bottom",
                    imageRendering: "pixelated",
                    transform: "scale(2)",
                    transformOrigin: "center bottom",
                  }}
                />
              </div>
            </button>
          );
        })}
      </div>

      {/* Content panel */}
      <div
        className="rct-panel"
        style={{
          padding: 8,
          flex: 1,
          overflowY: "auto",
          overflowX: "hidden",
          minHeight: 0,
        }}
      >
        {/* Tools Tab Content */}
        {activeTab === "tools" && (
          <div>
            {/* Roads/Tiles Section */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(6, 1fr)",
                gap: 6,
                marginBottom: 12,
              }}
            >
              <button
                onClick={() => {
                  onToolSelect(ToolType.RoadNetwork);
                  playClickSound();
                }}
                className={`rct-button ${
                  selectedTool === ToolType.RoadNetwork ? "active" : ""
                }`}
                title="Road"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 8,
                  minHeight: 60,
                }}
              >
                <img
                  src="/Tiles/1x1asphalt.png"
                  alt="Road"
                  style={{
                    width: 40,
                    height: 40,
                    objectFit: "contain",
                    imageRendering: "pixelated",
                  }}
                />
                <span style={{ fontSize: 13, marginTop: 4 }}>Road</span>
              </button>
              <button
                onClick={() => {
                  onToolSelect(ToolType.Asphalt);
                  playClickSound();
                }}
                className={`rct-button ${
                  selectedTool === ToolType.Asphalt ? "active" : ""
                }`}
                title="Asphalt"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 8,
                  minHeight: 60,
                }}
              >
                <img
                  src="/Tiles/1x1asphalt_tile.png"
                  alt="Asphalt"
                  style={{
                    width: 40,
                    height: 40,
                    objectFit: "contain",
                    imageRendering: "pixelated",
                  }}
                />
                <span style={{ fontSize: 13, marginTop: 4 }}>Asphalt</span>
              </button>
              <button
                onClick={() => {
                  onToolSelect(ToolType.Tile);
                  playClickSound();
                }}
                className={`rct-button ${
                  selectedTool === ToolType.Tile ? "active" : ""
                }`}
                title="Tile"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 8,
                  minHeight: 60,
                }}
              >
                <img
                  src="/Tiles/1x1square_tile.png"
                  alt="Tile"
                  style={{
                    width: 40,
                    height: 40,
                    objectFit: "contain",
                    imageRendering: "pixelated",
                  }}
                />
                <span style={{ fontSize: 13, marginTop: 4 }}>Tile</span>
              </button>
              <button
                onClick={() => {
                  onToolSelect(ToolType.Snow);
                  playClickSound();
                }}
                className={`rct-button ${
                  selectedTool === ToolType.Snow ? "active" : ""
                }`}
                title="Snow"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 8,
                  minHeight: 60,
                }}
              >
                <img
                  src="/Tiles/1x1snow_tile_1.png"
                  alt="Snow"
                  style={{
                    width: 40,
                    height: 40,
                    objectFit: "contain",
                    imageRendering: "pixelated",
                  }}
                />
                <span style={{ fontSize: 13, marginTop: 4 }}>Snow</span>
              </button>
            </div>

            {/* Divider */}
            <div
              style={{
                height: 2,
                background: "var(--rct-panel-dark)",
                margin: "8px 0",
              }}
            />

            {/* Spawn buttons */}
            <div style={{ display: "flex", gap: 4 }}>
              <button
                onClick={() => {
                  onSpawnCharacter();
                  playClickSound();
                }}
                className="rct-button"
                style={{
                  flex: 1,
                  padding: "8px 12px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  fontSize: 14,
                }}
              >
                <span style={{ fontSize: 14 }}>🍌</span>
                <span>Spawn Citizen</span>
              </button>

              <button
                onClick={() => {
                  onSpawnCar();
                  playClickSound();
                }}
                className="rct-button"
                style={{
                  flex: 1,
                  padding: "8px 12px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  fontSize: 14,
                }}
              >
                <span style={{ fontSize: 14 }}>🚗</span>
                <span>Spawn Car</span>
              </button>
            </div>
          </div>
        )}

        {/* Building Category Content */}
        {activeTab !== "tools" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              gap: 4,
              width: "100%",
            }}
          >
            {getBuildingsByCategory(activeTab).map((building) => {
              const previewSprite = getBuildingPreviewSprite(building);
              const previewZoom = getBuildingPreviewZoom(building);
              const isSelected =
                selectedTool === ToolType.Building &&
                selectedBuildingId === building.id;

              return (
                <button
                  key={building.id}
                  onClick={() => {
                    onToolSelect(ToolType.Building);
                    onBuildingSelect(building.id);
                    playClickSound();
                  }}
                  onMouseEnter={() => setHoveredBuilding(building.name)}
                  onMouseLeave={() => setHoveredBuilding(null)}
                  className={`rct-button ${isSelected ? "active" : ""}`}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: 4,
                    minHeight: 60,
                    overflow: "hidden",
                    background: isSelected
                      ? "var(--rct-button-active)"
                      : undefined,
                  }}
                >
                  <div
                    style={{
                      width: 56,
                      height: 50,
                      display: "flex",
                      alignItems: "flex-end",
                      justifyContent: "center",
                      overflow: "hidden",
                      position: "relative",
                    }}
                  >
                    {/* Render at half size then scale up 2x for chunky pixel effect */}
                    <img
                      src={previewSprite}
                      alt={building.name}
                      style={{
                        width: `${previewZoom / 2}%`,
                        height: `${previewZoom / 2}%`,
                        objectFit: "cover",
                        objectPosition: "center bottom",
                        imageRendering: "pixelated",
                        transform: "scale(2)",
                        transformOrigin: "center bottom",
                      }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer - shows selected/hovered building name and rotate hint */}
      {activeTab !== "tools" && (
        <div
          style={{
            padding: "6px 10px",
            background: "var(--rct-panel-mid)",
            borderTop: "2px solid var(--rct-panel-dark)",
            fontSize: 16,
            minHeight: 24,
            color: "var(--rct-text-light)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            textShadow: "1px 1px 0 var(--rct-text-shadow)",
          }}
        >
          <span>
            {hoveredBuilding ||
              (selectedBuildingId && selectedTool === ToolType.Building
                ? getBuilding(selectedBuildingId)?.name
                : "") ||
              ""}
          </span>
          {selectedTool === ToolType.Building && selectedBuildingId && (
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ opacity: 0.7, fontSize: 14 }}>
                press &quot;R&quot; to rotate
              </span>
              <button
                className="rct-button"
                onClick={() => {
                  onRotate?.();
                  playClickSound();
                }}
                style={{
                  padding: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                title="Rotate building"
              >
                <img
                  src="/UI/r20x20rotate.png"
                  alt="Rotate"
                  style={{
                    width: 32,
                    height: 32,
                    imageRendering: "pixelated",
                  }}
                />
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
