"use client";

import { Character, CharacterType, Direction, TILE_WIDTH, TILE_HEIGHT, gridToIso } from "./types";

interface CharacterProps {
  character: Character;
  offsetX: number;
  offsetY: number;
}

// Map character type and direction to the appropriate walking GIF
const getWalkingSprite = (characterType: CharacterType, direction: Direction): string => {
  const prefix = characterType === CharacterType.Apple ? "apple" : "banana";
  
  switch (direction) {
    case Direction.Up:
      return `/Characters/${prefix}walknorth.gif`;
    case Direction.Down:
      return `/Characters/${prefix}walksouth.gif`;
    case Direction.Left:
      return `/Characters/${prefix}walkwest.gif`;
    case Direction.Right:
      return `/Characters/${prefix}walkeast.gif`;
    default:
      return `/Characters/${prefix}walksouth.gif`;
  }
};

export default function CharacterSprite({
  character,
  offsetX,
  offsetY,
}: CharacterProps) {
  const { x, y, direction, characterType } = character;

  // Convert grid position to isometric screen position
  const isoPos = gridToIso(x, y);

  // Position character at tile center
  const pixelX = offsetX + isoPos.x + TILE_WIDTH / 2;
  const pixelY = offsetY + isoPos.y;

  // Use tile position as key to reset animation when crossing tile boundaries
  // This helps sync the animation with movement - each tile gets a fresh animation cycle
  // We use Math.floor to ensure the key only changes when entering a new tile
  const tileX = Math.floor(x);
  const tileY = Math.floor(y);
  const tileKey = `${tileX},${tileY}`;

  return (
    <div
      style={{
        position: "absolute",
        // Center horizontally on tile, position feet near tile center
        left: pixelX,
        top: pixelY,
        transform: "translate(-50%, -100%)",
        // Depth based on position, with offset to stay above ground tiles
        // +9 ensures characters render above the tile they're on but still respect building depth
        zIndex: Math.floor((x + y) * 10) + 9,
        pointerEvents: "none",
      }}
    >
      <img
        key={`${tileKey}-${direction}-${characterType}`} // Reset animation when tile, direction, or type changes
        src={getWalkingSprite(characterType, direction)}
        alt="Character"
        style={{
          // Let the gif display at natural size, no squishing
          height: "auto",
          width: "auto",
          maxHeight: 48,
          imageRendering: "pixelated",
          display: "block",
        }}
      />
    </div>
  );
}
