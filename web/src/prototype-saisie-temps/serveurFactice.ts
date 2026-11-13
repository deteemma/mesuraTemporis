// PROTOTYPE — faux serveur en mémoire (aucune API, aucune base, aucun Keycloak).
// Reproduit les réponses de l'API source pour l'écran Saisie de temps, avec la
// journée calendaire Europe/Zurich. Tout est perdu au rechargement de la page.
import { normaliser, type ActiviteDisponible } from './resolutionActivite';
import { debutJournee, decalerJour, instantZurich, journee } from './journee';

export interface Projet {
  id: string;
  nom: string;
}
export interface Activite {
  id: string;
  nom: string;
  projetId: string;
}
export interface Imputation {
  id: string;
  projetId: string;
  activiteId: string;
  heureDebut: string;
  heureFin: string | null;
}
export interface GroupeServeur {
  projetId: string;
  activiteId: string;
  imputations: Imputation[];
}
export interface PageHistoriqueServeur {
  jours: { date: string; objets: GroupeServeur[] }[];
  curseurSuivant: string | null;
}

/** Erreur portant un code stable (ADR source 0008), traduit par l'écran. */
export class ErreurApi extends Error {
  constructor(public code: string) {
    super(code);
  }
}

const LIMITE_OBJETS_PAR_PAGE = 50;
let prochainId = 1;
const id = (prefixe: string) => `${prefixe}${prochainId++}`;

const projets: Projet[] = [
  { id: 'p1', nom: 'Refonte du site' },
  { id: 'p2', nom: 'Support client' },
  { id: 'p3', nom: 'Interne' },
  { id: 'p4', nom: 'Migration ERP' },
];

const activites: Activite[] = [
  { id: 'a1', nom: 'Maquettes', projetId: 'p1' },
  { id: 'a2', nom: 'Intégration', projetId: 'p1' },
  { id: 'a3', nom: 'Réunion', projetId: 'p1' },
  { id: 'a4', nom: 'Tickets niveau 1', projetId: 'p2' },
  { id: 'a5', nom: 'Réunion', projetId: 'p2' },
  { id: 'a6', nom: 'Formation', projetId: 'p3' },
  { id: 'a7', nom: 'Administration', projetId: 'p3' },
];

let imputations: Imputation[] = [];

function ajouter(projetId: string, activiteId: string, debut: Date, fin: Date | null): Imputation {
  const imputation = {
    id: id('i'),
    projetId,
    activiteId,
    heureDebut: debut.toISOString(),
    heureFin: fin ? fin.toISOString() : null,
  };
  imputations.push(imputation);
  return imputation;
}

// Jeu de données : aujourd'hui, ~40 jours ouvrés d'historique (2 pages), un chrono actif.
(function amorcer() {
  const aujourdHui = journee(new Date());
  const h = (jour: string, hh: number, mm: number) => instantZurich(jour, hh, mm);
  ajouter('p1', 'a1', h(aujourdHui, 8, 2), h(aujourdHui, 9, 47));
  ajouter('p2', 'a4', h(aujourdHui, 9, 50), h(aujourdHui, 10, 31));
  ajouter('p1', 'a1', h(aujourdHui, 10, 35), h(aujourdHui, 11, 58));
  ajouter('p1', 'a3', h(aujourdHui, 13, 30), h(aujourdHui, 14, 15));

  const couples: [string, string][] = [
    ['p1', 'a1'], ['p1', 'a2'], ['p1', 'a3'], ['p2', 'a4'], ['p2', 'a5'], ['p3', 'a6'], ['p3', 'a7'],
  ];
  let graine = 7;
  const hasard = () => (graine = (graine * 9301 + 49297) % 233280) / 233280;
  let jour = aujourdHui;
  for (let n = 0; n < 40; ) {
    jour = decalerJour(jour, -1);
    const jourSemaine = new Date(`${jour}T12:00:00Z`).getUTCDay();
    if (jourSemaine === 0 || jourSemaine === 6) continue;
    n++;
    let minutes = 8 * 60 + Math.floor(hasard() * 30);
    const nombre = 2 + Math.floor(hasard() * 3);
    for (let k = 0; k < nombre; k++) {
      const [p, a] = couples[Math.floor(hasard() * couples.length)]!;
      const duree = 30 + Math.floor(hasard() * 150);
      ajouter(p, a, h(jour, Math.floor(minutes / 60), minutes % 60), h(jour, Math.floor((minutes + duree) / 60), (minutes + duree) % 60));
      minutes += duree + 5 + Math.floor(hasard() * 20);
    }
  }
  // Chrono actif démarré il y a 25 minutes.
  ajouter('p1', 'a2', new Date(Date.now() - 25 * 60 * 1000 - 13 * 1000), null);
})();

const parDebutDesc = (a: Imputation, b: Imputation) => b.heureDebut.localeCompare(a.heureDebut);
const nomProjet = (projetId: string) => projets.find((p) => p.id === projetId)?.nom ?? '—';

