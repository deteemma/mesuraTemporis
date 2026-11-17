// Écran « Activités du Projet » (Administrateur), repris de la source avec les
// écarts du ticket #8 : dialogue de suppression chiffré, refus en notification.
// Ouvert depuis le lien « Activités » de l'écran Projets ; réservé à
// l'Administrateur (E25) : voir App.tsx.
import type { ActivityDto, ActivityImpactDto } from '@app/shared';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { request } from '../api';
import { DeleteButton } from '../DeleteButton';
import { useLanguage } from '../i18n/i18n';
import { useNotifyError } from '../notifications';
import { Link } from '../router';

export const ACTIVITIES_PATH = /^\/projets\/([^/]+)\/activites$/;

export function activitiesPath(projectId: string): string {
  return `/projets/${encodeURIComponent(projectId)}/activites`;
}

export function ActivitiesPage({ projectId }: { projectId: string }) {
  const { t } = useLanguage();
  const notifyError = useNotifyError();
  const [activities, setActivities] = useState<ActivityDto[] | null>(null);
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<Record<string, string>>({});
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const base = `/projects/${encodeURIComponent(projectId)}/activities`;

  useEffect(() => {
    let active = true;
    request<ActivityDto[]>(base).then((list) => {
      if (active) setActivities(list);
    }, notifyError);
    return () => {
      active = false;
    };
  }, [base, version, notifyError]);

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!newName) return;
    try {
      await request<ActivityDto>(base, { method: 'POST', body: JSON.stringify({ name: newName }) });
      setNewName('');
      reload();
    } catch (error) {
      notifyError(error);
    }
  }

  async function rename(activityId: string) {
    const name = renaming[activityId];
    if (!name) return;
    try {
      await request<ActivityDto>(`${base}/${activityId}`, { method: 'PATCH', body: JSON.stringify({ name }) });
      reload();
    } catch (error) {
      notifyError(error);
    }
  }

  async function remove(activityId: string) {
    try {
      await request<void>(`${base}/${activityId}`, { method: 'DELETE' });
    } catch (error) {
      notifyError(error);
    }
    reload();
  }

  async function describeDeletion(activity: ActivityDto): Promise<string> {
    const impact = await request<ActivityImpactDto>(`${base}/${activity.id}/impact`);
    return t('CONFIRMER_ACTIVITE', { nom: activity.name, imputations: String(impact.timeEntries) });
  }

  return (
    <div className="page">
      <Link to="/projets" className="back-link">
        {t('ACTIVITES_LIEN_RETOUR_PROJETS')}
      </Link>
      <h1>{t('ACTIVITES_TITRE')}</h1>

      <section className="card">
        <form className="inline-form" onSubmit={(event) => void create(event)}>
          <input
            className="field"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder={t('ARIA_NOM_ACTIVITE')}
            aria-label={t('ARIA_NOM_ACTIVITE')}
          />
          <button type="submit" className="btn btn-primary">
            {t('BOUTON_CREER')}
          </button>
        </form>
      </section>

      {activities?.length === 0 && <p className="resource-list__vide">{t('ACTIVITES_AUCUNE')}</p>}

      {activities && activities.length > 0 && (
        <section className="card">
          <ul className="resource-list">
            {activities.map((activity) => (
              <li className="resource-list__item" key={activity.id}>
                <span className="resource-list__nom">{activity.name}</span>
                <div className="resource-list__actions">
                  <input
                    className="field"
                    value={renaming[activity.id] ?? ''}
                    onChange={(event) => setRenaming((current) => ({ ...current, [activity.id]: event.target.value }))}
                    placeholder={t('ACTIVITES_PLACEHOLDER_RENOMMER')}
                    aria-label={t('ARIA_RENOMMER_ACTIVITE')}
                  />
                  <button type="button" className="btn btn-secondary" onClick={() => void rename(activity.id)}>
                    {t('BOUTON_RENOMMER')}
                  </button>
                  <DeleteButton describe={() => describeDeletion(activity)} onConfirm={() => void remove(activity.id)} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
