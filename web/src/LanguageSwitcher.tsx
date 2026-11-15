// Sélecteur de langue à drapeaux, repris de la source (menu latéral et barre basse).
import { useEffect, useRef, useState } from 'react';
import { useLanguage } from './i18n/i18n';
import { type Language, LANGUAGES } from './i18n/languages';

interface Props {
  className?: string;
  /** Sens préféré ; inversé à l'ouverture si la place manque (barre basse sur téléphone). */
  openUpwards?: boolean;
}

const ESTIMATED_LIST_WIDTH = 160;
const ESTIMATED_OPTION_HEIGHT = 40;

export function LanguageSwitcher({ className, openUpwards = false }: Props) {
  const { language, setLanguage, t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [placeAbove, setPlaceAbove] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function closeOnOutsideClick(event: globalThis.MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('click', closeOnOutsideClick);
    return () => document.removeEventListener('click', closeOnOutsideClick);
  }, [open]);

  /** Place la liste là où elle ne sera pas coupée par le bord de l'écran. */
  function toggle() {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const listHeight = LANGUAGES.length * ESTIMATED_OPTION_HEIGHT + 8;
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const preferred = openUpwards ? spaceAbove : spaceBelow;
      const opposite = openUpwards ? spaceBelow : spaceAbove;
      const lacksRoom = preferred < listHeight && opposite > preferred;
      setPlaceAbove(lacksRoom ? !openUpwards : openUpwards);
      setAlignRight(window.innerWidth - rect.left < ESTIMATED_LIST_WIDTH);
    }
    setOpen(!open);
  }

  function choose(code: Language) {
    setLanguage(code);
    setOpen(false);
  }

  const current = LANGUAGES.find((l) => l.code === language) ?? LANGUAGES[0]!;
  const listClass = [
    'langue-switcher__liste',
    placeAbove ? 'langue-switcher__liste--haut' : '',
    alignRight ? 'langue-switcher__liste--droite' : '',
  ].join(' ');

  return (
    <div className={className}>
      <div className="langue-switcher" ref={containerRef}>
        <button
          ref={buttonRef}
          type="button"
          className="langue-switcher__bouton"
          aria-label={t('LANGUE_SELECTEUR_LABEL')}
          aria-expanded={open}
          onClick={toggle}
        >
          <img className="langue-switcher__drapeau" src={current.flagUrl} alt={current.nativeName} />
        </button>
        {open && (
          <ul className={listClass}>
            {LANGUAGES.map((l) => (
              <li key={l.code}>
                <button
                  type="button"
                  className={`langue-switcher__option${l.code === language ? ' is-active' : ''}`}
                  onClick={() => choose(l.code)}
                >
                  <img className="langue-switcher__drapeau" src={l.flagUrl} alt={l.nativeName} />
                  <span>{l.nativeName}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
