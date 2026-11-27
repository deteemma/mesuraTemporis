// Suppression confirmée par un dialogue chiffré (E18, variante C du ticket #8) :
// un clic sur « Supprimer » lit d'abord l'impact auprès de l'API, puis ouvre un
// dialogue qui annonce ce qui sera détruit, avec Annuler et Supprimer.
// Partagé par les écrans Projets, Activités du Projet et Utilisateurs ; le
// dialogue sert aussi à la désactivation d'un Fournisseur de connexion.
import type { UiKey } from './i18n/dictionaries/fr';
import { useEffect, useState } from 'react';
import { useLanguage } from './i18n/i18n';
import { useNotifyError } from './notifications';

interface ConfirmDialogProps {
  message: string;
  /** Titre et bouton de confirmation ; par défaut, ceux d'une suppression. */
  title?: UiKey;
  confirmLabel?: UiKey;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  message,
  title = 'CONFIRMER_TITRE',
  confirmLabel = 'BOUTON_SUPPRIMER',
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const { t } = useLanguage();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div
        className="dialog card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby="dialog-message"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="dialog-title" className="dialog__title">
          {t(title)}
        </h2>
        <p id="dialog-message" className="dialog__message">
          {message}
        </p>
        <div className="dialog__actions">
          <button type="button" className="btn btn-secondary" autoFocus onClick={onCancel}>
            {t('BOUTON_ANNULER')}
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm}>
            {t(confirmLabel)}
          </button>
        </div>
      </div>
    </div>
  );
}

interface DeleteButtonProps {
  /** Lit l'impact auprès de l'API et renvoie le message chiffré du dialogue. */
  describe: () => Promise<string>;
  /** Appelé seulement si l'Administrateur confirme. */
  onConfirm: () => void;
}

export function DeleteButton({ describe, onConfirm }: DeleteButtonProps) {
  const { t } = useLanguage();
  const notifyError = useNotifyError();
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function open() {
    setLoading(true);
    try {
      setMessage(await describe());
    } catch (error) {
      notifyError(error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button type="button" className="btn btn-danger" disabled={loading} onClick={() => void open()}>
        {t('BOUTON_SUPPRIMER')}
      </button>
      {message !== null && (
        <ConfirmDialog
          message={message}
          onCancel={() => setMessage(null)}
          onConfirm={() => {
            setMessage(null);
            onConfirm();
          }}
        />
      )}
    </>
  );
}
