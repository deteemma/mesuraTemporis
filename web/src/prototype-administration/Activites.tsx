// PROTOTYPE — écran Activités du Projet, repris de activites.component.html de la source.
import { useState } from 'react';
import { BoutonSupprimer, useAdmin } from './commun';
import { serveur } from './serveurAdmin';

export function Activites({ projetId }: { projetId: string }) {
  const { t, executer, aller } = useAdmin();
  const activites = serveur.listerActivites(projetId);
  const [nouveauNom, setNouveauNom] = useState('');
  const [renommage, setRenommage] = useState<Record<string, string>>({});

  return (
    <div className="page">
      <a
        className="back-link"
        href="#"
        onClick={(e) => {
          e.preventDefault();
          aller({ nom: 'projets' });
        }}
      >
        {t('ACTIVITES_LIEN_RETOUR_PROJETS')}
      </a>
      <h1>{t('ACTIVITES_TITRE')}</h1>

      <section className="card">
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (executer(() => serveur.creerActivite(projetId, nouveauNom))) setNouveauNom('');
          }}
        >
          <input className="field" value={nouveauNom} onChange={(e) => setNouveauNom(e.target.value)} placeholder={t('ARIA_NOM_ACTIVITE')} />
          <button type="submit" className="btn btn-primary">{t('BOUTON_CREER')}</button>
        </form>
      </section>

      {activites.length === 0 ? (
        <p className="resource-list__vide">{t('ACTIVITES_AUCUNE')}</p>
      ) : (
        <section className="card">
          <ul className="resource-list">
            {activites.map((a) => (
              <li className="resource-list__item" key={a.id}>
                <span className="resource-list__nom">{a.nom}</span>
                <div className="resource-list__actions">
                  <input
                    className="field"
                    value={renommage[a.id] ?? ''}
                    onChange={(e) => setRenommage({ ...renommage, [a.id]: e.target.value })}
                    placeholder={t('ACTIVITES_PLACEHOLDER_RENOMMER')}
                    aria-label={t('ARIA_RENOMMER_ACTIVITE')}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      const nom = renommage[a.id];
                      if (nom) executer(() => serveur.renommerActivite(a.id, nom));
                    }}
                  >
                    {t('BOUTON_RENOMMER')}
                  </button>
                  <BoutonSupprimer
                    message={t('CONFIRMER_ACTIVITE', { nom: a.nom, imputations: String(serveur.impact.activite(a.id).imputations) })}
                    onConfirme={() => executer(() => serveur.supprimerActivite(a.id))}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
