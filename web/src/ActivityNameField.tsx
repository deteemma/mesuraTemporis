// Renommage d'une Activité sur place (ADR-0015), repris de la source : clic sur
// le nom, Entrée ou sortie du champ pour enregistrer, Échap pour annuler ; un
// nom vide annule. Un refus (ex. doublon) laisse le champ ouvert avec son message.
import { useRef, useState } from 'react';
import { useLanguage } from './i18n/i18n';

interface ActivityNameFieldProps {
  name: string;
  className: string;
  errorClassName: string;
  /** Enregistre le nouveau nom ; renvoie le message d'un refus à afficher, ou `null`. */
  onRename: (name: string) => Promise<string | null>;
}

export function ActivityNameField({ name, className, errorClassName, onRename }: ActivityNameFieldProps) {
  const { t } = useLanguage();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Garde contre la sortie du champ qui suit Entrée ou Échap, et contre un double envoi.
  const state = useRef<'closed' | 'editing' | 'saving'>('closed');

  function open() {
    state.current = 'editing';
    setEditing(true);
    setValue(name);
    setError(null);
  }

  function cancel() {
    state.current = 'closed';
    setEditing(false);
    setValue('');
    setError(null);
  }

  async function confirm() {
    if (state.current !== 'editing') return;
    const trimmed = value.trim();
    if (!trimmed) {
      cancel();
      return;
    }
    state.current = 'saving';
    const refusal = await onRename(trimmed);
    if (refusal) {
      state.current = 'editing';
      setError(refusal);
    } else {
      cancel();
    }
  }

  return (
    <>
      {editing ? (
        <input
          type="text"
          className="field field--inline"
          aria-label={t('ARIA_RENOMMER_ACTIVITE')}
          autoFocus
          value={value}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => void confirm()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void confirm();
            else if (event.key === 'Escape') cancel();
          }}
        />
      ) : (
        <span
          className={className}
          role="button"
          tabIndex={0}
          onClick={(event) => {
            event.stopPropagation();
            open();
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.stopPropagation();
            open();
          }}
        >
          {name}
        </span>
      )}
      {editing && error && <span className={errorClassName}>{error}</span>}
    </>
  );
}
