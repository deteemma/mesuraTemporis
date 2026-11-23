// Page d'attente (ADR-0028) : seule page de la personne dont la Demande
// d'accès attend la décision d'un Administrateur.
import { logout } from '../auth';
import { useLanguage } from '../i18n/i18n';
import { LanguageSwitcher } from '../LanguageSwitcher';

export function WaitingPage({ email }: { email: string | null }) {
  const { t } = useLanguage();
  return (
    <main className="waiting">
      <div className="card waiting__card">
        <h1>{t('ATTENTE_TITRE')}</h1>
        <p>{t('ATTENTE_MESSAGE')}</p>
        {email && <p className="waiting__email">{t('ATTENTE_EMAIL', { email })}</p>}
        <div className="waiting__actions">
          <LanguageSwitcher />
          <button type="button" className="btn btn-primary" onClick={() => void logout()}>
            {t('NAV_DECONNEXION')}
          </button>
        </div>
      </div>
    </main>
  );
}
