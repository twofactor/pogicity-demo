"use client";

import { Car, TILE_WIDTH, TILE_HEIGHT, gridToIso, Direction, CarType } from "./types";

interface CarProps {
  car: Car;
  offsetX: number;
  offsetY: number;
}

// Map direction and car type to sprite filename
function getCarSprite(direction: Direction, carType: CarType): string {
  const prefix = carType === CarType.Taxi ? "taxi" : "jeep";
  
  switch (direction) {
    case Direction.Up:
      return `/Cars/${prefix}n.png`; // North
    case Direction.Down:
      return `/Cars/${prefix}s.png`; // South
    case Direction.Left:
      return `/Cars/${prefix}w.png`; // West
    case Direction.Right:
      return `/Cars/${prefix}e.png`; // East
    default:
      return `/Cars/${prefix}s.png`; // Default to south
  }
}

export default function CarSprite({ car, offsetX, offsetY }: CarProps) {
  const { x, y, direction, carType } = car;

  const isoPos = gridToIso(x, y);

  // Center car on the tile, shift down slightly to align with road
  // Round to nearest pixel for pixelated movement
  const pixelX = Math.round(offsetX + isoPos.x + TILE_WIDTH / 2);
  const pixelY = Math.round(offsetY + isoPos.y + TILE_HEIGHT / 2); // Shift down to align with road surface

  return (
    <div
      style={{
        position: "absolute",
        left: pixelX,
        top: pixelY,
        transform: "translate(-50%, -100%)",
        zIndex: Math.floor((x + y) * 10) + 8, // Above tiles, slightly below characters
        pointerEvents: "none",
      }}
    >
      <img
        src={getCarSprite(direction, carType)}
        alt="Car"
        style={{
          height: "auto",
          width: "auto",
          maxHeight: 40,
          imageRendering: "pixelated",
          display: "block",
        }}
      />
    </div>
  );
}


