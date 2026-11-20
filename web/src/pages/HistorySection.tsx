// Historique paginé des Journées précédentes (#19), repris de la source : pages
// du plus récent au plus ancien, Journée jamais coupée (règle dans `shared/`),
// Édition à la volée, Scission, suppression et Relancer comme pour la Journée
// en cours. « + Ajouter une plage » ne s'ouvre que sous la Journée cliquée (E4)
// et un refus s'affiche en notification (E5). Dates jj.mm.aaaa et heures 24 h
// saisies au clavier (ADR-0022), lues en heure de Zurich (ADR-0012).
import {
  type Day,
  type EnteredRange,
  type HistoryPageDto,
  type TimeEntryDto,
  type TimeInput,
  formatSeconds,
  parseEnteredRange,
} from '@app/shared';
import { type FormEvent, useEffect, useState } from 'react';
import { request } from '../api';
import { EntryLine } from '../EntryLine';
import { useLanguage } from '../i18n/i18n';
import { useNotify, useNotifyError } from '../notifications';

/** Couple Projet/Activité d'un groupe d'Imputations. */
export interface ProjectActivity {
  projectId: string;
  activityId: string;
}

interface HistorySectionProps {
  /** Change à chaque modification des Imputations : la page affichée est relue. */
  version: number;
  isRunning: (pair: ProjectActivity) => boolean;
  onEditTime: (entry: TimeEntryDto, field: 'startedAt' | 'endedAt', time: TimeInput) => Promise<string | null>;
  onRemove: (id: string) => void;
  onRelaunch: (pair: ProjectActivity) => void;
  onAdded: () => void;
  onBackToToday: () => void;
}

/** Formulaire « + Ajouter une plage », ouvert sous un seul groupe d'une seule Journée. */
interface RangeForm extends ProjectActivity, EnteredRange {
  day: Day;
}

