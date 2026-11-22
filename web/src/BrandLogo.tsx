// Logo du menu latéral : le cadran du « o » de la vidéo de présentation, suivi
// du nom. Au survol de la souris (ou au focus clavier), la vidéo de présentation
// s'ouvre dans un cadre à droite du logo et se ferme dès que le logo est quitté.
// Jamais au toucher, ni quand l'utilisateur demande moins d'animations.
import { type FocusEvent, type PointerEvent, useEffect, useRef, useState } from 'react';

const APP_NAME = 'Mesura Temporis';
const VIDEO_URL = '/mesuratemporis-loop.mp4';
/** Durée du fondu de fermeture, identique à la transition CSS de .brand__video. */
const FADE_MS = 150;

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Cadran à aiguille rouge sur midi. */
function Dial() {
  return (
    <svg className="brand__dial" viewBox="0 0 24 24" width={28} height={28} aria-hidden="true">
      <circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" strokeWidth="2.8" />
      <path className="brand__needle" d="M12 6.2v5.4" strokeWidth="1.6" strokeLinecap="round" />
      <path className="brand__needle-tip" d="M12 10.6l1.1 1.6-1.1 1.6-1.1-1.6z" />
    </svg>
  );
}

export function BrandLogo() {
  const [open, setOpen] = useState(false);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (open) {
      element.currentTime = 0;
      // Lecture refusée par le navigateur : le logo reste simplement affiché.
      element.play().catch(() => undefined);
      return;
    }
    const timer = setTimeout(() => element.pause(), FADE_MS);
    return () => clearTimeout(timer);
  }, [open]);

  function show() {
    if (!prefersReducedMotion()) setOpen(true);
  }

  function onPointerEnter(event: PointerEvent) {
    if (event.pointerType !== 'touch') show();
  }

  // Focus clavier seulement : un toucher ou un clic donne aussi le focus, et
  // ne doit pas ouvrir la vidéo (le logo n'est pas cliquable).
  function onFocus(event: FocusEvent<HTMLDivElement>) {
    if (event.currentTarget.matches(':focus-visible')) show();
  }

  return (
    <div
      className="sidenav__brand brand"
      tabIndex={0}
      onPointerEnter={onPointerEnter}
      onPointerLeave={() => setOpen(false)}
      onFocus={onFocus}
      onBlur={() => setOpen(false)}
    >
      <Dial />
      <span className="sidenav__brand-name">{APP_NAME}</span>
      <div className={open ? 'brand__video brand__video--open' : 'brand__video'} aria-hidden="true">
        <video ref={video} src={VIDEO_URL} muted loop playsInline preload="metadata" />
      </div>
    </div>
  );
}