export const serveur = {
  /** État brut, affiché par le panneau « État » du prototype. */
  etatBrut: () => ({ projets, activites, imputations }),

  listerProjets: (): Projet[] => [...projets],

  listerActivites: (projetId: string): Activite[] => activites.filter((a) => a.projetId === projetId),

  rechercherActivites(texte: string): ActiviteDisponible[] {
    const n = normaliser(texte);
    return activites
      .filter((a) => normaliser(a.nom).includes(n))
      .map((a) => ({ id: a.id, nom: a.nom, projetId: a.projetId, projetNom: nomProjet(a.projetId) }));
  },

  statutChrono: (): Imputation | null => imputations.find((i) => i.heureFin === null) ?? null,

  listerDuJour: (jour: string): Imputation[] =>
    imputations.filter((i) => journee(i.heureDebut) === jour).sort(parDebutDesc),

  historique(avant?: string): PageHistoriqueServeur {
    const aujourdHui = journee(new Date());
    const borne = avant && avant < aujourdHui ? avant : decalerJour(aujourdHui, -1);
    const parJour = new Map<string, Imputation[]>();
    for (const i of imputations.filter((x) => x.heureFin && journee(x.heureDebut) <= borne).sort(parDebutDesc)) {
      const j = journee(i.heureDebut);
      parJour.set(j, [...(parJour.get(j) ?? []), i]);
    }
    const jours: PageHistoriqueServeur['jours'] = [];
    let total = 0;
    for (const [date, liste] of parJour) {
      const objets = new Map<string, GroupeServeur>();
      for (const i of liste) {
        const cle = `${i.projetId}::${i.activiteId}`;
        if (!objets.has(cle)) objets.set(cle, { projetId: i.projetId, activiteId: i.activiteId, imputations: [] });
        objets.get(cle)!.imputations.push(i);
      }
      if (jours.length > 0 && total + objets.size > LIMITE_OBJETS_PAR_PAGE) {
        return { jours, curseurSuivant: date };
      }
      jours.push({ date, objets: [...objets.values()] });
      total += objets.size;
    }
    return { jours, curseurSuivant: null };
  },

  demarrerChrono(
    projetId: string,
    options: { activiteId: string } | { nomNouvelleActivite: string },
  ): { imputation: Imputation; chronoPrecedentArrete: Imputation | null } {
    let activite: Activite | undefined;
    if ('activiteId' in options) {
      activite = activites.find((a) => a.id === options.activiteId && a.projetId === projetId);
      if (!activite) throw new ErreurApi('ACTIVITE_INTROUVABLE');
    } else {
      const nom = options.nomNouvelleActivite.trim();
      activite = activites.find((a) => a.projetId === projetId && normaliser(a.nom) === normaliser(nom));
      if (!activite) {
        activite = { id: id('a'), nom, projetId };
        activites.push(activite);
      }
    }
    const enCours = serveur.statutChrono();
    if (enCours) enCours.heureFin = new Date().toISOString();
    return { imputation: ajouter(projetId, activite.id, new Date(), null), chronoPrecedentArrete: enCours };
  },

  arreterChrono(): void {
    const enCours = serveur.statutChrono();
    if (!enCours) throw new ErreurApi('AUCUN_CHRONO_ACTIF');
    enCours.heureFin = new Date().toISOString();
  },

  creerManuelle(projetId: string, activiteId: string, debut: Date, fin: Date): Imputation {
    // Décision « Frontière des journées » : fin avant début refusée (écart à la source) ;
    // franchir minuit est accepté sans Scission.
    if (fin < debut) throw new ErreurApi('IMPUTATION_FIN_AVANT_DEBUT');
    return ajouter(projetId, activiteId, debut, fin);
  },

  /**
   * Édition à la volée d'une heure. Si l'heure demandée fait franchir minuit
   * (fin avant début), Scission : l'Imputation est tronquée à minuit et une
   * nouvelle est créée sur la journée voisine (Europe/Zurich), à l'heure visée.
   */
  modifier(idImputation: string, champ: 'heureDebut' | 'heureFin', valeur: Date): { scission: Imputation | null } {
    const imputation = imputations.find((i) => i.id === idImputation);
    if (!imputation) throw new ErreurApi('IMPUTATION_INTROUVABLE');
    const debut = champ === 'heureDebut' ? valeur : new Date(imputation.heureDebut);
    const fin = champ === 'heureFin' ? valeur : new Date(imputation.heureFin!);
    if (fin >= debut) {
      imputation[champ] = valeur.toISOString();
      return { scission: null };
    }
    const heureVisee = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(valeur).split(':').map(Number) as [number, number];
    if (champ === 'heureFin') {
      const lendemain = decalerJour(journee(imputation.heureDebut), 1);
      imputation.heureFin = new Date(debutJournee(lendemain).getTime() - 1).toISOString();
      return { scission: ajouter(imputation.projetId, imputation.activiteId, debutJournee(lendemain), instantZurich(lendemain, ...heureVisee)) };
    }
    const jourOrigine = journee(imputation.heureFin!);
    const veille = decalerJour(jourOrigine, -1);
    imputation.heureDebut = debutJournee(jourOrigine).toISOString();
    return {
      scission: ajouter(imputation.projetId, imputation.activiteId, instantZurich(veille, ...heureVisee), new Date(debutJournee(jourOrigine).getTime() - 1)),
    };
  },

  supprimer(idImputation: string): void {
    imputations = imputations.filter((i) => i.id !== idImputation);
  },

  renommerActivite(projetId: string, activiteId: string, nom: string): Activite {
    const activite = activites.find((a) => a.id === activiteId && a.projetId === projetId);
    if (!activite) throw new ErreurApi('ACTIVITE_INTROUVABLE');
    const doublon = activites.some(
      (a) => a.projetId === projetId && a.id !== activiteId && normaliser(a.nom) === normaliser(nom),
    );
    if (doublon) throw new ErreurApi('ACTIVITE_NOM_DUPLIQUE');
    activite.nom = nom;
    return activite;
  },
};
