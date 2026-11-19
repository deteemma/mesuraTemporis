// Écran « Saisie de temps » : Chronomètre, recherche combinée Activité→Projet
// (ADR-0014), Imputations de la Journée (ADR-0012) avec Édition à la volée et
// Scission (ADR-0013), Relancer et renommage sur place (ADR-0015), repris de la
// source et de l'ébauche de la branche prototype/saisie-temps. La Saisie
// manuelle et l'historique relèvent de leurs propres tickets.
import {
  type ActivityDto,
  type ActivityFieldAction,
  type ActivityFieldState,
  type ActivitySearchResultDto,
  type EditedTimeEntryDto,
  type ProjectSummaryDto,
  type StartedTimerDto,
  type SuggestionContext,
  type TimeEntryDto,
  type TimeInput,
  type TimerStatusDto,
  dayOf,
  durationSeconds,
  formatSeconds,
  formatTimeOfDay,
  groupByActivity,
  initialActivityFieldState,
  recentPairs,
  reduceActivityField,
  zurichInstant,
} from '@app/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityNameField } from '../ActivityNameField';
import { ApiError, request } from '../api';
import { useLanguage } from '../i18n/i18n';
import { useNotify, useNotifyError } from '../notifications';
import { TimeField, type TimeFieldHandle } from '../TimeField';

const COUNTER_INTERVAL_MS = 1000;

const ARROW_KEYS = { ArrowDown: 'ARROW_DOWN', ArrowUp: 'ARROW_UP', Enter: 'ENTER' } as const;

