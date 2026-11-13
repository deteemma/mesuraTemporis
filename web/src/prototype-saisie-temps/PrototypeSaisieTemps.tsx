// PROTOTYPE — à jeter. Ébauche de l'écran Saisie de temps en React (ticket wayfinder
// « Ébauche de l'écran Saisie de temps en React »). Une seule variante : la cible est
// la reproduction à l'identique de la source. Choix techniques testés ici :
// i18n maison (contexte React + dictionnaires de la source) et CSS global maison
// (jetons de la source), sans bibliothèque de composants ni de traduction.
// Lancement : `pnpm prototype:saisie-temps` (aucune API ni Keycloak nécessaires).
import { useCallback, useState } from 'react';
import { FournisseurLangue, useLangue } from './i18n';
import { LangueSwitcher } from './LangueSwitcher';
import { SaisieTemps } from './SaisieTemps';
import { serveur } from './serveurFactice';
import { formatHeure, journee } from './journee';
import './styles.css';

const Icone = {
  temps: <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>,
  rapport: <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19V10M12 19V5M20 19v-7" /></svg>,
  mesProjets: <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>,
  projets: <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7h5l2 2h11v10H3z" /></svg>,
  utilisateurs: <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="8" r="3" /><path d="M2 20c0-3.3 3-6 7-6s7 2.7 7 6M16 8a3 3 0 1 1 0-6M22 20c0-2.8-1.9-5-4.5-5.7" /></svg>,
  sortie: <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>,
};

function Coquille() {
  const { t } = useLangue();
  const [notifications, setNotifications] = useState<{ id: number; message: string }[]>([]);
  const fermer = (id: number) => setNotifications((n) => n.filter((x) => x.id !== id));
  const notifier = useCallback((message: string) => {
    const id = Date.now() + Math.random();
    setNotifications((n) => [...n, { id, message }]);
    setTimeout(() => setNotifications((n) => n.filter((x) => x.id !== id)), 4000);
  }, []);

  const liens = [
    { icone: Icone.temps, cle: 'NAV_SAISIE_TEMPS', court: 'NAV_TEMPS_COURT', actif: true },
    { icone: Icone.rapport, cle: 'NAV_RAPPORT', court: 'NAV_RAPPORT' },
    { icone: Icone.mesProjets, cle: 'NAV_MES_PROJETS', court: 'NAV_MES_PROJETS' },
    { icone: Icone.projets, cle: 'NAV_PROJETS', court: 'NAV_PROJETS' },
    { icone: Icone.utilisateurs, cle: 'NAV_UTILISATEURS', court: 'NAV_UTILISATEURS' },
  ];

  return (
    <>
      <div className="toast-hote">
        {notifications.map((n) => (
          <div className="toast" key={n.id}>
            <span className="toast__message">{n.message}</span>
            <button type="button" className="toast__fermer" aria-label="Fermer la notification" onClick={() => fermer(n.id)}>
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="shell">
        <nav className="sidenav">
          <div className="sidenav__brand">
            <span className="sidenav__brand-mark">MT</span>
            <span className="sidenav__brand-name">mesuraTemporis</span>
          </div>
          <div className="sidenav__links">
            {liens.map((l) => (
              <a key={l.cle} href="#" className={`sidenav__link${l.actif ? ' is-active' : ''}`} onClick={(e) => e.preventDefault()}>
                {l.icone}
                <span>{t(l.cle)}</span>
              </a>
            ))}
          </div>
          <LangueSwitcher className="sidenav__langue" />
          <button type="button" className="sidenav__logout">
            {Icone.sortie}
            <span>{t('NAV_DECONNEXION')}</span>
          </button>
        </nav>

        <main className="shell__content">
          <SaisieTemps notifier={notifier} />
        </main>

        <nav className="bottomnav">
          {liens.map((l) => (
            <a key={l.cle} href="#" className={`bottomnav__link${l.actif ? ' is-active' : ''}`} onClick={(e) => e.preventDefault()}>
              {l.icone}
              <span>{t(l.court)}</span>
            </a>
          ))}
          <LangueSwitcher className="bottomnav__langue" ouvrirVersLeHaut />
        </nav>
      </div>

      <PanneauEtat />
    </>
  );
}

/** Panneau propre au prototype : montre l'état du faux serveur (hors design évalué). */
function PanneauEtat() {
  const [ouvert, setOuvert] = useState(false);
  const [, setTic] = useState(0);
  const { activites, imputations } = serveur.etatBrut();
  const aujourdHui = journee(new Date());
  const chrono = serveur.statutChrono();
  return (
    <div className="proto-etat">
      <button type="button" onClick={() => { setOuvert(!ouvert); setTic((x) => x + 1); }}>
        PROTOTYPE · état {ouvert ? '▾' : '▴'}
      </button>
      {ouvert && (
        <div className="proto-etat__corps">
          <p>Données en mémoire, perdues au rechargement. Journée : Europe/Zurich ({aujourdHui}).</p>
          <p>Chrono actif : {chrono ? `${activites.find((a) => a.id === chrono.activiteId)?.nom} depuis ${formatHeure(chrono.heureDebut)}` : 'aucun'}</p>
          <p>{activites.length} Activités · {imputations.length} Imputations</p>
          <button type="button" onClick={() => setTic((x) => x + 1)}>Actualiser</button>
        </div>
      )}
    </div>
  );
}

export function PrototypeSaisieTemps() {
  return (
    <FournisseurLangue>
      <Coquille />
    </FournisseurLangue>
  );
}
