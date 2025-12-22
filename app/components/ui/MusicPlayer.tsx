"use client";

import { useState, useRef, useEffect } from "react";
import { playClickSound, playDoubleClickSound } from "@/app/utils/sounds";

// Music genres and their tracks
type MusicGenre = "chill" | "jazz";

const MUSIC_PLAYLISTS: Record<MusicGenre, string[]> = {
  chill: [
    "chill_1.mp3",
    "chill_2.mp3",
    "chill_3.mp3",
  ],
  jazz: [
    "pogicity_music_001.mp3",
    "pogicity_music_002.mp3",
    "pogicity_music_003.mp3",
    "pogicity_music_004.mp3",
    "pogicity_music_005.mp3",
    "pogicity_music_006.mp3",
    "pogicity_music_007.mp3",
  ],
};

// Gray color scheme for music player
const GRAY_COLORS = {
  bg: "#5a5a5a",
  bgActive: "#3a3a3a",
  borderLight: "#7a7a7a",
  borderDark: "#3a3a3a",
  shadow: "#2a2a2a",
};

// Music player component styled like top menu buttons
export default function MusicPlayer() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentGenre, setCurrentGenre] = useState<MusicGenre>("chill");
  const [currentTrack, setCurrentTrack] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const currentPlaylist = MUSIC_PLAYLISTS[currentGenre];
  const getTrackPath = (genre: MusicGenre, index: number) => 
    `/audio/music/${genre}/${MUSIC_PLAYLISTS[genre][index]}`;

  const nextTrack = () => {
    setCurrentTrack((prev) => (prev + 1) % currentPlaylist.length);
    playClickSound();
  };

  const prevTrack = () => {
    setCurrentTrack((prev) => (prev - 1 + currentPlaylist.length) % currentPlaylist.length);
    playClickSound();
  };

  const togglePlay = () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(() => {});
    }
    setIsPlaying(!isPlaying);
    playClickSound();
  };

  useEffect(() => {
    // Create audio element
    if (!audioRef.current) {
      audioRef.current = new Audio(getTrackPath(currentGenre, currentTrack));
      audioRef.current.volume = 0.3;
    }

    // Update audio source when track or genre changes
    audioRef.current.src = getTrackPath(currentGenre, currentTrack);
    
    // Auto-play next track when current ends
    const handleEnded = () => {
      setCurrentTrack((prev) => (prev + 1) % currentPlaylist.length);
    };
    
    audioRef.current.addEventListener("ended", handleEnded);
    
    if (isPlaying) {
      audioRef.current.play().catch(() => {});
    }

    return () => {
      if (audioRef.current) {
        audioRef.current.removeEventListener("ended", handleEnded);
      }
    };
  }, [currentTrack, currentGenre, currentPlaylist.length, isPlaying]);

  const switchGenre = (genre: MusicGenre) => {
    if (genre !== currentGenre) {
      setCurrentGenre(genre);
      setCurrentTrack(0); // Reset to first track of new genre
      playDoubleClickSound();
    }
  };

  // Get the icon path for current genre
  const getGenreIcon = (genre: MusicGenre) => {
    return genre === "chill" ? "/UI/ambient.png" : "/UI/jazz.png";
  };

  // Button component matching top menu style
  const MenuButton = ({
    onClick,
    title,
    imgSrc,
    active = false,
  }: {
    onClick: () => void;
    title: string;
    imgSrc: string;
    active?: boolean;
  }) => (
    <button
      onClick={onClick}
      title={title}
      style={{
        background: active ? GRAY_COLORS.bgActive : GRAY_COLORS.bg,
        border: "2px solid",
        borderColor: active
          ? `${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderLight} ${GRAY_COLORS.borderLight} ${GRAY_COLORS.borderDark}` // Inverted for active
          : `${GRAY_COLORS.borderLight} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderLight}`, // Normal
        padding: 0,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 0,
        borderTop: "none",
        boxShadow: active ? `inset 1px 1px 0px ${GRAY_COLORS.shadow}` : `1px 1px 0px ${GRAY_COLORS.shadow}`,
        imageRendering: "pixelated",
        transition: "filter 0.1s",
        transform: active ? "translate(1px, 1px)" : "none",
      }}
      onMouseEnter={(e) => !active && (e.currentTarget.style.filter = "brightness(1.1)")}
      onMouseLeave={(e) => !active && (e.currentTarget.style.filter = "none")}
      onMouseDown={(e) => {
        if (active) return;
        e.currentTarget.style.filter = "brightness(0.9)";
        e.currentTarget.style.borderColor = `${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderLight} ${GRAY_COLORS.borderLight} ${GRAY_COLORS.borderDark}`;
        e.currentTarget.style.transform = "translate(1px, 1px)";
        e.currentTarget.style.boxShadow = `inset 1px 1px 0px ${GRAY_COLORS.shadow}`;
      }}
      onMouseUp={(e) => {
        if (active) return;
        e.currentTarget.style.filter = "brightness(1.1)";
        e.currentTarget.style.borderColor = `${GRAY_COLORS.borderLight} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderLight}`;
        e.currentTarget.style.transform = "none";
        e.currentTarget.style.boxShadow = `1px 1px 0px ${GRAY_COLORS.shadow}`;
      }}
    >
      <img
        src={imgSrc}
        alt={title}
        style={{
          width: 48,
          height: 48,
          display: "block",
        }}
      />
    </button>
  );

  return (
    <div 
      style={{
        display: "flex",
        alignItems: "center",
        gap: 0,
        borderTop: `2px solid ${GRAY_COLORS.borderLight}`,
        boxShadow: `inset 0 2px 0px ${GRAY_COLORS.borderLight}`,
      }}
      onWheel={(e) => e.stopPropagation()}
    >
      {/* Genre selector button */}
      <div style={{ position: "relative", display: "inline-block" }}>
        <MenuButton
          onClick={() => {}}
          title="Select Music Genre"
          imgSrc={getGenreIcon(currentGenre)}
        />
        <select
          value={currentGenre}
          onChange={(e) => switchGenre(e.target.value as MusicGenre)}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            opacity: 0,
            cursor: "pointer",
            fontSize: 16,
          }}
        >
          <option value="chill">Chill</option>
          <option value="jazz">Jazz</option>
        </select>
      </div>

      {/* Playback controls */}
      <MenuButton
        onClick={prevTrack}
        title="Previous Song"
        imgSrc="/UI/lastsong.png"
      />
      <MenuButton
        onClick={togglePlay}
        title={isPlaying ? "Pause" : "Play"}
        imgSrc={isPlaying ? "/UI/pause.png" : "/UI/play.png"}
        active={isPlaying}
      />
      <MenuButton
        onClick={nextTrack}
        title="Next Song"
        imgSrc="/UI/nextsong.png"
      />

      {/* Song name display with marquee */}
      <div
        style={{
          background: GRAY_COLORS.bg,
          border: "2px solid",
          borderColor: `${GRAY_COLORS.borderLight} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderLight}`,
          borderTop: "none",
          padding: "4px",
          minWidth: 180,
          maxWidth: 220,
          height: 48,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: `1px 1px 0px ${GRAY_COLORS.shadow}`,
          overflow: "hidden",
        }}
      >
        {/* Inner inset panel - dark gray/black */}
        <div
          style={{
            width: "100%",
            height: "100%",
            padding: "4px 8px",
            display: "flex",
            alignItems: "center",
            overflow: "hidden",
            position: "relative",
            background: "#000000", // Pure black background
            border: "1px solid",
            borderColor: `${GRAY_COLORS.shadow} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.shadow}`,
          }}
        >
          <div
            key={`${currentGenre}-${currentTrack}`}
            style={{
              color: isPlaying ? "#00ff00" : "#00cc00", // Green text - bright when playing, darker when paused
              fontSize: 18,
              fontWeight: "700",
              fontFamily: "var(--font-pixelify), monospace",
              whiteSpace: "nowrap",
              textShadow: "2px 2px 0 rgba(0, 0, 0, 0.9)",
              animation: "marquee 10s linear infinite",
              display: "inline-block",
              paddingLeft: "100%",
              letterSpacing: "1px",
              textTransform: "uppercase",
            }}
          >
            {`${currentTrack + 1}. ${currentGenre}_${currentPlaylist[currentTrack]}`.toUpperCase()} • {`${currentTrack + 1}. ${currentGenre}_${currentPlaylist[currentTrack]}`.toUpperCase()}
          </div>
        </div>
      </div>
    </div>
  );
}



