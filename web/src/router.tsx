// Navigation sans rechargement, sur l'historique du navigateur. L'API renvoie
// index.html pour toute adresse inconnue, donc chaque écran a sa propre URL.
import { type MouseEvent, type ReactNode, useEffect, useSyncExternalStore } from 'react';

const NAVIGATE_EVENT = 'app:navigate';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  window.addEventListener(NAVIGATE_EVENT, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(NAVIGATE_EVENT, onChange);
  };
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname);
}

export function navigate(path: string, { replace = false } = {}): void {
  if (replace) window.history.replaceState({}, '', path);
  else window.history.pushState({}, '', path);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

/** Redirige dès l'affichage (adresse inconnue, écran réservé). */
export function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, { replace: true }), [to]);
  return null;
}

interface LinkProps {
  to: string;
  className: string;
  children: ReactNode;
}

export function Link({ to, className, children }: LinkProps) {
  const active = usePath() === to;
  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    // Ctrl/Cmd/Maj + clic ou clic du milieu : comportement natif (nouvel onglet).
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  }
  return (
    <a
      href={to}
      className={active ? `${className} is-active` : className}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
    >
      {children}
    </a>
  );
}
