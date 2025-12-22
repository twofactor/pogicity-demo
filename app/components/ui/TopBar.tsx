"use client";

import { useState, useRef, useEffect } from "react";

import { LightingType } from "../game/types";

interface TopBarProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onToggleDebug: () => void;
  debugPaths: boolean;
  zoom: number;
  lighting: LightingType;
  onLightingChange: (lighting: LightingType) => void;
  brightness: number;
  onBrightnessChange: (brightness: number) => void;
  debugCharacterSpeed: number;
  onDebugCharacterSpeedChange: (speed: number) => void;
  onSpawnTestCharacterLeft: () => void;
  onSaveGame: () => void;
  onLoadGame: () => void;
}

// Music tracks - names are the actual file names
const MUSIC_TRACKS = [
  "pogicity_music_001.mp3",
  "pogicity_music_002.mp3",
  "pogicity_music_003.mp3",
  "pogicity_music_004.mp3",
  "pogicity_music_005.mp3",
  "pogicity_music_006.mp3",
  "pogicity_music_007.mp3",
];

// RCT1-style icon button
function IconButton({
  icon,
  label,
  onClick,
  active = false,
  small = false,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  active?: boolean;
  small?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`rct-button ${active ? "active" : ""}`}
      style={{
        width: small ? 28 : 36,
        height: small ? 24 : 32,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: small ? 14 : 18,
        padding: 0,
      }}
    >
      {icon}
    </button>
  );
}

// Music player component
function MusicPlayer() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const getTrackPath = (index: number) => `/audio/music/${MUSIC_TRACKS[index]}`;

  useEffect(() => {
    // Create audio element
    audioRef.current = new Audio(getTrackPath(currentTrack));
    audioRef.current.volume = 0.3;

    // Auto-play next track when current ends
    audioRef.current.addEventListener("ended", () => {
      nextTrack();
    });

    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.src = getTrackPath(currentTrack);
      if (isPlaying) {
        audioRef.current.play().catch(() => {});
      }
    }
  }, [currentTrack]);

  const togglePlay = () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(() => {});
    }
    setIsPlaying(!isPlaying);
  };

  const nextTrack = () => {
    setCurrentTrack((prev) => (prev + 1) % MUSIC_TRACKS.length);
  };

  const prevTrack = () => {
    setCurrentTrack((prev) => (prev - 1 + MUSIC_TRACKS.length) % MUSIC_TRACKS.length);
  };

  return (
    <div 
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
      }}
    >
      <IconButton icon="⏮️" label="Previous" onClick={prevTrack} small />
      <IconButton
        icon={isPlaying ? "⏸️" : "▶️"}
        label={isPlaying ? "Pause" : "Play"}
        onClick={togglePlay}
        small
      />
      <IconButton icon="⏭️" label="Next" onClick={nextTrack} small />
      <div
        className="rct-inset"
        style={{
          marginLeft: 4,
          padding: "2px 6px",
          maxWidth: 160,
          overflow: "hidden",
          height: 20,
          display: "flex",
          alignItems: "center",
        }}
      >
        <div
          style={{
            color: isPlaying ? "#2ecc40" : "var(--rct-text-light)",
            fontSize: 10,
            fontWeight: "bold",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            textShadow: "1px 1px 0 var(--rct-text-shadow)",
          }}
        >
          {isPlaying ? "♪ " : ""}
          {MUSIC_TRACKS[currentTrack]}
        </div>
      </div>
    </div>
  );
}