export function TimeEntryPage() {
  const { t } = useLanguage();
  const notify = useNotify();
  const notifyError = useNotifyError();

  const [projects, setProjects] = useState<ProjectSummaryDto[]>([]);
  const [timer, setTimer] = useState<TimeEntryDto | null>(null);
  const [entries, setEntries] = useState<TimeEntryDto[]>([]);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  // Projets où créer une Activité en démarrant : ceux où l'on est affecté (tous pour l'Administrateur).
  useEffect(() => {
    let active = true;
    request<ProjectSummaryDto[]>('/projects').then((list) => {
      if (active) setProjects(list);
    }, notifyError);
    return () => {
      active = false;
    };
  }, [notifyError]);

  // Chronomètre et Journée, relus après chaque changement (et donc au rechargement de la page).
  useEffect(() => {
    let active = true;
    Promise.all([request<TimerStatusDto>('/time-entries/timer'), request<TimeEntryDto[]>('/time-entries/today')]).then(
      ([status, today]) => {
        if (!active) return;
        setTimer(status.timer);
        setEntries(today);
      },
      notifyError,
    );
    return () => {
      active = false;
    };
  }, [version, notifyError]);

  // Compteur à la seconde, recalculé depuis l'heure de début (jamais une seconde d'avance).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!timer) return;
    const tick = () => setNow(Date.now());
    // Premier calcul aussitôt, sans attendre le premier intervalle.
    const first = setTimeout(tick, 0);
    const interval = setInterval(tick, COUNTER_INTERVAL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
    };
  }, [timer]);
  const counter = timer ? formatSeconds(Math.floor((now - new Date(timer.startedAt).getTime()) / 1000)) : '00:00:00';

  // --- Champ « Activité » (recherche combinée) ---
  const [field, setField] = useState<ActivityFieldState>(initialActivityFieldState);
  const [searchResults, setSearchResults] = useState<ActivitySearchResultDto[]>([]);
  const context = useMemo<SuggestionContext>(
    () => ({
      activities: searchResults,
      assignedProjects: projects.map((p) => ({ id: p.id, name: p.name })),
      recentPairs: recentPairs(entries),
    }),
    [searchResults, projects, entries],
  );
  const apply = (action: ActivityFieldAction) => setField((state) => reduceActivityField(state, action, context));

  function type(text: string) {
    apply({ type: 'SET_TEXT', text });
    if (!text.trim()) {
      setSearchResults([]);
      return;
    }
    request<ActivitySearchResultDto[]>(`/activities/search?q=${encodeURIComponent(text)}`).then((results) => {
      setSearchResults(results);
      // Une réponse tardive est ignorée si le texte a changé entre-temps.
      setField((state) =>
        state.text === text ? reduceActivityField(state, { type: 'SET_TEXT', text }, { ...context, activities: results }) : state,
      );
    }, notifyError);
  }

  async function start() {
    const resolution = field.resolution;
    if (!resolution) return;
    const body = resolution.isNew
      ? { projectId: resolution.projectId, newActivityName: resolution.activity }
      : { projectId: resolution.projectId, activityId: resolution.activityId };
    try {
      const started = await request<StartedTimerDto>('/time-entries/timer/start', { method: 'POST', body: JSON.stringify(body) });
      setField(initialActivityFieldState());
      setSearchResults([]);
      const previous = started.previousTimerStopped;
      if (previous?.endedAt) notify(t('NOTIF_CHRONO_PRECEDENT_ARRETE', { heure: formatTimeOfDay(previous.endedAt) }));
    } catch (error) {
      notifyError(error);
    }
    reload();
  }

  async function stop() {
    try {
      await request<TimeEntryDto>('/time-entries/timer/stop', { method: 'POST' });
    } catch (error) {
      notifyError(error);
    }
    reload();
  }

  // Relancer : un Chronomètre démarre aujourd'hui sur le même Projet et la même
  // Activité ; l'Imputation d'origine reste inchangée, le Chronomètre en cours est arrêté.
  async function relaunch(entry: TimeEntryDto) {
    try {
      const started = await request<StartedTimerDto>('/time-entries/timer/start', {
        method: 'POST',
        body: JSON.stringify({ projectId: entry.projectId, activityId: entry.activityId }),
      });
      const previous = started.previousTimerStopped;
      if (previous?.endedAt) notify(t('NOTIF_CHRONO_PRECEDENT_ARRETE', { heure: formatTimeOfDay(previous.endedAt) }));
    } catch (error) {
      notifyError(error);
    }
    reload();
  }

  // Rien à relancer sur la ligne dont le Projet et l'Activité sont ceux du Chronomètre en cours.
  const isRunning = (entry: TimeEntryDto) =>
    !!timer && timer.projectId === entry.projectId && timer.activityId === entry.activityId;

  /** Message d'un refus à afficher sur place : son Code d'erreur traduit, sinon `fallback`. */
  const refusalMessage = (error: unknown, fallback: string) =>
    error instanceof ApiError && error.code ? t(error.code) : t(fallback);

  // Édition à la volée : l'heure saisie est placée sur la Journée de la valeur
  // éditée (heure suisse) ; une Scission éventuelle est seulement signalée.
  async function editTime(entry: TimeEntryDto, field: 'startedAt' | 'endedAt', time: TimeInput): Promise<string | null> {
    const reference = entry[field] ?? entry.startedAt;
    const instant = zurichInstant(dayOf(reference), time.hours, time.minutes).toISOString();
    try {
      const edited = await request<EditedTimeEntryDto>(`/time-entries/${entry.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ [field]: instant }),
      });
      if (edited.split) notify(t('NOTIF_SCISSION', { jour: dayOf(edited.split.startedAt) }));
      reload();
      return null;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      return refusalMessage(error, 'ERREUR_MODIFICATION_NON_ENREGISTREE');
    }
  }

  // Renommage sur place : le nouveau nom s'applique à toutes les Imputations de
  // l'Activité. Un Projet quitté entre-temps est signalé en notification (E10).
  async function rename(projectId: string, activityId: string, name: string): Promise<string | null> {
    try {
      await request<ActivityDto>(`/projects/${projectId}/activities/${activityId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      });
      reload();
      return null;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      if (error instanceof ApiError && error.code === 'PROJET_INTROUVABLE') {
        notifyError(error);
        return null;
      }
      return refusalMessage(error, 'ERREUR_RENOMMAGE_NON_ENREGISTRE');
    }
  }

  async function remove(id: string) {
    try {
      await request<void>(`/time-entries/${id}`, { method: 'DELETE' });
    } catch (error) {
      notifyError(error);
    }
    reload();
  }

  // --- Imputations de la Journée, regroupées par Projet et Activité ---
  const groups = useMemo(() => groupByActivity(entries), [entries]);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="page">
      <h1>{t('NAV_SAISIE_TEMPS')}</h1>

      <section className={`hero card${timer ? ' hero--actif' : ''}`}>
        {timer ? (
          <div className="hero__actif">
            <span className="hero__pulse"></span>
            <div className="hero__texte">
              <div className="hero__titre">
                <ActivityNameField
                  name={timer.activityName}
                  className="hero__titre-editable"
                  errorClassName="hero__erreur"
                  onRename={(name) => rename(timer.projectId, timer.activityId, name)}
                />
              </div>
              <div className="hero__sous-titre">
                {timer.projectName} · {t('SAISIE_EN_COURS_DEPUIS')} {formatTimeOfDay(timer.startedAt)} ·{' '}
                <span className="hero__compteur">{counter}</span>
              </div>
            </div>
            <button type="button" className="btn btn-danger hero__stop" onClick={() => void stop()}>
              {t('SAISIE_BOUTON_ARRETER')}
            </button>
          </div>
        ) : (
          <div className="hero__form">
            <div className="combobox">
              <input
                className="field"
                type="text"
                aria-label={t('ARIA_NOM_ACTIVITE')}
                autoComplete="off"
                placeholder={t('SAISIE_PLACEHOLDER_NOM_ACTIVITE')}
                value={field.text}
                onFocus={() => apply({ type: 'FOCUS' })}
                onChange={(event) => type(event.target.value)}
                onKeyDown={(event) => {
                  const action = ARROW_KEYS[event.key as keyof typeof ARROW_KEYS];
                  if (!action) return;
                  event.preventDefault();
                  apply({ type: action });
                }}
              />
              {field.suggestions.length > 0 && (
                <ul className="suggestions" role="listbox">
                  {field.suggestions.map((suggestion, index) => (
                    <li
                      key={suggestion.type === 'existing' ? suggestion.activityId : 'create'}
                      role="option"
                      aria-selected={index === field.highlighted}
                      className={index === field.highlighted ? 'hl' : ''}
                      onMouseDown={(event) => {
                        // Garde le focus dans le champ : le clic choisit, il ne ferme pas.
                        event.preventDefault();
                        apply({ type: 'CLICK_SUGGESTION', index });
                      }}
                    >
                      {suggestion.type === 'existing'
                        ? `${suggestion.name} — ${suggestion.projectName}`
                        : `➕ ${t('SAISIE_SUGGESTION_CREER', { texte: suggestion.text })}`}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {field.creation && (
              <select
                className="field"
                aria-label={t('ARIA_CHOISIR_PROJET_ACTIVITE')}
                value={field.creation.chosenProjectId ?? ''}
                onChange={(event) => event.target.value && apply({ type: 'CHOOSE_CREATION_PROJECT', projectId: event.target.value })}
              >
                <option value="">{t('SAISIE_OPTION_CHOISIR_PROJET')}</option>
                {field.creation.availableProjects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            )}
            <button type="button" className="btn btn-primary hero__start" disabled={!field.resolution} onClick={() => void start()}>
              {t('SAISIE_BOUTON_DEMARRER')}
            </button>
          </div>
        )}
      </section>

      <section className="card entries">
        <h2 className="entries__titre">{t('SAISIE_TITRE_ENTREES_JOUR')}</h2>
        {groups.length === 0 && <p className="entries__vide">{t('SAISIE_AUCUNE_IMPUTATION_JOUR')}</p>}
        <ul className="groupes">
          {groups.map((group) => {
            const open = expanded.has(group.key);
            return (
              <li className="groupe" key={group.key}>
                <div className="groupe__entete" onClick={() => toggle(group.key)}>
                  <button
                    type="button"
                    className="groupe__chevron-bouton"
                    aria-expanded={open}
                    aria-label={t('ARIA_DEPLIER_GROUPE')}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggle(group.key);
                    }}
                  >
                    <span className={`groupe__chevron${open ? ' groupe__chevron--ouvert' : ''}`}>▸</span>
                  </button>
                  <div className="groupe__info">
                    <ActivityNameField
                      name={group.entries[0]!.activityName}
                      className="groupe__activite"
                      errorClassName="entries__erreur"
                      onRename={(name) => rename(group.entries[0]!.projectId, group.entries[0]!.activityId, name)}
                    />
                    <span className="groupe__projet">{group.entries[0]!.projectName}</span>
                  </div>
                  <span className="groupe__nombre">({group.entries.length})</span>
                  <span className="badge groupe__total">{formatSeconds(group.totalSeconds)}</span>
                </div>
                {open && (
                  <ul className="entries__liste">
                    {group.entries.map((entry) => (
                      <EntryLine
                        key={entry.id}
                        entry={entry}
                        running={isRunning(entry)}
                        onEditTime={(field, time) => editTime(entry, field, time)}
                        onRelaunch={() => void relaunch(entry)}
                        onRemove={() => void remove(entry.id)}
                      />
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

interface EntryLineProps {
  entry: TimeEntryDto;
  running: boolean;
  onEditTime: (field: 'startedAt' | 'endedAt', time: TimeInput) => Promise<string | null>;
  onRelaunch: () => void;
  onRemove: () => void;
}

/** Ligne d'une Imputation terminée : heures éditables sur place, Relancer, supprimer. */
function EntryLine({ entry, running, onEditTime, onRelaunch, onRemove }: EntryLineProps) {
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
      <button
        type="button"
        className="btn btn-secondary entries__relancer"
        disabled={running}
        aria-label={t('ARIA_RELANCER')}
        onClick={onRelaunch}
      >
        {t('BOUTON_RELANCER')}
      </button>
      <button type="button" className="btn btn-danger entries__supprimer" aria-label={t('ARIA_SUPPRIMER_IMPUTATION')} onClick={onRemove}>
        ✕
      </button>
    </li>
  );
}
