// PROTOTYPE — à jeter. Faux serveur en mémoire pour les écrans d'administration.
// Reprend les règles de la source (routes projets/activites/utilisateurs, cascade.js)
// et les écarts tranchés (compte initial `admin` protégé, pas d'action sur soi-même,
// rôle Administrateur attribuable). Les noms des deux nouveaux codes d'erreur sont
// provisoires : ils seront fixés à l'implémentation.

export type Role = 'utilisateur' | 'administrateur';

export interface Utilisateur {
  id: string;
  login: string;
  nom: string;
  email: string;
  role: Role;
}

export interface Projet {
  id: string;
  nom: string;
  statut: 'actif';
  utilisateursAffectes: string[];
}

export interface Activite {
  id: string;
  nom: string;
  projetId: string;
}

interface Imputation {
  id: string;
  utilisateurId: string;
  projetId: string;
  activiteId: string;
}

export class ErreurApi extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export const LOGIN_COMPTE_INITIAL = 'admin';

let compteur = 100;
const nouvelId = () => String(++compteur);

const normaliser = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();

const utilisateurs: Utilisateur[] = [
  { id: 'u1', login: 'admin', nom: '', email: 'admin@exemple.ch', role: 'administrateur' },
  { id: 'u2', login: 'emma', nom: 'Emma Rochat', email: 'emma.rochat@exemple.ch', role: 'administrateur' },
  { id: 'u3', login: 'lucas', nom: 'Lucas Favre', email: 'lucas.favre@exemple.ch', role: 'utilisateur' },
  { id: 'u4', login: 'sophie.meier@gmail.com', nom: 'Sophie Meier', email: 'sophie.meier@gmail.com', role: 'utilisateur' },
  { id: 'u5', login: 'noah', nom: '', email: 'noah.berset@exemple.ch', role: 'utilisateur' },
];

const projets: Projet[] = [
  { id: 'p1', nom: 'Refonte du site', statut: 'actif', utilisateursAffectes: ['u3', 'u4'] },
  { id: 'p2', nom: 'Migration comptable', statut: 'actif', utilisateursAffectes: ['u2'] },
  { id: 'p3', nom: 'Support interne', statut: 'actif', utilisateursAffectes: [] },
];

const activites: Activite[] = [
  { id: 'a1', nom: 'Maquettes', projetId: 'p1' },
  { id: 'a2', nom: 'Développement', projetId: 'p1' },
  { id: 'a3', nom: 'Recette', projetId: 'p1' },
  { id: 'a4', nom: 'Analyse', projetId: 'p2' },
];

const imputations: Imputation[] = [];
function semer(utilisateurId: string, activiteId: string, nombre: number) {
  const projetId = activites.find((a) => a.id === activiteId)!.projetId;
  for (let i = 0; i < nombre; i++) imputations.push({ id: nouvelId(), utilisateurId, projetId, activiteId });
}
semer('u3', 'a1', 12);
semer('u3', 'a2', 30);
semer('u4', 'a2', 18);
semer('u4', 'a3', 4);
semer('u2', 'a4', 9);

/** Utilisateur connecté (modifiable depuis le panneau du prototype). */
let courantId = 'u2';

/** Retire en place les éléments qui vérifient le prédicat. */
function retirerSi<T>(liste: T[], predicat: (x: T) => boolean) {
  const gardes = liste.filter((x) => !predicat(x));
  liste.splice(0, liste.length, ...gardes);
}

const copie = <T>(x: T): T => structuredClone(x);
const trouverUtilisateur = (id: string) => {
  const u = utilisateurs.find((x) => x.id === id);
  if (!u) throw new ErreurApi('UTILISATEUR_INTROUVABLE');
  return u;
};
const trouverProjet = (id: string) => {
  const p = projets.find((x) => x.id === id);
  if (!p) throw new ErreurApi('PROJET_INTROUVABLE');
  return p;
};

/** Pourquoi une action sensible (rôle, suppression) est interdite sur ce compte, ou null. */
export function protection(u: Utilisateur, idCourant: string): 'COMPTE_INITIAL' | 'SOI_MEME' | null {
  if (u.login === LOGIN_COMPTE_INITIAL) return 'COMPTE_INITIAL';
  if (u.id === idCourant) return 'SOI_MEME';
  return null;
}

function verifierProtection(u: Utilisateur) {
  const motif = protection(u, courantId);
  if (motif === 'COMPTE_INITIAL') throw new ErreurApi('UTILISATEUR_COMPTE_INITIAL_PROTEGE');
  if (motif === 'SOI_MEME') throw new ErreurApi('UTILISATEUR_ACTION_SUR_SOI_INTERDITE');
}

