import Phaser from "phaser";
import { parseGIF, decompressFrames } from "gifuct-js";

/**
 * GIF Animation Loader for Phaser
 *
 * Parses animated GIFs and creates Phaser sprite sheets/animations from them.
 */

interface GifFrame {
  patch: ImageData;
  delay: number;
  dims: {
    width: number;
    height: number;
    top: number;
    left: number;
  };
  disposalType: number;
}

interface ParsedGif {
  width: number;
  height: number;
  frames: GifFrame[];
}

/**
 * Load and parse a GIF file, creating a sprite sheet texture and animation
 */
export async function loadGifAsAnimation(
  scene: Phaser.Scene,
  key: string,
  url: string,
  frameRate: number = 10
): Promise<void> {
  try {
    // Fetch the GIF file
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();

    // Parse the GIF
    const gif = parseGIF(arrayBuffer);
    const frames = decompressFrames(gif, true);

    if (frames.length === 0) {
      console.warn(`GIF ${url} has no frames, loading as static image`);
      return;
    }

    const { width, height } = gif.lsd;

    // Create a canvas to composite frames
    const canvas = document.createElement("canvas");
    canvas.width = width * frames.length;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;

    // Composite canvas for building up frames (GIF disposal handling)
    const compositeCanvas = document.createElement("canvas");
    compositeCanvas.width = width;
    compositeCanvas.height = height;
    const compositeCtx = compositeCanvas.getContext("2d")!;

    // Draw each frame to the sprite sheet
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];

      // Create ImageData from the frame patch
      const frameImageData = new ImageData(
        new Uint8ClampedArray(frame.patch),
        frame.dims.width,
        frame.dims.height
      );

      // Create a temporary canvas for this frame's patch
      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = frame.dims.width;
      tempCanvas.height = frame.dims.height;
      const tempCtx = tempCanvas.getContext("2d")!;
      tempCtx.putImageData(frameImageData, 0, 0);

      // Draw the patch onto the composite at the correct position
      compositeCtx.drawImage(tempCanvas, frame.dims.left, frame.dims.top);

      // Copy the composite to the sprite sheet
      ctx.drawImage(compositeCanvas, i * width, 0);

      // Handle disposal
      if (frame.disposalType === 2) {
        // Restore to background (clear)
        compositeCtx.clearRect(
          frame.dims.left,
          frame.dims.top,
          frame.dims.width,
          frame.dims.height
        );
      }
      // disposalType 1 = do not dispose (keep frame)
      // disposalType 3 = restore to previous (not commonly used)
    }

    // Convert canvas to image and add as sprite sheet
    const dataUrl = canvas.toDataURL();

    // Load the image and create sprite sheet
    await new Promise<void>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        // Add the sprite sheet texture to Phaser using the canvas image
        scene.textures.addSpriteSheet(key, img, {
          frameWidth: width,
          frameHeight: height,
        });

        // Calculate frame rate from GIF delays (use first frame delay or default)
        const avgDelay =
          frames.reduce((sum, f) => sum + (f.delay || 100), 0) / frames.length;
        const calculatedFrameRate = Math.round(1000 / avgDelay);

        // Create the animation
        scene.anims.create({
          key: `${key}_anim`,
          frames: scene.anims.generateFrameNumbers(key, {
            start: 0,
            end: frames.length - 1,
          }),
          frameRate: calculatedFrameRate || frameRate,
          repeat: -1, // Loop forever
        });

        resolve();
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
  } catch (error) {
    console.error(`Failed to load GIF ${url}:`, error);
    throw error;
  }
}

/**
 * Load multiple GIFs as animations
 */
export async function loadGifsAsAnimations(
  scene: Phaser.Scene,
  gifs: Array<{ key: string; url: string; frameRate?: number }>
): Promise<void> {
  await Promise.all(
    gifs.map(({ key, url, frameRate }) =>
      loadGifAsAnimation(scene, key, url, frameRate)
    )
  );
}

/**
 * Play animation on a sprite, creating it if needed
 */
export function playGifAnimation(
  sprite: Phaser.GameObjects.Sprite,
  animKey: string
): void {
  const fullKey = `${animKey}_anim`;

  // Check if animation exists and has valid frames before playing
  const anim = sprite.scene.anims.get(fullKey);
  if (!anim || !anim.frames || anim.frames.length === 0) {
    return; // Animation not ready yet
  }

  if (sprite.anims.currentAnim?.key !== fullKey) {
    sprite.play(fullKey);
  }
}
