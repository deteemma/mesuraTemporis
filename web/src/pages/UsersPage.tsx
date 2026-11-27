// Écran « Utilisateurs » (Administrateur), repris de la source avec les écarts
// du ticket #8 (variante C) : badge de rôle, case « Administrateur » à la
// création, bouton de rôle par ligne sans confirmation, dialogue de suppression
// chiffré, refus en notification, ligne sur deux niveaux. Les actions refusées
// (sur soi-même) restent visibles : le serveur les refuse, en
// notification. Il pilote l'Annuaire des comptes par l'API (ADR-0018).
// Réservé à l'Administrateur : voir App.tsx. Il présente aussi les Demandes
// d'accès, en attente puis refusées, et la décision de l'Administrateur
// (ADR-0028, #32).
import {
  type AccessRequestDto,
  dayOf,
  type DecisionDto,
  formatDateInput,
  type UserDto,
  type UserImpactDto,
  type UserListDto,
} from '@app/shared';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { reloadAccessRequests, useAccessRequests } from '../accessRequests';
import { request } from '../api';
import { DeleteButton } from '../DeleteButton';
import { PROVIDER_NAMES } from '../identityProviders';
import { useLanguage } from '../i18n/i18n';
import { useNotifyError } from '../notifications';

export function UsersPage() {
  const { t } = useLanguage();
  const notifyError = useNotifyError();
  const [list, setList] = useState<UserListDto | null>(null);
  const [login, setLogin] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let active = true;
    request<UserListDto>('/users').then((result) => {
      if (active) setList(result);
    }, notifyError);
    return () => {
      active = false;
    };
  }, [version, notifyError]);

  async function create(event: FormEvent) {
    event.preventDefault();
    try {
      await request<UserDto>('/users', { method: 'POST', body: JSON.stringify({ login, name, email, isAdmin }) });
      setLogin('');
      setName('');
      setEmail('');
      setIsAdmin(false);
      reload();
    } catch (error) {
      notifyError(error);
    }
  }

  return (
    <div className="page">
      <h1>
        {t('NAV_UTILISATEURS')}
        {list !== null && list.withoutProject > 0 && (
          <span className="badge">{t('UTILISATEURS_SANS_PROJET_BADGE', { nombre: String(list.withoutProject) })}</span>
        )}
      </h1>

      <section className="card">
        {/* noValidate : un champ manquant est refusé par le serveur, en notification. */}
        <form className="inline-form" noValidate onSubmit={(event) => void create(event)}>
          <input
            className="field"
            value={login}
            onChange={(event) => setLogin(event.target.value)}
            placeholder={t('ADMIN_PLACEHOLDER_LOGIN')}
            aria-label={t('ADMIN_PLACEHOLDER_LOGIN')}
          />
          <input
            className="field"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('ADMIN_PLACEHOLDER_NOM')}
            aria-label={t('ADMIN_PLACEHOLDER_NOM')}
          />
          <input
            className="field"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={t('ADMIN_PLACEHOLDER_EMAIL')}
            aria-label={t('ADMIN_PLACEHOLDER_EMAIL')}
          />
          <label className="role-checkbox">
            <input type="checkbox" checked={isAdmin} onChange={(event) => setIsAdmin(event.target.checked)} />
            {t('ADMIN_CASE_ADMINISTRATEUR')}
          </label>
          <button type="submit" className="btn btn-primary">
            {t('BOUTON_CREER')}
          </button>
        </form>
      </section>

      <AccessRequestsSections onUsersChanged={reload} />

      {list?.users.length === 0 && <p className="resource-list__vide">{t('UTILISATEURS_AUCUN')}</p>}

      {list !== null && list.users.length > 0 && (
        <section className="card">
          <ul className="resource-list">
            {list.users.map((user) => (
              <UserRow key={user.id} user={user} onChanged={reload} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function UserRow({ user, onChanged }: { user: UserDto; onChanged: () => void }) {
  const { t } = useLanguage();
  const notifyError = useNotifyError();
  const [newEmail, setNewEmail] = useState('');
  const base = `/users/${encodeURIComponent(user.id)}`;

  async function changeEmail() {
    try {
      await request<void>(`${base}/email`, { method: 'PUT', body: JSON.stringify({ email: newEmail }) });
      setNewEmail('');
      onChanged();
    } catch (error) {
      notifyError(error);
    }
  }

  async function toggleAdministrator() {
    try {
      await request<void>(`${base}/administrator`, { method: user.isAdmin ? 'DELETE' : 'PUT' });
      onChanged();
    } catch (error) {
      notifyError(error);
    }
  }

  async function describeDeletion(): Promise<string> {
    const impact = await request<UserImpactDto>(`${base}/impact`);
    return t('CONFIRMER_UTILISATEUR', { nom: user.name || user.login, imputations: String(impact.timeEntries) });
  }

  async function remove() {
    try {
      await request<void>(base, { method: 'DELETE' });
    } catch (error) {
      notifyError(error);
    }
    onChanged();
  }

  return (
    <li className="resource-list__item user-row">
      <div className="user-row__identity">
        <span className="resource-list__nom">{user.login}</span>
        {user.name && <span className="resource-list__meta">{user.name}</span>}
        <span className="resource-list__meta">{user.email || '—'}</span>
        {user.acceptance && (
          <span className="resource-list__meta">{t('UTILISATEURS_ACCEPTE_PAR', decisionParams(user.acceptance))}</span>
        )}
      </div>

      <span className={`badge${user.isAdmin ? ' badge--admin' : ''}`}>
        {t(user.isAdmin ? 'ROLE_ADMINISTRATEUR' : 'ROLE_UTILISATEUR')}
      </span>

      <div className="resource-list__actions">
        <input
          className="field"
          type="email"
          value={newEmail}
          onChange={(event) => setNewEmail(event.target.value)}
          placeholder={t('ADMIN_PLACEHOLDER_EMAIL')}
          aria-label={t('ARIA_MODIFIER_EMAIL')}
        />
        <button type="button" className="btn btn-secondary" onClick={() => void changeEmail()}>
          {t('BOUTON_MODIFIER')}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => void toggleAdministrator()}>
          {t(user.isAdmin ? 'BOUTON_RETIRER_ROLE_ADMINISTRATEUR' : 'BOUTON_RENDRE_ADMINISTRATEUR')}
        </button>
        <DeleteButton describe={describeDeletion} onConfirm={() => void remove()} />
      </div>
    </li>
  );
}

/** Auteur et date d'une décision, pour les libellés « … par {nom} le {date} ». */
function decisionParams(decision: DecisionDto): Record<string, string> {
  return { nom: decision.by, date: formatDay(decision.at) };
}

function formatDay(instant: string): string {
  return formatDateInput(dayOf(instant));
}

/**
 * Demandes d'accès en attente, puis refusées à part ; chaque section n'apparaît
 * que si elle a des demandes. Une acceptation fait apparaître l'Utilisateur
 * dans la liste.
 */
function AccessRequestsSections({ onUsersChanged }: { onUsersChanged: () => void }) {
  const { t } = useLanguage();
  const notifyError = useNotifyError();
  const requests = useAccessRequests();

  useEffect(() => {
    reloadAccessRequests().catch(notifyError);
  }, [notifyError]);

  const decide = useCallback(
    async (path: string, method: 'POST' | 'DELETE', usersChanged: boolean) => {
      try {
        await request<void>(path, { method });
      } catch (error) {
        notifyError(error);
      }
      if (usersChanged) onUsersChanged();
      reloadAccessRequests().catch(notifyError);
    },
    [notifyError, onUsersChanged],
  );

  if (requests === null) return null;
  return (
    <>
      {requests.pending.length > 0 && (
        <section className="card">
          <h2>{t('DEMANDES_TITRE_ATTENTE')}</h2>
          <ul className="resource-list">
            {requests.pending.map((accessRequest) => (
              <AccessRequestRow key={accessRequest.id} accessRequest={accessRequest} decide={decide} />
            ))}
          </ul>
        </section>
      )}
      {requests.refused.length > 0 && (
        <section className="card">
          <h2>{t('DEMANDES_TITRE_REFUSEES')}</h2>
          <ul className="resource-list">
            {requests.refused.map((accessRequest) => (
              <AccessRequestRow key={accessRequest.id} accessRequest={accessRequest} decide={decide} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/**
 * Une Demande d'accès : Email, Nom, fournisseur et date. En attente :
 * Accepter ou Refuser ; refusée : l'auteur et la date du refus, Accepter ou
 * Supprimer (ce qui libère l'Email).
 */
function AccessRequestRow({
  accessRequest,
  decide,
}: {
  accessRequest: AccessRequestDto;
  decide: (path: string, method: 'POST' | 'DELETE', usersChanged: boolean) => Promise<void>;
}) {
  const { t } = useLanguage();
  const base = `/access-requests/${encodeURIComponent(accessRequest.id)}`;
  const label = accessRequest.email || accessRequest.name || accessRequest.id;

  return (
    <li className="resource-list__item user-row">
      <div className="user-row__identity">
        <span className="resource-list__nom">{accessRequest.email || '—'}</span>
        {accessRequest.name && <span className="resource-list__meta">{accessRequest.name}</span>}
        <span className="resource-list__meta">
          {PROVIDER_NAMES[accessRequest.provider] ?? accessRequest.provider} ·{' '}
          {t('DEMANDES_RECUE_LE', { date: formatDay(accessRequest.createdAt) })}
        </span>
        {accessRequest.refusal && (
          <span className="resource-list__meta">{t('DEMANDES_REFUSEE_PAR', decisionParams(accessRequest.refusal))}</span>
        )}
        {accessRequest.provider === 'microsoft' && (
          <span className="access-request__warning">{t('DEMANDES_AVERTISSEMENT_MICROSOFT')}</span>
        )}
      </div>

      <div className="resource-list__actions">
        <button type="button" className="btn btn-primary" onClick={() => void decide(`${base}/accept`, 'POST', true)}>
          {t('BOUTON_ACCEPTER')}
        </button>
        {accessRequest.refusal ? (
          <DeleteButton
            describe={() => Promise.resolve(t('CONFIRMER_DEMANDE', { email: label }))}
            onConfirm={() => void decide(base, 'DELETE', false)}
          />
        ) : (
          <button type="button" className="btn btn-secondary" onClick={() => void decide(`${base}/refuse`, 'POST', false)}>
            {t('BOUTON_REFUSER')}
          </button>
        )}
      </div>
    </li>
  );
}
