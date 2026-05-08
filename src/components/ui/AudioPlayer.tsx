import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";

interface AudioPlayerProps {
  src?: string;
  onLoadRequest?: () => Promise<string | null>;
  className?: string;
  autoPlay?: boolean;
  /** Stable identifier used to generate the waveform shape (e.g. file_name or entry id) */
  seed?: string;
}

const BAR_COUNT = 60;

function generateWaveform(seed: string): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  }
  const bars: number[] = [];
  for (let i = 0; i < BAR_COUNT; i++) {
    h = (Math.imul(1664525, h) + 1013904223) | 0;
    const u = (h >>> 0) / 4294967296;
    // Shape like a voice: taller in the middle, shorter at edges
    const pos = i / BAR_COUNT;
    const envelope = 0.35 + 0.65 * Math.sin(pos * Math.PI);
    bars.push(0.15 + envelope * u * 0.85);
  }
  return bars;
}

function fmt(t: number): string {
  if (!isFinite(t) || t < 0) return "0:00";
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export const AudioPlayer: React.FC<AudioPlayerProps> = ({
  src: initialSrc,
  onLoadRequest,
  className = "",
  autoPlay = false,
  seed,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(initialSrc ?? null);
  const [isLoading, setIsLoading] = useState(false);

  const audioRef = useRef<HTMLAudioElement>(null);
  const animationRef = useRef<number>();
  const dragTimeRef = useRef(0);
  const isPlayingRef = useRef(false);
  const isDraggingRef = useRef(false);
  const prevLoadedSrc = useRef<string | null>(null);

  const bars = useMemo(
    () => generateWaveform(seed ?? loadedSrc ?? initialSrc ?? "default"),
    [seed, loadedSrc, initialSrc],
  );

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);
  useEffect(() => {
    isDraggingRef.current = isDragging;
  }, [isDragging]);

  const tick = useCallback(() => {
    if (audioRef.current && !isDraggingRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
    if (isPlayingRef.current) {
      animationRef.current = requestAnimationFrame(tick);
    }
  }, []);

  useEffect(() => {
    if (isPlaying && !isDragging) {
      if (!animationRef.current)
        animationRef.current = requestAnimationFrame(tick);
    } else {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = undefined;
      }
    }
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = undefined;
      }
    };
  }, [isPlaying, isDragging, tick]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onMeta = () => {
      setDuration(audio.duration || 0);
      setCurrentTime(0);
    };
    const onEnd = () => {
      setIsPlaying(false);
      setCurrentTime(audio.duration || 0);
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("ended", onEnd);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    return () => {
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("ended", onEnd);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (loadedSrc && !prevLoadedSrc.current && onLoadRequest) {
      audio.play().catch(console.error);
    } else if (autoPlay && initialSrc && !prevLoadedSrc.current) {
      audio.play().catch(console.error);
    }
    prevLoadedSrc.current = loadedSrc;
  }, [loadedSrc, autoPlay, initialSrc, onLoadRequest]);

  const handleMouseUp = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
      if (audioRef.current) {
        audioRef.current.currentTime = dragTimeRef.current;
        setCurrentTime(dragTimeRef.current);
      }
    }
  }, [isDragging]);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener("mouseup", handleMouseUp);
      document.addEventListener("touchend", handleMouseUp);
      return () => {
        document.removeEventListener("mouseup", handleMouseUp);
        document.removeEventListener("touchend", handleMouseUp);
      };
    }
  }, [isDragging, handleMouseUp]);

  useEffect(() => {
    return () => {
      if (loadedSrc?.startsWith("blob:")) URL.revokeObjectURL(loadedSrc);
    };
  }, [loadedSrc]);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio || isLoading) return;
    try {
      if (isPlaying) {
        audio.pause();
      } else if (!loadedSrc && onLoadRequest) {
        setIsLoading(true);
        const newSrc = await onLoadRequest();
        setIsLoading(false);
        if (newSrc) setLoadedSrc(newSrc);
      } else if (loadedSrc) {
        await audio.play();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleWaveformClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(
      0,
      Math.min(1, (e.clientX - rect.left) / rect.width),
    );
    const newTime = ratio * duration;
    dragTimeRef.current = newTime;
    setCurrentTime(newTime);
    if (audioRef.current) audioRef.current.currentTime = newTime;
  };

  const progress = duration > 0 ? currentTime / duration : 0;

  return (
    <div
      className={className}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        background: "#0e0e12",
        borderRadius: 12,
        padding: "10px 16px 10px 12px",
        border: "1px solid rgba(255,255,255,0.07)",
      }}
    >
      <audio ref={audioRef} src={loadedSrc ?? undefined} preload="metadata" />

      {/* Play/Pause button */}
      <button
        onClick={togglePlay}
        disabled={isLoading}
        style={{
          width: 38,
          height: 38,
          borderRadius: "50%",
          background: isLoading ? "rgba(201,168,76,0.5)" : "#c9a84c",
          border: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          flexShrink: 0,
          boxShadow: "0 2px 10px rgba(201,168,76,0.35)",
          transition: "filter .14s, box-shadow .14s",
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.filter = "brightness(1.12)")
        }
        onMouseLeave={(e) => (e.currentTarget.style.filter = "")}
        aria-label={isPlaying ? "Pause" : "Play"}
      >
        {isPlaying ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="#1a1407">
            <rect x="5" y="3" width="4" height="18" rx="1" />
            <rect x="15" y="3" width="4" height="18" rx="1" />
          </svg>
        ) : (
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="#1a1407"
            style={{ marginLeft: 2 }}
          >
            <polygon points="5,3 19,12 5,21" />
          </svg>
        )}
      </button>

      {/* Waveform */}
      <div
        onClick={handleWaveformClick}
        style={{
          flex: 1,
          height: 32,
          display: "flex",
          alignItems: "center",
          gap: 2,
          cursor: duration ? "pointer" : "default",
        }}
      >
        {bars.map((h, i) => {
          const barProgress = i / BAR_COUNT;
          const played = barProgress < progress;
          const isCurrent = Math.abs(barProgress - progress) < 1 / BAR_COUNT;
          const barH = Math.max(3, Math.round(h * 26));
          return (
            <div
              key={i}
              style={{
                flex: 1,
                minWidth: 0,
                height: barH,
                borderRadius: 2,
                background:
                  played || isCurrent
                    ? `rgba(201,168,76,${0.5 + h * 0.5})`
                    : `rgba(255,255,255,${0.08 + h * 0.1})`,
                transition: "background .05s",
              }}
            />
          );
        })}
      </div>

      {/* Time */}
      <span
        style={{
          fontSize: 12,
          color: "rgba(255,255,255,0.45)",
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "0.02em",
          flexShrink: 0,
          fontFamily: "inherit",
        }}
      >
        {fmt(currentTime)} / {fmt(duration)}
      </span>
    </div>
  );
};
