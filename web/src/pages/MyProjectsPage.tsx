// Écran « Mes projets » (ADR-0016), repris de la source : total général, puis
// une carte par Projet avec sa Durée totale et celles de ses Activités, en
// hh:mm:ss. Le calcul (affectation, Chronomètre exclu, ordre E23) est
// calculée par l'API avec `shared/`.
import { type MyProjectsDto, formatSeconds } from '@app/shared';
import { useEffect, useState } from 'react';
import { request } from '../api';
import { useLanguage } from '../i18n/i18n';
import { useNotifyError } from '../notifications';

export function MyProjectsPage() {
  const { t } = useLanguage();
  const notifyError = useNotifyError();
  const [summary, setSummary] = useState<MyProjectsDto | null>(null);

  useEffect(() => {
    let active = true;
    request<MyProjectsDto>('/reports/projects').then((loaded) => {
      if (active) setSummary(loaded);
    }, notifyError);
    return () => {
      active = false;
    };
  }, [notifyError]);

  return (
    <div className="page">
      <h1>{t('NAV_MES_PROJETS')}</h1>

      {summary &&
        (summary.projects.length === 0 ? (
          <p className="resource-list__vide">{t('MES_PROJETS_MESSAGE_VIDE')}</p>
        ) : (
          <>
            <div className="stat-row">
              <div className="stat-row__item">
                <span className="stat-row__valeur">{formatSeconds(summary.totalSeconds)}</span>
                <span className="stat-row__label">{t('MES_PROJETS_TOTAL_GENERAL')}</span>
              </div>
            </div>

            {summary.projects.map((project) => (
              <section className="card mes-projets__projet" key={project.projectId}>
                <div className="mes-projets__entete">
                  <span className="mes-projets__nom">{project.projectName}</span>
                  <span className="badge">{formatSeconds(project.totalSeconds)}</span>
                </div>

                <ul className="resource-list">
                  {project.activities.map((activity) => (
                    <li className="resource-list__item" key={activity.activityId}>
                      <span className="resource-list__nom">{activity.activityName}</span>
                      <span className="badge resource-list__actions">{formatSeconds(activity.totalSeconds)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </>
        ))}
    </div>
  );
}
