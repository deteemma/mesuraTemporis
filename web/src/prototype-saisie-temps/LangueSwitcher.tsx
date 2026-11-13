// PROTOTYPE — sélecteur de langue à drapeaux, changement sans rechargement.
import { useEffect, useRef, useState } from 'react';
import { LANGUES_DISPONIBLES, useLangue } from './i18n';

export function LangueSwitcher({ ouvrirVersLeHaut = false, className = '' }: { ouvrirVersLeHaut?: boolean; className?: string }) {
  const { langue, definirLangue, t } = useLangue();
  const [ouvert, setOuvert] = useState(false);
  const [enHaut, setEnHaut] = useState(false);
  const [aDroite, setADroite] = useState(false);
  const racine = useRef<HTMLDivElement>(null);
  const actuelle = LANGUES_DISPONIBLES.find((l) => l.code === langue)!;

  useEffect(() => {
    const fermer = (e: MouseEvent) => {
      if (!racine.current?.contains(e.target as Node)) setOuvert(false);
    };
    document.addEventListener('click', fermer);
    return () => document.removeEventListener('click', fermer);
  }, []);

  function basculer() {
    if (!ouvert && racine.current) {
      const r = racine.current.getBoundingClientRect();
      const hauteur = LANGUES_DISPONIBLES.length * 40 + 8;
      const prefere = ouvrirVersLeHaut ? r.top : window.innerHeight - r.bottom;
      const oppose = ouvrirVersLeHaut ? window.innerHeight - r.bottom : r.top;
      setEnHaut(prefere < hauteur && oppose > prefere ? !ouvrirVersLeHaut : ouvrirVersLeHaut);
      setADroite(window.innerWidth - r.left < 160);
    }
    setOuvert(!ouvert);
  }

  return (
    <div className={`langue-switcher ${className}`} ref={racine}>
      <button type="button" className="langue-switcher__bouton" onClick={basculer} aria-label={t('LANGUE_SELECTEUR_LABEL')} aria-expanded={ouvert}>
        <img className="langue-switcher__drapeau" src={actuelle.drapeauUrl} alt={actuelle.nomNatif} />
      </button>
      {ouvert && (
        <ul className={`langue-switcher__liste${enHaut ? ' langue-switcher__liste--haut' : ''}${aDroite ? ' langue-switcher__liste--droite' : ''}`}>
          {LANGUES_DISPONIBLES.map((l) => (
            <li key={l.code}>
              <button
                type="button"
                className={`langue-switcher__option${l.code === langue ? ' is-active' : ''}`}
                onClick={() => {
                  definirLangue(l.code);
                  setOuvert(false);
                }}
              >
                <img className="langue-switcher__drapeau" src={l.drapeauUrl} alt={l.nomNatif} />
                <span>{l.nomNatif}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
