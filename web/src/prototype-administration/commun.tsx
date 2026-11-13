// PROTOTYPE — contexte commun aux trois écrans : variante, traduction (avec libellés
// nouveaux), toasts, dialogue de confirmation, rafraîchissement après mutation.
import { createContext, type ReactNode, useCallback, useContext, useState } from 'react';
import { type Traduire, useLangue } from '../prototype-saisie-temps/i18n';
import { ErreurApi } from './serveurAdmin';
import { TEXTES_ADMIN } from './textes';

export type Variante = 'A' | 'B' | 'C';

export const NOMS_VARIANTES: Record<Variante, string> = {
  A: 'Masquer + dialogue',
  B: 'Griser + expliquer + confirmer sur place',
  C: 'Tout afficher, le serveur refuse, sans confirmation (= source)',
};

export type Ecran = { nom: 'projets' } | { nom: 'activites'; projetId: string } | { nom: 'utilisateurs' };

interface Dialogue {
  titre: string;
  message: string;
  libelle: string;
  action: () => void;
}

interface ContexteAdmin {
  variante: Variante;
  t: Traduire;
  notifier: (message: string) => void;
  /** Exécute une mutation du faux serveur ; une ErreurApi part en toast (code traduit). */
  executer: (mutation: () => void) => boolean;
  demanderConfirmation: (d: Dialogue) => void;
  version: number;
  aller: (e: Ecran) => void;
}

const Contexte = createContext<ContexteAdmin | null>(null);

export function useAdmin() {
  const c = useContext(Contexte);
  if (!c) throw new Error('FournisseurAdmin manquant');
  return c;
}

export function FournisseurAdmin({ variante, aller, children }: { variante: Variante; aller: (e: Ecran) => void; children: ReactNode }) {
  const { langue, t: tBase } = useLangue();
  const [notifications, setNotifications] = useState<{ id: number; message: string }[]>([]);
  const [dialogue, setDialogue] = useState<Dialogue | null>(null);
  const [version, setVersion] = useState(0);

  const t = useCallback<Traduire>(
    (cle, params) => {
      const brut = TEXTES_ADMIN[langue]?.[cle] ?? TEXTES_ADMIN.fr?.[cle];
      if (brut === undefined) return tBase(cle, params);
      return Object.entries(params ?? {}).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, v), brut);
    },
    [langue, tBase],
  );

  const notifier = useCallback((message: string) => {
    const id = Date.now() + Math.random();
    setNotifications((n) => [...n, { id, message }]);
    setTimeout(() => setNotifications((n) => n.filter((x) => x.id !== id)), 4000);
  }, []);

  const executer = useCallback(
    (mutation: () => void) => {
      try {
        mutation();
        setVersion((v) => v + 1);
        return true;
      } catch (e) {
        notifier(e instanceof ErreurApi ? t(e.code) : String(e));
        return false;
      }
    },
    [notifier, t],
  );

  return (
    <Contexte.Provider value={{ variante, t, notifier, executer, demanderConfirmation: setDialogue, version, aller }}>
      {children}

      <div className="toast-hote">
        {notifications.map((n) => (
          <div className="toast" key={n.id}>
            <span className="toast__message">{n.message}</span>
            <button type="button" className="toast__fermer" aria-label="Fermer la notification" onClick={() => setNotifications((x) => x.filter((y) => y.id !== n.id))}>
              ✕
            </button>
          </div>
        ))}
      </div>

      {dialogue && (
        <div className="dialogue-fond" onClick={() => setDialogue(null)}>
          <div className="dialogue card" role="dialog" aria-modal="true" aria-labelledby="dialogue-titre" onClick={(e) => e.stopPropagation()}>
            <h2 id="dialogue-titre" className="dialogue__titre">{dialogue.titre}</h2>
            <p className="dialogue__message">{dialogue.message}</p>
            <div className="dialogue__actions">
              <button type="button" className="btn btn-secondary" autoFocus onClick={() => setDialogue(null)}>
                {t('BOUTON_ANNULER')}
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  dialogue.action();
                  setDialogue(null);
                }}
              >
                {dialogue.libelle}
              </button>
            </div>
          </div>
        </div>
      )}
    </Contexte.Provider>
  );
}

/**
 * Bouton « Supprimer » dont la confirmation dépend de la variante :
 * A = dialogue avec conséquences, B = confirmation sur place, C = aucune (source).
 */
export function BoutonSupprimer({ message, onConfirme, desactive = false }: { message: string; onConfirme: () => void; desactive?: boolean }) {
  const { variante, t, demanderConfirmation } = useAdmin();
  const [enConfirmation, setEnConfirmation] = useState(false);

  if (variante === 'B' && enConfirmation) {
    return (
      <span className="confirmation-sur-place">
        <span className="confirmation-sur-place__message">{message}</span>
        <button type="button" className="btn btn-secondary" onClick={() => setEnConfirmation(false)}>
          {t('BOUTON_ANNULER')}
        </button>
        <button
          type="button"
          className="btn btn-danger"
          onClick={() => {
            setEnConfirmation(false);
            onConfirme();
          }}
        >
          {t('BOUTON_CONFIRMER_SUPPRESSION')}
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      className="btn btn-danger"
      disabled={desactive}
      onClick={() => {
        if (variante === 'A') demanderConfirmation({ titre: t('CONFIRMER_TITRE'), message, libelle: t('BOUTON_SUPPRIMER'), action: onConfirme });
        else if (variante === 'B') setEnConfirmation(true);
        else onConfirme();
      }}
    >
      {t('BOUTON_SUPPRIMER')}
    </button>
  );
}
