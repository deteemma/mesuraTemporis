// Notification transitoire (toast), reprise de la source : les messages
// s'empilent en bas de l'écran et disparaissent seuls après un délai.
import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { ApiError } from './api';
import { useLanguage } from './i18n/i18n';

export const NOTIFICATION_DELAY_MS = 4000;

interface Notification {
  id: number;
  message: string;
}

interface NotificationsContextValue {
  notify: (message: string, durationMs?: number) => void;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const nextId = useRef(1);
  const { t } = useLanguage();

  const close = useCallback((id: number) => {
    setNotifications((list) => list.filter((notification) => notification.id !== id));
  }, []);

  const notify = useCallback(
    (message: string, durationMs = NOTIFICATION_DELAY_MS) => {
      const id = nextId.current++;
      setNotifications((list) => [...list, { id, message }]);
      setTimeout(() => close(id), durationMs);
    },
    [close],
  );

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <NotificationsContext.Provider value={value}>
      {children}
      <div className="toast-host">
        {notifications.map((notification) => (
          <div className="toast" key={notification.id} role="status">
            <span className="toast__message">{notification.message}</span>
            <button
              type="button"
              className="toast__fermer"
              aria-label={t('ARIA_FERMER_NOTIFICATION')}
              onClick={() => close(notification.id)}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </NotificationsContext.Provider>
  );
}

export function useNotify(): NotificationsContextValue['notify'] {
  const context = useContext(NotificationsContext);
  if (!context) throw new Error('NotificationsProvider manquant');
  return context.notify;
}

/**
 * Affiche un refus du serveur en notification : son Code d'erreur traduit dans
 * la langue courante, sinon le message français du serveur (repli, ADR-0021).
 */
export function useNotifyError(): (error: unknown) => void {
  const notify = useNotify();
  const { t } = useLanguage();
  return useCallback(
    (error: unknown) => {
      // 401 : la redirection vers la connexion est déjà en cours.
      if (error instanceof ApiError && error.status === 401) return;
      if (error instanceof ApiError) notify(error.code ? t(error.code) : error.message);
      else notify(t('ERREUR_INTERNE'));
    },
    [notify, t],
  );
}
