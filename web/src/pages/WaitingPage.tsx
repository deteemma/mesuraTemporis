// Page d'attente ou de refus (ADR-0028) : seule page de la personne dont la
// Demande d'accès attend la décision d'un Administrateur, ou a été refusée.
import type { AccessRequestStatus } from '@app/shared';
import { logout } from '../auth';
import { useLanguage } from '../i18n/i18n';
import { LanguageSwitcher } from '../LanguageSwitcher';

const TEXTS = {
  pending: { title: 'ATTENTE_TITRE', message: 'ATTENTE_MESSAGE' },
  refused: { title: 'REFUS_TITRE', message: 'REFUS_MESSAGE' },
} as const;

export function WaitingPage({ status, email }: { status: AccessRequestStatus; email: string | null }) {
  const { t } = useLanguage();
  return (
    <main className="waiting">
      <div className="card waiting__card">
        <h1>{t(TEXTS[status].title)}</h1>
        <p>{t(TEXTS[status].message)}</p>
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
