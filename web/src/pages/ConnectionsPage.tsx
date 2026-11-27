// Écran « Connexions » (Administrateur, ADR-0029, #35) : un interrupteur par
// Fournisseur de connexion, avec l'auteur et la date de la dernière
// modification. Sans identifiants dans .env : « non configuré », interrupteur
// grisé. La désactivation passe par une confirmation chiffrée ; l'activation,
// non. Un refus du serveur s'affiche en notification. Réservé à
// l'Administrateur : voir App.tsx.
import { dayOf, type DeactivationImpactDto, formatDateInput, type IdentityProviderDto } from '@app/shared';
import { useCallback, useEffect, useState } from 'react';
import { request } from '../api';
import { ConfirmDialog } from '../DeleteButton';
import { PROVIDER_NAMES } from '../identityProviders';
import { useLanguage } from '../i18n/i18n';
import { useNotifyError } from '../notifications';

export function ConnectionsPage() {
  const { t } = useLanguage();
  const notifyError = useNotifyError();
  const [providers, setProviders] = useState<IdentityProviderDto[] | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let active = true;
    request<IdentityProviderDto[]>('/identity-providers').then((result) => {
      if (active) setProviders(result);
    }, notifyError);
    return () => {
      active = false;
    };
  }, [version, notifyError]);

  return (
    <div className="page">
      <h1>{t('NAV_CONNEXIONS')}</h1>
      <p className="page__intro">{t('CONNEXIONS_INTRO')}</p>
      {providers !== null && (
        <section className="card">
          <ul className="resource-list">
            {providers.map((provider) => (
              <ProviderRow key={provider.alias} provider={provider} onChanged={reload} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ProviderRow({ provider, onChanged }: { provider: IdentityProviderDto; onChanged: () => void }) {
  const { t } = useLanguage();
  const notifyError = useNotifyError();
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const name = PROVIDER_NAMES[provider.alias] ?? provider.alias;
  const path = `/identity-providers/${encodeURIComponent(provider.alias)}`;

  async function change(enabled: boolean) {
    setBusy(true);
    try {
      await request<void>(`${path}/enabled`, { method: enabled ? 'PUT' : 'DELETE' });
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
    onChanged();
  }

  /** Désactivation : d'abord l'impact, annoncé par la confirmation. */
  async function askDeactivation() {
    setBusy(true);
    try {
      const impact = await request<DeactivationImpactDto>(`${path}/impact`);
      const params = { fournisseur: name, nombre: String(impact.users) };
      const message = t('CONFIRMER_DESACTIVATION', params);
      setConfirmation(impact.includesYou ? `${message} ${t('CONFIRMER_DESACTIVATION_VOUS', params)}` : message);
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  }

  const status = !provider.configured
    ? 'CONNEXIONS_NON_CONFIGURE'
    : provider.enabled
      ? 'CONNEXIONS_ACTIVE'
      : 'CONNEXIONS_DESACTIVE';

  return (
    <li className="resource-list__item user-row">
      <div className="user-row__identity">
        <span className="resource-list__nom">{name}</span>
        {provider.lastChange && (
          <span className="resource-list__meta">
            {t('CONNEXIONS_MODIFIE_PAR', {
              nom: provider.lastChange.by,
              date: formatDateInput(dayOf(provider.lastChange.at)),
            })}
          </span>
        )}
      </div>

      <span className={`badge${provider.enabled ? ' badge--admin' : ''}`}>{t(status)}</span>

      <div className="resource-list__actions">
        <label className="switch">
          <input
            type="checkbox"
            role="switch"
            checked={provider.enabled}
            disabled={!provider.configured || busy}
            aria-label={t('CONNEXIONS_ARIA_INTERRUPTEUR', { fournisseur: name })}
            onChange={(event) => void (event.target.checked ? change(true) : askDeactivation())}
          />
          <span className="switch__track" aria-hidden="true" />
        </label>
      </div>

      {confirmation !== null && (
        <ConfirmDialog
          title="CONFIRMER_DESACTIVATION_TITRE"
          confirmLabel="BOUTON_DESACTIVER"
          message={confirmation}
          onCancel={() => setConfirmation(null)}
          onConfirm={() => {
            setConfirmation(null);
            void change(false);
          }}
        />
      )}
    </li>
  );
}
