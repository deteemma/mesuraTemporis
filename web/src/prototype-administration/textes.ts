// PROTOTYPE — libellés nouveaux (absents de la source). fr et en seulement ; de et it
// retombent sur le français. Les traductions définitives viendront à l'implémentation.
import type { CodeLangue } from '../prototype-saisie-temps/i18n';

export const TEXTES_ADMIN: Partial<Record<CodeLangue, Record<string, string>>> = {
  fr: {
    ADMIN_CASE_ADMINISTRATEUR: 'Administrateur',
    ADMIN_CHAMP_ROLE: 'Rôle',
    BOUTON_RENDRE_ADMIN: 'Rendre administrateur',
    BOUTON_RETIRER_ADMIN: 'Retirer le rôle administrateur',
    BADGE_COMPTE_INITIAL: 'compte initial',
    BADGE_VOUS: 'vous',
    PROTECTION_COMPTE_INITIAL: 'Compte initial protégé : son rôle ne peut pas être retiré et il ne peut pas être supprimé.',
    PROTECTION_SOI_MEME: 'Votre propre compte : vous ne pouvez ni vous retirer le rôle administrateur, ni vous supprimer.',
    CONFIRMER_TITRE: 'Confirmer la suppression',
    CONFIRMER_UTILISATEUR: "Supprimer l'Utilisateur « {nom} » ? Son compte de connexion et ses {imputations} Imputations seront supprimés définitivement.",
    CONFIRMER_PROJET: 'Supprimer le Projet « {nom} » ? Ses {activites} Activités et les {imputations} Imputations associées seront supprimées définitivement.',
    CONFIRMER_ACTIVITE: "Supprimer l'Activité « {nom} » ? Les {imputations} Imputations associées seront supprimées définitivement.",
    CONFIRMER_RETRAIT_ADMIN: "Retirer le rôle administrateur à « {nom} » ? Ses sessions seront fermées immédiatement.",
    BOUTON_CONFIRMER_SUPPRESSION: 'Confirmer la suppression',
    BOUTON_CONFIRMER: 'Confirmer',
    UTILISATEUR_COMPTE_INITIAL_PROTEGE: 'Le compte initial est protégé : son rôle ne peut pas être retiré et il ne peut pas être supprimé',
    UTILISATEUR_ACTION_SUR_SOI_INTERDITE: 'Vous ne pouvez ni vous retirer le rôle administrateur, ni supprimer votre propre compte',
  },
  en: {
    ADMIN_CASE_ADMINISTRATEUR: 'Administrator',
    ADMIN_CHAMP_ROLE: 'Role',
    BOUTON_RENDRE_ADMIN: 'Make administrator',
    BOUTON_RETIRER_ADMIN: 'Remove administrator role',
    BADGE_COMPTE_INITIAL: 'initial account',
    BADGE_VOUS: 'you',
    PROTECTION_COMPTE_INITIAL: 'Protected initial account: its role cannot be removed and it cannot be deleted.',
    PROTECTION_SOI_MEME: 'Your own account: you can neither remove your administrator role nor delete yourself.',
    CONFIRMER_TITRE: 'Confirm deletion',
    CONFIRMER_UTILISATEUR: 'Delete user "{nom}"? Their sign-in account and their {imputations} time entries will be permanently deleted.',
    CONFIRMER_PROJET: 'Delete project "{nom}"? Its {activites} activities and the {imputations} related time entries will be permanently deleted.',
    CONFIRMER_ACTIVITE: 'Delete activity "{nom}"? The {imputations} related time entries will be permanently deleted.',
    CONFIRMER_RETRAIT_ADMIN: 'Remove the administrator role from "{nom}"? Their sessions will be closed immediately.',
    BOUTON_CONFIRMER_SUPPRESSION: 'Confirm deletion',
    BOUTON_CONFIRMER: 'Confirm',
    UTILISATEUR_COMPTE_INITIAL_PROTEGE: 'The initial account is protected: its role cannot be removed and it cannot be deleted',
    UTILISATEUR_ACTION_SUR_SOI_INTERDITE: 'You can neither remove your own administrator role nor delete your own account',
  },
};
