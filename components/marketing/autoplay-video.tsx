"use client";

import { useCallback, useEffect, useRef } from "react";

type AutoplayVideoProps = {
  describedBy?: string;
  label: string;
  onTimeUpdate?: (currentTime: number) => void;
  src: string;
};

export function AutoplayVideo({ describedBy, label, onTimeUpdate, src }: AutoplayVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  const ensurePlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    video.controls = false;
    video.defaultMuted = true;
    video.muted = true;
    video.playsInline = true;
    void video.play().catch(() => undefined);
  }, []);

  const bindVideo = useCallback(
    (video: HTMLVideoElement | null) => {
      videoRef.current = video;
      if (!video) return;

      video.controls = false;
      video.defaultMuted = true;
      video.muted = true;
      video.playsInline = true;
      void video.play().catch(() => undefined);
    },
    [],
  );

  useEffect(() => {
    const handlePageReturn = () => {
      if (document.visibilityState === "visible") ensurePlayback();
    };

    const retryTimers = [0, 120, 500, 1400].map((delay) =>
      window.setTimeout(ensurePlayback, delay),
    );
    window.addEventListener("focus", ensurePlayback);
    window.addEventListener("pageshow", ensurePlayback);
    document.addEventListener("visibilitychange", handlePageReturn);

    return () => {
      retryTimers.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener("focus", ensurePlayback);
      window.removeEventListener("pageshow", ensurePlayback);
      document.removeEventListener("visibilitychange", handlePageReturn);
    };
  }, [ensurePlayback]);

  return (
    <video
      ref={bindVideo}
      aria-describedby={describedBy}
      aria-label={label}
      autoPlay
      controls={false}
      disablePictureInPicture
      loop
      muted
      onCanPlay={ensurePlayback}
      onLoadedData={ensurePlayback}
      onLoadedMetadata={ensurePlayback}
      onPause={ensurePlayback}
      onTimeUpdate={(event) => onTimeUpdate?.(event.currentTarget.currentTime)}
      playsInline
      preload="auto"
      tabIndex={-1}
    >
      <source src={src} type="video/mp4" />
    </video>
  );
}
