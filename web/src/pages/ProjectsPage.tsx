// Écran « Projets » (Administrateur), repris de la source avec les écarts du
// ticket #8 : dialogue de suppression chiffré, refus en notification, marges
// intérieures. Réservé à l'Administrateur (E25) : voir App.tsx.
import type { ProjectImpactDto, ProjectSummaryDto, UserSummaryDto } from '@app/shared';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { request } from '../api';
import { DeleteButton } from '../DeleteButton';
import { useLanguage } from '../i18n/i18n';
import { useNotifyError } from '../notifications';

export function ProjectsPage() {
  const { t } = useLanguage();
  const notifyError = useNotifyError();
  const [projects, setProjects] = useState<ProjectSummaryDto[] | null>(null);
  const [users, setUsers] = useState<UserSummaryDto[]>([]);
  const [newName, setNewName] = useState('');
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let active = true;
    request<ProjectSummaryDto[]>('/projects').then((list) => {
      if (active) setProjects(list);
    }, notifyError);
    return () => {
      active = false;
    };
  }, [version, notifyError]);

  // Tant que l'écran Utilisateurs n'existe pas, la liste « Affecter » propose
  // les Utilisateurs déjà connus de l'application (#14).
  useEffect(() => {
    let active = true;
    request<UserSummaryDto[]>('/users').then((list) => {
      if (active) setUsers(list);
    }, notifyError);
    return () => {
      active = false;
    };
  }, [notifyError]);

  async function create(event: FormEvent) {
    event.preventDefault();
    try {
      await request<ProjectSummaryDto>('/projects', { method: 'POST', body: JSON.stringify({ name: newName }) });
      setNewName('');
      reload();
    } catch (error) {
      notifyError(error);
    }
  }

  return (
    <div className="page">
      <h1>{t('NAV_PROJETS')}</h1>

      <section className="card">
        <form className="inline-form" onSubmit={(event) => void create(event)}>
          <input
            className="field"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder={t('ADMIN_PLACEHOLDER_NOM_PROJET')}
            aria-label={t('ADMIN_PLACEHOLDER_NOM_PROJET')}
          />
          <button type="submit" className="btn btn-primary">
            {t('BOUTON_CREER')}
          </button>
        </form>
      </section>

      {projects?.length === 0 && <p className="resource-list__vide">{t('PROJETS_AUCUN')}</p>}

      {projects?.map((project) => (
        <ProjectCard key={project.id} project={project} users={users} onDeleted={reload} />
      ))}
    </div>
  );
}

interface ProjectCardProps {
  project: ProjectSummaryDto;
  users: UserSummaryDto[];
  onDeleted: () => void;
}

function ProjectCard({ project, users, onDeleted }: ProjectCardProps) {
  const { t } = useLanguage();
  const notifyError = useNotifyError();
  const [members, setMembers] = useState<UserSummaryDto[] | null>(null);
  const [chosenUserId, setChosenUserId] = useState('');
  const [version, setVersion] = useState(0);
  const base = `/projects/${project.id}`;

  useEffect(() => {
    let active = true;
    request<UserSummaryDto[]>(`${base}/members`).then((list) => {
      if (active) setMembers(list);
    }, notifyError);
    return () => {
      active = false;
    };
  }, [base, version, notifyError]);

  /** Appelle l'API puis relit l'équipe ; un refus part en notification. */
  async function changeTeam(method: 'PUT' | 'DELETE', userId: string) {
    try {
      await request<void>(`${base}/members/${encodeURIComponent(userId)}`, { method });
    } catch (error) {
      notifyError(error);
    }
    setVersion((v) => v + 1);
  }

  async function describeDeletion(): Promise<string> {
    const impact = await request<ProjectImpactDto>(`${base}/impact`);
    return t('CONFIRMER_PROJET', {
      nom: project.name,
      activites: String(impact.activities),
      imputations: String(impact.timeEntries),
    });
  }

  async function remove() {
    try {
      await request<void>(base, { method: 'DELETE' });
    } catch (error) {
      notifyError(error);
    }
    onDeleted();
  }

  return (
    <section className="card project-card">
      <div className="project-card__header">
        <div className="project-card__title">
          <span className="project-card__name">{project.name}</span>
          <span className="badge">{t('STATUT_ACTIF')}</span>
        </div>
        <div className="project-card__actions">
          <DeleteButton describe={describeDeletion} onConfirm={() => void remove()} />
        </div>
      </div>

      <div className="project-card__team">
        <h3 className="project-card__subtitle">{t('PROJETS_TITRE_EQUIPE')}</h3>
        {members?.length === 0 && <p className="resource-list__vide">{t('PROJETS_AUCUN_UTILISATEUR_AFFECTE')}</p>}
        {members && members.length > 0 && (
          <ul className="resource-list">
            {members.map((member) => (
              <li className="resource-list__item" key={member.id}>
                <span className="resource-list__nom">{member.login}</span>
                <button
                  type="button"
                  className="btn btn-danger resource-list__actions"
                  onClick={() => void changeTeam('DELETE', member.id)}
                >
                  {t('BOUTON_RETIRER')}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="inline-form project-card__assign">
          <select
            className="field"
            value={chosenUserId}
            onChange={(event) => setChosenUserId(event.target.value)}
            aria-label={t('ARIA_CHOISIR_UTILISATEUR_AFFECTER')}
          >
            <option value="" disabled hidden />
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.login}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              if (chosenUserId) void changeTeam('PUT', chosenUserId);
            }}
          >
            {t('BOUTON_AFFECTER')}
          </button>
        </div>
      </div>
    </section>
  );
}
