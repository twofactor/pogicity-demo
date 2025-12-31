import Phaser from "phaser";
import { GRID_WIDTH, GRID_HEIGHT, SUBTILE_WIDTH, SUBTILE_HEIGHT } from "../types";

// Calculate WORLD size for isometric grid (total game world, not canvas)
// Grid is measured in subtiles (32x16), so use subtile dimensions
const isoWidth = (GRID_WIDTH + GRID_HEIGHT) * (SUBTILE_WIDTH / 2);
const isoHeight = (GRID_WIDTH + GRID_HEIGHT) * (SUBTILE_HEIGHT / 2);

// Add padding for buildings that extend above their footprint
const WORLD_PADDING_TOP = 300;
const WORLD_PADDING_BOTTOM = 100;

export const WORLD_WIDTH = Math.ceil(isoWidth) + SUBTILE_WIDTH * 4;
export const WORLD_HEIGHT =
  Math.ceil(isoHeight) + WORLD_PADDING_TOP + WORLD_PADDING_BOTTOM;

// Offset to center the grid in the world
export const GRID_OFFSET_X = WORLD_WIDTH / 2;
export const GRID_OFFSET_Y = WORLD_PADDING_TOP;

// Legacy exports for compatibility (now world size, not canvas size)
export const GAME_WIDTH = WORLD_WIDTH;
export const GAME_HEIGHT = WORLD_HEIGHT;

export function createGameConfig(
  parent: HTMLElement,
  scene: Phaser.Scene
): Phaser.Types.Core.GameConfig {
  // Canvas matches viewport/container size, NOT world size
  // This dramatically reduces pixels rendered (18M -> ~2M for 1080p)
  const containerWidth = parent.clientWidth || window.innerWidth;
  const containerHeight = parent.clientHeight || window.innerHeight;

  return {
    type: Phaser.AUTO,
    parent,
    width: containerWidth,
    height: containerHeight,
    backgroundColor: "#3d5560",
    pixelArt: true, // Crisp pixel rendering
    roundPixels: true,
    antialias: false,
    scene,
    scale: {
      mode: Phaser.Scale.RESIZE, // Canvas resizes with container
      autoCenter: Phaser.Scale.NO_CENTER,
    },
    fps: {
      target: 60,      // Target for delta time calculations (actual FPS syncs with monitor)
    },
    disableContextMenu: true, // Prevent right-click menu on canvas
  };
}
