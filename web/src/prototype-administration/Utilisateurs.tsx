// PROTOTYPE — écran Utilisateurs, repris de utilisateurs.component.html de la source,
// plus les écarts tranchés au ticket #7 : rôle choisi à la création et modifiable,
// compte initial `admin` protégé, aucune action sensible sur soi-même.
// Ce qui varie selon ?variant= : présentation du rôle et sort des actions interdites.
import { useState } from 'react';
import { BoutonSupprimer, useAdmin } from './commun';
import { protection, type Role, serveur, type Utilisateur } from './serveurAdmin';

export function Utilisateurs() {
  const { t, executer, variante } = useAdmin();
  const utilisateurs = serveur.listerUtilisateurs();
  const projets = serveur.listerProjets();
  const courant = serveur.courant();
  const [login, setLogin] = useState('');
  const [nom, setNom] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('utilisateur');
  const [emailEnCours, setEmailEnCours] = useState<Record<string, string>>({});

  const affectes = new Set(projets.flatMap((p) => p.utilisateursAffectes));
  const sansProjet = utilisateurs.filter((u) => !affectes.has(u.id)).length;

  return (
    <div className="page">
      <h1>
        {t('NAV_UTILISATEURS')}
        {sansProjet > 0 && <span className="badge"> {t('UTILISATEURS_SANS_PROJET_BADGE', { nombre: String(sansProjet) })}</span>}
      </h1>

      <section className="card">
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!login || !email) return; // comme la source : champs requis, rien envoyé
            if (executer(() => serveur.creerUtilisateur(login, nom, email, role))) {
              setLogin('');
              setNom('');
              setEmail('');
              setRole('utilisateur');
            }
          }}
        >
          <input className="field" value={login} onChange={(e) => setLogin(e.target.value)} placeholder={t('AUTH_CHAMP_LOGIN')} required />
          <input className="field" value={nom} onChange={(e) => setNom(e.target.value)} placeholder={t('ADMIN_PLACEHOLDER_NOM')} />
          <input className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('ADMIN_PLACEHOLDER_EMAIL')} required />
          {variante === 'B' ? (
            <select className="field champ-role" value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label={t('ADMIN_CHAMP_ROLE')}>
              <option value="utilisateur">{t('ROLE_UTILISATEUR')}</option>
              <option value="administrateur">{t('ROLE_ADMINISTRATEUR')}</option>
            </select>
          ) : (
            <label className="case-role">
              <input type="checkbox" checked={role === 'administrateur'} onChange={(e) => setRole(e.target.checked ? 'administrateur' : 'utilisateur')} />
              {t('ADMIN_CASE_ADMINISTRATEUR')}
            </label>
          )}
          <button type="submit" className="btn btn-primary">{t('BOUTON_CREER')}</button>
        </form>
      </section>

      {utilisateurs.length === 0 ? (
        <p className="resource-list__vide">{t('UTILISATEURS_AUCUN')}</p>
      ) : (
        <section className="card">
          <ul className="resource-list">
            {utilisateurs.map((u) => (
              <Ligne
                key={u.id}
                u={u}
                idCourant={courant.id}
                email={emailEnCours[u.id] ?? ''}
                setEmail={(v) => setEmailEnCours({ ...emailEnCours, [u.id]: v })}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Ligne({ u, idCourant, email, setEmail }: { u: Utilisateur; idCourant: string; email: string; setEmail: (v: string) => void }) {
  const { t, executer, variante, demanderConfirmation } = useAdmin();
  const motif = protection(u, idCourant);
  const protege = motif !== null && variante !== 'C'; // C : tout reste actif, le serveur refuse
  const libelleRole = (r: Role) => t(r === 'administrateur' ? 'ROLE_ADMINISTRATEUR' : 'ROLE_UTILISATEUR');
  const nomAffiche = u.nom || u.login;

  const changerRole = (r: Role) => {
    if (variante === 'A' && r === 'utilisateur') {
      demanderConfirmation({
        titre: t('ADMIN_CHAMP_ROLE'),
        message: t('CONFIRMER_RETRAIT_ADMIN', { nom: nomAffiche }),
        libelle: t('BOUTON_CONFIRMER'),
        action: () => executer(() => serveur.modifierRole(u.id, r)),
      });
    } else executer(() => serveur.modifierRole(u.id, r));
  };

  const repere =
    variante !== 'C' && motif ? (
      <span className="badge badge--discret">{t(motif === 'COMPTE_INITIAL' ? 'BADGE_COMPTE_INITIAL' : 'BADGE_VOUS')}</span>
    ) : null;

  return (
    <li className="resource-list__item ligne-utilisateur">
      <div>
        <span className="resource-list__nom">
          {u.login} {variante === 'A' && repere}
        </span>
        <span className="resource-list__meta">{u.nom}</span>
        <span className="resource-list__meta">{u.email || '—'}</span>
        {variante === 'B' && motif && (
          <span className="resource-list__meta protection">{t(motif === 'COMPTE_INITIAL' ? 'PROTECTION_COMPTE_INITIAL' : 'PROTECTION_SOI_MEME')}</span>
        )}
      </div>

      {variante === 'B' ? (
        <select
          className="field champ-role"
          value={u.role}
          disabled={protege && u.role === 'administrateur'}
          onChange={(e) => changerRole(e.target.value as Role)}
          aria-label={t('ADMIN_CHAMP_ROLE')}
        >
          <option value="utilisateur">{t('ROLE_UTILISATEUR')}</option>
          <option value="administrateur">{t('ROLE_ADMINISTRATEUR')}</option>
        </select>
      ) : (
        <span className={`badge${u.role === 'administrateur' ? ' badge--admin' : ''}`}>{libelleRole(u.role)}</span>
      )}

      <div className="resource-list__actions">
        <input className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('ADMIN_PLACEHOLDER_EMAIL')} aria-label={t('ARIA_MODIFIER_EMAIL')} />
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            if (email && executer(() => serveur.modifierEmail(u.id, email))) setEmail('');
          }}
        >
          {t('BOUTON_MODIFIER')}
        </button>

        {variante !== 'B' &&
          (u.role === 'utilisateur' ? (
            <button type="button" className="btn btn-secondary" onClick={() => changerRole('administrateur')}>
              {t('BOUTON_RENDRE_ADMIN')}
            </button>
          ) : (
            !protege && (
              <button type="button" className="btn btn-secondary" onClick={() => changerRole('utilisateur')}>
                {t('BOUTON_RETIRER_ADMIN')}
              </button>
            )
          ))}

        {!(variante === 'A' && protege) && (
          <BoutonSupprimer
            desactive={variante === 'B' && protege}
            message={t('CONFIRMER_UTILISATEUR', { nom: nomAffiche, imputations: String(serveur.impact.utilisateur(u.id).imputations) })}
            onConfirme={() => executer(() => serveur.supprimerUtilisateur(u.id))}
          />
        )}
      </div>
    </li>
  );
}
