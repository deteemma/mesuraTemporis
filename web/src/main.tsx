import type { AdmissionDto } from '@app/shared';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { request } from './api';
import { currentUser, initAuth, login } from './auth';
import { LanguageProvider } from './i18n/i18n';
import { NotificationsProvider } from './notifications';
import { WaitingPage } from './pages/WaitingPage';
import './styles.css';

const root = createRoot(document.getElementById('root')!);

initAuth()
  .then(currentUser)
  .then(async (user) => {
    // Visiteur non connecté : directement vers la connexion Keycloak.
    if (!user) return login();
    // Demande d'accès en attente (ADR-0028) : la page d'attente seule.
    const admission = await request<AdmissionDto>('/admission');
    root.render(
      <StrictMode>
        <LanguageProvider>
          {admission.status === 'pending' ? (
            <WaitingPage email={admission.email} />
          ) : (
            <NotificationsProvider>
              <App user={user} />
            </NotificationsProvider>
          )}
        </LanguageProvider>
      </StrictMode>,
    );
  })
  .catch((error: unknown) => {
    root.render(<p className="banner-error">Impossible de démarrer : {String(error)}</p>);
  });
