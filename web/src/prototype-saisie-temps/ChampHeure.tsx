/* eslint-disable react-hooks/refs, react-hooks/set-state-in-effect -- PROTOTYPE jetable */
// PROTOTYPE — champ heure 24h façon Clockify (ADR source 0006), porté en React.
import { type Ref, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { parseHeureSaisie, type HeureSaisie } from './heureSaisie';
import { useLangue } from './i18n';

export interface ChampHeureHandle {
  ouvrir: () => void;
}

const formatHHmm = (h: HeureSaisie) => `${String(h.heures).padStart(2, '0')}:${String(h.minutes).padStart(2, '0')}`;

export function ChampHeure(props: {
  valeur: string;
  ariaLabel: string;
  erreurServeur: string | null;
  onValide: (texte: string, viaEntree: boolean) => void;
  onAnnule: () => void;
  ref?: Ref<ChampHeureHandle>;
}) {
  const { t } = useLangue();
  const [enEdition, setEnEdition] = useState(false);
  const [texte, setTexte] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const dernierSoumis = useRef('');
  const input = useRef<HTMLInputElement>(null);
  const ignorerBlur = useRef(false);

  function ouvrir() {
    setEnEdition(true);
    setTexte(props.valeur);
    setErreur(null);
    setTimeout(() => {
      input.current?.focus();
      input.current?.select();
    });
  }
  useImperativeHandle(props.ref, () => ({ ouvrir }));

  // Échec serveur : rouvre l'édition avec le dernier texte soumis.
  useEffect(() => {
    if (props.erreurServeur) {
      setEnEdition(true);
      setTexte(dernierSoumis.current);
      setErreur(props.erreurServeur);
    }
  }, [props.erreurServeur]);

  function annuler() {
    ignorerBlur.current = true;
    setEnEdition(false);
    setTexte('');
    setErreur(null);
    props.onAnnule();
  }

  function ajuster(delta: number) {
    const a = parseHeureSaisie(texte) ?? parseHeureSaisie(props.valeur)!;
    const total = (((a.heures * 60 + a.minutes + delta) % 1440) + 1440) % 1440;
    setTexte(formatHHmm({ heures: Math.floor(total / 60), minutes: total % 60 }));
  }

  function confirmer(viaEntree: boolean) {
    if (!texte.trim()) return annuler();
    const analyse = parseHeureSaisie(texte);
    if (!analyse) {
      setErreur(t('CHAMP_HEURE_ERREUR_INVALIDE'));
      setTexte(props.valeur);
      return;
    }
    const valide = formatHHmm(analyse);
    ignorerBlur.current = true;
    setErreur(null);
    setEnEdition(false);
    dernierSoumis.current = valide;
    props.onValide(valide, viaEntree);
  }

  if (!enEdition) {
    return (
      <span
        className="champ-heure__lecture"
        role="button"
        tabIndex={0}
        aria-label={props.ariaLabel}
        onClick={ouvrir}
        onKeyDown={(e) => e.key === 'Enter' && ouvrir()}
      >
        {props.valeur}
      </span>
    );
  }
  return (
    <>
      <input
        ref={input}
        type="text"
        className="field field--inline champ-heure__saisie"
        value={texte}
        aria-label={props.ariaLabel}
        onChange={(e) => setTexte(e.target.value)}
        onFocus={() => (ignorerBlur.current = false)}
        onBlur={() => !ignorerBlur.current && confirmer(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') confirmer(true);
          else if (e.key === 'Escape') annuler();
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            ajuster((e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 60 : 1));
          }
        }}
      />
      {erreur && <span className="champ-heure__erreur">{erreur}</span>}
    </>
  );
}
