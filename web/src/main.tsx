import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { currentUser, initAuth, login } from './auth';
import { LanguageProvider } from './i18n/i18n';
import { NotificationsProvider } from './notifications';
import './styles.css';

const root = createRoot(document.getElementById('root')!);

initAuth()
  .then(currentUser)
  .then(async (user) => {
    // Visiteur non connecté : directement vers la connexion Keycloak.
    if (!user) return login();
    root.render(
      <StrictMode>
        <LanguageProvider>
          <NotificationsProvider>
            <App user={user} />
          </NotificationsProvider>
        </LanguageProvider>
      </StrictMode>,
    );
  })
  .catch((error: unknown) => {
    root.render(<p className="banner-error">Impossible de démarrer : {String(error)}</p>);
  });