export function HistorySection({ version, isRunning, onEditTime, onRemove, onRelaunch, onAdded, onBackToToday }: HistorySectionProps) {
  const { t } = useLanguage();
  const notify = useNotify();
  const notifyError = useNotifyError();

  // Curseurs des pages visitées : la première n'en a pas ; la dernière est la page affichée.
  const [cursors, setCursors] = useState<(Day | undefined)[]>([undefined]);
  const cursor = cursors[cursors.length - 1];
  const [loaded, setLoaded] = useState<{ cursor: Day | undefined; page: HistoryPageDto } | null>(null);

  useEffect(() => {
    let active = true;
    const query = cursor ? `?before=${encodeURIComponent(cursor)}` : '';
    request<HistoryPageDto>(`/time-entries/history${query}`).then((page) => {
      if (active) setLoaded({ cursor, page });
    }, notifyError);
    return () => {
      active = false;
    };
  }, [version, cursor, notifyError]);

  // « Suivant » attend que la page demandée soit chargée, pour ne jamais sauter de page.
  const page = loaded?.page ?? null;
  const nextCursor = loaded && loaded.cursor === cursor ? loaded.page.nextCursor : null;

  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const [form, setForm] = useState<RangeForm | null>(null);
  const setFormField = (field: keyof EnteredRange) => (event: { target: { value: string } }) =>
    setForm((current) => (current ? { ...current, [field]: event.target.value } : current));

  async function addRange(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    const { projectId, activityId, startDate, startTime, endDate, endTime } = form;
    // Comme dans la source, un formulaire incomplet n'est pas envoyé.
    if (!startDate || !startTime || !endDate || !endTime) return;
    const range = parseEnteredRange(form);
    if ('error' in range) {
      notify(t(range.error === 'date' ? 'CHAMP_DATE_ERREUR_INVALIDE' : 'CHAMP_HEURE_ERREUR_INVALIDE'));
      return;
    }
    try {
      await request<TimeEntryDto>('/time-entries', {
        method: 'POST',
        body: JSON.stringify({ projectId, activityId, startedAt: range.startedAt.toISOString(), endedAt: range.endedAt.toISOString() }),
      });
      setForm(null);
      onAdded();
    } catch (error) {
      notifyError(error);
    }
  }

  return (
    <section className="card historique">
      <div className="historique__entete">
        <h2 className="entries__titre">{t('SAISIE_TITRE_HISTORIQUE')}</h2>
        <button type="button" className="btn btn-secondary" onClick={onBackToToday}>
          {t('BOUTON_RETOUR_AUJOURDHUI')}
        </button>
      </div>

      {page && page.days.length === 0 && <p className="entries__vide">{t('SAISIE_AUCUN_HISTORIQUE')}</p>}

      <div className="historique__jours">
        {(page?.days ?? []).map(({ day, groups }) => (
          <div className="historique__jour" key={day}>
            <h3 className="historique__date">{day}</h3>
            <div className="historique__jour-corps">
              <ul className="groupes">
                {groups.map((group) => {
                  const key = `${day}::${group.key}`;
                  const open = expanded.has(key);
                  const first = group.entries[0]!;
                  const formHere = form?.day === day && form.projectId === group.projectId && form.activityId === group.activityId;
                  return (
                    <li className="groupe" key={group.key}>
                      <div className="groupe__entete" onClick={() => toggle(key)}>
                        <button
                          type="button"
                          className="groupe__chevron-bouton"
                          aria-expanded={open}
                          aria-label={t('ARIA_DEPLIER_GROUPE')}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggle(key);
                          }}
                        >
                          <span className={`groupe__chevron${open ? ' groupe__chevron--ouvert' : ''}`}>▸</span>
                        </button>
                        <div className="groupe__info">
                          <span className="groupe__activite">{first.activityName}</span>
                          <span className="groupe__projet">{first.projectName}</span>
                        </div>
                        <span className="groupe__nombre">({group.entries.length})</span>
                        <span className="badge groupe__total">{formatSeconds(group.totalSeconds)}</span>
                        <button
                          type="button"
                          className="btn btn-secondary entries__relancer"
                          disabled={isRunning(group)}
                          aria-label={t('ARIA_RELANCER')}
                          onClick={(event) => {
                            event.stopPropagation();
                            onRelaunch(group);
                          }}
                        >
                          {t('BOUTON_RELANCER')}
                        </button>
                      </div>
                      {open && (
                        <>
                          <ul className="entries__liste">
                            {group.entries.map((entry) => (
                              <EntryLine
                                key={entry.id}
                                entry={entry}
                                onEditTime={(field, time) => onEditTime(entry, field, time)}
                                onRemove={() => onRemove(entry.id)}
                              />
                            ))}
                          </ul>
                          {formHere ? (
                            <form className="historique__ajout" onSubmit={(event) => void addRange(event)}>
                              <div className="manuel__borne">
                                <input
                                  className="field manuel__date"
                                  type="text"
                                  inputMode="numeric"
                                  aria-label={t('CHAMP_DATE_DEBUT')}
                                  placeholder={t('CHAMP_DATE_FORMAT')}
                                  value={form.startDate}
                                  onChange={setFormField('startDate')}
                                />
                                <input
                                  className="field manuel__heure"
                                  type="text"
                                  inputMode="numeric"
                                  aria-label={t('CHAMP_HEURE_DEBUT')}
                                  placeholder={t('CHAMP_HEURE_FORMAT')}
                                  value={form.startTime}
                                  onChange={setFormField('startTime')}
                                />
                              </div>
                              <div className="manuel__borne">
                                <input
                                  className="field manuel__date"
                                  type="text"
                                  inputMode="numeric"
                                  aria-label={t('CHAMP_DATE_FIN')}
                                  placeholder={t('CHAMP_DATE_FORMAT')}
                                  value={form.endDate}
                                  onChange={setFormField('endDate')}
                                />
                                <input
                                  className="field manuel__heure"
                                  type="text"
                                  inputMode="numeric"
                                  aria-label={t('CHAMP_HEURE_FIN')}
                                  placeholder={t('CHAMP_HEURE_FORMAT')}
                                  value={form.endTime}
                                  onChange={setFormField('endTime')}
                                />
                              </div>
                              <button type="submit" className="btn btn-secondary">
                                {t('BOUTON_AJOUTER')}
                              </button>
                              <button type="button" className="btn btn-secondary" onClick={() => setForm(null)}>
                                {t('BOUTON_ANNULER')}
                              </button>
                            </form>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-secondary historique__ajout-bouton"
                              onClick={() =>
                                setForm({
                                  day,
                                  projectId: group.projectId,
                                  activityId: group.activityId,
                                  startDate: '',
                                  startTime: '',
                                  endDate: '',
                                  endTime: '',
                                })
                              }
                            >
                              {t('BOUTON_AJOUTER_PLAGE')}
                            </button>
                          )}
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        ))}
      </div>

      <div className="historique__pagination">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={cursors.length === 1}
          onClick={() => setCursors((current) => current.slice(0, -1))}
        >
          {t('BOUTON_PRECEDENT')}
        </button>
        <span className="historique__page-numero">{t('SAISIE_PAGE_NUMERO', { numero: String(cursors.length) })}</span>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={!nextCursor}
          onClick={() => nextCursor && setCursors((current) => [...current, nextCursor])}
        >
          {t('BOUTON_SUIVANT')}
        </button>
      </div>
    </section>
  );
}
