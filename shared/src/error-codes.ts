// Codes d'erreur stables (ADR-0021) : écrits une seule fois ici, renvoyés par
// l'API dans le corps `{ code, message }` d'un refus et traduits par le web.
// Catalogue : celui de la source, moins PROJET_NON_AFFECTE (ADR-0017) et les
// codes de l'authentification maison, plus les deux codes de compte (ADR-0018)
// et les trois refus de format de l'Annuaire des comptes (#24).

export const ERROR_CODES = [
  'ERREUR_INTERNE',
  'ACCES_REFUSE',
  'UTILISATEUR_INTROUVABLE',
  'PROJET_INTROUVABLE',
  'ACTIVITE_INTROUVABLE',
  'ACTIVITE_NOM_DUPLIQUE',
  'NOM_REQUIS',
  'LOGIN_REQUIS',
  'LOGIN_EXISTANT',
  'LOGIN_INVALIDE',
  'EMAIL_REQUIS',
  'EMAIL_EXISTANT',
  'EMAIL_INVALIDE',
  'NOM_INVALIDE',
  'IMPUTATION_INTROUVABLE',
  'AUCUN_CHRONO_ACTIF',
  'IMPUTATION_CHAMPS_REQUIS',
  'IMPUTATION_FIN_AVANT_DEBUT',
  'PLAGE_DATES_REQUISE',
  'UTILISATEUR_COMPTE_INITIAL_PROTEGE',
  'UTILISATEUR_ACTION_SUR_SOI_INTERDITE',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Corps d'un refus métier de l'API ; `message` est le repli en français. */
export interface ErrorBody {
  code: ErrorCode;
  message: string;
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}

/**
 * Message français de chaque code : repli renvoyé par l'API dans `message`
 * (textes de la source) et traduction française du web. L'indexation par
 * ErrorCode garantit, à la vérification des types, qu'aucun code n'est oublié.
 */
export const ERROR_MESSAGES_FR: Record<ErrorCode, string> = {
  ERREUR_INTERNE: 'Erreur interne du serveur',
  IMPUTATION_INTROUVABLE: 'Imputation introuvable',
  AUCUN_CHRONO_ACTIF: 'Aucun chronomètre actif',
  IMPUTATION_CHAMPS_REQUIS: 'projetId, activiteId, heureDebut et heureFin sont requis',
  IMPUTATION_FIN_AVANT_DEBUT: "L'heure de fin ne peut pas être antérieure à l'heure de début",
  PLAGE_DATES_REQUISE: 'dateDebut et dateFin sont requis',
  ACCES_REFUSE: 'Accès refusé',
  PROJET_INTROUVABLE: 'Projet introuvable',
  ACTIVITE_INTROUVABLE: 'Activité introuvable',
  ACTIVITE_NOM_DUPLIQUE: 'Une Activité de ce nom existe déjà dans ce Projet',
  UTILISATEUR_INTROUVABLE: 'Utilisateur introuvable',
  NOM_REQUIS: 'Nom requis',
  LOGIN_REQUIS: 'Login requis',
  LOGIN_EXISTANT: 'Ce login existe déjà',
  EMAIL_REQUIS: 'Email requis',
  EMAIL_EXISTANT: 'Cet email existe déjà',
  LOGIN_INVALIDE: 'Login invalide : 3 caractères au moins, lettres, chiffres et . - _ @ seulement',
  EMAIL_INVALIDE: 'Email invalide',
  NOM_INVALIDE: 'Nom invalide : 255 caractères au plus, sans caractères spéciaux',
  UTILISATEUR_COMPTE_INITIAL_PROTEGE: 'Le Compte initial ne peut ni perdre son rôle ni être supprimé',
  UTILISATEUR_ACTION_SUR_SOI_INTERDITE: 'Vous ne pouvez ni retirer votre propre rôle ni supprimer votre propre compte',
};

/** Corps d'un refus métier, avec le message français de repli. */
export function errorBody(code: ErrorCode): ErrorBody {
  return { code, message: ERROR_MESSAGES_FR[code] };
}
