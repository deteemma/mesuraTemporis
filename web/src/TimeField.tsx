// Champ heure 24h maison de l'Édition à la volée, repris de la source
// (app-champ-heure) : lecture cliquable, frappe abrégée (« 9 », « 930 »,
// « 9:30 », « 0930 »), flèches ±1 minute et Maj+flèches ±1 heure, Entrée ou
// sortie du champ pour valider, Échap pour annuler. L'heure validée est une
// heure murale suisse (ADR-0012) : c'est la page qui la place sur la Journée.
import { formatTimeInput, parseTimeInput, type TimeInput } from '@app/shared';
import { type Ref, useImperativeHandle, useRef, useState } from 'react';
import { useLanguage } from './i18n/i18n';

const DAY_MINUTES = 24 * 60;

export interface TimeFieldHandle {
  open: () => void;
}

interface TimeFieldProps {
  /** Dernière heure confirmée, hh:mm. */
  value: string;
  ariaLabel: string;
  /** Enregistre l'heure ; renvoie le message d'un refus du serveur, ou `null`. */
  onValidate: (time: TimeInput, viaEnter: boolean) => Promise<string | null>;
  ref?: Ref<TimeFieldHandle>;
}

export function TimeField({ value, ariaLabel, onValidate, ref }: TimeFieldProps) {
  const { t } = useLanguage();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  // La sortie du champ qui suit Entrée ou Échap ne doit pas valider une seconde fois.
  const editingRef = useRef(false);

  function open() {
    editingRef.current = true;
    setEditing(true);
    setText(value);
    setError(null);
  }
  useImperativeHandle(ref, () => ({ open }));

  function close() {
    editingRef.current = false;
    setEditing(false);
  }

  function cancel() {
    if (!editingRef.current) return;
    close();
    setText('');
    setError(null);
  }

  function adjust(deltaMinutes: number) {
    const current = parseTimeInput(text) ?? parseTimeInput(value);
    if (!current) return;
    const total = (((current.hours * 60 + current.minutes + deltaMinutes) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
    setText(formatTimeInput({ hours: Math.floor(total / 60), minutes: total % 60 }));
  }

  async function confirm(viaEnter: boolean) {
    if (!editingRef.current) return;
    if (!text.trim()) {
      cancel();
      return;
    }
    const time = parseTimeInput(text);
    if (!time) {
      setError(t('CHAMP_HEURE_ERREUR_INVALIDE'));
      setText(value);
      return;
    }
    const submitted = formatTimeInput(time);
    close();
    setError(null);
    const serverError = await onValidate(time, viaEnter);
    // Refus du serveur : l'édition se rouvre sur le texte soumis, avec le message.
    if (serverError) {
      editingRef.current = true;
      setEditing(true);
      setText(submitted);
      setError(serverError);
    }
  }

  if (!editing) {
    return (
      <span
        className="champ-heure__lecture"
        role="button"
        tabIndex={0}
        aria-label={ariaLabel}
        onClick={open}
        onKeyDown={(event) => {
          if (event.key === 'Enter') open();
        }}
      >
        {value}
      </span>
    );
  }

  return (
    <>
      <input
        type="text"
        className="field field--inline champ-heure__saisie"
        aria-label={ariaLabel}
        autoFocus
        value={text}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => void confirm(false)}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 60 : 1;
          if (event.key === 'Enter') void confirm(true);
          else if (event.key === 'Escape') cancel();
          else if (event.key === 'ArrowUp') {
            event.preventDefault();
            adjust(step);
          } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            adjust(-step);
          }
        }}
      />
      {error && <span className="champ-heure__erreur">{error}</span>}
    </>
  );
}
