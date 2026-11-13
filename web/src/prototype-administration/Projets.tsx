// PROTOTYPE — écran Projets (avec l'équipe), repris de projets.component.html de la source.
// Écran réservé à l'Administrateur (ticket #2) : plus de version « non administrateur ».
import { useState } from 'react';
import { BoutonSupprimer, useAdmin } from './commun';
import { serveur } from './serveurAdmin';

export function Projets() {
  const { t, executer, aller } = useAdmin();
  const projets = serveur.listerProjets();
  const utilisateurs = serveur.listerUtilisateurs();
  const [nouveauNom, setNouveauNom] = useState('');
  const [choix, setChoix] = useState<Record<string, string>>({});

  const login = (id: string) => utilisateurs.find((u) => u.id === id)?.login ?? id;

  return (
    <div className="page">
      <h1>{t('NAV_PROJETS')}</h1>

      <section className="card">
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (executer(() => serveur.creerProjet(nouveauNom))) setNouveauNom('');
          }}
        >
          <input className="field" value={nouveauNom} onChange={(e) => setNouveauNom(e.target.value)} placeholder={t('ADMIN_PLACEHOLDER_NOM_PROJET')} />
          <button type="submit" className="btn btn-primary">{t('BOUTON_CREER')}</button>
        </form>
      </section>

      {projets.length === 0 && <p className="resource-list__vide">{t('PROJETS_AUCUN')}</p>}

      {projets.map((projet) => {
        const impact = serveur.impact.projet(projet.id);
        return (
          <section className="card projet" key={projet.id}>
            <div className="projet__entete">
              <div className="projet__titre">
                <span className="projet__nom">{projet.nom}</span>
                <span className="badge">{t('STATUT_ACTIF')}</span>
              </div>
              <div className="projet__entete-actions">
                <button type="button" className="btn btn-secondary" onClick={() => aller({ nom: 'activites', projetId: projet.id })}>
                  {t('PROJETS_LIEN_ACTIVITES')}
                </button>
                <BoutonSupprimer
                  message={t('CONFIRMER_PROJET', { nom: projet.nom, activites: String(impact.activites), imputations: String(impact.imputations) })}
                  onConfirme={() => executer(() => serveur.supprimerProjet(projet.id))}
                />
              </div>
            </div>

            <div className="projet__equipe">
              <h3 className="projet__soustitre">{t('PROJETS_TITRE_EQUIPE')}</h3>
              {projet.utilisateursAffectes.length === 0 ? (
                <p className="resource-list__vide">{t('PROJETS_AUCUN_UTILISATEUR_AFFECTE')}</p>
              ) : (
                <ul className="resource-list">
                  {projet.utilisateursAffectes.map((id) => (
                    <li className="resource-list__item" key={id}>
                      <span className="resource-list__nom">{login(id)}</span>
                      <button type="button" className="btn btn-danger resource-list__actions" onClick={() => executer(() => serveur.retirer(projet.id, id))}>
                        {t('BOUTON_RETIRER')}
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="inline-form projet__affectation">
                <select
                  className="field"
                  value={choix[projet.id] ?? ''}
                  onChange={(e) => setChoix({ ...choix, [projet.id]: e.target.value })}
                  aria-label={t('ARIA_CHOISIR_UTILISATEUR_AFFECTER')}
                >
                  <option value="" disabled hidden />
                  {utilisateurs.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.login}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    const id = choix[projet.id];
                    if (id) executer(() => serveur.affecter(projet.id, id));
                  }}
                >
                  {t('BOUTON_AFFECTER')}
                </button>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
