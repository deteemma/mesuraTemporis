// Suppression confirmée par un dialogue chiffré (E18, variante C du ticket #8) :
// un clic sur « Supprimer » lit d'abord l'impact auprès de l'API, puis ouvre un
// dialogue qui annonce ce qui sera détruit, avec Annuler et Supprimer.
// Partagé par les écrans Projets, Activités du Projet et Utilisateurs.
import { useEffect, useState } from 'react';
import { useLanguage } from './i18n/i18n';
import { useNotifyError } from './notifications';

interface ConfirmDialogProps {
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
}

function ConfirmDialog({ message, onCancel, onConfirm }: ConfirmDialogProps) {
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
          {t('CONFIRMER_TITRE')}
        </h2>
        <p id="dialog-message" className="dialog__message">
          {message}
        </p>
        <div className="dialog__actions">
          <button type="button" className="btn btn-secondary" autoFocus onClick={onCancel}>
            {t('BOUTON_ANNULER')}
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm}>
            {t('BOUTON_SUPPRIMER')}
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
