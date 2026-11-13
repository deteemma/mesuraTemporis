/* eslint-disable react-hooks/refs, react-hooks/purity -- PROTOTYPE jetable */
// PROTOTYPE — écran Saisie de temps, portage React de
// mesureTemporisMP/frontend/src/app/pages/saisie-temps (rendu et comportement à l'identique).
// Branché sur le faux serveur en mémoire ; à réécrire proprement à l'implémentation.
import { type FormEvent, Fragment, useEffect, useRef, useState } from 'react';
import { ChampHeure, type ChampHeureHandle } from './ChampHeure';
import { useLangue } from './i18n';
import { formatDuree, formatHeure, formatSecondesHHMMSS, instantZurich, journee } from './journee';
import {
  type ActionChampActivite,
  type ActiviteDisponible,
  type EtatChampActivite,
  type PaireRecente,
  etatInitialChampActivite,
  reducerChampActivite,
} from './resolutionActivite';
import { ErreurApi, type Imputation, serveur } from './serveurFactice';

type Champ = 'heureDebut' | 'heureFin';
interface Groupe {
  cle: string;
  projetId: string;
  activiteId: string;
  imputations: Imputation[];
  totalSecondes: number;
}

const cleGroupe = (projetId: string, activiteId: string) => `${projetId}::${activiteId}`;
const secondes = (i: Imputation) => Math.round((new Date(i.heureFin!).getTime() - new Date(i.heureDebut).getTime()) / 1000);

function regrouper(imputations: Imputation[]): Groupe[] {
  const parCle = new Map<string, Groupe>();
  for (const i of imputations) {
    if (!i.heureFin) continue;
    const cle = cleGroupe(i.projetId, i.activiteId);
    const g = parCle.get(cle) ?? { cle, projetId: i.projetId, activiteId: i.activiteId, imputations: [], totalSecondes: 0 };
    g.imputations.push(i);
    g.totalSecondes += secondes(i);
    parCle.set(cle, g);
  }
  const plusAncien = (g: Groupe) => Math.min(...g.imputations.map((i) => new Date(i.heureDebut).getTime()));
  return [...parCle.values()].sort((a, b) => plusAncien(a) - plusAncien(b));
}

/** Champ 24h : l'heure saisie s'applique à la Journée (Europe/Zurich) de la valeur éditée. */
function heureEditee(referenceIso: string, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  return instantZurich(journee(referenceIso), h!, m!);
}

/** Valeur d'un <input type="datetime-local">, interprétée en heure de Zurich. */
function depuisDatetimeLocal(valeur: string): Date {
  const [jour, heure] = valeur.split('T');
  const [h, m] = heure!.split(':').map(Number);
  return instantZurich(jour!, h!, m!);
}

