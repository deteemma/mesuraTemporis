// Ligne d'une Imputation terminée, dans la Journée en cours comme dans
// l'historique : heures éditables sur place, Relancer, supprimer.
import { type TimeEntryDto, type TimeInput, durationSeconds, formatSeconds, formatTimeOfDay } from '@app/shared';
import { useRef } from 'react';
import { useLanguage } from './i18n/i18n';
import { TimeField, type TimeFieldHandle } from './TimeField';

export interface EntryLineProps {
  entry: TimeEntryDto;
  running?: boolean;
  onEditTime: (field: 'startedAt' | 'endedAt', time: TimeInput) => Promise<string | null>;
  /** Absent dans l'historique : on y Relance depuis l'en-tête du groupe, comme dans la source. */
  onRelaunch?: () => void;
  onRemove: () => void;
}

/** Ligne d'une Imputation terminée : heures éditables sur place, Relancer, supprimer. */
export function EntryLine({ entry, running, onEditTime, onRelaunch, onRemove }: EntryLineProps) {
  const { t } = useLanguage();
  const endField = useRef<TimeFieldHandle>(null);
  return (
    <li className="entries__ligne">
      <span className="entries__puce"></span>
      <div className="entries__info">
        <span className="entries__activite">{entry.activityName}</span>
        <span className="entries__projet">{entry.projectName}</span>
      </div>
      <span className="entries__horaire">
        <TimeField
          value={formatTimeOfDay(entry.startedAt)}
          ariaLabel={t('ARIA_MODIFIER_HEURE_DEBUT')}
          onValidate={(time, viaEnter) => {
            // Entrée sur le début enchaîne sur la fin, comme dans la source.
            if (viaEnter) endField.current?.open();
            return onEditTime('startedAt', time);
          }}
        />{' '}
        →{' '}
        <TimeField
          ref={endField}
          value={formatTimeOfDay(entry.endedAt!)}
          ariaLabel={t('ARIA_MODIFIER_HEURE_FIN')}
          onValidate={(time) => onEditTime('endedAt', time)}
        />
      </span>
      <span className="badge">{formatSeconds(durationSeconds(entry.startedAt, entry.endedAt!))}</span>
      {onRelaunch && (
        <button
          type="button"
          className="btn btn-secondary entries__relancer"
          disabled={running}
          aria-label={t('ARIA_RELANCER')}
          onClick={onRelaunch}
        >
          {t('BOUTON_RELANCER')}
        </button>
      )}
      <button type="button" className="btn btn-danger entries__supprimer" aria-label={t('ARIA_SUPPRIMER_IMPUTATION')} onClick={onRemove}>
        ✕
      </button>
    </li>
  );
}
