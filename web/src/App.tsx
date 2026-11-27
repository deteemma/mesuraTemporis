// Coquille de l'application, reprise de la source : menu latéral (barre basse
// sur téléphone), sélecteur de langue et déconnexion.
import type { User } from 'oidc-client-ts';
import { type ReactNode, useEffect } from 'react';
import { reloadAccessRequests, useAccessRequests } from './accessRequests';
import { isAdministrator, logout } from './auth';
import { BrandLogo } from './BrandLogo';
import { useLanguage } from './i18n/i18n';
import { useNotifyError } from './notifications';
import { LanguageSwitcher } from './LanguageSwitcher';
import { ACTIVITIES_PATH, ActivitiesPage } from './pages/ActivitiesPage';
import { ConnectionsPage } from './pages/ConnectionsPage';
import { MyProjectsPage } from './pages/MyProjectsPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { ReportPage } from './pages/ReportPage';
import { TimeEntryPage } from './pages/TimeEntryPage';
import { UsersPage } from './pages/UsersPage';
import { Link, Redirect, usePath } from './router';

/** Pictogramme au trait, repris de la source. */
function Icon({ size, children }: { size: number; children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      {children}
    </svg>
  );
}

const ICONS = {
  time: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </>
  ),
  report: <path d="M4 19V10M12 19V5M20 19v-7" />,
  myProjects: (
    <>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </>
  ),
  projects: <path d="M3 7h5l2 2h11v10H3z" />,
  users: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M2 20c0-3.3 3-6 7-6s7 2.7 7 6M16 8a3 3 0 1 1 0-6M22 20c0-2.8-1.9-5-4.5-5.7" />
    </>
  ),
  connections: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l9-9M17 6l3 3M14 9l2 2" />
    </>
  ),
  logout: <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />,
};

interface Screen {
  path: string;
  /** Libellé du menu latéral, et libellé court de la barre basse. */
  label: string;
  shortLabel: string;
  icon: ReactNode;
  adminOnly: boolean;
  page: () => ReactNode;
}

export const HOME_PATH = '/saisie-temps';
const USERS_PATH = '/utilisateurs';

const SCREENS: Screen[] = [
  { path: HOME_PATH, label: 'NAV_SAISIE_TEMPS', shortLabel: 'NAV_TEMPS_COURT', icon: ICONS.time, adminOnly: false, page: TimeEntryPage },
  { path: '/rapport', label: 'NAV_RAPPORT', shortLabel: 'NAV_RAPPORT', icon: ICONS.report, adminOnly: false, page: ReportPage },
  { path: '/mes-projets', label: 'NAV_MES_PROJETS', shortLabel: 'NAV_MES_PROJETS', icon: ICONS.myProjects, adminOnly: false, page: MyProjectsPage },
  { path: '/projets', label: 'NAV_PROJETS', shortLabel: 'NAV_PROJETS', icon: ICONS.projects, adminOnly: true, page: ProjectsPage },
  { path: USERS_PATH, label: 'NAV_UTILISATEURS', shortLabel: 'NAV_UTILISATEURS', icon: ICONS.users, adminOnly: true, page: UsersPage },
  { path: '/connexions', label: 'NAV_CONNEXIONS', shortLabel: 'NAV_CONNEXIONS', icon: ICONS.connections, adminOnly: true, page: ConnectionsPage },
];

export function App({ user }: { user: User }) {
  const { t } = useLanguage();
  const path = usePath();
  const admin = isAdministrator(user);
  const screens = SCREENS.filter((screen) => admin || !screen.adminOnly);
  // Adresse inconnue, ou écran réservé à l'Administrateur (E25) : retour à la Saisie de temps.
  const screen = screens.find((s) => s.path === path);
  // Activités du Projet : ouvert depuis l'écran Projets, hors menu, réservé à l'Administrateur.
  const activitiesProjectId = admin ? ACTIVITIES_PATH.exec(path)?.[1] : undefined;
  const notifyError = useNotifyError();
  // Compteur des Demandes d'accès : lu à l'ouverture, puis à chaque décision de l'écran Utilisateurs.
  useEffect(() => {
    if (admin) reloadAccessRequests().catch(notifyError);
  }, [admin, notifyError]);
  const counter = (s: Screen) => (admin && s.path === USERS_PATH ? <PendingRequestsCounter /> : null);

  return (
    <div className="shell">
      <nav className="sidenav">
        <BrandLogo />
        <div className="sidenav__links">
          {screens.map((s) => (
            <Link key={s.path} to={s.path} className="sidenav__link">
              <Icon size={18}>{s.icon}</Icon>
              <span>{t(s.label)}</span>
              {counter(s)}
            </Link>
          ))}
        </div>
        <LanguageSwitcher className="sidenav__langue" />
        <button type="button" className="sidenav__logout" onClick={() => void logout()}>
          <Icon size={18}>{ICONS.logout}</Icon>
          <span>{t('NAV_DECONNEXION')}</span>
        </button>
      </nav>

      <main className="shell__content">
        {activitiesProjectId ? (
          <ActivitiesPage key={activitiesProjectId} projectId={decodeURIComponent(activitiesProjectId)} />
        ) : screen ? (
          <screen.page />
        ) : (
          <Redirect to={HOME_PATH} />
        )}
      </main>

      <nav className="bottomnav">
        {screens.map((s) => (
          <Link key={s.path} to={s.path} className="bottomnav__link">
            <Icon size={20}>{s.icon}</Icon>
            <span>{t(s.shortLabel)}</span>
            {counter(s)}
          </Link>
        ))}
        <LanguageSwitcher className="bottomnav__langue" openUpwards />
      </nav>
    </div>
  );
}

/**
 * Compteur des Demandes d'accès en attente (ADR-0028), sur le lien
 * « Utilisateurs » de l'Administrateur ; rien quand il n'y en a pas.
 */
function PendingRequestsCounter() {
  const { t } = useLanguage();
  const requests = useAccessRequests();

  const count = requests?.pending.length ?? 0;
  if (count === 0) return null;
  return (
    <span className="nav-counter" aria-label={t('DEMANDES_COMPTEUR_ARIA', { nombre: String(count) })}>
      {count}
    </span>
  );
}
