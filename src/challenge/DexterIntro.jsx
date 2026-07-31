import React, { useEffect, useRef, useState } from 'react';

/*
 * Coded Dexter intro (no video). The Pokedex zooms in on a black stage,
 * brightens, then a white flash takes over and we hand off to the next screen.
 *
 * Always resolves: onDone fires on a timer no matter what, and never twice.
 * Respects prefers-reduced-motion (quick flash, no big motion).
 *
 * Props: { imageSrc = '/pokedex.png', onDone, isMobile }  (videoSrc accepted + ignored for compatibility)
 */
export default function DexterIntro({ imageSrc = '/pokedex.png', onDone, isMobile }) {
  const [whiteOn, setWhiteOn] = useState(false);
  const doneRef = useRef(false);

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (typeof onDone === 'function') onDone();
  };

  useEffect(() => {
    const reduced = typeof window !== 'undefined'
      && window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const timers = [];
    if (reduced) {
      setWhiteOn(true);
      timers.push(setTimeout(finish, 450));
    } else {
      timers.push(setTimeout(() => setWhiteOn(true), 1150)); // brighten to white
      timers.push(setTimeout(finish, 1750));                 // hand off to next screen
    }
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stageStyle = {
    position: 'fixed',
    inset: 0,
    width: '100vw',
    height: '100dvh',
    background: 'radial-gradient(120% 90% at 50% 42%, #1b1d22 0%, #0b0b0d 65%)',
    overflow: 'hidden',
    zIndex: 9999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxSizing: 'border-box',
    paddingTop: 'calc(72px + env(safe-area-inset-top))',
    paddingBottom: 'calc(100px + env(safe-area-inset-bottom))',
    paddingLeft: '20px',
    paddingRight: '20px',
  };

  const pokedexStyle = {
    width: 'auto',
    height: 'auto',
    maxWidth: 'min(66vw, 290px)',
    maxHeight: 'min(50vh, 400px)',
    objectFit: 'contain',
    filter: 'drop-shadow(0 24px 50px rgba(0,0,0,0.6))',
    animation: 'dexZoom 1.75s cubic-bezier(0.45, 0, 0.55, 1) forwards',
    willChange: 'transform, filter',
  };

  const whiteStyle = {
    position: 'absolute',
    inset: 0,
    background: '#ffffff',
    opacity: whiteOn ? 1 : 0,
    transition: 'opacity 600ms ease-in',
    pointerEvents: 'none',
  };

  return (
    <div style={stageStyle} aria-label="Loading the challenge">
      <style>{`
        @keyframes dexZoom {
          0%   { transform: scale(0.92) translateY(6px); filter: brightness(0.9); }
          55%  { transform: scale(1.35) translateY(0);   filter: brightness(1.05); }
          100% { transform: scale(2.6)  translateY(-2%); filter: brightness(1.6); }
        }
        @media (prefers-reduced-motion: reduce) {
          [data-dexpokedex] { animation: none !important; transform: scale(1.05); }
        }
      `}</style>
      <img src={imageSrc} alt="Dexter" data-dexpokedex style={pokedexStyle} draggable={false} />
      <div style={whiteStyle} />
      <button
        type="button"
        onClick={finish}
        aria-label="Skip"
        style={{
          position: 'absolute',
          bottom: isMobile ? 18 : 26,
          right: isMobile ? 16 : 24,
          background: 'rgba(0,0,0,0.4)',
          border: '1px solid rgba(255,255,255,0.35)',
          color: '#fff',
          borderRadius: 999,
          padding: isMobile ? '8px 14px' : '9px 16px',
          fontSize: isMobile ? 13 : 14,
          fontWeight: 700,
          cursor: 'pointer',
          zIndex: 2,
          WebkitTapHighlightColor: 'transparent',
        }}
      >Skip</button>
    </div>
  );
}
