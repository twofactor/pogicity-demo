// UI Sound utilities

// Create and cache audio elements for better performance
const audioCache: Record<string, HTMLAudioElement> = {};

function getAudio(path: string): HTMLAudioElement {
  if (!audioCache[path]) {
    audioCache[path] = new Audio(path);
  }
  return audioCache[path];
}

// Play a sound effect with optional volume
function playSound(path: string, volume: number = 0.5) {
  // Clone the audio to allow overlapping plays
  const audio = getAudio(path).cloneNode() as HTMLAudioElement;
  audio.volume = volume;
  audio.play().catch(() => {
    // Ignore autoplay errors
  });
}

// UI Sounds
export const playOpenSound = () => playSound("/audio/open.mp3", 0.5);
export const playDoubleClickSound = () => playSound("/audio/double_click.mp3", 0.5);
export const playClickSound = () => playSound("/audio/click.mp3", 0.25);

// Game sounds (moving these here for consistency)
export const playDestructionSound = () => playSound("/audio/destruction.mp3", 0.25);
export const playBuildSound = () => playSound("/audio/build.mp3", 0.25);
export const playBuildRoadSound = () => playSound("/audio/buildroad.mp3", 0.25);