export const serveur = {
  courant: () => copie(trouverUtilisateur(courantId)),
  definirCourant: (id: string) => {
    courantId = id;
  },

  // --- Utilisateurs ---
  listerUtilisateurs: () => copie(utilisateurs),

  creerUtilisateur(login: string, nom: string, email: string, role: Role) {
    if (!login.trim()) throw new ErreurApi('LOGIN_REQUIS');
    if (!email.trim()) throw new ErreurApi('EMAIL_REQUIS');
    if (utilisateurs.some((u) => u.login === login.trim())) throw new ErreurApi('LOGIN_EXISTANT');
    if (utilisateurs.some((u) => u.email.toLowerCase() === email.trim().toLowerCase())) throw new ErreurApi('EMAIL_EXISTANT');
    // Keycloak : mot de passe temporaire = login, changement imposé à la première connexion.
    utilisateurs.push({ id: nouvelId(), login: login.trim(), nom: nom.trim(), email: email.trim().toLowerCase(), role });
  },

  modifierEmail(id: string, email: string) {
    const u = trouverUtilisateur(id);
    if (!email.trim()) throw new ErreurApi('EMAIL_REQUIS');
    if (utilisateurs.some((x) => x.id !== id && x.email.toLowerCase() === email.trim().toLowerCase())) throw new ErreurApi('EMAIL_EXISTANT');
    u.email = email.trim().toLowerCase();
  },

  modifierRole(id: string, role: Role) {
    const u = trouverUtilisateur(id);
    if (u.role === role) return;
    // Attribuer le rôle à quelqu'un d'autre est toujours permis ; le retirer non pour `admin` ni soi-même.
    if (role === 'utilisateur') verifierProtection(u);
    u.role = role;
    // Keycloak : POST /users/{id}/logout — sessions coupées aussitôt (ticket #7).
  },

  supprimerUtilisateur(id: string) {
    const u = trouverUtilisateur(id);
    verifierProtection(u);
    retirerSi(imputations, (x) => x.utilisateurId === id);
    for (const p of projets) p.utilisateursAffectes = p.utilisateursAffectes.filter((x) => x !== id);
    utilisateurs.splice(utilisateurs.indexOf(u), 1);
  },

  // --- Projets et équipe ---
  listerProjets: () => copie(projets),
  projet: (id: string) => copie(trouverProjet(id)),

  creerProjet(nom: string) {
    if (!nom.trim()) throw new ErreurApi('NOM_REQUIS');
    projets.push({ id: nouvelId(), nom: nom.trim(), statut: 'actif', utilisateursAffectes: [] });
  },

  supprimerProjet(id: string) {
    const p = trouverProjet(id);
    retirerSi(imputations, (x) => x.projetId === id);
    retirerSi(activites, (x) => x.projetId === id);
    projets.splice(projets.indexOf(p), 1);
  },

  affecter(projetId: string, utilisateurId: string) {
    const p = trouverProjet(projetId);
    trouverUtilisateur(utilisateurId);
    if (!p.utilisateursAffectes.includes(utilisateurId)) p.utilisateursAffectes.push(utilisateurId);
  },

  retirer(projetId: string, utilisateurId: string) {
    const p = trouverProjet(projetId);
    // L'auteur garde ses Imputations passées (ticket #2).
    p.utilisateursAffectes = p.utilisateursAffectes.filter((x) => x !== utilisateurId);
  },

  // --- Activités ---
  listerActivites: (projetId: string) => copie(activites.filter((a) => a.projetId === projetId)),

  creerActivite(projetId: string, nom: string) {
    trouverProjet(projetId);
    if (!nom.trim()) throw new ErreurApi('NOM_REQUIS');
    if (activites.some((a) => a.projetId === projetId && normaliser(a.nom) === normaliser(nom))) throw new ErreurApi('ACTIVITE_NOM_DUPLIQUE');
    activites.push({ id: nouvelId(), nom: nom.trim(), projetId });
  },

  renommerActivite(id: string, nom: string) {
    const a = activites.find((x) => x.id === id);
    if (!a) throw new ErreurApi('ACTIVITE_INTROUVABLE');
    if (!nom.trim()) throw new ErreurApi('NOM_REQUIS');
    if (activites.some((x) => x.id !== id && x.projetId === a.projetId && normaliser(x.nom) === normaliser(nom))) throw new ErreurApi('ACTIVITE_NOM_DUPLIQUE');
    a.nom = nom.trim();
  },

  supprimerActivite(id: string) {
    const a = activites.find((x) => x.id === id);
    if (!a) throw new ErreurApi('ACTIVITE_INTROUVABLE');
    retirerSi(imputations, (x) => x.activiteId === id);
    activites.splice(activites.indexOf(a), 1);
  },

  // --- Comptages pour les messages de confirmation ---
  impact: {
    utilisateur: (id: string) => ({ imputations: imputations.filter((i) => i.utilisateurId === id).length }),
    projet: (id: string) => ({
      activites: activites.filter((a) => a.projetId === id).length,
      imputations: imputations.filter((i) => i.projetId === id).length,
    }),
    activite: (id: string) => ({ imputations: imputations.filter((i) => i.activiteId === id).length }),
  },

  etat: () => ({ utilisateurs: utilisateurs.length, projets: projets.length, activites: activites.length, imputations: imputations.length }),
};
