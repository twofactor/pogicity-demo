"use client";

import { useState, useRef, useCallback, MouseEvent } from "react";
import { playDoubleClickSound, playClickSound } from "@/app/utils/sounds";

export interface VisualSettings {
  blueness: number;      // -100 to 100 (hue shift toward blue)
  contrast: number;      // 0.5 to 2.0
  saturation: number;    // 0.5 to 2.0
  brightness: number;    // 0.5 to 2.0
}

interface DebugWindowProps {
  settings: VisualSettings;
  onSettingsChange: (settings: VisualSettings) => void;
  showPaths: boolean;
  onShowPathsChange: (show: boolean) => void;
  showStats: boolean;
  onShowStatsChange: (show: boolean) => void;
  isVisible: boolean;
  onClose: () => void;
  initialPosition?: { x: number; y: number };
}

export default function DebugWindow({
  settings,
  onSettingsChange,
  showPaths,
  onShowPathsChange,
  showStats,
  onShowStatsChange,
  isVisible,
  onClose,
  initialPosition = { x: 240, y: 60 },
}: DebugWindowProps) {
  if (!isVisible) return null;

  const [position, setPosition] = useState(initialPosition);
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });

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

  const handleSliderChange = (key: keyof VisualSettings, value: number) => {
    onSettingsChange({
      ...settings,
      [key]: value,
    });
  };

  const handleReset = () => {
    onSettingsChange({
      blueness: 0,
      contrast: 1.0,
      saturation: 1.0,
      brightness: 1.0,
    });
  };

  // Preset: Cool & Crisp (more blue, higher contrast)
  const applyCoolCrisp = () => {
    onSettingsChange({
      blueness: 25,
      contrast: 1.25,
      saturation: 0.95,
      brightness: 1.05,
    });
  };

  return (
    <div
      className="rct-frame"
      style={{
        position: "absolute",
        left: position.x,
        top: position.y,
        width: 220,
        zIndex: 1001,
        userSelect: "none",
      }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={(e) => e.stopPropagation()}
    >
      {/* Title bar */}
      <div className="rct-titlebar" onMouseDown={handleMouseDown}>
        <span>🎨 Visual Debug</span>
        <button className="rct-close" onClick={() => {
          onClose();
          playDoubleClickSound();
        }}>
          ×
        </button>
      </div>

      {/* Content */}
      <div className="rct-panel" style={{ padding: 12 }}>
        {/* Blueness Slider */}
        <div style={{ marginBottom: 12 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: "bold",
              color: "var(--rct-panel-dark)",
              marginBottom: 4,
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span>BLUENESS (Color Temp)</span>
            <span style={{ fontFamily: "monospace" }}>
              {settings.blueness > 0 ? "+" : ""}{settings.blueness}°
            </span>
          </div>
          <input
            type="range"
            min="-50"
            max="50"
            step="1"
            value={settings.blueness}
            onChange={(e) => handleSliderChange("blueness", parseInt(e.target.value))}
            style={{
              width: "100%",
              accentColor: "#5588cc",
            }}
          />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 8,
              color: "var(--rct-panel-dark)",
              marginTop: 2,
            }}
          >
            <span>🟠 Warm</span>
            <span>🔵 Cool</span>
          </div>
        </div>

        {/* Contrast Slider */}
        <div style={{ marginBottom: 12 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: "bold",
              color: "var(--rct-panel-dark)",
              marginBottom: 4,
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span>CONTRAST</span>
            <span style={{ fontFamily: "monospace" }}>
              {(settings.contrast * 100).toFixed(0)}%
            </span>
          </div>
          <input
            type="range"
            min="50"
            max="200"
            step="5"
            value={settings.contrast * 100}
            onChange={(e) => handleSliderChange("contrast", parseInt(e.target.value) / 100)}
            style={{
              width: "100%",
              accentColor: "#888888",
            }}
          />
        </div>

        {/* Saturation Slider */}
        <div style={{ marginBottom: 12 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: "bold",
              color: "var(--rct-panel-dark)",
              marginBottom: 4,
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span>SATURATION</span>
            <span style={{ fontFamily: "monospace" }}>
              {(settings.saturation * 100).toFixed(0)}%
            </span>
          </div>
          <input
            type="range"
            min="50"
            max="200"
            step="5"
            value={settings.saturation * 100}
            onChange={(e) => handleSliderChange("saturation", parseInt(e.target.value) / 100)}
            style={{
              width: "100%",
              accentColor: "#cc6688",
            }}
          />
        </div>

        {/* Brightness Slider */}
        <div style={{ marginBottom: 12 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: "bold",
              color: "var(--rct-panel-dark)",
              marginBottom: 4,
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span>BRIGHTNESS</span>
            <span style={{ fontFamily: "monospace" }}>
              {(settings.brightness * 100).toFixed(0)}%
            </span>
          </div>
          <input
            type="range"
            min="50"
            max="200"
            step="5"
            value={settings.brightness * 100}
            onChange={(e) => handleSliderChange("brightness", parseInt(e.target.value) / 100)}
            style={{
              width: "100%",
              accentColor: "#cccc66",
            }}
          />
        </div>

        {/* Divider */}
        <div
          style={{
            height: 2,
            background: "var(--rct-panel-dark)",
            margin: "12px 0",
          }}
        />

        {/* Debug Toggles */}
        <div style={{ marginBottom: 12 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: "bold",
              color: "var(--rct-panel-dark)",
              marginBottom: 8,
              textTransform: "uppercase",
            }}
          >
            Debug Overlays
          </div>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              cursor: "pointer",
              fontSize: 14,
              marginBottom: 6,
            }}
          >
            <input
              type="checkbox"
              checked={showStats}
              onChange={(e) => onShowStatsChange(e.target.checked)}
              style={{ cursor: "pointer" }}
            />
            <span>📊 Show FPS & Stats</span>
          </label>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            <input
              type="checkbox"
              checked={showPaths}
              onChange={(e) => onShowPathsChange(e.target.checked)}
              style={{ cursor: "pointer" }}
            />
            <span>🚶 Show Walkable Paths</span>
          </label>
        </div>

        {/* Divider */}
        <div
          style={{
            height: 2,
            background: "var(--rct-panel-dark)",
            margin: "12px 0",
          }}
        />

        {/* Preset Buttons */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <button
            onClick={applyCoolCrisp}
            className="rct-button"
            style={{
              width: "100%",
              padding: "6px 12px",
              fontSize: 14,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
          >
            <span>❄️</span>
            <span>Cool & Crisp</span>
          </button>
          <button
            onClick={handleReset}
            className="rct-button"
            style={{
              width: "100%",
              padding: "6px 12px",
              fontSize: 14,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
          >
            <span>↩️</span>
            <span>Reset to Default</span>
          </button>
        </div>
      </div>
    </div>
  );
}


