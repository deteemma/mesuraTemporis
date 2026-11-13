// PROTOTYPE — à jeter. Ébauche des écrans d'administration en React (ticket wayfinder
// « Ébauche des écrans d'administration en React »). Projets (avec l'équipe), Activités
// du Projet et Utilisateurs, repris à l'identique de la source. Trois variantes,
// switchables via ?variant=A|B|C, qui ne diffèrent que sur les questions ouvertes :
// présentation du rôle, actions interdites (masquées / grisées / refusées) et
// confirmation de suppression. Réutilise l'i18n, le sélecteur de langue et le CSS de
// l'ébauche Saisie de temps. Lancement : `pnpm prototype:administration`.
import { useEffect, useState } from 'react';
import { FournisseurLangue, useLangue } from '../prototype-saisie-temps/i18n';
import { LangueSwitcher } from '../prototype-saisie-temps/LangueSwitcher';
import '../prototype-saisie-temps/styles.css';
import { Activites } from './Activites';
import { type Ecran, FournisseurAdmin, NOMS_VARIANTES, useAdmin, type Variante } from './commun';
import { Projets } from './Projets';
import { serveur } from './serveurAdmin';
import { Utilisateurs } from './Utilisateurs';
import './admin.css';

const VARIANTES: Variante[] = ['A', 'B', 'C'];
const voisine = (v: Variante, pas: number) => VARIANTES[(VARIANTES.indexOf(v) + pas + VARIANTES.length) % VARIANTES.length]!;

const Icone = {
  temps: <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>,
  rapport: <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19V10M12 19V5M20 19v-7" /></svg>,
  mesProjets: <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>,
  projets: <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7h5l2 2h11v10H3z" /></svg>,
  utilisateurs: <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="8" r="3" /><path d="M2 20c0-3.3 3-6 7-6s7 2.7 7 6M16 8a3 3 0 1 1 0-6M22 20c0-2.8-1.9-5-4.5-5.7" /></svg>,
  sortie: <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>,
};

function lireVariante(): Variante {
  const v = new URLSearchParams(window.location.search).get('variant');
  return VARIANTES.includes(v as Variante) ? (v as Variante) : 'A';
}

function Coquille({ ecran, aller }: { ecran: Ecran; aller: (e: Ecran) => void }) {
  const { t } = useLangue();
  const actif = ecran.nom === 'utilisateurs' ? 'utilisateurs' : 'projets';
  const liens = [
    { id: 'temps', icone: Icone.temps, cle: 'NAV_SAISIE_TEMPS', court: 'NAV_TEMPS_COURT' },
    { id: 'rapport', icone: Icone.rapport, cle: 'NAV_RAPPORT', court: 'NAV_RAPPORT' },
    { id: 'mesProjets', icone: Icone.mesProjets, cle: 'NAV_MES_PROJETS', court: 'NAV_MES_PROJETS' },
    { id: 'projets', icone: Icone.projets, cle: 'NAV_PROJETS', court: 'NAV_PROJETS', vers: { nom: 'projets' } as Ecran },
    { id: 'utilisateurs', icone: Icone.utilisateurs, cle: 'NAV_UTILISATEURS', court: 'NAV_UTILISATEURS', vers: { nom: 'utilisateurs' } as Ecran },
  ];
  const lien = (l: (typeof liens)[number], classe: string, cle: string) => (
    <a
      key={l.id}
      href="#"
      className={`${classe}${l.id === actif ? ' is-active' : ''}${l.vers ? '' : ' proto-inerte'}`}
      onClick={(e) => {
        e.preventDefault();
        if (l.vers) aller(l.vers);
      }}
    >
      {l.icone}
      <span>{t(cle)}</span>
    </a>
  );

  return (
    <div className="shell">
      <nav className="sidenav">
        <div className="sidenav__brand">
          <span className="sidenav__brand-mark">MT</span>
          <span className="sidenav__brand-name">mesuraTemporis</span>
        </div>
        <div className="sidenav__links">{liens.map((l) => lien(l, 'sidenav__link', l.cle))}</div>
        <LangueSwitcher className="sidenav__langue" />
        <button type="button" className="sidenav__logout">
          {Icone.sortie}
          <span>{t('NAV_DECONNEXION')}</span>
        </button>
      </nav>

      <main className="shell__content">
        {ecran.nom === 'projets' && <Projets />}
        {ecran.nom === 'activites' && <Activites projetId={ecran.projetId} />}
        {ecran.nom === 'utilisateurs' && <Utilisateurs />}
      </main>

      <nav className="bottomnav">
        {liens.map((l) => lien(l, 'bottomnav__link', l.court))}
        <LangueSwitcher className="bottomnav__langue" ouvrirVersLeHaut />
      </nav>
    </div>
  );
}

/** Barre propre au prototype (hors design évalué) : change de variante, flèches ← →. */
function Switcher({ variante, changer }: { variante: Variante; changer: (v: Variante) => void }) {
  useEffect(() => {
    const touche = (e: KeyboardEvent) => {
      const cible = e.target as HTMLElement;
      if (cible.closest('input, textarea, select, [contenteditable]')) return;
      if (e.key === 'ArrowLeft') changer(voisine(variante, -1));
      if (e.key === 'ArrowRight') changer(voisine(variante, 1));
    };
    window.addEventListener('keydown', touche);
    return () => window.removeEventListener('keydown', touche);
  }, [variante, changer]);
  return (
    <div className="proto-switcher">
      <button type="button" onClick={() => changer(voisine(variante, -1))} aria-label="Variante précédente">
        ←
      </button>
      <span>
        {variante} ({NOMS_VARIANTES[variante]})
      </span>
      <button type="button" onClick={() => changer(voisine(variante, 1))} aria-label="Variante suivante">
        →
      </button>
    </div>
  );
}

/** Panneau propre au prototype : état du faux serveur et choix de l'Utilisateur connecté. */
function PanneauEtat() {
  const { version, executer } = useAdmin();
  const [ouvert, setOuvert] = useState(false);
  const etat = serveur.etat();
  const admins = serveur.listerUtilisateurs().filter((u) => u.role === 'administrateur');
  void version;
  return (
    <div className="proto-etat">
      <button type="button" onClick={() => setOuvert(!ouvert)}>
        PROTOTYPE · état {ouvert ? '▾' : '▴'}
      </button>
      {ouvert && (
        <div className="proto-etat__corps">
          <p>Données en mémoire, perdues au rechargement.</p>
          <p>
            Connecté en tant que :{' '}
            <select value={serveur.courant().id} onChange={(e) => executer(() => serveur.definirCourant(e.target.value))}>
              {admins.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.login}
                </option>
              ))}
            </select>
          </p>
          <p>
            {etat.utilisateurs} Utilisateurs · {etat.projets} Projets · {etat.activites} Activités · {etat.imputations} Imputations
          </p>
        </div>
      )}
    </div>
  );
}

export function PrototypeAdministration() {
  const [variante, setVariante] = useState<Variante>(lireVariante);
  const [ecran, setEcran] = useState<Ecran>({ nom: 'utilisateurs' });
  const changer = (v: Variante) => {
    const url = new URL(window.location.href);
    url.searchParams.set('variant', v);
    window.history.replaceState(null, '', url);
    setVariante(v);
  };
  return (
    <FournisseurLangue>
      <FournisseurAdmin variante={variante} aller={setEcran} key={variante}>
        <Coquille ecran={ecran} aller={setEcran} />
        <PanneauEtat />
      </FournisseurAdmin>
      <Switcher variante={variante} changer={changer} />
    </FournisseurLangue>
  );
}
