import { setTimeout as sleep } from 'node:timers/promises';
import { type BeforeApplicationShutdown, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import {
  type AdministratorSignIn,
  type DeactivationImpactDto,
  deactivationRefusal,
  decisionAuthorName,
  IDENTITY_PROVIDERS,
  type IdentityProviderAlias,
  type IdentityProviderDto,
  isIdentityProviderAlias,
  isProviderEnabled,
} from '@app/shared';
import { sql } from 'kysely';
import { AccountDirectory } from '../accounts/account-directory.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { AppConfig } from '../config/app-config.js';
import { DatabaseService, NO_USER, type Tx } from '../db/database.service.js';
import { decisionOf } from '../db/queries.js';
import { identityProviderChangeRefused, identityProviderNotFound } from '../errors.js';

/** Verrou des réglages : un seul changement, ou une seule réapplication, à la fois. */
const LOCK_ID = 727_002;
/** Keycloak injoignable au démarrage : nouvel essai après ce délai. */
const RETRY_MS = 15_000;

/** Choix enregistré d'un Administrateur pour un fournisseur. */
interface ProviderChoice {
  alias: string;
  enabled: boolean;
}

/**
 * Fournisseurs de connexion (ADR-0029) : un Administrateur active ou désactive
 * Google et Microsoft. Le choix est gardé en base, appliqué aussitôt à
 * Keycloak, et réappliqué au démarrage de l'API : il survit à un déploiement
 * et à une réapplication du realm. Seule la dernière modification est gardée.
 */
@Injectable()
export class IdentityProvidersService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(IdentityProvidersService.name);
  private stopped = false;

  constructor(
    private readonly config: AppConfig,
    private readonly database: DatabaseService,
    private readonly accounts: AccountDirectory,
  ) {}

  onApplicationBootstrap(): void {
    void this.reapplyUntilDone();
  }

  beforeApplicationShutdown(): void {
    this.stopped = true;
  }

  async list(user: AuthenticatedUser): Promise<IdentityProviderDto[]> {
    const rows = await this.database.asUser(user, (tx) =>
      tx.selectFrom('identity_provider_setting').select(['alias', 'enabled', 'updated_by_name', 'updated_at']).execute(),
    );
    return IDENTITY_PROVIDERS.map((alias) => {
      const row = rows.find((r) => r.alias === alias);
      const configured = this.isConfigured(alias);
      return {
        alias,
        configured,
        enabled: isProviderEnabled(configured, row?.enabled ?? null),
        lastChange: row ? decisionOf(row.updated_by_name, row.updated_at) : null,
      };
    });
  }

  /**
   * Utilisateurs nés du fournisseur, qui ne pourront plus se connecter s'il
   * est désactivé ; les Demandes d'accès n'en font pas partie.
   */
  async deactivationImpact(user: AuthenticatedUser, aliasParam: string): Promise<DeactivationImpactDto> {
    const alias = known(aliasParam);
    const linked = [...(await this.accounts.accountIdsLinkedTo(alias))];
    const users =
      linked.length === 0
        ? 0
        : await this.database.asUser(user, async (tx) => {
            const { count } = await tx
              .selectFrom('app_user')
              .select((eb) => eb.fn.countAll<string>().as('count'))
              .where('id', 'in', linked)
              .executeTakeFirstOrThrow();
            return Number(count);
          });
    return { users, includesYou: linked.includes(user.id) };
  }

  /**
   * Active ou désactive le fournisseur. Non configuré : `FOURNISSEUR_NON_CONFIGURE`.
   * Une désactivation qui ne laisserait aucun Administrateur capable de se
   * connecter : `AUCUN_ADMINISTRATEUR_CONNECTABLE`. Rien d'autre ne change :
   * Utilisateurs, Demandes d'accès et sessions en cours restent. Si Keycloak
   * échoue, le choix n'est pas enregistré.
   */
  async setEnabled(user: AuthenticatedUser, aliasParam: string, enabled: boolean): Promise<void> {
    const alias = known(aliasParam);
    if (!this.isConfigured(alias)) throw identityProviderChangeRefused('FOURNISSEUR_NON_CONFIGURE');
    await this.database.asUser(user, async (tx) => {
      await lock(tx);
      if (!enabled) {
        const choices = await tx.selectFrom('identity_provider_setting').select(['alias', 'enabled']).execute();
        const refusal = deactivationRefusal(await this.administrators(), alias, this.enabledProviders(choices));
        if (refusal) throw identityProviderChangeRefused(refusal);
      }
      const change = { enabled, updated_by: user.id, updated_by_name: decisionAuthorName(user), updated_at: sql<Date>`now()` };
      await tx
        .insertInto('identity_provider_setting')
        .values({ alias, ...change })
        .onConflict((conflict) => conflict.column('alias').doUpdateSet(change))
        .execute();
      await this.accounts.setIdentityProviderEnabled(alias, enabled);
    });
  }

  /** Réapplique les choix à Keycloak, en réessayant tant que Keycloak ou la base ne répondent pas. */
  private async reapplyUntilDone(): Promise<void> {
    if (!this.config.keycloakAdmin) {
      this.logger.warn('KEYCLOAK_ADMIN_CLIENT_SECRET absent : Fournisseurs de connexion non réappliqués');
      return;
    }
    while (!this.stopped) {
      try {
        await this.reapply();
        this.logger.log('Fournisseurs de connexion réappliqués à Keycloak');
        return;
      } catch (error) {
        this.logger.warn(`Fournisseurs de connexion non réappliqués, nouvel essai dans ${RETRY_MS / 1000} s : ${String(error)}`);
        await sleep(RETRY_MS, undefined, { ref: false });
      }
    }
  }

  private async reapply(): Promise<void> {
    await this.database.asUser(NO_USER, async (tx) => {
      await lock(tx);
      const { rows } = await sql<ProviderChoice>`SELECT alias, enabled FROM identity_provider_choices()`.execute(tx);
      const enabled = this.enabledProviders(rows);
      for (const alias of IDENTITY_PROVIDERS) {
        await this.accounts.setIdentityProviderEnabled(alias, enabled.includes(alias));
      }
    });
  }

  /** Fournisseurs activés d'après les choix enregistrés et `.env`. */
  private enabledProviders(choices: readonly ProviderChoice[]): IdentityProviderAlias[] {
    return IDENTITY_PROVIDERS.filter((alias) =>
      isProviderEnabled(this.isConfigured(alias), choices.find((choice) => choice.alias === alias)?.enabled ?? null),
    );
  }

  /** Ce qui permet à chaque Administrateur de se connecter : mot de passe, fournisseurs liés. */
  private async administrators(): Promise<AdministratorSignIn[]> {
    const ids = [...(await this.accounts.administratorIds())];
    return Promise.all(
      ids.map(async (id) => {
        const [hasPassword, providers] = await Promise.all([this.accounts.hasPassword(id), this.accounts.identityProviders(id)]);
        return { hasPassword, providers: providers ?? [] };
      }),
    );
  }

  private isConfigured(alias: IdentityProviderAlias): boolean {
    return this.config.configuredIdentityProviders.has(alias);
  }
}

function known(alias: string): IdentityProviderAlias {
  if (!isIdentityProviderAlias(alias)) throw identityProviderNotFound();
  return alias;
}

async function lock(tx: Tx): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(${LOCK_ID})`.execute(tx);
}
