import React, { useEffect, useRef, useState } from 'react';
import { SkipForward } from 'lucide-react';

/**
 * DexterIntro
 * Full-bleed "Dexter boot" video intro on a black stage.
 *
 * Contract:
 *  - Autoplays on mobile (muted + playsInline + autoPlay + preload="auto").
 *  - On the video's onEnded OR after a 6s safety timeout, fades the stage to
 *    white over ~400ms, then calls onDone() exactly once.
 *  - "Skip" affordance in the bottom corner jumps straight to the fade.
 *  - If the video errors / can't load, falls back to a quick CSS flash-to-white
 *    (~1.2s) then onDone — it NEVER hangs and ALWAYS resolves.
 *  - Respects prefers-reduced-motion (skips the video, brief flash only).
 *
 * Props: { videoSrc = '/dexter-boot.mp4', onDone, isMobile }
 */
export default function DexterIntro({ videoSrc = '/dexter-boot.mp4', onDone, isMobile }) {
  const videoRef = useRef(null);
  const doneRef = useRef(false);
  const timersRef = useRef([]);

  // phase: 'video' (playing) | 'fade' (fading to white) | 'flash' (error fallback)
  const [phase, setPhase] = useState('video');
  // whiteOn drives the white overlay opacity 0 -> 1
  const [whiteOn, setWhiteOn] = useState(false);

  const prefersReduced =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Fade duration is trimmed when reduced motion is requested.
  const FADE_MS = prefersReduced ? 120 : 400;
  const FLASH_MS = prefersReduced ? 300 : 1200;
  const SAFETY_MS = 6000;

  // Register a timer so we can clear everything on unmount.
  const addTimer = (fn, ms) => {
    const id = setTimeout(fn, ms);
    timersRef.current.push(id);
    return id;
  };

  const clearTimers = () => {
    timersRef.current.forEach((id) => clearTimeout(id));
    timersRef.current = [];
  };

  // Fire onDone exactly once, ever.
  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    clearTimers();
    if (typeof onDone === 'function') {
      try {
        onDone();
      } catch (e) {
        // Swallow — the intro's job is to resolve, not to surface caller errors.
      }
    }
  };

  // Normal path: fade the black stage to white, then finish.
  const startFadeToWhite = () => {
    if (doneRef.current) return;
    setPhase('fade');
    // Kick the white overlay on next frame so the CSS transition animates.
    requestAnimationFrame(() => setWhiteOn(true));
    addTimer(finish, FADE_MS + 40);
  };

  // Error path: quick CSS flash to white, then finish. Never hangs.
  const startFlashToWhite = () => {
    if (doneRef.current) return;
    setPhase('flash');
    requestAnimationFrame(() => setWhiteOn(true));
    addTimer(finish, FLASH_MS + 40);
  };

  useEffect(() => {
    // Reduced motion: skip the video entirely, just a brief flash then done.
    if (prefersReduced) {
      startFlashToWhite();
      return () => clearTimers();
    }

    // Safety net: no matter what the video does, we resolve by SAFETY_MS.
    addTimer(() => startFadeToWhite(), SAFETY_MS);

    // Nudge autoplay for browsers that need an explicit play() call.
    const v = videoRef.current;
    if (v) {
      const p = v.play();
      if (p && typeof p.catch === 'function') {
        // If autoplay is blocked the safety timeout still resolves the intro.
        p.catch(() => {});
      }
    }

    return () => clearTimers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleEnded = () => startFadeToWhite();
  const handleError = () => startFlashToWhite();
  // If the source can't be loaded at all, stalled/emptied also route to fallback.
  const handleStalled = () => {
    // Only treat as failure if nothing has buffered after a beat.
    const v = videoRef.current;
    if (v && v.readyState < 2) {
      startFlashToWhite();
    }
  };
  const handleSkip = () => startFadeToWhite();

  const stageStyle = {
    position: 'fixed',
    inset: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100vw',
    height: '100vh',
    backgroundColor: '#000000',
    overflow: 'hidden',
    zIndex: 9999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  const videoStyle = {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: phase === 'flash' ? 'none' : 'block',
  };

  const whiteOverlayStyle = {
    position: 'absolute',
    inset: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#ffffff',
    opacity: whiteOn ? 1 : 0,
    transition: `opacity ${phase === 'flash' ? FLASH_MS : FADE_MS}ms ease-in-out`,
    pointerEvents: 'none',
  };

  const skipButtonStyle = {
    position: 'absolute',
    bottom: isMobile ? 16 : 24,
    right: isMobile ? 16 : 24,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: isMobile ? '8px 12px' : '9px 14px',
    fontSize: isMobile ? 13 : 14,
    fontWeight: 600,
    color: '#ffffff',
    backgroundColor: 'rgba(0,0,0,0.45)',
    border: '1px solid rgba(255,255,255,0.35)',
    borderRadius: 999,
    cursor: 'pointer',
    letterSpacing: '0.02em',
    lineHeight: 1,
    WebkitTapHighlightColor: 'transparent',
    zIndex: 2,
  };

  return (
    <div style={stageStyle} aria-label="Intro">
      <video
        ref={videoRef}
        src={videoSrc}
        style={videoStyle}
        muted
        playsInline
        autoPlay
        preload="auto"
        controls={false}
        disablePictureInPicture
        onEnded={handleEnded}
        onError={handleError}
        onStalled={handleStalled}
      />

      {/* White fade / flash overlay */}
      <div style={whiteOverlayStyle} />

      {/* Skip affordance — hidden once we begin resolving */}
      {phase === 'video' && (
        <button
          type="button"
          onClick={handleSkip}
          style={skipButtonStyle}
          aria-label="Skip intro"
        >
          <SkipForward size={isMobile ? 14 : 16} color="#C8102E" strokeWidth={2.5} />
          Skip
        </button>
      )}
    </div>
  );
}
