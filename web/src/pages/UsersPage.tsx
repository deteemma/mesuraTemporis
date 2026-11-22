// Écran « Utilisateurs » (Administrateur), repris de la source avec les écarts
// du ticket #8 (variante C) : badge de rôle, case « Administrateur » à la
// création, bouton de rôle par ligne sans confirmation, dialogue de suppression
// chiffré, refus en notification, ligne sur deux niveaux. Les actions refusées
// (sur soi-même) restent visibles : le serveur les refuse, en
// notification. Il pilote l'Annuaire des comptes par l'API (ADR-0018).
// Réservé à l'Administrateur : voir App.tsx.
import type { UserDto, UserImpactDto, UserListDto } from '@app/shared';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { request } from '../api';
import { DeleteButton } from '../DeleteButton';
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
