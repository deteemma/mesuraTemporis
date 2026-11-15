// Codes d'erreur stables (ADR-0021) : écrits une seule fois ici, renvoyés par
// l'API dans le corps `{ code, message }` d'un refus et traduits par le web.
// Catalogue : celui de la source, moins PROJET_NON_AFFECTE (ADR-0017) et les
// codes de l'authentification maison, plus les deux codes de compte (ADR-0018).

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
  'EMAIL_REQUIS',
  'EMAIL_EXISTANT',
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