export function SaisieTemps({ notifier }: { notifier: (message: string) => void }) {
  const { t } = useLangue();
  const [, setVersion] = useState(0);
  const rafraichir = () => setVersion((v) => v + 1);
  const message = (e: unknown, repli: string) => (e instanceof ErreurApi ? t(e.code) : t(repli));

  const projets = serveur.listerProjets();
  const nomProjet = (id: string) => projets.find((p) => p.id === id)?.nom ?? '—';
  const nomActivite = (id: string) => serveur.etatBrut().activites.find((a) => a.id === id)?.nom ?? '—';

  // --- Chronomètre ---
  const chronoActif = serveur.statutChrono();
  const [maintenant, setMaintenant] = useState(Date.now());
  useEffect(() => {
    const minuterie = setInterval(() => setMaintenant(Date.now()), 1000);
    return () => clearInterval(minuterie);
  }, []);
  const compteur = chronoActif
    ? formatSecondesHHMMSS(Math.floor((maintenant - new Date(chronoActif.heureDebut).getTime()) / 1000))
    : '00:00:00';
  const estChronoActifPour = (x: { projetId: string; activiteId: string }) =>
    !!chronoActif && chronoActif.projetId === x.projetId && chronoActif.activiteId === x.activiteId;

  // --- Jour courant ---
  const imputationsDuJour = serveur.listerDuJour(journee(new Date()));
  const groupes = regrouper(imputationsDuJour);
  const [deplies, setDeplies] = useState<Set<string>>(new Set());
  const basculer = (cle: string) =>
    setDeplies((s) => {
      const n = new Set(s);
      if (n.has(cle)) n.delete(cle);
      else n.add(cle);
      return n;
    });

  // --- Saisie unifiée Activité → Projet (ADR source 0004) ---
  const [champActivite, setChampActivite] = useState<EtatChampActivite>(etatInitialChampActivite);
  const activitesRecherche = useRef<ActiviteDisponible[]>([]);
  function pairesRecentes(): PaireRecente[] {
    const parActivite = new Map<string, Imputation>();
    for (const i of imputationsDuJour) {
      const e = parActivite.get(i.activiteId);
      if (!e || i.heureDebut > e.heureDebut) parActivite.set(i.activiteId, i);
    }
    return [...parActivite.values()]
      .sort((a, b) => b.heureDebut.localeCompare(a.heureDebut))
      .map((i) => ({ activiteId: i.activiteId, nom: nomActivite(i.activiteId), projetId: i.projetId, projetNom: nomProjet(i.projetId), date: i.heureDebut }));
  }
  const appliquer = (action: ActionChampActivite) =>
    setChampActivite((etat) =>
      reducerChampActivite(etat, action, {
        activitesDisponibles: activitesRecherche.current,
        projetsAffectes: projets,
        pairesRecentes: pairesRecentes(),
      }),
    );
  function saisirActivite(texte: string) {
    activitesRecherche.current = texte.trim() ? serveur.rechercherActivites(texte) : [];
    appliquer({ type: 'SET_TEXTE', texte });
  }
  function demarrerChrono() {
    const r = champActivite.resolution;
    if (!r || chronoActif) return;
    serveur.demarrerChrono(r.projetId, r.nouvelle ? { nomNouvelleActivite: r.activite } : { activiteId: r.activiteId! });
    setChampActivite(etatInitialChampActivite());
    activitesRecherche.current = [];
    rafraichir();
  }
  function arreterChrono() {
    serveur.arreterChrono();
    rafraichir();
  }
  function relancer(x: { projetId: string; activiteId: string }, depuisHistorique: boolean) {
    const { chronoPrecedentArrete } = serveur.demarrerChrono(x.projetId, { activiteId: x.activiteId });
    rafraichir();
    if (chronoPrecedentArrete) notifier(t('NOTIF_CHRONO_PRECEDENT_ARRETE', { heure: formatHeure(chronoPrecedentArrete.heureFin!) }));
    if (depuisHistorique) retournerAujourdHui();
  }

  // --- Renommage d'Activité (ADR source 0005) ---
  const [editionNom, setEditionNom] = useState<{ projetId: string; activiteId: string } | null>(null);
  const editionNomRef = useRef(editionNom);
  editionNomRef.current = editionNom;
  const [valeurNom, setValeurNom] = useState('');
  const [erreurNom, setErreurNom] = useState<string | null>(null);
  const enEditionNom = (projetId: string, activiteId: string) => editionNom?.projetId === projetId && editionNom.activiteId === activiteId;
  function demarrerEditionNom(projetId: string, activiteId: string) {
    setErreurNom(null);
    setEditionNom({ projetId, activiteId });
    setValeurNom(nomActivite(activiteId));
  }
  function annulerEditionNom() {
    editionNomRef.current = null;
    setEditionNom(null);
    setValeurNom('');
    setErreurNom(null);
  }
  function confirmerEditionNom() {
    const edition = editionNomRef.current;
    if (!edition) return;
    const nom = valeurNom.trim();
    if (!nom) return annulerEditionNom();
    try {
      serveur.renommerActivite(edition.projetId, edition.activiteId, nom);
      annulerEditionNom();
      rafraichir();
    } catch (e) {
      setErreurNom(message(e, 'ERREUR_RENOMMAGE_NON_ENREGISTRE'));
    }
  }
  function champNom(projetId: string, activiteId: string, classeLecture: string, stop: boolean) {
    if (enEditionNom(projetId, activiteId)) {
      return (
        <input
          type="text"
          className="field field--inline"
          autoFocus
          value={valeurNom}
          aria-label={t('ARIA_RENOMMER_ACTIVITE')}
          onClick={(e) => stop && e.stopPropagation()}
          onChange={(e) => setValeurNom(e.target.value)}
          onBlur={confirmerEditionNom}
          onKeyDown={(e) => {
            if (e.key === 'Enter') confirmerEditionNom();
            else if (e.key === 'Escape') annulerEditionNom();
          }}
        />
      );
    }
    return (
      <span
        className={classeLecture}
        role="button"
        tabIndex={0}
        onClick={(e) => {
          if (stop) e.stopPropagation();
          demarrerEditionNom(projetId, activiteId);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          if (stop) e.stopPropagation();
          demarrerEditionNom(projetId, activiteId);
        }}
      >
        {nomActivite(activiteId)}
      </span>
    );
  }

  // --- Saisie manuelle ---
  const [manuel, setManuel] = useState({ projetId: '', activiteId: '', debut: '', fin: '' });
  const [erreurManuelle, setErreurManuelle] = useState<string | null>(null);
  function ajouterManuelle(e: FormEvent) {
    e.preventDefault();
    if (!manuel.projetId || !manuel.activiteId || !manuel.debut || !manuel.fin) return;
    try {
      serveur.creerManuelle(manuel.projetId, manuel.activiteId, depuisDatetimeLocal(manuel.debut), depuisDatetimeLocal(manuel.fin));
      setManuel((m) => ({ ...m, debut: '', fin: '' }));
      setErreurManuelle(null);
      rafraichir();
    } catch (err) {
      setErreurManuelle(message(err, 'ERREUR_MODIFICATION_NON_ENREGISTREE'));
    }
  }

  // --- Édition à la volée des heures (champ 24h) ---
  const [erreurEdition, setErreurEdition] = useState<{ id: string; champ: Champ; message: string } | null>(null);
  const refsFin = useRef(new Map<string, ChampHeureHandle>());
  function enregistrerHeure(imputation: Imputation, champ: Champ, texte: string) {
    try {
      const { scission } = serveur.modifier(imputation.id, champ, heureEditee(imputation[champ] ?? imputation.heureDebut, texte));
      setErreurEdition(null);
      rafraichir();
      if (scission) notifier(t('NOTIF_SCISSION', { jour: journee(scission.heureDebut) }));
    } catch (e) {
      setErreurEdition({ id: imputation.id, champ, message: message(e, 'ERREUR_MODIFICATION_NON_ENREGISTREE') });
    }
  }
  const erreurPour = (id: string, champ: Champ) =>
    erreurEdition?.id === id && erreurEdition.champ === champ ? erreurEdition.message : null;

  function supprimer(id: string) {
    serveur.supprimer(id);
    rafraichir();
  }

  // --- Historique paginé ---
  const ancreAujourdHui = useRef<HTMLElement>(null);
  const retournerAujourdHui = () => ancreAujourdHui.current?.scrollIntoView({ behavior: 'smooth' });
  const [curseurs, setCurseurs] = useState<(string | undefined)[]>([undefined]);
  const [indexPage, setIndexPage] = useState(0);
  const page = serveur.historique(curseurs[indexPage]);
  function pageSuivante() {
    if (page.curseurSuivant === null) return;
    if (indexPage + 1 >= curseurs.length) setCurseurs((c) => [...c, page.curseurSuivant!]);
    setIndexPage(indexPage + 1);
  }
  const [ajoutHistorique, setAjoutHistorique] = useState<{ date: string; projetId: string; activiteId: string } | null>(null);
  const [plage, setPlage] = useState({ debut: '', fin: '' });
  function confirmerAjoutHistorique(e: FormEvent) {
    e.preventDefault();
    if (!ajoutHistorique || !plage.debut || !plage.fin) return;
    try {
      serveur.creerManuelle(ajoutHistorique.projetId, ajoutHistorique.activiteId, depuisDatetimeLocal(plage.debut), depuisDatetimeLocal(plage.fin));
      setAjoutHistorique(null);
      setPlage({ debut: '', fin: '' });
      rafraichir();
    } catch (err) {
      notifier(message(err, 'ERREUR_MODIFICATION_NON_ENREGISTREE'));
    }
  }

  function ligne(imputation: Imputation, avecRelancer: boolean) {
    return (
      <li className="entries__ligne" key={imputation.id}>
        <span className="entries__puce"></span>
        <div className="entries__info">
          <span className="entries__activite">{nomActivite(imputation.activiteId)}</span>
          <span className="entries__projet">{nomProjet(imputation.projetId)}</span>
        </div>
        <span className="entries__horaire">
          <ChampHeure
            valeur={formatHeure(imputation.heureDebut)}
            ariaLabel={t('ARIA_MODIFIER_HEURE_DEBUT')}
            erreurServeur={erreurPour(imputation.id, 'heureDebut')}
            onValide={(texte, viaEntree) => {
              enregistrerHeure(imputation, 'heureDebut', texte);
              if (viaEntree) refsFin.current.get(imputation.id)?.ouvrir();
            }}
            onAnnule={() => erreurPour(imputation.id, 'heureDebut') && setErreurEdition(null)}
          />
          {' → '}
          <ChampHeure
            ref={(h) => {
              if (h) refsFin.current.set(imputation.id, h);
              else refsFin.current.delete(imputation.id);
            }}
            valeur={formatHeure(imputation.heureFin!)}
            ariaLabel={t('ARIA_MODIFIER_HEURE_FIN')}
            erreurServeur={erreurPour(imputation.id, 'heureFin')}
            onValide={(texte) => enregistrerHeure(imputation, 'heureFin', texte)}
            onAnnule={() => erreurPour(imputation.id, 'heureFin') && setErreurEdition(null)}
          />
        </span>
        <span className="badge">{formatDuree(imputation.heureDebut, imputation.heureFin!)}</span>
        {avecRelancer && (
          <button
            type="button"
            className="btn btn-secondary entries__relancer"
            disabled={estChronoActifPour(imputation)}
            onClick={() => relancer(imputation, false)}
            aria-label={t('ARIA_RELANCER')}
          >
            {t('BOUTON_RELANCER')}
          </button>
        )}
        <button type="button" className="btn btn-danger entries__supprimer" onClick={() => supprimer(imputation.id)} aria-label={t('ARIA_SUPPRIMER_IMPUTATION')}>
          ✕
        </button>
      </li>
    );
  }

  function chevron(cle: string) {
    return (
      <button
        type="button"
        className="groupe__chevron-bouton"
        aria-expanded={deplies.has(cle)}
        aria-label={t('ARIA_DEPLIER_GROUPE')}
        onClick={(e) => {
          e.stopPropagation();
          basculer(cle);
        }}
      >
        <span className={`groupe__chevron${deplies.has(cle) ? ' groupe__chevron--ouvert' : ''}`}>▸</span>
      </button>
    );
  }

  return (
    <div className="page">
      <h1>{t('NAV_SAISIE_TEMPS')}</h1>

      <section ref={ancreAujourdHui} className={`hero card${chronoActif ? ' hero--actif' : ''}`}>
        {chronoActif ? (
          <div className="hero__actif">
            <span className="hero__pulse"></span>
            <div className="hero__texte">
              <div className="hero__titre">
                {champNom(chronoActif.projetId, chronoActif.activiteId, 'hero__titre-editable', false)}
                {erreurNom && editionNom?.activiteId === chronoActif.activiteId && <span className="hero__erreur">{erreurNom}</span>}
              </div>
              <div className="hero__sous-titre">
                {nomProjet(chronoActif.projetId)} · {t('SAISIE_EN_COURS_DEPUIS')} {formatHeure(chronoActif.heureDebut)} ·{' '}
                <span className="hero__compteur">{compteur}</span>
              </div>
            </div>
            <button type="button" className="btn btn-danger hero__stop" onClick={arreterChrono}>
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
                value={champActivite.texte}
                onFocus={() => appliquer({ type: 'FOCUS' })}
                onChange={(e) => saisirActivite(e.target.value)}
                onKeyDown={(e) => {
                  const touches = { ArrowDown: 'FLECHE_BAS', ArrowUp: 'FLECHE_HAUT', Enter: 'ENTREE' } as const;
                  const type = touches[e.key as keyof typeof touches];
                  if (!type) return;
                  e.preventDefault();
                  appliquer({ type });
                }}
              />
              {champActivite.suggestions.length > 0 && (
                <ul className="suggestions">
                  {champActivite.suggestions.map((s, index) => (
                    <li
                      key={index}
                      className={index === champActivite.surlignee ? 'hl' : ''}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        appliquer({ type: 'CLIC_SUGGESTION', index });
                      }}
                    >
                      {s.type === 'existing' ? `${s.nom} — ${s.projetNom}` : `➕ ${t('SAISIE_SUGGESTION_CREER', { texte: s.texte })}`}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {champActivite.creation && (
              <select
                className="field"
                aria-label={t('ARIA_CHOISIR_PROJET_ACTIVITE')}
                onChange={(e) => e.target.value && appliquer({ type: 'CHOISIR_PROJET_CREATION', projetId: e.target.value })}
              >
                <option value="">{t('SAISIE_OPTION_CHOISIR_PROJET')}</option>
                {champActivite.creation.projetsDisponibles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nom}
                  </option>
                ))}
              </select>
            )}
            <button type="button" className="btn btn-primary hero__start" disabled={!champActivite.resolution} onClick={demarrerChrono}>
              {t('SAISIE_BOUTON_DEMARRER')}
            </button>
          </div>
        )}
      </section>

      <details className="card manuel">
        <summary>{t('SAISIE_AJOUTER_MANUELLE')}</summary>
        <form className="manuel__form" onSubmit={ajouterManuelle}>
          <select
            className="field"
            aria-label={t('CHAMP_PROJET')}
            value={manuel.projetId}
            onChange={(e) => setManuel((m) => ({ ...m, projetId: e.target.value, activiteId: '' }))}
          >
            <option value="">{t('CHAMP_PROJET')}</option>
            {projets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nom}
              </option>
            ))}
          </select>
          <select
            className="field"
            aria-label={t('CHAMP_ACTIVITE')}
            value={manuel.activiteId}
            onChange={(e) => setManuel((m) => ({ ...m, activiteId: e.target.value }))}
          >
            <option value="">{t('CHAMP_ACTIVITE')}</option>
            {(manuel.projetId ? serveur.listerActivites(manuel.projetId) : []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.nom}
              </option>
            ))}
          </select>
          <input className="field" type="datetime-local" aria-label={t('CHAMP_HEURE_DEBUT')} value={manuel.debut} onChange={(e) => setManuel((m) => ({ ...m, debut: e.target.value }))} />
          <input className="field" type="datetime-local" aria-label={t('CHAMP_HEURE_FIN')} value={manuel.fin} onChange={(e) => setManuel((m) => ({ ...m, fin: e.target.value }))} />
          <button type="submit" className="btn btn-secondary">
            {t('BOUTON_AJOUTER')}
          </button>
        </form>
        {erreurManuelle && (
          <p className="banner-error proto-ecart" title="PROTOTYPE : affichage proposé, la source n'affichait rien">
            {erreurManuelle}
          </p>
        )}
      </details>

      <section className="card entries">
        <h2 className="entries__titre">{t('SAISIE_TITRE_ENTREES_JOUR')}</h2>
        {groupes.length === 0 && <p className="entries__vide">{t('SAISIE_AUCUNE_IMPUTATION_JOUR')}</p>}
        <ul className="groupes">
          {groupes.map((g) => (
            <li className="groupe" key={g.cle}>
              <div className="groupe__entete" onClick={() => basculer(g.cle)}>
                {chevron(g.cle)}
                <div className="groupe__info">
                  {champNom(g.projetId, g.activiteId, 'groupe__activite', true)}
                  <span className="groupe__projet">{nomProjet(g.projetId)}</span>
                  {erreurNom && editionNom?.activiteId === g.activiteId && <span className="entries__erreur">{erreurNom}</span>}
                </div>
                <span className="groupe__nombre">({g.imputations.length})</span>
                <span className="badge groupe__total">{formatSecondesHHMMSS(g.totalSecondes)}</span>
              </div>
              {deplies.has(g.cle) && <ul className="entries__liste">{g.imputations.map((i) => ligne(i, true))}</ul>}
            </li>
          ))}
        </ul>
      </section>

      <section className="card historique">
        <div className="historique__entete">
          <h2 className="entries__titre">{t('SAISIE_TITRE_HISTORIQUE')}</h2>
          <button type="button" className="btn btn-secondary" onClick={retournerAujourdHui}>
            {t('BOUTON_RETOUR_AUJOURDHUI')}
          </button>
        </div>
        {page.jours.length === 0 && <p className="entries__vide">{t('SAISIE_AUCUN_HISTORIQUE')}</p>}
        <div className="historique__jours">
          {page.jours.map((jour) => (
            <div className="historique__jour" key={jour.date}>
              <h3 className="historique__date">{jour.date}</h3>
              <div className="historique__jour-corps">
                <ul className="groupes">
                  {jour.objets.map((objet) => {
                    const cle = `${jour.date}|${cleGroupe(objet.projetId, objet.activiteId)}`;
                    const total = objet.imputations.reduce((s, i) => s + secondes(i), 0);
                    const ajoutOuvert =
                      ajoutHistorique?.date === jour.date && ajoutHistorique.projetId === objet.projetId && ajoutHistorique.activiteId === objet.activiteId;
                    return (
                      <Fragment key={cle}>
                        <li className="groupe">
                          <div className="groupe__entete" onClick={() => basculer(cle)}>
                            {chevron(cle)}
                            <div className="groupe__info">
                              <span className="groupe__activite">{nomActivite(objet.activiteId)}</span>
                              <span className="groupe__projet">{nomProjet(objet.projetId)}</span>
                            </div>
                            <span className="groupe__nombre">({objet.imputations.length})</span>
                            <span className="badge groupe__total">{formatSecondesHHMMSS(total)}</span>
                            <button
                              type="button"
                              className="btn btn-secondary entries__relancer"
                              disabled={estChronoActifPour(objet)}
                              onClick={(e) => {
                                e.stopPropagation();
                                relancer(objet, true);
                              }}
                              aria-label={t('ARIA_RELANCER')}
                            >
                              {t('BOUTON_RELANCER')}
                            </button>
                          </div>
                          {deplies.has(cle) && (
                            <>
                              <ul className="entries__liste">{objet.imputations.map((i) => ligne(i, false))}</ul>
                              {ajoutOuvert ? (
                                <form className="historique__ajout" onSubmit={confirmerAjoutHistorique}>
                                  <input className="field" type="datetime-local" aria-label={t('CHAMP_HEURE_DEBUT')} value={plage.debut} onChange={(e) => setPlage((p) => ({ ...p, debut: e.target.value }))} />
                                  <input className="field" type="datetime-local" aria-label={t('CHAMP_HEURE_FIN')} value={plage.fin} onChange={(e) => setPlage((p) => ({ ...p, fin: e.target.value }))} />
                                  <button type="submit" className="btn btn-secondary">
                                    {t('BOUTON_AJOUTER')}
                                  </button>
                                  <button type="button" className="btn btn-secondary" onClick={() => setAjoutHistorique(null)}>
                                    {t('BOUTON_ANNULER')}
                                  </button>
                                </form>
                              ) : (
                                <button
                                  type="button"
                                  className="btn btn-secondary historique__ajout-bouton"
                                  onClick={() => {
                                    setAjoutHistorique({ date: jour.date, projetId: objet.projetId, activiteId: objet.activiteId });
                                    setPlage({ debut: '', fin: '' });
                                  }}
                                >
                                  {t('BOUTON_AJOUTER_PLAGE')}
                                </button>
                              )}
                            </>
                          )}
                        </li>
                      </Fragment>
                    );
                  })}
                </ul>
              </div>
            </div>
          ))}
        </div>
        <div className="historique__pagination">
          <button type="button" className="btn btn-secondary" disabled={indexPage === 0} onClick={() => setIndexPage(indexPage - 1)}>
            {t('BOUTON_PRECEDENT')}
          </button>
          <span className="historique__page-numero">{t('SAISIE_PAGE_NUMERO', { numero: String(indexPage + 1) })}</span>
          <button type="button" className="btn btn-secondary" disabled={page.curseurSuivant === null} onClick={pageSuivante}>
            {t('BOUTON_SUIVANT')}
          </button>
        </div>
      </section>
    </div>
  );
}