export default function TopBar({
  onZoomIn,
  onZoomOut,
  onToggleDebug,
  debugPaths,
  zoom,
  lighting,
  onLightingChange,
  brightness,
  onBrightnessChange,
  debugCharacterSpeed,
  onDebugCharacterSpeedChange,
  onSpawnTestCharacterLeft,
  onSaveGame,
  onLoadGame,
}: TopBarProps) {
  return (
    <div
      className="rct-frame"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        padding: "4px 8px",
        height: 44,
      }}
    >
      {/* Left section - File/Game controls */}
      <div style={{ display: "flex", gap: 2 }}>
        <IconButton icon="💾" label="Save" onClick={onSaveGame} />
        <IconButton icon="📂" label="Load" onClick={onLoadGame} />
      </div>

      <div
        style={{
          width: 2,
          height: 28,
          background: "var(--rct-frame-dark)",
          margin: "0 4px",
        }}
      />

      {/* View controls */}
      <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
        <IconButton icon="🔍" label="Zoom In" onClick={onZoomIn} />
        <IconButton icon="🔎" label="Zoom Out" onClick={onZoomOut} />
        <div
          style={{
            padding: "0 8px",
            color: "var(--rct-text-light)",
            fontSize: 12,
            fontWeight: "bold",
            textShadow: "1px 1px 0 var(--rct-text-shadow)",
          }}
        >
          {zoom}x
        </div>
      </div>

      <div
        style={{
          width: 2,
          height: 28,
          background: "var(--rct-frame-dark)",
          margin: "0 4px",
        }}
      />

      {/* Debug button - more visible */}
      <IconButton
        icon="🔧"
        label="Debug Paths (Pedestrian & Car)"
        onClick={onToggleDebug}
        active={debugPaths}
      />

      <div
        style={{
          width: 2,
          height: 28,
          background: "var(--rct-frame-dark)",
          margin: "0 4px",
        }}
      />

      {/* Lighting controls */}
      <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
        <IconButton
          icon="☀️"
          label="Day"
          onClick={() => onLightingChange(LightingType.Day)}
          active={lighting === LightingType.Day}
        />
        <IconButton
          icon="🌙"
          label="Night"
          onClick={() => onLightingChange(LightingType.Night)}
          active={lighting === LightingType.Night}
        />
        <IconButton
          icon="🌅"
          label="Sunset"
          onClick={() => onLightingChange(LightingType.Sunset)}
          active={lighting === LightingType.Sunset}
        />
        <div
          style={{
            width: 2,
            height: 28,
            background: "var(--rct-frame-dark)",
            margin: "0 4px",
          }}
        />
        {/* Brightness control */}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <IconButton
            icon="🔆"
            label="Brightness Down"
            onClick={() => onBrightnessChange(Math.max(0.5, brightness - 0.1))}
            small
          />
          <div
            style={{
              padding: "0 8px",
              color: "var(--rct-text-light)",
              fontSize: 10,
              fontWeight: "bold",
              textShadow: "1px 1px 0 var(--rct-text-shadow)",
              minWidth: 40,
              textAlign: "center",
            }}
          >
            {Math.round(brightness * 100)}%
          </div>
          <IconButton
            icon="🔅"
            label="Brightness Up"
            onClick={() => onBrightnessChange(Math.min(2.0, brightness + 0.1))}
            small
          />
        </div>
      </div>

      <div
        style={{
          width: 2,
          height: 28,
          background: "var(--rct-frame-dark)",
          margin: "0 4px",
        }}
      />

      {/* Music player */}
      <MusicPlayer />

      <div
        style={{
          width: 2,
          height: 28,
          background: "var(--rct-frame-dark)",
          margin: "0 4px",
        }}
      />

      {/* Character Animation Debug Tool */}
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <IconButton
          icon="🧪"
          label="Spawn Test Character (Left)"
          onClick={onSpawnTestCharacterLeft}
          small
        />
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <IconButton
            icon="⬇️"
            label="Decrease Speed"
            onClick={() => onDebugCharacterSpeedChange(Math.max(0.001, debugCharacterSpeed - 0.002))}
            small
          />
          <div
            style={{
              padding: "0 8px",
              color: "var(--rct-text-light)",
              fontSize: 10,
              fontWeight: "bold",
              textShadow: "1px 1px 0 var(--rct-text-shadow)",
              minWidth: 80,
              textAlign: "center",
              background: "var(--rct-frame-dark)",
              borderRadius: 4,
            }}
          >
            {debugCharacterSpeed.toFixed(4)}
          </div>
          <IconButton
            icon="⬆️"
            label="Increase Speed"
            onClick={() => onDebugCharacterSpeedChange(Math.min(0.02, debugCharacterSpeed + 0.002))}
            small
          />
        </div>
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Game title */}
      <div
        style={{
          color: "var(--rct-text-light)",
          fontSize: 14,
          fontWeight: "bold",
          textShadow: "1px 1px 0 var(--rct-text-shadow)",
          letterSpacing: 1,
        }}
      >
        POGICITY
      </div>
    </div>
  );
}
