import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { currentUser, initAuth } from './auth';

const root = createRoot(document.getElementById('root')!);

// PROTOTYPE (branche jetable) : ?prototype=saisie-temps|administration affiche l'ébauche sans API ni Keycloak.
const prototype = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('prototype') : null;
if (prototype === 'administration') {
  void import('./prototype-administration/PrototypeAdministration').then(({ PrototypeAdministration }) => {
    root.render(
      <StrictMode>
        <PrototypeAdministration />
      </StrictMode>,
    );
  });
} else if (prototype === 'saisie-temps') {
  void import('./prototype-saisie-temps/PrototypeSaisieTemps').then(({ PrototypeSaisieTemps }) => {
    root.render(
      <StrictMode>
        <PrototypeSaisieTemps />
      </StrictMode>,
    );
  });
} else {
  void import('./styles.css');
  initAuth()
    .then(currentUser)
    .then((user) => {
      root.render(
        <StrictMode>
          <App user={user} />
        </StrictMode>,
      );
    })
    .catch((error: unknown) => {
      root.render(<p className="error">Impossible de démarrer : {String(error)}</p>);
    });
}
