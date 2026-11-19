// Écran « Saisie de temps » : Chronomètre, recherche combinée Activité→Projet
// (ADR-0014) et Imputations de la Journée (ADR-0012), repris de la source et de
// l'ébauche de la branche prototype/saisie-temps. L'Édition à la volée, Relancer,
// le renommage, la Saisie manuelle et l'historique relèvent de leurs propres tickets.
import {
  type ActivityFieldAction,
  type ActivityFieldState,
  type ActivitySearchResultDto,
  type ProjectSummaryDto,
  type StartedTimerDto,
  type SuggestionContext,
  type TimeEntryDto,
  type TimerStatusDto,
  durationSeconds,
  formatSeconds,
  formatTimeOfDay,
  groupByActivity,
  initialActivityFieldState,
  recentPairs,
  reduceActivityField,
} from '@app/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { request } from '../api';
import { useLanguage } from '../i18n/i18n';
import { useNotify, useNotifyError } from '../notifications';

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
              <div className="hero__titre">{timer.activityName}</div>
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
                    <span className="groupe__activite">{group.entries[0]!.activityName}</span>
                    <span className="groupe__projet">{group.entries[0]!.projectName}</span>
                  </div>
                  <span className="groupe__nombre">({group.entries.length})</span>
                  <span className="badge groupe__total">{formatSeconds(group.totalSeconds)}</span>
                </div>
                {open && (
                  <ul className="entries__liste">
                    {group.entries.map((entry) => (
                      <li className="entries__ligne" key={entry.id}>
                        <span className="entries__puce"></span>
                        <div className="entries__info">
                          <span className="entries__activite">{entry.activityName}</span>
                          <span className="entries__projet">{entry.projectName}</span>
                        </div>
                        <span className="entries__horaire">
                          {formatTimeOfDay(entry.startedAt)} → {formatTimeOfDay(entry.endedAt!)}
                        </span>
                        <span className="badge">{formatSeconds(durationSeconds(entry.startedAt, entry.endedAt!))}</span>
                        <button
                          type="button"
                          className="btn btn-danger entries__supprimer"
                          aria-label={t('ARIA_SUPPRIMER_IMPUTATION')}
                          onClick={() => void remove(entry.id)}
                        >
                          ✕
                        </button>
                      </li>
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
