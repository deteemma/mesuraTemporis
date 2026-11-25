// Preuve des rôles (ADR-0006, ADR-0017), double barrière :
//   1. par l'API (guards NestJS) ;
//   2. directement en base avec le compte applicatif (RLS PostgreSQL).
// Exige les comptes de test (ajouter-application.sh … --comptes-test) :
// alice, bruno, chloe (Utilisateurs) et diane (Administrateur).
// Lancé par scripts/tester-roles.sh, dans l'image de l'application.
// Nettoie les données qu'il crée.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire('/app/api/package.json');
const pg = require('pg');
const ExcelJS = require('exceljs');

const env = process.env;
const API = `http://${env.APP_NAME}-api:3000/api`;
const TOKEN_URL = env.OIDC_JWKS_URL.replace(/\/certs$/, '/token');
const RUN = Date.now();

let failures = 0;
async function check(label, fn) {
  try {
    await fn();
    console.log(`  ✔ ${label}`);
  } catch (error) {
    failures++;
    console.log(`  ✘ ${label}\n      ${error.message}`);
  }
}

async function login(username, isAdmin = false) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: 'tests', username, password: 'Test1234!' }),
  });
  assert.equal(response.status, 200, `connexion de ${username} impossible`);
  const { access_token } = await response.json();
  const sub = JSON.parse(Buffer.from(access_token.split('.')[1], 'base64url').toString()).sub;
  return { login: username, token: access_token, sub, isAdmin };
}

async function call(user, method, path, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${user.token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
}

/**
 * Exécute des requêtes en base « en tant que » `actor` ({ sub, isAdmin }), avec le
 * compte applicatif soumis à la RLS. `commit` = false : annulé à la fin.
 */
async function inDb(actor, work, { commit = false } = {}) {
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.user_id', $1, true), set_config('app.is_admin', $2, true)`, [
      actor.sub,
      actor.isAdmin ? 'true' : 'false',
    ]);
    const result = await work((text, params) => client.query(text, params));
    await client.query(commit ? 'COMMIT' : 'ROLLBACK');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}
const query = (actor, text, params) => inDb(actor, (q) => q(text, params));
const ids = (result) => result.rows.map((r) => r.id).sort();
const nobody = { sub: '', isAdmin: false };

const [alice, bruno, chloe, diane] = await Promise.all([
  login('alice'),
  login('bruno'),
  login('chloe'),
  login('diane', true),
]);

console.log('\nConnexion : recopie de la ligne Utilisateur');
await check('sans jeton : 401', async () => {
  assert.equal((await fetch(`${API}/projects`)).status, 401);
});
await check('la première requête de chacun crée sa ligne Utilisateur (Login, Email, Nom)', async () => {
  for (const u of [alice, bruno, chloe, diane]) assert.equal((await call(u, 'GET', '/projects')).status, 200);
  const r = await query(diane, `SELECT login, email, display_name FROM app_user WHERE id = ANY($1) ORDER BY login`, [
    [alice.sub, bruno.sub, chloe.sub, diane.sub],
  ]);
  assert.deepEqual(r.rows, [
    { login: 'alice', email: 'alice@exemple.test', display_name: 'Alice' },
    { login: 'bruno', email: 'bruno@exemple.test', display_name: 'Bruno' },
    { login: 'chloe', email: 'chloe@exemple.test', display_name: 'Chloé' },
    { login: 'diane', email: 'diane@exemple.test', display_name: 'Diane' },
  ]);
});
await check('un nouveau jeton remet à jour la ligne Utilisateur', async () => {
  await inDb(alice, (q) => q(`UPDATE app_user SET display_name = 'Périmé' WHERE id = $1`, [alice.sub]), { commit: true });
  Object.assign(alice, await login('alice'));
  await call(alice, 'GET', '/projects');
  const r = await query(alice, `SELECT display_name FROM app_user WHERE id = $1`, [alice.sub]);
  assert.equal(r.rows[0].display_name, 'Alice');
});

// Jeu de données, créé par l'Administrateur directement en base : P1 (alice et
// bruno affectés, Activité A1), P2 (personne). Une Imputation terminée pour alice
// et bruno sur P1, une pour diane sur P2.
const data = await inDb(
  diane,
  async (q) => {
    const p1 = (await q(`INSERT INTO project (id, name) VALUES (gen_random_uuid(), $1) RETURNING id`, [`P1 ${RUN}`])).rows[0].id;
    const p2 = (await q(`INSERT INTO project (id, name) VALUES (gen_random_uuid(), $1) RETURNING id`, [`P2 ${RUN}`])).rows[0].id;
    await q(`INSERT INTO project_member (project_id, user_id) VALUES ($1, $2), ($1, $3)`, [p1, alice.sub, bruno.sub]);
    const a1 = (await q(`INSERT INTO activity (id, project_id, name, normalized_name) VALUES (gen_random_uuid(), $1, 'Réunion', 'reunion') RETURNING id`, [p1])).rows[0].id;
    const a2 = (await q(`INSERT INTO activity (id, project_id, name, normalized_name) VALUES (gen_random_uuid(), $1, 'Analyse', 'analyse') RETURNING id`, [p2])).rows[0].id;
    const dianeEntry = (await q(`INSERT INTO time_entry (id, user_id, project_id, activity_id, started_at, ended_at)
      VALUES (gen_random_uuid(), $1, $2, $3, now() - interval '2 hours', now() - interval '1 hour') RETURNING id`, [diane.sub, p2, a2])).rows[0].id;
    return { p1, p2, a1, a2, dianeEntry };
  },
  { commit: true },
);
const addEntry = (user, projectId, activityId) =>
  inDb(
    user,
    async (q) =>
      (await q(`INSERT INTO time_entry (id, user_id, project_id, activity_id, started_at, ended_at)
        VALUES (gen_random_uuid(), $1, $2, $3, now() - interval '2 hours', now() - interval '1 hour') RETURNING id`,
        [user.sub, projectId, activityId])).rows[0].id,
    { commit: true },
  );
data.aliceEntry = await addEntry(alice, data.p1, data.a1);
data.brunoEntry = await addEntry(bruno, data.p1, data.a1);

console.log('\nBarrière 1 : API (guards NestJS)');
await check('alice (Affectée à P1) ne liste que P1', async () => {
  const r = await call(alice, 'GET', '/projects');
  const mine = r.body.filter((p) => p.id === data.p1 || p.id === data.p2).map((p) => p.id);
  assert.deepEqual(mine, [data.p1]);
});
await check('diane (Administrateur) liste tous les Projets, affectée ou non', async () => {
  const r = await call(diane, 'GET', '/projects');
  const listed = r.body.map((p) => p.id);
  assert.ok(listed.includes(data.p1) && listed.includes(data.p2));
});
await check('alice (Affectée) lit P1 : 200, badge « actif »', async () => {
  const r = await call(alice, 'GET', `/projects/${data.p1}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'active');
});
await check('chloé (non affectée) lit P1 : 404 PROJET_INTROUVABLE', async () => {
  const r = await call(chloe, 'GET', `/projects/${data.p1}`);
  assert.equal(r.status, 404);
  assert.deepEqual(r.body, { code: 'PROJET_INTROUVABLE', message: 'Projet introuvable' });
});
await check('alice lit P2, où elle n’est pas affectée : 404 PROJET_INTROUVABLE', async () => {
  assert.equal((await call(alice, 'GET', `/projects/${data.p2}`)).body.code, 'PROJET_INTROUVABLE');
});
await check('diane (Administrateur) lit P2 sans y être affectée : 200', async () => {
  assert.equal((await call(diane, 'GET', `/projects/${data.p2}`)).status, 200);
});
await check('identifiant de Projet invalide ou inconnu : 404 PROJET_INTROUVABLE', async () => {
  assert.equal((await call(diane, 'GET', '/projects/pas-un-uuid')).body.code, 'PROJET_INTROUVABLE');
  assert.equal((await call(diane, 'GET', '/projects/00000000-0000-4000-8000-000000000000')).body.code, 'PROJET_INTROUVABLE');
});

console.log('\nÉcran Projets : création, équipe, lecture d’impact, suppression (API)');
let p3;
await check('diane crée un Projet par son seul nom : 201, badge « actif », équipe vide', async () => {
  const r = await call(diane, 'POST', '/projects', { name: `  P3 ${RUN}  ` });
  assert.equal(r.status, 201);
  assert.equal(r.body.name, `P3 ${RUN}`);
  assert.equal(r.body.status, 'active');
  p3 = r.body.id;
  assert.deepEqual((await call(diane, 'GET', `/projects/${p3}/members`)).body, []);
});
await check('nom vide ou fait d’espaces : 400 NOM_REQUIS', async () => {
  for (const name of [undefined, '', '   ']) {
    const r = await call(diane, 'POST', '/projects', { name });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'NOM_REQUIS');
  }
});
await check('nom de Projet sans limite de longueur', async () => {
  const r = await call(diane, 'POST', '/projects', { name: 'L'.repeat(1000) });
  assert.equal(r.status, 201);
  assert.equal((await call(diane, 'DELETE', `/projects/${r.body.id}`)).status, 204);
});
await check('diane liste les Utilisateurs connus de l’application (par Login)', async () => {
  const r = await call(diane, 'GET', '/users');
  assert.equal(r.status, 200);
  const logins = r.body.users.map((u) => u.login);
  for (const l of ['alice', 'bruno', 'chloe', 'diane']) assert.ok(logins.includes(l), l);
  assert.equal(r.body.users.find((u) => u.login === 'alice').id, alice.sub);
});
await check('diane affecte alice à P3 ; affecter une seconde fois est sans effet', async () => {
  assert.equal((await call(diane, 'PUT', `/projects/${p3}/members/${alice.sub}`)).status, 204);
  assert.equal((await call(diane, 'PUT', `/projects/${p3}/members/${alice.sub}`)).status, 204);
  assert.deepEqual((await call(diane, 'GET', `/projects/${p3}/members`)).body, [{ id: alice.sub, login: 'alice' }]);
});
await check('alice (Affectée) voit P3 par l’API ; chloé (non affectée) reçoit 404', async () => {
  assert.equal((await call(alice, 'GET', `/projects/${p3}`)).status, 200);
  assert.ok((await call(alice, 'GET', '/projects')).body.some((p) => p.id === p3));
  assert.equal((await call(chloe, 'GET', `/projects/${p3}`)).body.code, 'PROJET_INTROUVABLE');
});
await check('affecter un Utilisateur inconnu : 404 UTILISATEUR_INTROUVABLE ; un Projet inconnu : 404 PROJET_INTROUVABLE', async () => {
  assert.equal((await call(diane, 'PUT', `/projects/${p3}/members/inconnu-${RUN}`)).body.code, 'UTILISATEUR_INTROUVABLE');
  const unknown = '00000000-0000-4000-8000-000000000000';
  assert.equal((await call(diane, 'PUT', `/projects/${unknown}/members/${alice.sub}`)).body.code, 'PROJET_INTROUVABLE');
  assert.equal((await call(diane, 'GET', `/projects/${unknown}/impact`)).body.code, 'PROJET_INTROUVABLE');
  assert.equal((await call(diane, 'DELETE', `/projects/${unknown}`)).body.code, 'PROJET_INTROUVABLE');
});
await check('alice (non Administrateur) : 403 ACCES_REFUSE sur création, suppression, équipe, lecture d’impact et liste des Utilisateurs', async () => {
  const attempts = [
    ['POST', '/projects', { name: 'Pirate' }],
    ['DELETE', `/projects/${p3}`],
    ['GET', `/projects/${p3}/members`],
    ['PUT', `/projects/${p3}/members/${bruno.sub}`],
    ['DELETE', `/projects/${p3}/members/${alice.sub}`],
    ['GET', `/projects/${p3}/impact`],
    ['GET', '/users'],
  ];
  for (const [method, path, body] of attempts) {
    const r = await call(alice, method, path, body);
    assert.equal(r.status, 403, `${method} ${path}`);
    assert.equal(r.body.code, 'ACCES_REFUSE', `${method} ${path}`);
  }
  // chloé, non affectée, reçoit aussi 403 (et non 404) : l'administration est refusée d'abord.
  assert.equal((await call(chloe, 'DELETE', `/projects/${p3}`)).status, 403);
});
await check('la lecture d’impact chiffre les Activités et les Imputations (Chronomètre compris) de P3', async () => {
  const a3 = (await inDb(diane, async (q) =>
    (await q(`INSERT INTO activity (id, project_id, name, normalized_name) VALUES (gen_random_uuid(), $1, 'Tests', 'tests') RETURNING id`, [p3])).rows[0].id,
  { commit: true }));
  await inDb(diane, (q) => q(`INSERT INTO activity (id, project_id, name, normalized_name) VALUES (gen_random_uuid(), $1, 'Vide', 'vide')`, [p3]), { commit: true });
  await addEntry(alice, p3, a3);
  await addEntry(diane, p3, a3);
  await inDb(diane, (q) => q(`INSERT INTO time_entry (id, user_id, project_id, activity_id, started_at) VALUES (gen_random_uuid(), $1, $2, $3, now())`, [diane.sub, p3, a3]), { commit: true });
  const r = await call(diane, 'GET', `/projects/${p3}/impact`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { activities: 2, timeEntries: 3 });
});
await check('diane retire alice de P3 : alice reçoit ensuite 404, ses Imputations restent', async () => {
  assert.equal((await call(diane, 'DELETE', `/projects/${p3}/members/${alice.sub}`)).status, 204);
  assert.deepEqual((await call(diane, 'GET', `/projects/${p3}/members`)).body, []);
  assert.equal((await call(alice, 'GET', `/projects/${p3}`)).body.code, 'PROJET_INTROUVABLE');
  assert.equal((await query(alice, `SELECT 1 FROM time_entry WHERE project_id = $1`, [p3])).rowCount, 1);
});
await check('diane supprime P3 : Activités, Imputations et équipe partent avec lui ; une seconde suppression répond 404', async () => {
  await call(diane, 'PUT', `/projects/${p3}/members/${bruno.sub}`);
  assert.equal((await call(diane, 'DELETE', `/projects/${p3}`)).status, 204);
  await inDb(diane, async (q) => {
    for (const table of ['project_member', 'activity', 'time_entry']) {
      assert.equal((await q(`SELECT 1 FROM ${table} WHERE project_id = $1`, [p3])).rowCount, 0, table);
    }
  });
  assert.equal((await call(diane, 'GET', `/projects/${p3}`)).body.code, 'PROJET_INTROUVABLE');
  assert.equal((await call(diane, 'DELETE', `/projects/${p3}`)).body.code, 'PROJET_INTROUVABLE');
});
await check('personne ne renomme un Projet : aucune route de modification', async () => {
  const r = await call(diane, 'PATCH', `/projects/${data.p1}`, { name: 'Renommé' });
  assert.equal(r.status, 404);
});

console.log('\nÉcran Activités du Projet : lister, créer, renommer, supprimer (API)');
// P4 : alice affectée, chloé non affectée.
let p4;
const activitiesOf = async (projectId) =>
  (await query(diane, `SELECT name FROM activity WHERE project_id = $1 ORDER BY created_at, id`, [projectId])).rows.map((r) => r.name);
const act = {};
await check('diane crée des Activités dans P4 : 201, nom aux espaces de bord retirés', async () => {
  p4 = (await call(diane, 'POST', '/projects', { name: `P4 ${RUN}` })).body.id;
  await call(diane, 'PUT', `/projects/${p4}/members/${alice.sub}`);
  const r = await call(diane, 'POST', `/projects/${p4}/activities`, { name: '  Réunion ' });
  assert.equal(r.status, 201);
  assert.deepEqual(r.body, { id: r.body.id, projectId: p4, name: 'Réunion' });
  act.meeting = r.body.id;
  act.analysis = (await call(diane, 'POST', `/projects/${p4}/activities`, { name: 'Analyse' })).body.id;
  const stored = await query(diane, `SELECT normalized_name FROM activity WHERE id = $1`, [act.meeting]);
  assert.equal(stored.rows[0].normalized_name, 'reunion');
});
await check('création d’un nom déjà présent dans le Projet (casse et accents ignorés) : 409 ACTIVITE_NOM_DUPLIQUE', async () => {
  for (const name of ['Réunion', 'REUNION', ' réunion ', 'Réunion']) {
    const r = await call(diane, 'POST', `/projects/${p4}/activities`, { name });
    assert.equal(r.status, 409, name);
    assert.deepEqual(r.body, { code: 'ACTIVITE_NOM_DUPLIQUE', message: 'Une Activité de ce nom existe déjà dans ce Projet' });
  }
});
await check('le même nom reste permis dans un autre Projet', async () => {
  const r = await call(diane, 'POST', `/projects/${data.p2}/activities`, { name: 'réunion' });
  assert.equal(r.status, 201);
  assert.equal((await call(diane, 'DELETE', `/projects/${data.p2}/activities/${r.body.id}`)).status, 204);
});
await check('nom d’Activité vide ou fait d’espaces : 400 NOM_REQUIS, à la création comme au renommage', async () => {
  for (const name of [undefined, '', '  ']) {
    assert.equal((await call(diane, 'POST', `/projects/${p4}/activities`, { name })).body.code, 'NOM_REQUIS');
    assert.equal((await call(alice, 'PATCH', `/projects/${p4}/activities/${act.meeting}`, { name })).body.code, 'NOM_REQUIS');
  }
});
await check('deux créations simultanées du même nom : une seule réussit, l’autre reçoit 409', async () => {
  const results = await Promise.all(
    ['Simultanée', 'SIMULTANEE', 'simultanée', 'Simultanee'].map((name) => call(diane, 'POST', `/projects/${p4}/activities`, { name })),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409, 409]);
  for (const r of results.filter((x) => x.status === 409)) assert.equal(r.body.code, 'ACTIVITE_NOM_DUPLIQUE');
  assert.equal((await activitiesOf(p4)).length, 3);
});
await check('alice (Affectée) liste les Activités de P4, dans leur ordre de création', async () => {
  const r = await call(alice, 'GET', `/projects/${p4}/activities`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.slice(0, 2), [
    { id: act.meeting, projectId: p4, name: 'Réunion' },
    { id: act.analysis, projectId: p4, name: 'Analyse' },
  ]);
  assert.equal(r.body.length, 3);
});
await check('alice (Affectée) renomme une Activité ; reconfirmer son nom ou en changer la casse est permis', async () => {
  let r = await call(alice, 'PATCH', `/projects/${p4}/activities/${act.meeting}`, { name: ' Réunion hebdo ' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { id: act.meeting, projectId: p4, name: 'Réunion hebdo' });
  r = await call(alice, 'PATCH', `/projects/${p4}/activities/${act.meeting}`, { name: 'Réunion hebdo' });
  assert.equal(r.status, 200);
  r = await call(diane, 'PATCH', `/projects/${p4}/activities/${act.meeting}`, { name: 'RÉUNION HEBDO' });
  assert.equal(r.status, 200);
  assert.equal(r.body.name, 'RÉUNION HEBDO');
});
await check('renommer vers le nom d’une autre Activité du Projet : 409 ACTIVITE_NOM_DUPLIQUE', async () => {
  const r = await call(alice, 'PATCH', `/projects/${p4}/activities/${act.meeting}`, { name: 'analyse' });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'ACTIVITE_NOM_DUPLIQUE');
  assert.ok((await activitiesOf(p4)).includes('RÉUNION HEBDO'));
});
await check('alice (Affectée) ne crée pas hors Chronomètre, ne supprime pas, ne lit pas l’impact : 403 ACCES_REFUSE', async () => {
  const attempts = [
    ['POST', `/projects/${p4}/activities`, { name: 'Pirate' }],
    ['DELETE', `/projects/${p4}/activities/${act.analysis}`],
    ['GET', `/projects/${p4}/activities/${act.analysis}/impact`],
  ];
  for (const [method, path, body] of attempts) {
    const r = await call(alice, method, path, body);
    assert.equal(r.status, 403, `${method} ${path}`);
    assert.equal(r.body.code, 'ACCES_REFUSE', `${method} ${path}`);
  }
});
await check('chloé (non affectée) : 404 PROJET_INTROUVABLE pour lister et renommer', async () => {
  for (const [method, path, body] of [
    ['GET', `/projects/${p4}/activities`],
    ['PATCH', `/projects/${p4}/activities/${act.analysis}`, { name: 'Piratée' }],
  ]) {
    const r = await call(chloe, method, path, body);
    assert.equal(r.status, 404, `${method} ${path}`);
    assert.equal(r.body.code, 'PROJET_INTROUVABLE', `${method} ${path}`);
  }
});
await check('Activité inconnue, d’un autre Projet ou identifiant invalide : 404 ACTIVITE_INTROUVABLE', async () => {
  const unknown = '00000000-0000-4000-8000-000000000000';
  for (const id of [unknown, data.a2, 'pas-un-uuid']) {
    assert.equal((await call(alice, 'PATCH', `/projects/${p4}/activities/${id}`, { name: 'X' })).body.code, 'ACTIVITE_INTROUVABLE', id);
    assert.equal((await call(diane, 'DELETE', `/projects/${p4}/activities/${id}`)).body.code, 'ACTIVITE_INTROUVABLE', id);
    assert.equal((await call(diane, 'GET', `/projects/${p4}/activities/${id}/impact`)).body.code, 'ACTIVITE_INTROUVABLE', id);
  }
  assert.equal((await call(diane, 'GET', `/projects/${unknown}/activities`)).body.code, 'PROJET_INTROUVABLE');
  assert.equal((await call(diane, 'POST', `/projects/${unknown}/activities`, { name: 'X' })).body.code, 'PROJET_INTROUVABLE');
});
await check('la lecture d’impact chiffre les Imputations de l’Activité (Chronomètre compris)', async () => {
  await addEntry(alice, p4, act.meeting);
  await addEntry(diane, p4, act.analysis);
  await inDb(diane, (q) => q(`INSERT INTO time_entry (id, user_id, project_id, activity_id, started_at) VALUES (gen_random_uuid(), $1, $2, $3, now())`,
    [diane.sub, p4, act.meeting]), { commit: true });
  const r = await call(diane, 'GET', `/projects/${p4}/activities/${act.meeting}/impact`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { timeEntries: 2 });
});
await check('diane supprime l’Activité : ses Imputations (Chronomètre compris) partent avec elle, pas celles des autres ; une seconde suppression répond 404', async () => {
  assert.equal((await call(diane, 'DELETE', `/projects/${p4}/activities/${act.meeting}`)).status, 204);
  await inDb(diane, async (q) => {
    assert.equal((await q(`SELECT 1 FROM time_entry WHERE activity_id = $1`, [act.meeting])).rowCount, 0);
    assert.equal((await q(`SELECT 1 FROM time_entry WHERE activity_id = $1`, [act.analysis])).rowCount, 1);
  });
  assert.equal((await call(diane, 'DELETE', `/projects/${p4}/activities/${act.meeting}`)).body.code, 'ACTIVITE_INTROUVABLE');
});
await check('alice retirée de P4 ne peut plus lister ni renommer : 404 PROJET_INTROUVABLE', async () => {
  await call(diane, 'DELETE', `/projects/${p4}/members/${alice.sub}`);
  assert.equal((await call(alice, 'GET', `/projects/${p4}/activities`)).body.code, 'PROJET_INTROUVABLE');
  assert.equal((await call(alice, 'PATCH', `/projects/${p4}/activities/${act.analysis}`, { name: 'Après retrait' })).body.code, 'PROJET_INTROUVABLE');
  await call(diane, 'PUT', `/projects/${p4}/members/${alice.sub}`);
});

console.log('\nActivités : barrière 2 (RLS, compte applicatif)');
const insertActivity = (actor, projectId, name, normalized) =>
  query(actor, `INSERT INTO activity (id, project_id, name, normalized_name) VALUES (gen_random_uuid(), $1, $2, $3)`, [projectId, name, normalized]);
await check('alice (Affectée) voit, crée (au Chronomètre) et renomme en base, mais ne supprime pas (sans effet)', async () => {
  assert.ok(ids(await query(alice, `SELECT id FROM activity WHERE project_id = $1`, [p4])).includes(act.analysis));
  await insertActivity(alice, p4, 'Créée par alice', 'creee par alice');
  assert.equal((await query(alice, `UPDATE activity SET name = 'Analyse 2', normalized_name = 'analyse 2' WHERE id = $1`, [act.analysis])).rowCount, 1);
  assert.equal((await query(alice, `DELETE FROM activity WHERE id = $1`, [act.analysis])).rowCount, 0);
});
await check('chloé (non affectée) ne voit, ne crée, ne renomme ni ne supprime en base', async () => {
  assert.equal((await query(chloe, `SELECT 1 FROM activity WHERE project_id = $1`, [p4])).rowCount, 0);
  await assert.rejects(insertActivity(chloe, p4, 'Pirate', 'pirate'), /row-level security/);
  assert.equal((await query(chloe, `UPDATE activity SET name = 'Piratée', normalized_name = 'piratee' WHERE id = $1`, [act.analysis])).rowCount, 0);
  assert.equal((await query(chloe, `DELETE FROM activity WHERE id = $1`, [act.analysis])).rowCount, 0);
});
await check('diane (Administrateur, non affectée) voit, crée, renomme et supprime en base', async () => {
  await inDb(diane, async (q) => {
    const id = (await q(`INSERT INTO activity (id, project_id, name, normalized_name) VALUES (gen_random_uuid(), $1, 'Admin', 'admin') RETURNING id`, [p4])).rows[0].id;
    assert.equal((await q(`UPDATE activity SET name = 'Admin 2', normalized_name = 'admin 2' WHERE id = $1`, [id])).rowCount, 1);
    assert.equal((await q(`DELETE FROM activity WHERE id = $1`, [id])).rowCount, 1);
  });
});
await check('deux transactions simultanées créant le même nom normalisé : la base n’en garde qu’une', async () => {
  const results = await Promise.allSettled(
    [alice, diane].map((actor) => inDb(actor, (q) => q(
      `INSERT INTO activity (id, project_id, name, normalized_name) VALUES (gen_random_uuid(), $1, $2, 'concurrente')`,
      [p4, actor === alice ? 'Concurrente' : 'CONCURRENTE']), { commit: true })),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
  assert.match(results.find((r) => r.status === 'rejected').reason.message, /activity_project_name_key/);
  assert.equal((await query(diane, `SELECT 1 FROM activity WHERE project_id = $1 AND normalized_name = 'concurrente'`, [p4])).rowCount, 1);
});
console.log('\nSaisie de temps : recherche combinée, Chronomètre, Journée (API et base)');
// P5 : alice et bruno affectés (Activités « Réunion », « Analyse ») ; P6 : personne
// (Activité « Réunion »). diane (Administrateur) n'est affectée à aucun des deux.
const fixture = {};
fixture.p5 = (await call(diane, 'POST', '/projects', { name: `P5 ${RUN}` })).body.id;
fixture.p6 = (await call(diane, 'POST', '/projects', { name: `P6 ${RUN}` })).body.id;
await call(diane, 'PUT', `/projects/${fixture.p5}/members/${alice.sub}`);
await call(diane, 'PUT', `/projects/${fixture.p5}/members/${bruno.sub}`);
fixture.meeting5 = (await call(diane, 'POST', `/projects/${fixture.p5}/activities`, { name: 'Réunion' })).body.id;
fixture.analysis5 = (await call(diane, 'POST', `/projects/${fixture.p5}/activities`, { name: 'Analyse' })).body.id;
fixture.meeting6 = (await call(diane, 'POST', `/projects/${fixture.p6}/activities`, { name: 'Réunion' })).body.id;
const searchIn = async (user, q, projects) =>
  (await call(user, 'GET', `/activities/search?q=${encodeURIComponent(q)}`)).body.filter((r) => projects.includes(r.projectId));
const runningOf = async (user) =>
  (await query(diane, `SELECT id FROM time_entry WHERE user_id = $1 AND ended_at IS NULL`, [user.sub])).rows.map((r) => r.id);
const start = (user, body) => call(user, 'POST', '/time-entries/timer/start', body);

await check('recherche combinée : préfixe ou sous-chaîne, casse et accents ignorés, sur les seuls Projets affectés', async () => {
  for (const q of ['réu', 'REU', 'union', 'RÉUNION']) {
    assert.deepEqual(await searchIn(alice, q, [fixture.p5, fixture.p6]), [
      { id: fixture.meeting5, name: 'Réunion', projectId: fixture.p5, projectName: `P5 ${RUN}` },
    ], q);
  }
  assert.deepEqual(await searchIn(chloe, 'réu', [fixture.p5, fixture.p6]), []);
});
await check('recherche combinée de l’Administrateur : tous les Projets, une ligne par Projet', async () => {
  const r = await searchIn(diane, 'reunion', [fixture.p5, fixture.p6]);
  assert.deepEqual(r.map((x) => x.id).sort(), [fixture.meeting5, fixture.meeting6].sort());
});
await check('alice démarre un Chronomètre sur une Activité existante : 201, retrouvé par l’état du Chronomètre', async () => {
  const r = await start(alice, { projectId: fixture.p5, activityId: fixture.meeting5 });
  assert.equal(r.status, 201);
  assert.equal(r.body.previousTimerStopped, null);
  assert.equal(r.body.timer.endedAt, null);
  assert.deepEqual(
    { userId: r.body.timer.userId, projectName: r.body.timer.projectName, activityName: r.body.timer.activityName },
    { userId: alice.sub, projectName: `P5 ${RUN}`, activityName: 'Réunion' },
  );
  fixture.first = r.body.timer;
  assert.deepEqual((await call(alice, 'GET', '/time-entries/timer')).body, { timer: fixture.first });
});
await check('démarrer arrête le Chronomètre en cours au même instant et l’indique ; un nom existant (casse, accents) réutilise l’Activité', async () => {
  const r = await start(alice, { projectId: fixture.p5, newActivityName: '  REUNION ' });
  assert.equal(r.status, 201);
  assert.equal(r.body.timer.activityId, fixture.meeting5);
  assert.equal(r.body.previousTimerStopped.id, fixture.first.id);
  assert.equal(r.body.previousTimerStopped.endedAt, r.body.timer.startedAt);
  assert.deepEqual(await runningOf(alice), [r.body.timer.id]);
  assert.equal((await query(diane, `SELECT 1 FROM activity WHERE project_id = $1`, [fixture.p5])).rowCount, 2);
});
await check('un nouveau nom crée l’Activité dans le Projet choisi en démarrant', async () => {
  const r = await start(alice, { projectId: fixture.p5, newActivityName: 'Rédaction' });
  assert.equal(r.status, 201);
  assert.equal(r.body.timer.activityName, 'Rédaction');
  assert.ok(r.body.previousTimerStopped);
  const stored = await query(diane, `SELECT name, normalized_name FROM activity WHERE id = $1`, [r.body.timer.activityId]);
  assert.deepEqual(stored.rows, [{ name: 'Rédaction', normalized_name: 'redaction' }]);
});
await check('démarrages simultanés : un seul Chronomètre ; un même nouveau nom ne crée qu’une Activité', async () => {
  const results = await Promise.all([
    start(alice, { projectId: fixture.p5, newActivityName: 'Atelier' }),
    start(alice, { projectId: fixture.p5, newActivityName: 'ATELIER' }),
    start(alice, { projectId: fixture.p5, activityId: fixture.analysis5 }),
    start(bruno, { projectId: fixture.p5, newActivityName: 'atelier' }),
  ]);
  assert.deepEqual(results.map((r) => r.status), [201, 201, 201, 201]);
  assert.equal((await runningOf(alice)).length, 1);
  assert.equal((await runningOf(bruno)).length, 1);
  assert.equal((await query(diane, `SELECT 1 FROM activity WHERE project_id = $1 AND normalized_name = 'atelier'`, [fixture.p5])).rowCount, 1);
});
await check('chloé (non affectée) démarre sur P5 : 404 PROJET_INTROUVABLE ; Projet inconnu, invalide ou absent : 404', async () => {
  for (const projectId of [fixture.p5, '00000000-0000-4000-8000-000000000000', 'pas-un-uuid', undefined]) {
    const r = await start(chloe, { projectId, activityId: fixture.meeting5 });
    assert.equal(r.status, 404, String(projectId));
    assert.equal(r.body.code, 'PROJET_INTROUVABLE', String(projectId));
  }
  assert.deepEqual(await runningOf(chloe), []);
});
await check('Activité absente, inconnue ou d’un autre Projet : 404 ACTIVITE_INTROUVABLE ; nouveau nom vide : 400 NOM_REQUIS', async () => {
  for (const activityId of [undefined, fixture.meeting6, 'pas-un-uuid']) {
    const r = await start(alice, { projectId: fixture.p5, activityId });
    assert.equal(r.status, 404, String(activityId));
    assert.equal(r.body.code, 'ACTIVITE_INTROUVABLE', String(activityId));
  }
  const r = await start(alice, { projectId: fixture.p5, newActivityName: '   ' });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'NOM_REQUIS');
});
await check('diane (Administrateur, non affectée) démarre sur P6 : son propre Chronomètre', async () => {
  const r = await start(diane, { projectId: fixture.p6, activityId: fixture.meeting6 });
  assert.equal(r.status, 201);
  assert.equal(r.body.timer.userId, diane.sub);
});
await check('un Affecté ne voit pas les Imputations des autres, ni par l’API ni en base', async () => {
  const brunoToday = (await call(bruno, 'GET', '/time-entries/today')).body;
  assert.ok(brunoToday.length > 0);
  assert.ok(brunoToday.every((e) => e.userId === bruno.sub));
  assert.equal((await call(bruno, 'GET', '/time-entries/timer')).body.timer.userId, bruno.sub);
  assert.equal((await query(bruno, `SELECT 1 FROM time_entry WHERE user_id <> $1`, [bruno.sub])).rowCount, 0);
  // L'Administrateur lui-même ne lit par l'API que ses propres Imputations de la Journée.
  assert.ok((await call(diane, 'GET', '/time-entries/today')).body.every((e) => e.userId === diane.sub));
});
await check('Imputations de la Journée : Chronomètre compris, les plus récentes d’abord', async () => {
  const entries = (await call(alice, 'GET', '/time-entries/today')).body;
  assert.ok(entries.length >= 4);
  assert.ok(entries.some((e) => e.endedAt === null));
  const starts = entries.map((e) => e.startedAt);
  assert.deepEqual(starts, [...starts].sort().reverse());
});
await check('une Imputation franchissant minuit (Europe/Zurich) reste une seule ligne, dans la Journée de son début', async () => {
  // De 23:30 la veille à 00:30 aujourd'hui, heure de Zurich.
  const crossing = await inDb(alice, async (q) => (await q(`
    WITH midnight AS (SELECT (date_trunc('day', now() AT TIME ZONE 'Europe/Zurich') AT TIME ZONE 'Europe/Zurich') AS m)
    INSERT INTO time_entry (id, user_id, project_id, activity_id, started_at, ended_at)
    SELECT gen_random_uuid(), $1, $2, $3, m - interval '30 minutes', m + interval '30 minutes' FROM midnight
    RETURNING id`, [alice.sub, fixture.p5, fixture.analysis5])).rows[0].id, { commit: true });
  const today = (await call(alice, 'GET', '/time-entries/today')).body.map((e) => e.id);
  assert.ok(!today.includes(crossing), 'rattachée à la veille, pas à aujourd’hui');
});
await check('arrêter : 200 avec l’heure de fin ; s’il n’y a plus de Chronomètre : 404 AUCUN_CHRONO_ACTIF', async () => {
  const r = await call(alice, 'POST', '/time-entries/timer/stop');
  assert.equal(r.status, 200);
  assert.ok(r.body.endedAt);
  assert.deepEqual((await call(alice, 'GET', '/time-entries/timer')).body, { timer: null });
  const again = await call(alice, 'POST', '/time-entries/timer/stop');
  assert.equal(again.status, 404);
  assert.deepEqual(again.body, { code: 'AUCUN_CHRONO_ACTIF', message: 'Aucun chronomètre actif' });
});
await check('l’Imputation d’un autre Utilisateur répond 404 IMPUTATION_INTROUVABLE et reste en place', async () => {
  const r = await call(bruno, 'DELETE', `/time-entries/${fixture.first.id}`);
  assert.equal(r.status, 404);
  assert.deepEqual(r.body, { code: 'IMPUTATION_INTROUVABLE', message: 'Imputation introuvable' });
  assert.equal((await query(diane, `SELECT 1 FROM time_entry WHERE id = $1`, [fixture.first.id])).rowCount, 1);
  assert.equal((await call(alice, 'DELETE', '/time-entries/pas-un-uuid')).body.code, 'IMPUTATION_INTROUVABLE');
});
await check('alice supprime sa propre Imputation, sans confirmation : 204, puis 404', async () => {
  assert.equal((await call(alice, 'DELETE', `/time-entries/${fixture.first.id}`)).status, 204);
  assert.equal((await call(alice, 'DELETE', `/time-entries/${fixture.first.id}`)).body.code, 'IMPUTATION_INTROUVABLE');
});
await check('l’Administrateur passe les deux barrières : il modifie (en base) et supprime (par l’API) l’Imputation d’autrui', async () => {
  const [brunoTimer] = await runningOf(bruno);
  assert.equal((await query(diane, `UPDATE time_entry SET ended_at = now() WHERE id = $1`, [brunoTimer])).rowCount, 1);
  assert.equal((await call(diane, 'DELETE', `/time-entries/${brunoTimer}`)).status, 204);
  assert.deepEqual(await runningOf(bruno), []);
});
await check('en base, un seul Chronomètre par Utilisateur, Administrateur compris', async () => {
  await assert.rejects(
    query(diane, `INSERT INTO time_entry (id, user_id, project_id, activity_id, started_at) VALUES (gen_random_uuid(), $1, $2, $3, now())`,
      [diane.sub, fixture.p6, fixture.meeting6]),
    /time_entry_one_running_timer/,
  );
});
await check('bruno, retiré de P5, n’y trouve plus d’Activité par la recherche et ne peut plus y démarrer : 404', async () => {
  await call(diane, 'DELETE', `/projects/${fixture.p5}/members/${bruno.sub}`);
  assert.deepEqual(await searchIn(bruno, 'réu', [fixture.p5, fixture.p6]), []);
  assert.equal((await start(bruno, { projectId: fixture.p5, activityId: fixture.meeting5 })).body.code, 'PROJET_INTROUVABLE');
});

console.log('\nÉdition à la volée, Scission et Relancer (API et base)');
// Imputations terminées du 5 janvier 2026, heure de Zurich (UTC+1).
const entryAt = (user, activityId, startedAt, endedAt) =>
  inDb(
    user,
    async (q) =>
      (await q(`INSERT INTO time_entry (id, user_id, project_id, activity_id, started_at, ended_at)
        VALUES (gen_random_uuid(), $1, $2, $3, $4, $5) RETURNING id`, [user.sub, fixture.p5, activityId, startedAt, endedAt])).rows[0].id,
    { commit: true },
  );
const nineToTen = (user) => entryAt(user, fixture.meeting5, '2026-01-05T08:00:00Z', '2026-01-05T09:00:00Z'); // 09:00 → 10:00
const edit = (user, id, body) => call(user, 'PATCH', `/time-entries/${id}`, body);
const rangeOf = async (id) => {
  const row = (await query(diane, `SELECT started_at, ended_at FROM time_entry WHERE id = $1`, [id])).rows[0];
  return row && [row.started_at.toISOString(), row.ended_at.toISOString()];
};
const countOf = async (user) =>
  Number((await query(diane, `SELECT count(*) FROM time_entry WHERE user_id = $1 AND project_id = $2`, [user.sub, fixture.p5])).rows[0].count);

await check('une édition sans franchissement de minuit est une modification simple, sans Scission', async () => {
  const id = await nineToTen(alice);
  const r = await edit(alice, id, { endedAt: '2026-01-05T10:30:00.000Z' }); // fin à 11:30
  assert.equal(r.status, 200);
  assert.equal(r.body.entry.endedAt, '2026-01-05T10:30:00.000Z');
  assert.equal(r.body.split, null);
});
await check('fin éditée avant le début : Scission vers le lendemain, sur les minuits suisses', async () => {
  const id = await nineToTen(alice);
  const r = await edit(alice, id, { endedAt: '2026-01-05T07:00:00.000Z' }); // fin à 08:00
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.entry.startedAt, r.body.entry.endedAt], ['2026-01-05T08:00:00.000Z', '2026-01-05T22:59:59.999Z']);
  const { split } = r.body;
  assert.deepEqual([split.startedAt, split.endedAt], ['2026-01-05T23:00:00.000Z', '2026-01-06T07:00:00.000Z']);
  assert.deepEqual([split.userId, split.projectId, split.activityId], [alice.sub, fixture.p5, fixture.meeting5]);
  assert.deepEqual(await rangeOf(split.id), ['2026-01-05T23:00:00.000Z', '2026-01-06T07:00:00.000Z']);
});
await check('début édité après la fin : Scission vers la veille, l’original commence à minuit', async () => {
  const id = await nineToTen(alice);
  const r = await edit(alice, id, { startedAt: '2026-01-05T22:50:00.000Z' }); // début à 23:50
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.entry.startedAt, r.body.entry.endedAt], ['2026-01-04T23:00:00.000Z', '2026-01-05T09:00:00.000Z']);
  assert.deepEqual([r.body.split.startedAt, r.body.split.endedAt], ['2026-01-04T22:50:00.000Z', '2026-01-04T22:59:59.999Z']);
});
await check('début et fin envoyés ensemble et inversés : 400 IMPUTATION_FIN_AVANT_DEBUT, rien ne change', async () => {
  const id = await nineToTen(alice);
  const before = await countOf(alice);
  const r = await edit(alice, id, { startedAt: '2026-01-05T22:50:00.000Z', endedAt: '2026-01-05T08:30:00.000Z' });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'IMPUTATION_FIN_AVANT_DEBUT');
  assert.deepEqual(await rangeOf(id), ['2026-01-05T08:00:00.000Z', '2026-01-05T09:00:00.000Z']);
  assert.equal(await countOf(alice), before);
});
await check('instant illisible : 400 IMPUTATION_CHAMPS_REQUIS', async () => {
  const id = await nineToTen(alice);
  assert.equal((await edit(alice, id, { endedAt: '08:00' })).body.code, 'IMPUTATION_CHAMPS_REQUIS');
});
await check('l’Imputation d’autrui : 404 IMPUTATION_INTROUVABLE, ni modification ni Scission', async () => {
  const id = await nineToTen(alice);
  const before = await countOf(alice);
  const r = await edit(bruno, id, { endedAt: '2026-01-05T07:00:00.000Z' });
  assert.equal(r.status, 404);
  assert.equal(r.body.code, 'IMPUTATION_INTROUVABLE');
  assert.deepEqual(await rangeOf(id), ['2026-01-05T08:00:00.000Z', '2026-01-05T09:00:00.000Z']);
  assert.equal(await countOf(alice), before);
  assert.equal((await edit(alice, 'pas-un-uuid', { endedAt: '2026-01-05T07:00:00.000Z' })).body.code, 'IMPUTATION_INTROUVABLE');
});
await check('diane (Administrateur, non affectée) scinde l’Imputation d’alice : la nouvelle est à alice', async () => {
  const id = await nineToTen(alice);
  const r = await edit(diane, id, { endedAt: '2026-01-05T07:00:00.000Z' });
  assert.equal(r.status, 200);
  assert.equal(r.body.split.userId, alice.sub);
});
await check('un Auteur retiré du Projet édite et scinde encore ses Imputations ; Relancer lui répond 404', async () => {
  await call(diane, 'PUT', `/projects/${fixture.p5}/members/${chloe.sub}`);
  const id = await nineToTen(chloe);
  await call(diane, 'DELETE', `/projects/${fixture.p5}/members/${chloe.sub}`);
  const r = await edit(chloe, id, { endedAt: '2026-01-05T07:00:00.000Z' });
  assert.equal(r.status, 200);
  assert.equal(r.body.split.userId, chloe.sub);
  const relaunch = await start(chloe, { projectId: fixture.p5, activityId: fixture.meeting5 });
  assert.equal(relaunch.status, 404);
  assert.equal(relaunch.body.code, 'PROJET_INTROUVABLE');
});
await check('en base, la Scission n’est qu’une coupe à minuit, sur une Imputation que l’on peut modifier', async () => {
  const id = await nineToTen(alice);
  const split = (user, args) => query(user, `SELECT split_time_entry($1, $2, $3, gen_random_uuid(), $4, $5)`, [id, ...args]);
  // Coupe ailleurs qu'à minuit : refusée (pas de création libre par ce biais).
  await assert.rejects(
    split(alice, ['2026-01-05T08:00:00Z', '2026-01-05T08:30:00Z', '2026-01-05T08:30:00.001Z', '2026-01-05T09:00:00Z']),
    /pas une Scission à minuit/,
  );
  // Vers la veille, mais depuis un minuit antérieur à la Journée de l'original : refusée.
  await assert.rejects(
    split(alice, ['2025-12-31T23:00:00Z', '2026-01-05T09:00:00Z', '2025-12-31T22:00:00Z', '2025-12-31T22:59:59.999Z']),
    /pas une Scission à minuit/,
  );
  // Imputation d'autrui : introuvable.
  await assert.rejects(
    split(bruno, ['2026-01-05T08:00:00Z', '2026-01-05T22:59:59.999Z', '2026-01-05T23:00:00Z', '2026-01-06T07:00:00Z']),
    /introuvable/,
  );
  assert.deepEqual(await rangeOf(id), ['2026-01-05T08:00:00.000Z', '2026-01-05T09:00:00.000Z']);
});
await check('en base, la Scission est atomique : si la création échoue, l’original n’est pas tronqué', async () => {
  const id = await nineToTen(alice);
  const before = await countOf(alice);
  // L'identifiant de la nouvelle Imputation est déjà pris : l'insertion échoue après la troncature.
  await assert.rejects(
    query(alice, `SELECT split_time_entry($1, $2, $3, $1, $4, $5)`,
      [id, '2026-01-05T08:00:00Z', '2026-01-05T22:59:59.999Z', '2026-01-05T23:00:00Z', '2026-01-06T07:00:00Z']),
    /time_entry_pkey/,
  );
  assert.deepEqual(await rangeOf(id), ['2026-01-05T08:00:00.000Z', '2026-01-05T09:00:00.000Z']);
  assert.equal(await countOf(alice), before);
});
await check('Relancer : nouveau Chronomètre aujourd’hui sur le même Projet et la même Activité, le précédent arrêté, l’origine inchangée', async () => {
  const id = await nineToTen(alice);
  const running = (await start(alice, { projectId: fixture.p5, activityId: fixture.analysis5 })).body.timer;
  const r = await start(alice, { projectId: fixture.p5, activityId: fixture.meeting5 });
  assert.equal(r.status, 201);
  assert.deepEqual([r.body.timer.projectId, r.body.timer.activityId, r.body.timer.endedAt], [fixture.p5, fixture.meeting5, null]);
  assert.ok(Date.now() - new Date(r.body.timer.startedAt).getTime() < 60_000, 'démarré maintenant');
  assert.equal(r.body.previousTimerStopped.id, running.id);
  assert.deepEqual(await runningOf(alice), [r.body.timer.id]);
  assert.deepEqual(await rangeOf(id), ['2026-01-05T08:00:00.000Z', '2026-01-05T09:00:00.000Z']);
  await call(alice, 'POST', '/time-entries/timer/stop');
});
await check('renommer sur place s’applique à toutes les Imputations de l’Activité', async () => {
  const r = await call(alice, 'PATCH', `/projects/${fixture.p5}/activities/${fixture.meeting5}`, { name: 'Réunion d’équipe' });
  assert.equal(r.status, 200);
  const names = (await call(alice, 'GET', '/time-entries/today')).body
    .filter((e) => e.activityId === fixture.meeting5)
    .map((e) => e.activityName);
  assert.ok(names.length > 0);
  assert.ok(names.every((n) => n === 'Réunion d’équipe'));
  const duplicate = await call(alice, 'PATCH', `/projects/${fixture.p5}/activities/${fixture.meeting5}`, { name: 'ANALYSE' });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, 'ACTIVITE_NOM_DUPLIQUE');
});

console.log('\nSaisie manuelle (API et base)');
// Minuit de la Journée en cours, heure de Zurich, lu en base.
const midnight = (await query(diane, `SELECT (date_trunc('day', now() AT TIME ZONE 'Europe/Zurich') AT TIME ZONE 'Europe/Zurich') AS m`))
  .rows[0].m.getTime();
const at = (minutesFromMidnight) => new Date(midnight + minutesFromMidnight * 60_000).toISOString();
const manual = (user, body) => call(user, 'POST', '/time-entries', body);
const manualBody = (overrides = {}) => ({
  projectId: fixture.p5,
  activityId: fixture.analysis5,
  startedAt: at(9 * 60),
  endedAt: at(10 * 60 + 30),
  ...overrides,
});

await check('alice (Affectée) saisit une Imputation terminée : 201, elle apparaît dans la Journée concernée', async () => {
  const r = await manual(alice, manualBody());
  assert.equal(r.status, 201);
  assert.deepEqual(
    [r.body.userId, r.body.projectId, r.body.activityId, r.body.activityName, r.body.startedAt, r.body.endedAt],
    [alice.sub, fixture.p5, fixture.analysis5, 'Analyse', at(9 * 60), at(10 * 60 + 30)],
  );
  assert.ok((await call(alice, 'GET', '/time-entries/today')).body.some((e) => e.id === r.body.id));
});
await check('une saisie qui franchit minuit donne une seule Imputation, rattachée à la Journée de son début, sans Scission', async () => {
  const before = await countOf(alice);
  const r = await manual(alice, manualBody({ startedAt: at(-60), endedAt: at(60) }));
  assert.equal(r.status, 201);
  assert.equal(await countOf(alice), before + 1);
  assert.deepEqual(await rangeOf(r.body.id), [at(-60), at(60)]);
  assert.ok(!(await call(alice, 'GET', '/time-entries/today')).body.some((e) => e.id === r.body.id), 'rattachée à la veille');
});
await check('fin égale au début : acceptée', async () => {
  assert.equal((await manual(alice, manualBody({ endedAt: at(9 * 60) }))).status, 201);
});
await check('fin avant début : 400 IMPUTATION_FIN_AVANT_DEBUT, rien n’est créé', async () => {
  const before = await countOf(alice);
  const r = await manual(alice, manualBody({ endedAt: at(9 * 60 - 1) }));
  assert.deepEqual([r.status, r.body.code], [400, 'IMPUTATION_FIN_AVANT_DEBUT']);
  assert.equal(await countOf(alice), before);
});
await check('champ manquant, vide ou illisible : 400 IMPUTATION_CHAMPS_REQUIS, avant tout contrôle d’accès', async () => {
  for (const field of ['projectId', 'activityId', 'startedAt', 'endedAt']) {
    for (const value of [undefined, '']) {
      const r = await manual(alice, manualBody({ [field]: value }));
      assert.deepEqual([r.status, r.body.code], [400, 'IMPUTATION_CHAMPS_REQUIS'], `${field}=${value}`);
    }
  }
  const unreadable = await manual(alice, manualBody({ startedAt: '09:00' }));
  assert.deepEqual([unreadable.status, unreadable.body.code], [400, 'IMPUTATION_CHAMPS_REQUIS']);
  // Même pour un non-affecté : la saisie incomplète est refusée avant l'accès.
  const incomplete = await manual(chloe, manualBody({ endedAt: undefined }));
  assert.deepEqual([incomplete.status, incomplete.body.code], [400, 'IMPUTATION_CHAMPS_REQUIS']);
});
await check('Projet non affecté, inconnu ou invalide : 404 PROJET_INTROUVABLE ; bruno, retiré de P5, aussi', async () => {
  for (const [user, projectId] of [
    [chloe, fixture.p5],
    [alice, fixture.p6],
    [bruno, fixture.p5],
    [alice, '00000000-0000-4000-8000-000000000000'],
    [alice, 'pas-un-uuid'],
  ]) {
    const r = await manual(user, manualBody({ projectId }));
    assert.deepEqual([r.status, r.body.code], [404, 'PROJET_INTROUVABLE'], `${user.login} ${projectId}`);
  }
});
await check('Activité inconnue, d’un autre Projet ou invalide : 404 ACTIVITE_INTROUVABLE', async () => {
  for (const activityId of [fixture.meeting6, '00000000-0000-4000-8000-000000000000', 'pas-un-uuid']) {
    const r = await manual(alice, manualBody({ activityId }));
    assert.deepEqual([r.status, r.body.code], [404, 'ACTIVITE_INTROUVABLE'], activityId);
  }
});
await check('diane (Administrateur, non affectée) saisit sur P6, pour elle-même ; un userId envoyé est ignoré', async () => {
  const r = await manual(diane, manualBody({ projectId: fixture.p6, activityId: fixture.meeting6, userId: alice.sub }));
  assert.equal(r.status, 201);
  assert.equal(r.body.userId, diane.sub);
});
await check('la Saisie manuelle n’arrête pas le Chronomètre en cours', async () => {
  const timer = (await start(alice, { projectId: fixture.p5, activityId: fixture.meeting5 })).body.timer;
  assert.equal((await manual(alice, manualBody())).status, 201);
  assert.deepEqual(await runningOf(alice), [timer.id]);
  await call(alice, 'POST', '/time-entries/timer/stop');
});

console.log('\nHistorique paginé (API)');
const zurichDay = (instant) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(instant);
const todayDay = zurichDay(midnight);
const yesterdayDay = zurichDay(midnight - 1);
const history = (user, before) =>
  call(user, 'GET', `/time-entries/history${before === undefined ? '' : `?before=${encodeURIComponent(before)}`}`);
const historyEntries = (page) => page.days.flatMap((d) => d.groups.flatMap((g) => g.entries));
// Une Imputation l'avant-veille à 23:00 (heure de Zurich), sous la Journée de la veille.
const olderEntry = (await manual(alice, manualBody({ startedAt: at(-25 * 60), endedAt: at(-24 * 60 - 30) }))).body;
const olderDay = zurichDay(new Date(olderEntry.startedAt).getTime());

await check('l’historique exclut la Journée en cours et le Chronomètre ; Journées Europe/Zurich, la plus récente d’abord', async () => {
  const timer = (await start(alice, { projectId: fixture.p5, activityId: fixture.meeting5 })).body.timer;
  const page = (await history(alice)).body;
  const days = page.days.map((d) => d.day);
  assert.ok(days.length >= 2);
  assert.equal(days[0], yesterdayDay);
  assert.ok(days.every((d) => d < todayDay));
  assert.deepEqual(days, [...days].sort().reverse());
  const entries = historyEntries(page);
  assert.ok(entries.every((e) => e.endedAt !== null && e.id !== timer.id));
  assert.ok(page.days.every((d) => d.groups.every((g) => g.entries.every((e) => zurichDay(new Date(e.startedAt).getTime()) === d.day))));
  assert.ok(entries.some((e) => e.id === olderEntry.id));
  await call(alice, 'POST', '/time-entries/timer/stop');
});
await check('l’historique ne renvoie que ses propres Imputations, Administrateur compris', async () => {
  for (const user of [alice, bruno, diane]) {
    assert.ok(historyEntries((await history(user)).body).every((e) => e.userId === user.sub), user.login);
  }
});
await check('curseur : la page commence à la Journée `before` incluse ; aujourd’hui, futur ou illisible valent hier', async () => {
  const fromOlder = (await history(alice, olderDay)).body;
  assert.equal(fromOlder.days[0].day, olderDay);
  assert.ok(historyEntries(fromOlder).some((e) => e.id === olderEntry.id));
  const reference = (await history(alice)).body;
  for (const before of [todayDay, '2999-01-01', 'n-importe-quoi', '2026-02-31']) {
    assert.deepEqual((await history(alice, before)).body, reference, before);
  }
  assert.deepEqual((await history(alice, '1970-01-01')).body, { days: [], nextCursor: null });
});

// Fin de section : Imputations et Chronomètres partent avec les Projets.
await call(diane, 'DELETE', `/projects/${fixture.p5}`);
await call(diane, 'DELETE', `/projects/${fixture.p6}`);

// alice ne reste affectée qu'à P1 pour les contrôles suivants.
await call(diane, 'DELETE', `/projects/${p4}/members/${alice.sub}`);

console.log('\nBarrière 2 : base de données (RLS, compte applicatif)');
await check('diane (Administrateur) voit tous les Utilisateurs, Projets, équipes et Imputations', async () => {
  await inDb(diane, async (q) => {
    const users = ids(await q(`SELECT id FROM app_user WHERE id = ANY($1)`, [[alice.sub, bruno.sub, chloe.sub, diane.sub]]));
    assert.equal(users.length, 4);
    assert.equal(ids(await q(`SELECT id FROM project WHERE id = ANY($1)`, [[data.p1, data.p2]])).length, 2);
    assert.equal((await q(`SELECT 1 FROM project_member WHERE project_id = $1`, [data.p1])).rowCount, 2);
    const entries = ids(await q(`SELECT id FROM time_entry WHERE project_id = ANY($1)`, [[data.p1, data.p2]]));
    assert.deepEqual(entries, [data.aliceEntry, data.brunoEntry, data.dianeEntry].sort());
  });
});
await check('alice ne voit que sa ligne Utilisateur, ses affectations et ses Imputations', async () => {
  await inDb(alice, async (q) => {
    assert.deepEqual(ids(await q(`SELECT id FROM app_user`)), [alice.sub]);
    // Toutes ses affectations, quels que soient les Projets déjà présents en base.
    assert.deepEqual([...new Set((await q(`SELECT user_id FROM project_member`)).rows.map((r) => r.user_id))], [alice.sub]);
    assert.deepEqual(ids(await q(`SELECT id FROM time_entry`)), [data.aliceEntry]);
  });
});
await check('alice (Affectée) voit P1 et son Activité, pas P2', async () => {
  await inDb(alice, async (q) => {
    assert.deepEqual(ids(await q(`SELECT id FROM project WHERE id = ANY($1)`, [[data.p1, data.p2]])), [data.p1]);
    assert.deepEqual(ids(await q(`SELECT id FROM activity WHERE id = ANY($1)`, [[data.a1, data.a2]])), [data.a1]);
  });
});
await check('chloé (non affectée, sans Imputation) ne voit ni Projet ni Activité', async () => {
  await inDb(chloe, async (q) => {
    assert.equal((await q(`SELECT 1 FROM project WHERE id = ANY($1)`, [[data.p1, data.p2]])).rowCount, 0);
    assert.equal((await q(`SELECT 1 FROM activity WHERE id = ANY($1)`, [[data.a1, data.a2]])).rowCount, 0);
  });
});
await check('bruno retiré de P1 voit encore P1 et l’Activité de ses Imputations, pas les autres', async () => {
  const other = await inDb(diane, async (q) => {
    await q(`DELETE FROM project_member WHERE project_id = $1 AND user_id = $2`, [data.p1, bruno.sub]);
    return (await q(`INSERT INTO activity (id, project_id, name, normalized_name) VALUES (gen_random_uuid(), $1, 'Sans bruno', 'sans bruno') RETURNING id`, [data.p1])).rows[0].id;
  }, { commit: true });
  try {
    await inDb(bruno, async (q) => {
      assert.deepEqual(ids(await q(`SELECT id FROM project WHERE id = ANY($1)`, [[data.p1, data.p2]])), [data.p1]);
      assert.deepEqual(ids(await q(`SELECT id FROM activity WHERE project_id = $1`, [data.p1])), [data.a1]);
      assert.deepEqual(ids(await q(`SELECT id FROM time_entry`)), [data.brunoEntry]);
    });
    assert.equal((await call(bruno, 'GET', `/projects/${data.p1}`)).status, 404);
  } finally {
    await inDb(diane, async (q) => {
      await q(`DELETE FROM activity WHERE id = $1`, [other]);
      await q(`INSERT INTO project_member (project_id, user_id) VALUES ($1, $2)`, [data.p1, bruno.sub]);
    }, { commit: true });
  }
});
await check('sans utilisateur courant : rien n’est visible', async () => {
  await inDb(nobody, async (q) => {
    for (const table of ['app_user', 'project', 'project_member', 'activity', 'time_entry']) {
      assert.equal((await q(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n, 0, table);
    }
  });
});
await check('un Utilisateur ne crée ni Projet ni affectation', async () => {
  await assert.rejects(query(alice, `INSERT INTO project (id, name) VALUES (gen_random_uuid(), 'Pirate')`), /row-level security/);
  await assert.rejects(
    query(alice, `INSERT INTO project_member (project_id, user_id) VALUES ($1, $2)`, [data.p2, alice.sub]),
    /row-level security/,
  );
});
await check('un Utilisateur, même Affecté, ne supprime ni Projet ni affectation, ne lit pas l’équipe des autres (sans effet)', async () => {
  assert.equal((await query(alice, `DELETE FROM project WHERE id = $1`, [data.p1])).rowCount, 0);
  assert.equal((await query(alice, `DELETE FROM project_member WHERE project_id = $1`, [data.p1])).rowCount, 0);
  assert.equal((await query(alice, `SELECT 1 FROM project_member WHERE project_id = $1 AND user_id <> $2`, [data.p1, alice.sub])).rowCount, 0);
  assert.equal((await query(alice, `DELETE FROM project_member WHERE project_id = $1 AND user_id = $2`, [data.p1, alice.sub])).rowCount, 0);
});
await check('l’Administrateur crée un Projet, affecte et retire en base', async () => {
  await inDb(diane, async (q) => {
    const p = (await q(`INSERT INTO project (id, name) VALUES (gen_random_uuid(), 'Admin en base') RETURNING id`)).rows[0].id;
    await q(`INSERT INTO project_member (project_id, user_id) VALUES ($1, $2)`, [p, chloe.sub]);
    assert.equal((await q(`DELETE FROM project_member WHERE project_id = $1 AND user_id = $2`, [p, chloe.sub])).rowCount, 1);
    assert.equal((await q(`DELETE FROM project WHERE id = $1`, [p])).rowCount, 1);
  });
});
await check('un nom de Projet fait d’espaces est refusé par la base', async () => {
  await assert.rejects(query(diane, `INSERT INTO project (id, name) VALUES (gen_random_uuid(), '   ')`), /check constraint/);
});
await check('un non-affecté ne crée pas d’Imputation ; personne n’en crée pour autrui', async () => {
  await assert.rejects(addEntry(chloe, data.p1, data.a1), /row-level security/);
  await assert.rejects(
    query(diane, `INSERT INTO time_entry (id, user_id, project_id, activity_id, started_at)
      VALUES (gen_random_uuid(), $1, $2, $3, now())`, [alice.sub, data.p1, data.a1]),
    /row-level security/,
  );
});
await check('alice ne modifie ni ne supprime l’Imputation de bruno (sans effet)', async () => {
  assert.equal((await query(alice, `UPDATE time_entry SET ended_at = now() WHERE id = $1`, [data.brunoEntry])).rowCount, 0);
  assert.equal((await query(alice, `DELETE FROM time_entry WHERE id = $1`, [data.brunoEntry])).rowCount, 0);
});
await check('diane (Administrateur) modifie l’Imputation de bruno', async () => {
  assert.equal((await query(diane, `UPDATE time_entry SET ended_at = now() WHERE id = $1`, [data.brunoEntry])).rowCount, 1);
});
await check('personne ne renomme un Projet (aucune politique de modification)', async () => {
  assert.equal((await query(diane, `UPDATE project SET name = 'Renommé' WHERE id = $1`, [data.p1])).rowCount, 0);
});
await check('l’Administrateur ne supprime pas sa propre ligne Utilisateur', async () => {
  assert.equal((await query(diane, `DELETE FROM app_user WHERE id = $1`, [diane.sub])).rowCount, 0);
});

console.log('\nInvariants garantis par la base');
const startTimer = (user, projectId, activityId) =>
  query(user, `INSERT INTO time_entry (id, user_id, project_id, activity_id, started_at) VALUES (gen_random_uuid(), $1, $2, $3, now())`,
    [user.sub, projectId, activityId]);
await check('un seul Chronomètre par Utilisateur', async () => {
  await assert.rejects(
    inDb(alice, async (q) => {
      for (let i = 0; i < 2; i++) {
        await q(`INSERT INTO time_entry (id, user_id, project_id, activity_id, started_at) VALUES (gen_random_uuid(), $1, $2, $3, now())`,
          [alice.sub, data.p1, data.a1]);
      }
    }),
    /time_entry_one_running_timer/,
  );
  await startTimer(alice, data.p1, data.a1); // un seul : accepté
});
await check('fin ≥ début', async () => {
  await assert.rejects(
    query(alice, `UPDATE time_entry SET ended_at = started_at - interval '1 second' WHERE id = $1`, [data.aliceEntry]),
    /time_entry_end_after_start/,
  );
  await assert.rejects(
    query(alice, `INSERT INTO time_entry (id, user_id, project_id, activity_id, started_at, ended_at)
      VALUES (gen_random_uuid(), $1, $2, $3, now(), now() - interval '1 minute')`, [alice.sub, data.p1, data.a1]),
    /time_entry_end_after_start/,
  );
});
await check('unicité normalisée des Activités dans un Projet ; même nom permis dans un autre Projet', async () => {
  await assert.rejects(
    query(diane, `INSERT INTO activity (id, project_id, name, normalized_name) VALUES (gen_random_uuid(), $1, 'REUNION', 'reunion')`, [data.p1]),
    /activity_project_name_key/,
  );
  await query(diane, `INSERT INTO activity (id, project_id, name, normalized_name) VALUES (gen_random_uuid(), $1, 'Réunion', 'reunion')`, [data.p2]);
});
await check('l’Activité d’une Imputation appartient à son Projet (clé composite)', async () => {
  await assert.rejects(
    query(diane, `INSERT INTO time_entry (id, user_id, project_id, activity_id, started_at, ended_at)
      VALUES (gen_random_uuid(), $1, $2, $3, now(), now())`, [diane.sub, data.p1, data.a2]),
    /foreign key/,
  );
});
await check('Auteur, Projet et Activité d’une Imputation ne changent jamais', async () => {
  await assert.rejects(query(diane, `UPDATE time_entry SET user_id = $2 WHERE id = $1`, [data.aliceEntry, diane.sub]), /ne changent jamais/);
  await assert.rejects(query(diane, `UPDATE time_entry SET project_id = $2 WHERE id = $1`, [data.dianeEntry, data.p1]), /ne changent jamais/);
  await assert.rejects(
    inDb(diane, async (q) => {
      const other = (await q(`INSERT INTO activity (id, project_id, name, normalized_name) VALUES (gen_random_uuid(), $1, 'Autre', 'autre') RETURNING id`, [data.p1])).rows[0].id;
      await q(`UPDATE time_entry SET activity_id = $2 WHERE id = $1`, [data.aliceEntry, other]);
    }),
    /ne changent jamais/,
  );
});
await check('un Projet naît sans « propriétaire » (équipe vide)', async () => {
  assert.equal((await query(diane, `SELECT 1 FROM project_member WHERE project_id = $1`, [data.p2])).rowCount, 0);
});

console.log('\nCascades de suppression (Administrateur)');
await check('Activité → ses Imputations', async () => {
  await inDb(diane, async (q) => {
    await q(`DELETE FROM activity WHERE id = $1`, [data.a2]);
    assert.equal((await q(`SELECT 1 FROM time_entry WHERE id = $1`, [data.dianeEntry])).rowCount, 0);
  });
});
await check('Projet → Activités, Imputations (Chronomètre compris) et équipe', async () => {
  await inDb(diane, async (q) => {
    await q(`INSERT INTO time_entry (id, user_id, project_id, activity_id, started_at) VALUES (gen_random_uuid(), $1, $2, $3, now())`,
      [diane.sub, data.p1, data.a1]);
    await q(`DELETE FROM project WHERE id = $1`, [data.p1]);
    assert.equal((await q(`SELECT 1 FROM activity WHERE project_id = $1`, [data.p1])).rowCount, 0);
    assert.equal((await q(`SELECT 1 FROM time_entry WHERE project_id = $1`, [data.p1])).rowCount, 0);
    assert.equal((await q(`SELECT 1 FROM project_member WHERE project_id = $1`, [data.p1])).rowCount, 0);
  });
});
await check('Utilisateur → ses Imputations et ses affectations', async () => {
  const ghost = { sub: `test-cascade-${RUN}`, isAdmin: false };
  await inDb(diane, async (q) => {
    await q(`INSERT INTO app_user (id, login) VALUES ($1, $1)`, [ghost.sub]);
    await q(`INSERT INTO project_member (project_id, user_id) VALUES ($1, $2)`, [data.p1, ghost.sub]);
  }, { commit: true });
  await addEntry(ghost, data.p1, data.a1);
  await inDb(diane, async (q) => {
    await q(`DELETE FROM app_user WHERE id = $1`, [ghost.sub]);
    assert.equal((await q(`SELECT 1 FROM time_entry WHERE user_id = $1`, [ghost.sub])).rowCount, 0);
    assert.equal((await q(`SELECT 1 FROM project_member WHERE user_id = $1`, [ghost.sub])).rowCount, 0);
  });
});

console.log('\nRetrait d’une équipe : Chronomètre et Imputations (API et base, #20)');
// P7 : alice, bruno et diane affectés ; P8 : bruno affecté.
const removal = {};
removal.p7 = (await call(diane, 'POST', '/projects', { name: `P7 ${RUN}` })).body.id;
removal.p8 = (await call(diane, 'POST', '/projects', { name: `P8 ${RUN}` })).body.id;
removal.a7 = (await call(diane, 'POST', `/projects/${removal.p7}/activities`, { name: 'Recette' })).body.id;
removal.a8 = (await call(diane, 'POST', `/projects/${removal.p8}/activities`, { name: 'Recette' })).body.id;
for (const u of [alice, bruno, diane]) await call(diane, 'PUT', `/projects/${removal.p7}/members/${u.sub}`);
await call(diane, 'PUT', `/projects/${removal.p8}/members/${bruno.sub}`);
for (const u of [alice, bruno, diane]) await call(u, 'POST', '/time-entries/timer/stop');
removal.aliceEarlier = await addEntry(alice, removal.p7, removal.a7); // terminée, avant son retrait
const endOf = async (id) => (await query(diane, `SELECT ended_at FROM time_entry WHERE id = $1`, [id])).rows[0].ended_at;

await check('retrait d’un non-Administrateur : son Chronomètre sur ce Projet s’arrête à l’instant du retrait', async () => {
  const timer = (await start(alice, { projectId: removal.p7, activityId: removal.a7 })).body.timer;
  removal.aliceTimer = timer.id;
  const before = Date.now();
  assert.equal((await call(diane, 'DELETE', `/projects/${removal.p7}/members/${alice.sub}`)).status, 204);
  const after = Date.now();
  const ended = await endOf(timer.id);
  assert.ok(ended, 'Chronomètre toujours en cours');
  assert.ok(ended.getTime() >= before - 1000 && ended.getTime() <= after + 1000, `fin ${ended.toISOString()} hors de l’instant du retrait`);
  assert.deepEqual((await call(alice, 'GET', '/time-entries/timer')).body, { timer: null });
});
await check('aucune notification au retrait : « Arrêter » répond ensuite AUCUN_CHRONO_ACTIF', async () => {
  const r = await call(alice, 'POST', '/time-entries/timer/stop');
  assert.equal(r.status, 404);
  assert.equal(r.body.code, 'AUCUN_CHRONO_ACTIF');
});
await check('alice retirée voit, modifie et supprime son Imputation sur P7, avec les noms du Projet et de l’Activité', async () => {
  const entry = (await call(alice, 'GET', '/time-entries/today')).body.find((e) => e.id === removal.aliceTimer);
  assert.ok(entry, 'Imputation absente de la Journée');
  assert.deepEqual({ projectName: entry.projectName, activityName: entry.activityName }, { projectName: `P7 ${RUN}`, activityName: 'Recette' });
  assert.equal((await edit(alice, removal.aliceTimer, { startedAt: entry.startedAt })).status, 200);
  assert.equal((await call(alice, 'DELETE', `/time-entries/${removal.aliceTimer}`)).status, 204);
});
await check('alice retirée : P7 quitte la recherche combinée ; démarrer, Relancer ou renommer y répond 404 PROJET_INTROUVABLE', async () => {
  assert.deepEqual(await searchIn(alice, 'recette', [removal.p7]), []);
  assert.equal((await start(alice, { projectId: removal.p7, activityId: removal.a7 })).body.code, 'PROJET_INTROUVABLE');
  assert.equal((await start(alice, { projectId: removal.p7, newActivityName: 'Nouvelle' })).body.code, 'PROJET_INTROUVABLE');
  const rename = await call(alice, 'PATCH', `/projects/${removal.p7}/activities/${removal.a7}`, { name: 'Renommée' });
  assert.equal(rename.status, 404);
  assert.equal(rename.body.code, 'PROJET_INTROUVABLE');
  const typed = await manual(alice, manualBody({ projectId: removal.p7, activityId: removal.a7 }));
  assert.equal(typed.status, 404);
  assert.equal(typed.body.code, 'PROJET_INTROUVABLE');
});
await check('en base, alice retirée modifie et supprime son Imputation sur P7, mais n’en crée plus', async () => {
  const entry = removal.aliceEarlier;
  await inDb(alice, async (q) => {
    assert.equal((await q(`UPDATE time_entry SET ended_at = ended_at + interval '1 minute' WHERE id = $1`, [entry])).rowCount, 1);
    assert.equal((await q(`DELETE FROM time_entry WHERE id = $1`, [entry])).rowCount, 1);
  });
  await assert.rejects(
    query(alice, `INSERT INTO time_entry (id, user_id, project_id, activity_id, started_at) VALUES (gen_random_uuid(), $1, $2, $3, now())`,
      [alice.sub, removal.p7, removal.a7]),
    /row-level security/,
  );
});
await check('le retrait n’arrête pas un Chronomètre sur un autre Projet', async () => {
  const timer = (await start(bruno, { projectId: removal.p8, activityId: removal.a8 })).body.timer;
  assert.equal((await call(diane, 'DELETE', `/projects/${removal.p7}/members/${bruno.sub}`)).status, 204);
  assert.equal(await endOf(timer.id), null);
  await call(bruno, 'POST', '/time-entries/timer/stop');
});
await check('retrait d’un Administrateur : son Chronomètre continue', async () => {
  const timer = (await start(diane, { projectId: removal.p7, activityId: removal.a7 })).body.timer;
  assert.equal((await call(diane, 'DELETE', `/projects/${removal.p7}/members/${diane.sub}`)).status, 204);
  assert.equal(await endOf(timer.id), null);
  assert.equal((await call(diane, 'GET', '/time-entries/timer')).body.timer.id, timer.id);
  await call(diane, 'POST', '/time-entries/timer/stop');
});
await check('retirer un Utilisateur qui n’est pas dans l’équipe est sans effet', async () => {
  assert.equal((await call(diane, 'DELETE', `/projects/${removal.p7}/members/${alice.sub}`)).status, 204);
});
await check('en base, l’Administrateur retire et arrête le Chronomètre d’autrui dans une même transaction', async () => {
  await call(diane, 'PUT', `/projects/${removal.p7}/members/${alice.sub}`);
  const timer = (await start(alice, { projectId: removal.p7, activityId: removal.a7 })).body.timer;
  await inDb(diane, async (q) => {
    assert.equal((await q(`DELETE FROM project_member WHERE project_id = $1 AND user_id = $2`, [removal.p7, alice.sub])).rowCount, 1);
    assert.equal((await q(`UPDATE time_entry SET ended_at = now() WHERE id = $1 AND ended_at IS NULL`, [timer.id])).rowCount, 1);
  });
  removal.aliceTimer = timer.id;
});
await check('en base, un Utilisateur ne retire personne ni n’arrête le Chronomètre d’autrui (sans effet)', async () => {
  assert.equal((await query(bruno, `DELETE FROM project_member WHERE project_id = $1 AND user_id = $2`, [removal.p7, alice.sub])).rowCount, 0);
  assert.equal((await query(bruno, `UPDATE time_entry SET ended_at = now() WHERE id = $1`, [removal.aliceTimer])).rowCount, 0);
  await call(alice, 'POST', '/time-entries/timer/stop');
});

console.log('\nMes projets (API, ADR-0016, #21)');
// P9 : alice, bruno et diane affectés ; P10 : alice affectée, diane non.
const mine = {};
mine.p9 = (await call(diane, 'POST', '/projects', { name: `P9 ${RUN}` })).body.id;
mine.p10 = (await call(diane, 'POST', '/projects', { name: `P10 ${RUN}` })).body.id;
mine.dev9 = (await call(diane, 'POST', `/projects/${mine.p9}/activities`, { name: 'Développement' })).body.id;
mine.doc9 = (await call(diane, 'POST', `/projects/${mine.p9}/activities`, { name: 'Documentation' })).body.id;
mine.unused9 = (await call(diane, 'POST', `/projects/${mine.p9}/activities`, { name: 'Jamais imputée' })).body.id;
mine.support10 = (await call(diane, 'POST', `/projects/${mine.p10}/activities`, { name: 'Support' })).body.id;
for (const u of [alice, bruno, diane]) await call(diane, 'PUT', `/projects/${mine.p9}/members/${u.sub}`);
await call(diane, 'PUT', `/projects/${mine.p10}/members/${alice.sub}`);
const typed = (user, projectId, activityId, startedAt, endedAt) => manual(user, { projectId, activityId, startedAt, endedAt });
// alice : P10 commence le plus tôt ; dans P9, Documentation avant Développement.
await typed(alice, mine.p9, mine.dev9, '2025-01-07T09:00:00Z', '2025-01-07T10:00:00Z');
await typed(alice, mine.p9, mine.doc9, '2025-01-06T09:00:00Z', '2025-01-06T09:30:00Z');
await typed(alice, mine.p9, mine.dev9, '2025-01-08T09:00:00Z', '2025-01-08T09:00:42Z');
await typed(alice, mine.p10, mine.support10, '2025-01-05T09:00:00Z', '2025-01-05T09:45:00Z');
await typed(bruno, mine.p9, mine.dev9, '2025-01-05T08:00:00Z', '2025-01-05T12:00:00Z');
const myProjects = async (user) => {
  const r = await call(user, 'GET', '/reports/projects');
  assert.equal(r.status, 200);
  return r.body;
};
const ours = (summary) => summary.projects.filter((p) => p.projectId === mine.p9 || p.projectId === mine.p10);

await check('alice voit ses Projets affectés, ordonnés par leur première Imputation, avec leurs Activités et Durées totales', async () => {
  await start(alice, { projectId: mine.p9, activityId: mine.unused9 }); // Chronomètre : non compté
  try {
    const summary = await myProjects(alice);
    assert.deepEqual(ours(summary), [
      {
        projectId: mine.p10,
        projectName: `P10 ${RUN}`,
        totalSeconds: 2700,
        activities: [{ activityId: mine.support10, activityName: 'Support', totalSeconds: 2700 }],
      },
      {
        projectId: mine.p9,
        projectName: `P9 ${RUN}`,
        totalSeconds: 5442,
        activities: [
          { activityId: mine.doc9, activityName: 'Documentation', totalSeconds: 1800 },
          { activityId: mine.dev9, activityName: 'Développement', totalSeconds: 3642 },
        ],
      },
    ]);
    assert.equal(summary.totalSeconds, summary.projects.reduce((sum, p) => sum + p.totalSeconds, 0));
  } finally {
    await call(alice, 'POST', '/time-entries/timer/stop');
  }
});
await check('les Imputations de bruno, sur le même Projet, ne comptent pas pour alice ; bruno ne voit que les siennes', async () => {
  assert.deepEqual(ours(await myProjects(bruno)).map((p) => [p.projectId, p.totalSeconds]), [[mine.p9, 14400]]);
});
await check('diane (Administrateur) : ni les Projets où elle n’est pas affectée, ni les Imputations des autres', async () => {
  // Sa saisie sur P10, où elle n’est pas affectée, n’apparaît pas ; sur P9, seule la sienne compte.
  await typed(diane, mine.p10, mine.support10, '2025-01-04T09:00:00Z', '2025-01-04T10:00:00Z');
  assert.deepEqual(ours(await myProjects(diane)), []);
  await typed(diane, mine.p9, mine.dev9, '2025-01-04T09:00:00Z', '2025-01-04T09:15:00Z');
  assert.deepEqual(ours(await myProjects(diane)).map((p) => [p.projectId, p.totalSeconds]), [[mine.p9, 900]]);
});
await check('alice retirée de P10 : P10 disparaît de Mes projets, avec ses Activités et sa Durée totale', async () => {
  const before = await myProjects(alice);
  assert.equal((await call(diane, 'DELETE', `/projects/${mine.p10}/members/${alice.sub}`)).status, 204);
  const after = await myProjects(alice);
  assert.deepEqual(ours(after).map((p) => p.projectId), [mine.p9]);
  assert.equal(after.totalSeconds, before.totalSeconds - 2700);
});
await check('chloé (non affectée) ne voit aucun de ces Projets', async () => {
  assert.deepEqual(ours(await myProjects(chloe)), []);
});

console.log('\nRapport et synthèse journalière (API et base, #22)');
// P11 : alice et bruno affectés (Projet partagé) ; P12 : alice affectée, puis retirée.
const rep = {};
rep.p11 = (await call(diane, 'POST', '/projects', { name: `P11 ${RUN}` })).body.id;
rep.p12 = (await call(diane, 'POST', '/projects', { name: `P12 ${RUN}` })).body.id;
rep.dev11 = (await call(diane, 'POST', `/projects/${rep.p11}/activities`, { name: 'Développement' })).body.id;
rep.doc11 = (await call(diane, 'POST', `/projects/${rep.p11}/activities`, { name: 'Documentation' })).body.id;
rep.support12 = (await call(diane, 'POST', `/projects/${rep.p12}/activities`, { name: 'Support' })).body.id;
for (const u of [alice, bruno]) await call(diane, 'PUT', `/projects/${rep.p11}/members/${u.sub}`);
await call(diane, 'PUT', `/projects/${rep.p12}/members/${alice.sub}`);
// Juin 2024 (heure d'été, UTC+2) : 22:30 UTC le 03.06 est 00:30 le 04.06 à Zurich.
await typed(alice, rep.p11, rep.doc11, '2024-06-03T12:00:00Z', '2024-06-03T12:30:00Z');
await typed(alice, rep.p11, rep.dev11, '2024-06-03T07:00:00Z', '2024-06-03T08:00:00Z');
await typed(alice, rep.p11, rep.dev11, '2024-06-03T14:00:00Z', '2024-06-03T14:00:42Z');
await typed(alice, rep.p12, rep.support12, '2024-06-03T22:30:00Z', '2024-06-03T23:15:00Z');
await typed(bruno, rep.p11, rep.dev11, '2024-06-03T06:00:00Z', '2024-06-03T10:00:00Z');
await call(diane, 'DELETE', `/projects/${rep.p12}/members/${alice.sub}`);
const reportOf = async (user, from, to) => {
  const r = await call(user, 'GET', `/reports/range?${new URLSearchParams({ from, to })}`);
  assert.equal(r.status, 200);
  return r.body;
};
// Lignes des seuls Projets de ce contrôle : [Journée, Login, Activité, Durée].
const reportLines = (report) =>
  report.days.flatMap((d) =>
    d.lines
      .filter((l) => l.projectId === rep.p11 || l.projectId === rep.p12)
      .map((l) => [d.day, l.userLogin, l.activityName, l.totalSeconds]),
  );

await check('alice : ses seules Imputations, Projet partagé et Projet quitté compris, par Journée suisse et dans l’ordre E23', async () => {
  const report = await reportOf(alice, '2024-06-03', '2024-06-04');
  assert.deepEqual(reportLines(report), [
    ['2024-06-03', 'alice', 'Développement', 3642],
    ['2024-06-03', 'alice', 'Documentation', 1800],
    ['2024-06-04', 'alice', 'Support', 2700],
  ]);
  assert.ok(report.days.every((d) => d.lines.every((l) => l.userId === alice.sub)));
  for (const d of report.days) assert.equal(d.totalSeconds, d.lines.reduce((sum, l) => sum + l.totalSeconds, 0));
  assert.equal(report.totalSeconds, report.days.reduce((sum, d) => sum + d.totalSeconds, 0));
});
await check('en base, alice ne lit pas les Imputations de bruno sur le Projet partagé', async () => {
  const r = await query(alice, `SELECT DISTINCT user_id FROM time_entry WHERE project_id = $1`, [rep.p11]);
  assert.deepEqual(r.rows.map((row) => row.user_id), [alice.sub]);
});
await check('bruno ne voit que les siennes ; chloé (non affectée) ne voit rien', async () => {
  assert.deepEqual(reportLines(await reportOf(bruno, '2024-06-01', '2024-06-30')), [['2024-06-03', 'bruno', 'Développement', 14400]]);
  assert.deepEqual(reportLines(await reportOf(chloe, '2024-06-01', '2024-06-30')), []);
});
await check('diane (Administrateur) voit les Imputations de tout le monde', async () => {
  assert.deepEqual(reportLines(await reportOf(diane, '2024-06-03', '2024-06-03')), [
    ['2024-06-03', 'bruno', 'Développement', 14400],
    ['2024-06-03', 'alice', 'Développement', 3642],
    ['2024-06-03', 'alice', 'Documentation', 1800],
  ]);
});
await check('une plage sans « Du », sans « Au » ou illisible est refusée avec PLAGE_DATES_REQUISE ; une plage inversée est vide', async () => {
  for (const path of ['/reports/range?to=2024-06-30', '/reports/range?from=2024-06-01', '/reports/range?from=03.06.2024&to=2024-06-30']) {
    const r = await call(alice, 'GET', path);
    assert.equal(r.status, 400, path);
    assert.equal(r.body.code, 'PLAGE_DATES_REQUISE', path);
  }
  const inverted = await reportOf(diane, '2024-06-30', '2024-06-01');
  assert.deepEqual(inverted.days, []);
  assert.equal(inverted.totalSeconds, 0);
});
await check('le Chronomètre en cours est exclu du Rapport et de la synthèse journalière', async () => {
  await start(alice, { projectId: rep.p11, activityId: rep.doc11 });
  try {
    const today = (await call(alice, 'GET', '/reports/daily')).body;
    assert.equal(today.day, zurichDay(Date.now()));
    assert.ok(!today.lines.some((l) => l.projectId === rep.p11));
    assert.deepEqual(reportLines(await reportOf(alice, today.day, today.day)), []);
  } finally {
    await call(alice, 'POST', '/time-entries/timer/stop');
  }
});
await check('synthèse journalière : ses Imputations de la Journée suisse, par Projet et Activité, Administrateur compris', async () => {
  const summary = (await call(alice, 'GET', '/reports/daily?day=2024-06-03')).body;
  assert.deepEqual(summary.lines.filter((l) => l.projectId === rep.p11).map((l) => [l.activityName, l.totalSeconds]), [
    ['Développement', 3642],
    ['Documentation', 1800],
  ]);
  assert.ok(!summary.lines.some((l) => l.projectId === rep.p12)); // 00:30 le lendemain
  const forDiane = (await call(diane, 'GET', '/reports/daily?day=2024-06-03')).body;
  assert.ok(!forDiane.lines.some((l) => l.projectId === rep.p11)); // pas celles des autres
});

console.log('\nExport Excel du Rapport (API, #23)');
const exportOf = async (user, query) => {
  const response = await fetch(`${API}/reports/range/export?${new URLSearchParams(query)}`, {
    headers: { Authorization: `Bearer ${user.token}` },
  });
  return { status: response.status, headers: response.headers, body: Buffer.from(await response.arrayBuffer()) };
};
// Feuille « Rapport » : [en-têtes, lignes des seuls Projets de ce contrôle].
const sheetOf = async (body) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(body);
  const sheet = workbook.getWorksheet('Rapport');
  assert.ok(sheet, 'feuille « Rapport » absente');
  const rows = [];
  sheet.eachRow((row) => rows.push(row.values.slice(1)));
  const ours = new Set([`P11 ${RUN}`, `P12 ${RUN}`]);
  return [rows[0], rows.slice(1).filter((row) => ours.has(row[1]))];
};

await check('alice : fichier rapport-<du>-<au>.xlsx, feuille « Rapport », en-têtes français, ses seules lignes en minutes arrondies et hh:mm:ss', async () => {
  const r = await exportOf(alice, { from: '2024-06-03', to: '2024-06-04' });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(r.headers.get('content-disposition'), 'attachment; filename="rapport-2024-06-03-2024-06-04.xlsx"');
  const [headers, rows] = await sheetOf(r.body);
  assert.deepEqual(headers, ['Utilisateur', 'Projet', 'Activité', 'Journée', 'Durée (minutes)', 'Durée (hh:mm:ss)']);
  assert.deepEqual(rows, [
    ['alice', `P11 ${RUN}`, 'Développement', '2024-06-03', 61, '01:00:42'],
    ['alice', `P11 ${RUN}`, 'Documentation', '2024-06-03', 30, '00:30:00'],
    ['alice', `P12 ${RUN}`, 'Support', '2024-06-04', 45, '00:45:00'],
  ]);
});
await check('diane (Administrateur) exporte tout le monde ; une seule Journée : rapport-<du>.xlsx', async () => {
  const r = await exportOf(diane, { from: '2024-06-03', to: '2024-06-03' });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-disposition'), 'attachment; filename="rapport-2024-06-03.xlsx"');
  const [, rows] = await sheetOf(r.body);
  assert.deepEqual(rows.map((row) => [row[0], row[2], row[4]]), [
    ['bruno', 'Développement', 240],
    ['alice', 'Développement', 61],
    ['alice', 'Documentation', 30],
  ]);
});
await check('chloé (non affectée) exporte une feuille sans ces lignes ; sans « Du » : PLAGE_DATES_REQUISE', async () => {
  const [, rows] = await sheetOf((await exportOf(chloe, { from: '2024-06-01', to: '2024-06-30' })).body);
  assert.deepEqual(rows, []);
  const refused = await exportOf(alice, { to: '2024-06-30' });
  assert.equal(refused.status, 400);
  assert.equal(JSON.parse(refused.body.toString()).code, 'PLAGE_DATES_REQUISE');
});

console.log('\nÉcran Utilisateurs : Annuaire des comptes (Keycloak) et base');
// Accès direct à l'Annuaire par le compte de service, pour observer Keycloak.
const KEYCLOAK_ADMIN =
  env.KEYCLOAK_ADMIN_URL || env.OIDC_JWKS_URL.replace(/\/realms\/([^/]+)\/protocol\/openid-connect\/certs$/, '/admin/realms/$1');
const keycloak = async (method, path, body) => {
  const tokenResponse = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env.KEYCLOAK_ADMIN_CLIENT_ID || 'api-admin', client_secret: env.KEYCLOAK_ADMIN_CLIENT_SECRET }),
  });
  const { access_token } = await tokenResponse.json();
  const response = await fetch(`${KEYCLOAK_ADMIN}${path}`, {
    method,
    headers: { Authorization: `Bearer ${access_token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
};
const passwordGrant = (username, password) =>
  fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: 'tests', username, password }),
  });
const usersList = async () => (await call(diane, 'GET', '/users')).body;
const isAdminInKeycloak = async (id) =>
  ((await keycloak('GET', `/users/${id}/role-mappings/realm`)).body ?? []).some((role) => role.name === 'administrateur');
// Comptes créés par ce contrôle, supprimés de Keycloak et de la base au nettoyage.
const createdAccounts = [];
const created = (r) => {
  if (r.status === 201) createdAccounts.push(r.body.id);
  return r;
};

await check('alice (non Administrateur) : 403 ACCES_REFUSE sur la liste, la création, l’Email, le rôle, la lecture d’impact et la suppression', async () => {
  const attempts = [
    ['GET', '/users'],
    ['POST', '/users', { login: `pirate-${RUN}`, email: `pirate-${RUN}@exemple.test` }],
    ['PUT', `/users/${bruno.sub}/email`, { email: `pirate-${RUN}@exemple.test` }],
    ['GET', `/users/${bruno.sub}/impact`],
    ['DELETE', `/users/${bruno.sub}`],
    ['PUT', `/users/${bruno.sub}/administrator`],
    ['DELETE', `/users/${diane.sub}/administrator`],
  ];
  for (const [method, path, body] of attempts) {
    const r = await call(alice, method, path, body);
    assert.equal(r.status, 403, `${method} ${path}`);
    assert.equal(r.body.code, 'ACCES_REFUSE', `${method} ${path}`);
  }
  assert.equal((await keycloak('GET', `/users?username=pirate-${RUN}&exact=true`)).body.length, 0);
  assert.equal((await keycloak('GET', `/users/${bruno.sub}`)).body.email, 'bruno@exemple.test');
  assert.equal(await isAdminInKeycloak(bruno.sub), false);
  assert.equal(await isAdminInKeycloak(diane.sub), true);
});
await check('diane liste les Utilisateurs par Login : Login, Nom, Email et rôle lu dans l’Annuaire', async () => {
  const { users } = await usersList();
  assert.deepEqual(users.find((u) => u.login === 'alice'), { id: alice.sub, login: 'alice', name: 'Alice', email: 'alice@exemple.test', isAdmin: false, acceptance: null });
  assert.equal(users.find((u) => u.login === 'diane').isAdmin, true);
  const logins = users.map((u) => u.login);
  assert.deepEqual(logins, [...logins].sort());
});
await check('le badge « sans Projet » compte les Utilisateurs sans aucune affectation', async () => {
  const expected = await query(diane, `SELECT count(*)::int AS n FROM app_user u WHERE NOT EXISTS (SELECT 1 FROM project_member m WHERE m.user_id = u.id)`);
  assert.equal((await usersList()).withoutProject, expected.rows[0].n);
});
await check('création : Login ou Email manquant → 400 LOGIN_REQUIS / EMAIL_REQUIS ; rien n’est créé', async () => {
  const noLogin = created(await call(diane, 'POST', '/users', { login: '  ', email: `vide-${RUN}@exemple.test` }));
  assert.equal(noLogin.status, 400);
  assert.equal(noLogin.body.code, 'LOGIN_REQUIS');
  const noEmail = created(await call(diane, 'POST', '/users', { login: `vide-${RUN}`, email: '' }));
  assert.equal(noEmail.status, 400);
  assert.equal(noEmail.body.code, 'EMAIL_REQUIS');
  assert.equal((await keycloak('GET', `/users?username=vide-${RUN}&exact=true`)).body.length, 0);
});
await check('création : Login existant → 409 LOGIN_EXISTANT ; Email existant, casse ignorée → 409 EMAIL_EXISTANT', async () => {
  const sameLogin = created(await call(diane, 'POST', '/users', { login: 'alice', email: `autre-${RUN}@exemple.test` }));
  assert.equal(sameLogin.status, 409);
  assert.equal(sameLogin.body.code, 'LOGIN_EXISTANT');
  const sameEmail = created(await call(diane, 'POST', '/users', { login: `double-${RUN}`, email: 'ALICE@Exemple.test' }));
  assert.equal(sameEmail.status, 409);
  assert.equal(sameEmail.body.code, 'EMAIL_EXISTANT');
  assert.equal((await keycloak('GET', `/users?username=double-${RUN}&exact=true`)).body.length, 0);
});

await check('création refusée par le format de l’Annuaire → 400 LOGIN_INVALIDE / EMAIL_INVALIDE / NOM_INVALIDE ; rien n’est créé', async () => {
  const refusals = [
    [{ login: 'ab', email: `court-${RUN}@exemple.test` }, 'LOGIN_INVALIDE'],
    [{ login: `es pace-${RUN}`, email: `espace-${RUN}@exemple.test` }, 'LOGIN_INVALIDE'],
    [{ login: `format-${RUN}`, email: 'pas-un-email' }, 'EMAIL_INVALIDE'],
    [{ login: `format-${RUN}`, name: 'A<b>', email: `format-${RUN}@exemple.test` }, 'NOM_INVALIDE'],
    [{ login: `format-${RUN}`, name: 'x'.repeat(300), email: `format-${RUN}@exemple.test` }, 'NOM_INVALIDE'],
  ];
  for (const [body, code] of refusals) {
    const r = created(await call(diane, 'POST', '/users', body));
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.code, code, JSON.stringify(body));
  }
  assert.equal((await keycloak('GET', `/users?username=format-${RUN}&exact=true`)).body.length, 0);
  assert.equal((await keycloak('GET', `/users?email=court-${RUN}@exemple.test&exact=true`)).body.length, 0);
});
const newcomer = {};
// P13 : Projet où le nouvel Utilisateur est affecté, avec son Activité A13.
const p13 = (await call(diane, 'POST', '/projects', { name: `P13 ${RUN}` })).body.id;
const a13 = (await inDb(diane, (q) => q(`INSERT INTO activity (id, project_id, name, normalized_name) VALUES (gen_random_uuid(), $1, 'Accueil', 'accueil') RETURNING id`, [p13]), { commit: true })).rows[0].id;
await check('diane crée un Utilisateur : compte Keycloak et ligne Utilisateur aussitôt, non Administrateur', async () => {
  const before = (await usersList()).withoutProject;
  const r = created(await call(diane, 'POST', '/users', { login: `nouveau-${RUN}`, name: ' Nouveau ', email: `Nouveau-${RUN}@Exemple.test` }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  newcomer.id = r.body.id;
  assert.deepEqual(r.body, { id: newcomer.id, login: `nouveau-${RUN}`, name: 'Nouveau', email: `nouveau-${RUN}@exemple.test`, isAdmin: false, acceptance: null });
  const row = await query(diane, `SELECT login, email, display_name FROM app_user WHERE id = $1`, [newcomer.id]);
  assert.deepEqual(row.rows, [{ login: `nouveau-${RUN}`, email: `nouveau-${RUN}@exemple.test`, display_name: 'Nouveau' }]);
  const listed = await usersList();
  assert.equal(listed.users.find((u) => u.id === newcomer.id).isAdmin, false);
  assert.equal(listed.withoutProject, before + 1);
});
await check('le nouvel Utilisateur se connecte avec Login = mot de passe, mais doit d’abord le changer', async () => {
  const wrong = await passwordGrant(`nouveau-${RUN}`, 'mauvais');
  assert.equal((await wrong.json()).error_description, 'Invalid user credentials');
  const first = await passwordGrant(`nouveau-${RUN}`, `nouveau-${RUN}`);
  assert.equal(first.status, 400);
  assert.equal((await first.json()).error_description, 'Account is not fully set up');
  assert.deepEqual((await keycloak('GET', `/users/${newcomer.id}`)).body.requiredActions, ['UPDATE_PASSWORD']);
});
await check('un Login saisi en majuscules est enregistré en minuscules, et le mot de passe temporaire reste égal au Login', async () => {
  const r = created(await call(diane, 'POST', '/users', { login: `Majuscule-${RUN}`, email: `majuscule-${RUN}@exemple.test` }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.login, `majuscule-${RUN}`);
  const first = await passwordGrant(`majuscule-${RUN}`, `majuscule-${RUN}`);
  assert.equal((await first.json()).error_description, 'Account is not fully set up');
});
await check('il est affectable avant sa première connexion ; le badge « sans Projet » le retire', async () => {
  const before = (await usersList()).withoutProject;
  assert.equal((await call(diane, 'PUT', `/projects/${p13}/members/${newcomer.id}`)).status, 204);
  assert.ok((await call(diane, 'GET', `/projects/${p13}/members`)).body.some((m) => m.id === newcomer.id));
  assert.equal((await usersList()).withoutProject, before - 1);
});
await check('créé avec la case « Administrateur » cochée, il est Administrateur', async () => {
  const r = created(await call(diane, 'POST', '/users', { login: `chef-${RUN}`, email: `chef-${RUN}@exemple.test`, isAdmin: true }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.isAdmin, true);
  assert.equal(r.body.name, null);
  assert.equal((await usersList()).users.find((u) => u.id === r.body.id).isAdmin, true);
  const roles = (await keycloak('GET', `/users/${r.body.id}/role-mappings/realm`)).body.map((role) => role.name);
  assert.ok(roles.includes('administrateur'));
});
await check('modification de l’Email : répercutée dans Keycloak et en base (en minuscules), Nom conservé', async () => {
  const r = await call(diane, 'PUT', `/users/${newcomer.id}/email`, { email: ` Change-${RUN}@Exemple.test ` });
  assert.equal(r.status, 204, JSON.stringify(r.body));
  const account = (await keycloak('GET', `/users/${newcomer.id}`)).body;
  assert.equal(account.email, `change-${RUN}@exemple.test`);
  assert.equal(account.firstName, 'Nouveau');
  const row = await query(diane, `SELECT email FROM app_user WHERE id = $1`, [newcomer.id]);
  assert.equal(row.rows[0].email, `change-${RUN}@exemple.test`);
});
await check('modification de l’Email : mêmes refus qu’à la création, rien n’est modifié ; Utilisateur inconnu → 404', async () => {
  const empty = await call(diane, 'PUT', `/users/${newcomer.id}/email`, { email: ' ' });
  assert.equal(empty.status, 400);
  assert.equal(empty.body.code, 'EMAIL_REQUIS');
  const taken = await call(diane, 'PUT', `/users/${newcomer.id}/email`, { email: 'BRUNO@exemple.test' });
  assert.equal(taken.status, 409);
  assert.equal(taken.body.code, 'EMAIL_EXISTANT');
  const malformed = await call(diane, 'PUT', `/users/${newcomer.id}/email`, { email: 'pas-un-email' });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.code, 'EMAIL_INVALIDE');
  assert.equal((await keycloak('GET', `/users/${newcomer.id}`)).body.email, `change-${RUN}@exemple.test`);
  assert.equal((await query(diane, `SELECT email FROM app_user WHERE id = $1`, [newcomer.id])).rows[0].email, `change-${RUN}@exemple.test`);
  assert.equal((await call(diane, 'PUT', `/users/inconnu-${RUN}/email`, { email: `x-${RUN}@exemple.test` })).body.code, 'UTILISATEUR_INTROUVABLE');
});
await check('un échec de la base après la création Keycloak ne laisse pas de compte orphelin', async () => {
  // Une ligne Utilisateur sans compte Keycloak occupe le Login : Keycloak accepte
  // le compte, la base le refuse, et le compte doit être retiré de Keycloak.
  await inDb(diane, (q) => q(`INSERT INTO app_user (id, login) VALUES ($1, $1)`, [`fantome-${RUN}`]), { commit: true });
  try {
    const r = created(await call(diane, 'POST', '/users', { login: `fantome-${RUN}`, email: `fantome-${RUN}@exemple.test` }));
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'LOGIN_EXISTANT');
    assert.equal((await keycloak('GET', `/users?username=fantome-${RUN}&exact=true`)).body.length, 0);
  } finally {
    await inDb(diane, (q) => q(`DELETE FROM app_user WHERE id = $1`, [`fantome-${RUN}`]), { commit: true });
  }
});
await check('suppression : la lecture d’impact chiffre ses Imputations, Chronomètre compris', async () => {
  const actor = { sub: newcomer.id, isAdmin: false };
  await addEntry(actor, p13, a13);
  await inDb(actor, (q) => q(`INSERT INTO time_entry (id, user_id, project_id, activity_id, started_at) VALUES (gen_random_uuid(), $1, $2, $3, now())`, [newcomer.id, p13, a13]), { commit: true });
  assert.deepEqual((await call(diane, 'GET', `/users/${newcomer.id}/impact`)).body, { timeEntries: 2 });
  assert.equal((await call(diane, 'GET', `/users/inconnu-${RUN}/impact`)).body.code, 'UTILISATEUR_INTROUVABLE');
});
await check('suppression : sessions fermées, compte Keycloak supprimé, Imputations et affectations emportées', async () => {
  // Mot de passe définitif posé directement dans Keycloak pour ouvrir une session.
  await keycloak('PUT', `/users/${newcomer.id}/reset-password`, { type: 'password', value: 'Test1234!', temporary: false });
  await keycloak('PUT', `/users/${newcomer.id}`, { ...(await keycloak('GET', `/users/${newcomer.id}`)).body, requiredActions: [] });
  const session = await passwordGrant(`nouveau-${RUN}`, 'Test1234!');
  assert.equal(session.status, 200, 'session impossible à ouvrir');
  const { refresh_token } = await session.json();

  assert.equal((await call(diane, 'DELETE', `/users/${newcomer.id}`)).status, 204);

  const refresh = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: 'tests', refresh_token }),
  });
  assert.equal(refresh.status, 400, 'la session aurait dû être fermée');
  assert.equal((await keycloak('GET', `/users/${newcomer.id}`)).status, 404);
  const left = await query(diane, `SELECT (SELECT count(*) FROM app_user WHERE id = $1)::int AS users,
    (SELECT count(*) FROM time_entry WHERE user_id = $1)::int AS entries,
    (SELECT count(*) FROM project_member WHERE user_id = $1)::int AS members`, [newcomer.id]);
  assert.deepEqual(left.rows[0], { users: 0, entries: 0, members: 0 });
  assert.equal((await call(diane, 'DELETE', `/users/${newcomer.id}`)).body.code, 'UTILISATEUR_INTROUVABLE');
});
await check('suppression rejouable : un compte déjà absent de Keycloak n’empêche pas de supprimer l’Utilisateur', async () => {
  const r = created(await call(diane, 'POST', '/users', { login: `rejeu-${RUN}`, email: `rejeu-${RUN}@exemple.test` }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal((await keycloak('DELETE', `/users/${r.body.id}`)).status, 204);
  assert.equal((await call(diane, 'DELETE', `/users/${r.body.id}`)).status, 204);
  assert.equal((await query(diane, `SELECT id FROM app_user WHERE id = $1`, [r.body.id])).rowCount, 0);
});

console.log('\nRôle Administrateur, Compte initial et actions sur soi (ADR-0018, ADR-0025)');
/** Crée un compte de test au mot de passe définitif Test1234!, et s'y connecte. */
async function accountWithSession(prefix, isAdmin) {
  const r = created(await call(diane, 'POST', '/users', { login: `${prefix}-${RUN}`, email: `${prefix}-${RUN}@exemple.test`, isAdmin }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  await keycloak('PUT', `/users/${r.body.id}/reset-password`, { type: 'password', value: 'Test1234!', temporary: false });
  await keycloak('PUT', `/users/${r.body.id}`, { ...(await keycloak('GET', `/users/${r.body.id}`)).body, requiredActions: [] });
  return { ...(await login(`${prefix}-${RUN}`, isAdmin)), id: r.body.id };
}
/** Ouvre une session et renvoie son jeton de rafraîchissement. */
async function openSession(username) {
  const response = await passwordGrant(username, 'Test1234!');
  assert.equal(response.status, 200, `session de ${username} impossible`);
  return (await response.json()).refresh_token;
}
async function stillOpen(refresh_token) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: 'tests', refresh_token }),
  });
  return response.status === 200;
}

const promoted = {};
await check('diane rend un Utilisateur administrateur : badge, Keycloak, droits au jeton suivant ; rejouable', async () => {
  Object.assign(promoted, await accountWithSession('promu', false));
  assert.equal((await call(promoted, 'GET', '/users')).status, 403);
  assert.equal((await call(diane, 'PUT', `/users/${promoted.id}/administrator`)).status, 204);
  assert.equal((await call(diane, 'PUT', `/users/${promoted.id}/administrator`)).status, 204, 'attribution rejouable');
  assert.equal((await usersList()).users.find((u) => u.id === promoted.id).isAdmin, true);
  assert.equal(await isAdminInKeycloak(promoted.id), true);
  assert.equal((await call(await login(`promu-${RUN}`, true), 'GET', '/users')).status, 200);
});
await check('diane lui retire le rôle : badge, Keycloak, sessions fermées aussitôt, plus de droits d’Administrateur', async () => {
  const session = await openSession(`promu-${RUN}`);
  assert.equal((await call(diane, 'DELETE', `/users/${promoted.id}/administrator`)).status, 204);
  assert.equal(await stillOpen(session), false, 'la session aurait dû être fermée');
  assert.equal((await usersList()).users.find((u) => u.id === promoted.id).isAdmin, false);
  assert.equal(await isAdminInKeycloak(promoted.id), false);
  const r = await call(await login(`promu-${RUN}`), 'GET', '/users');
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'ACCES_REFUSE');
  assert.equal((await call(diane, 'DELETE', `/users/${promoted.id}/administrator`)).status, 204, 'retrait rejouable');
});
// P14 : Projet où « retro » n'est pas affecté ; P15 : Projet où il l'est.
const demotion = {};
demotion.p14 = (await call(diane, 'POST', '/projects', { name: `P14 ${RUN}` })).body.id;
demotion.p15 = (await call(diane, 'POST', '/projects', { name: `P15 ${RUN}` })).body.id;
demotion.a14 = (await call(diane, 'POST', `/projects/${demotion.p14}/activities`, { name: 'Veille' })).body.id;
demotion.a15 = (await call(diane, 'POST', `/projects/${demotion.p15}/activities`, { name: 'Veille' })).body.id;
await check('retrait du rôle : son Chronomètre sur un Projet où il n’est pas affecté s’arrête à l’instant du retrait', async () => {
  const retro = await accountWithSession('retro', true);
  demotion.retro = retro;
  const timer = (await start(retro, { projectId: demotion.p14, activityId: demotion.a14 })).body.timer;
  assert.ok(timer, 'Chronomètre impossible à démarrer');
  const before = Date.now();
  assert.equal((await call(diane, 'DELETE', `/users/${retro.id}/administrator`)).status, 204);
  const after = Date.now();
  const { ended_at } = (await query(diane, `SELECT ended_at FROM time_entry WHERE id = $1`, [timer.id])).rows[0];
  assert.ok(ended_at, 'Chronomètre toujours en cours');
  assert.ok(ended_at.getTime() >= before - 1000 && ended_at.getTime() <= after + 1000, `fin ${ended_at.toISOString()} hors de l’instant du retrait`);
});
await check('retrait du rôle : son Chronomètre sur un Projet où il est affecté continue', async () => {
  const { retro } = demotion;
  assert.equal((await call(diane, 'PUT', `/users/${retro.id}/administrator`)).status, 204);
  assert.equal((await call(diane, 'PUT', `/projects/${demotion.p15}/members/${retro.id}`)).status, 204);
  Object.assign(retro, await login(`retro-${RUN}`, true));
  const timer = (await start(retro, { projectId: demotion.p15, activityId: demotion.a15 })).body.timer;
  assert.ok(timer, 'Chronomètre impossible à démarrer');
  assert.equal((await call(diane, 'DELETE', `/users/${retro.id}/administrator`)).status, 204);
  const { ended_at } = (await query(diane, `SELECT ended_at FROM time_entry WHERE id = $1`, [timer.id])).rows[0];
  assert.equal(ended_at, null, 'Chronomètre arrêté à tort');
});
await check('rôle d’un Utilisateur inconnu → 404 UTILISATEUR_INTROUVABLE', async () => {
  for (const method of ['PUT', 'DELETE']) {
    const r = await call(diane, method, `/users/inconnu-${RUN}/administrator`);
    assert.equal(r.status, 404, method);
    assert.equal(r.body.code, 'UTILISATEUR_INTROUVABLE', method);
  }
});

// Compte initial (ADR-0025) : contrôlé sur le vrai compte « admin », qui n'est
// plus protégé. Pour s'y connecter, son mot de passe devient Test1234! le temps
// des contrôles. À la fin, il est remis dans son état d'installation (mot de
// passe « admin » temporaire, rôle Administrateur), sous un nouvel identifiant
// puisqu'il a été supprimé : ses données locales éventuelles sont perdues.
const INITIAL_LOGIN = 'admin';
const findInitial = async () => (await keycloak('GET', `/users?username=${INITIAL_LOGIN}&exact=true`)).body?.[0];
/** Compte initial tel qu'à l'installation ; recréé s'il a été supprimé. */
async function restoreInitialAccount() {
  if (!(await findInitial())) {
    assert.equal((await keycloak('POST', '/users', { username: INITIAL_LOGIN, enabled: true })).status, 201);
  }
  const account = await findInitial();
  await keycloak('PUT', `/users/${account.id}/reset-password`, { type: 'password', value: 'admin', temporary: true });
  if (!(await isAdminInKeycloak(account.id))) {
    const role = (await keycloak('GET', '/roles/administrateur')).body;
    await keycloak('POST', `/users/${account.id}/role-mappings/realm`, [{ id: role.id, name: role.name }]);
  }
  return account;
}
/** Se connecte au Compte initial Administrateur ; sa ligne Utilisateur est créée au passage. */
async function initialWithSession() {
  const { id } = await restoreInitialAccount();
  await keycloak('PUT', `/users/${id}/reset-password`, { type: 'password', value: 'Test1234!', temporary: false });
  await keycloak('PUT', `/users/${id}`, { ...(await keycloak('GET', `/users/${id}`)).body, requiredActions: [] });
  const initial = { ...(await login(INITIAL_LOGIN, true)), id };
  assert.equal((await call(initial, 'GET', '/projects')).status, 200);
  return initial;
}

await check('Compte initial : il ne peut ni se retirer son rôle ni se supprimer → 403 UTILISATEUR_ACTION_SUR_SOI_INTERDITE', async () => {
  const initial = await initialWithSession();
  for (const path of [`/users/${initial.id}/administrator`, `/users/${initial.id}`]) {
    const r = await call(initial, 'DELETE', path);
    assert.equal(r.status, 403, path);
    assert.equal(r.body.code, 'UTILISATEUR_ACTION_SUR_SOI_INTERDITE', path);
  }
  assert.equal(await isAdminInKeycloak(initial.id), true);
  assert.equal((await query(diane, `SELECT id FROM app_user WHERE id = $1`, [initial.id])).rowCount, 1);
});
await check('diane retire le rôle au Compte initial : badge, Keycloak, sessions fermées aussitôt', async () => {
  const initial = await initialWithSession();
  const session = await openSession(INITIAL_LOGIN);
  assert.equal((await call(diane, 'DELETE', `/users/${initial.id}/administrator`)).status, 204);
  assert.equal(await stillOpen(session), false, 'la session aurait dû être fermée');
  assert.equal((await usersList()).users.find((u) => u.id === initial.id).isAdmin, false);
  assert.equal(await isAdminInKeycloak(initial.id), false);
});
await check('Compte initial : modifier son Email reste permis', async () => {
  const initial = await initialWithSession();
  assert.equal((await call(diane, 'PUT', `/users/${initial.id}/email`, { email: `initial-${RUN}@exemple.test` })).status, 204);
  assert.equal((await keycloak('GET', `/users/${initial.id}`)).body.email, `initial-${RUN}@exemple.test`);
});
await check('diane supprime le Compte initial : le compte Keycloak et la ligne Utilisateur disparaissent', async () => {
  const initial = await initialWithSession();
  assert.equal((await call(diane, 'DELETE', `/users/${initial.id}`)).status, 204);
  assert.equal((await keycloak('GET', `/users/${initial.id}`)).status, 404);
  assert.equal((await query(diane, `SELECT id FROM app_user WHERE id = $1`, [initial.id])).rowCount, 0);
});
await check('Compte initial remis dans son état d’installation (mot de passe « admin » temporaire, Administrateur)', async () => {
  const { id } = await restoreInitialAccount();
  assert.deepEqual((await keycloak('GET', `/users/${id}`)).body.requiredActions, ['UPDATE_PASSWORD']);
  assert.equal(await isAdminInKeycloak(id), true);
  // Bon mot de passe, mais temporaire : Keycloak exige d'abord de le changer.
  const r = await passwordGrant(INITIAL_LOGIN, 'admin');
  assert.equal((await r.json()).error_description, 'Account is not fully set up');
});

await check('un Administrateur ne peut ni se retirer son rôle ni se supprimer → 403 UTILISATEUR_ACTION_SUR_SOI_INTERDITE', async () => {
  for (const path of [`/users/${diane.sub}/administrator`, `/users/${diane.sub}`]) {
    const r = await call(diane, 'DELETE', path);
    assert.equal(r.status, 403, path);
    assert.equal(r.body.code, 'UTILISATEUR_ACTION_SUR_SOI_INTERDITE', path);
  }
  assert.equal(await isAdminInKeycloak(diane.sub), true);
  assert.equal((await query(diane, `SELECT id FROM app_user WHERE id = $1`, [diane.sub])).rowCount, 1);
});
await check('un autre Administrateur y parvient : « second » est refusé sur lui-même, diane lui retire son rôle puis le supprime', async () => {
  const second = await accountWithSession('second', true);
  for (const path of [`/users/${second.id}/administrator`, `/users/${second.id}`]) {
    assert.equal((await call(second, 'DELETE', path)).body.code, 'UTILISATEUR_ACTION_SUR_SOI_INTERDITE', path);
  }
  assert.equal((await call(diane, 'DELETE', `/users/${second.id}/administrator`)).status, 204);
  assert.equal(await isAdminInKeycloak(second.id), false);
  assert.equal((await call(diane, 'DELETE', `/users/${second.id}`)).status, 204);
  assert.equal((await keycloak('GET', `/users/${second.id}`)).status, 404);
});

console.log('\nDemande d’accès à la première connexion Google (ADR-0028)');
/**
 * Compte tel que le crée la première connexion Google dans Keycloak (lien au
 * fournisseur « google », Login = Email), avec le mot de passe Test1234! pour
 * obtenir un jeton dans ce contrôle. Ne passe pas par l'API.
 */
async function googleAccount(prefix) {
  const email = `${prefix}-${RUN}@gmail.test`;
  const r = await keycloak('POST', '/users', { username: email, email, emailVerified: true, firstName: 'Nom Google', enabled: true });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const { id } = (await keycloak('GET', `/users?username=${encodeURIComponent(email)}&exact=true`)).body[0];
  createdAccounts.push(id);
  const link = await keycloak('POST', `/users/${id}/federated-identity/google`, { identityProvider: 'google', userId: `g-${prefix}-${RUN}`, userName: email });
  assert.equal(link.status, 204, `lien Google : ${JSON.stringify(link.body)}`);
  await keycloak('PUT', `/users/${id}/reset-password`, { type: 'password', value: 'Test1234!', temporary: false });
  return { ...(await login(email)), id, email };
}
const requestOf = async (id) =>
  (await query(diane, `SELECT email, display_name, provider, status, created_at FROM access_request WHERE account_id = $1`, [id])).rows[0];
const userRowOf = async (id) => (await query(diane, `SELECT id FROM app_user WHERE id = $1`, [id])).rowCount;

const applicant = {};
await check('un nouveau compte Google crée une Demande d’accès en attente (Email, Nom, fournisseur, date), aucun Utilisateur', async () => {
  Object.assign(applicant, await googleAccount('candidat'));
  const before = Date.now();
  const r = await call(applicant, 'GET', '/admission');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { status: 'pending', email: applicant.email });
  const request = await requestOf(applicant.id);
  assert.ok(request, 'aucune Demande d’accès');
  assert.equal(request.email, applicant.email);
  assert.equal(request.display_name, 'Nom Google');
  assert.equal(request.provider, 'google');
  assert.equal(request.status, 'pending');
  assert.ok(Math.abs(request.created_at.getTime() - before) < 60_000);
  assert.equal(await userRowOf(applicant.id), 0);
  assert.ok(!(await usersList()).users.some((u) => u.id === applicant.id), 'absent de l’écran Utilisateurs');
});
await check('la personne en attente : toute autre route lui répond 403 ACCES_REFUSE, sans créer d’Utilisateur', async () => {
  const attempts = [
    ['GET', '/projects'],
    ['POST', '/projects', { name: `Pirate ${RUN}` }],
    ['GET', `/projects/${data.p1}`],
    ['GET', '/activities/search?q=a'],
    ['GET', '/time-entries/timer'],
    ['POST', '/time-entries/timer/start', { projectId: data.p1, activityId: data.a1 }],
    ['GET', '/time-entries/today'],
    ['GET', '/time-entries/history'],
    ['GET', '/reports/projects'],
    ['GET', '/reports/daily'],
    ['GET', '/users'],
    ['POST', '/users', { login: `pirate-${RUN}`, email: `pirate-${RUN}@exemple.test` }],
    ['PATCH', `/time-entries/${data.aliceEntry}`, { endedAt: new Date().toISOString() }],
    ['DELETE', `/time-entries/${data.aliceEntry}`],
    ['DELETE', `/projects/${data.p2}`],
  ];
  for (const [method, path, body] of attempts) {
    const r = await call(applicant, method, path, body);
    assert.equal(r.status, 403, `${method} ${path}`);
    assert.equal(r.body.code, 'ACCES_REFUSE', `${method} ${path}`);
  }
  Object.assign(applicant, await login(applicant.email));
  assert.equal((await call(applicant, 'GET', '/projects')).status, 403, 'nouveau jeton : toujours en attente');
  assert.equal((await call(applicant, 'GET', '/admission')).body.status, 'pending');
  assert.equal(await userRowOf(applicant.id), 0);
  assert.equal((await query(diane, `SELECT count(*)::int AS n FROM access_request WHERE account_id = $1`, [applicant.id])).rows[0].n, 1);
});
await check('un Utilisateur admis lit son admission : « admitted »', async () => {
  assert.deepEqual((await call(alice, 'GET', '/admission')).body, { status: 'admitted' });
});
await check('création d’un Utilisateur avec l’Email d’une Demande d’accès, casse ignorée → 409 EMAIL_EXISTANT ; rien n’est créé', async () => {
  const r = created(await call(diane, 'POST', '/users', { login: `reserve-${RUN}`, email: applicant.email.toUpperCase() }));
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'EMAIL_EXISTANT');
  assert.equal((await keycloak('GET', `/users?username=reserve-${RUN}&exact=true`)).body.length, 0);
});
await check('Keycloak refuse tout autre compte avec l’Email d’une Demande d’accès (409)', async () => {
  const r = await keycloak('POST', '/users', { username: `autre-compte-${RUN}`, email: applicant.email, enabled: true });
  assert.equal(r.status, 409);
  assert.equal((await keycloak('GET', `/users?username=autre-compte-${RUN}&exact=true`)).body.length, 0);
});
await check('RLS : la personne en attente ne voit que sa demande ; alice n’en voit aucune ; l’Administrateur les voit', async () => {
  const pendingActor = { sub: applicant.id, isAdmin: false };
  assert.deepEqual((await query(pendingActor, `SELECT account_id FROM access_request`)).rows.map((r) => r.account_id), [applicant.id]);
  assert.equal((await query(alice, `SELECT account_id FROM access_request`)).rowCount, 0);
  assert.equal((await query(nobody, `SELECT account_id FROM access_request`)).rowCount, 0);
  assert.equal((await query(diane, `SELECT account_id FROM access_request WHERE account_id = $1`, [applicant.id])).rowCount, 1);
});
await check('RLS : nul ne crée la demande d’un autre, ni un Utilisateur la sienne ; la personne en attente ne supprime pas la sienne', async () => {
  await assert.rejects(
    query(alice, `INSERT INTO access_request (account_id, email, provider) VALUES ($1, $2, 'google')`, [alice.sub, `alice-${RUN}@gmail.test`]),
    /row-level security/,
  );
  await assert.rejects(
    query(alice, `INSERT INTO access_request (account_id, email, provider) VALUES ($1, $2, 'google')`, [`autre-${RUN}`, `autre-${RUN}@gmail.test`]),
    /row-level security/,
  );
  await assert.rejects(
    query(diane, `INSERT INTO access_request (account_id, email, provider) VALUES ($1, $2, 'google')`, [`autre-${RUN}`, `autre-${RUN}@gmail.test`]),
    /row-level security/,
  );
  const r = await query({ sub: applicant.id, isAdmin: false }, `DELETE FROM access_request WHERE account_id = $1`, [applicant.id]);
  assert.equal(r.rowCount, 0);
});

const veteran = {};
await check('un Utilisateur né de Google avant la mise en service continue d’entrer normalement, sans Demande d’accès', async () => {
  Object.assign(veteran, await googleAccount('ancien'));
  // Sa ligne Utilisateur existait avant l'ADR-0028.
  await inDb(diane, (q) => q(`INSERT INTO app_user (id, login, email) VALUES ($1, $2, $2)`, [veteran.id, veteran.email]), { commit: true });
  assert.equal((await call(veteran, 'GET', '/projects')).status, 200);
  assert.deepEqual((await call(veteran, 'GET', '/admission')).body, { status: 'admitted' });
  assert.equal(await requestOf(veteran.id), undefined);
});
await check('un Utilisateur né de Google supprimé qui se reconnecte crée une nouvelle Demande d’accès', async () => {
  assert.equal((await call(diane, 'DELETE', `/users/${veteran.id}`)).status, 204);
  // Reconnexion par Google : Keycloak recrée le compte, sous un nouvel identifiant.
  const back = await googleAccount('ancien');
  assert.notEqual(back.id, veteran.id);
  assert.deepEqual((await call(back, 'GET', '/admission')).body, { status: 'pending', email: back.email });
  assert.equal((await call(back, 'GET', '/projects')).status, 403);
  assert.equal((await requestOf(back.id)).status, 'pending');
  assert.equal(await userRowOf(back.id), 0);
});

console.log('\nDécision de l’Administrateur sur les Demandes d’accès (ADR-0028, #32)');
const requestsList = async (user = diane) => call(user, 'GET', '/access-requests');
const recent = (iso) => Math.abs(new Date(iso).getTime() - Date.now()) < 60_000;

await check('alice (non Administrateur) : 403 ACCES_REFUSE sur la liste, l’acceptation, le refus et la suppression ; la demande est intacte', async () => {
  const attempts = [
    ['GET', '/access-requests'],
    ['POST', `/access-requests/${applicant.id}/accept`],
    ['POST', `/access-requests/${applicant.id}/refuse`],
    ['DELETE', `/access-requests/${applicant.id}`],
  ];
  for (const [method, path] of attempts) {
    const r = await call(alice, method, path);
    assert.equal(r.status, 403, `${method} ${path}`);
    assert.equal(r.body.code, 'ACCES_REFUSE', `${method} ${path}`);
  }
  assert.equal((await requestOf(applicant.id)).status, 'pending');
  assert.equal(await userRowOf(applicant.id), 0);
});
await check('la personne en attente : 403 sur la liste et sur toute décision, y compris la sienne', async () => {
  for (const [method, path] of [['GET', '/access-requests'], ['POST', `/access-requests/${applicant.id}/accept`]]) {
    assert.equal((await call(applicant, method, path)).status, 403, `${method} ${path}`);
  }
  assert.equal(await userRowOf(applicant.id), 0);
});
await check('diane voit les demandes en attente (Email, Nom, fournisseur, date) ; le compteur est leur nombre', async () => {
  const r = await requestsList();
  assert.equal(r.status, 200);
  const mine = r.body.pending.find((request) => request.id === applicant.id);
  assert.deepEqual({ ...mine, createdAt: undefined }, {
    id: applicant.id, email: applicant.email, name: 'Nom Google', provider: 'google', createdAt: undefined, refusal: null,
  });
  assert.ok(recent(mine.createdAt));
  const expected = await query(diane, `SELECT count(*)::int AS n FROM access_request WHERE status = 'pending'`);
  assert.equal(r.body.pending.length, expected.rows[0].n);
  assert.ok(!r.body.refused.some((request) => request.id === applicant.id));
});
await check('demande inconnue : 404 DEMANDE_ACCES_INTROUVABLE pour l’acceptation, le refus et la suppression', async () => {
  for (const [method, path] of [['POST', '/accept'], ['POST', '/refuse'], ['DELETE', '']]) {
    const r = await call(diane, method, `/access-requests/inconnue-${RUN}${path}`);
    assert.equal(r.status, 404, `${method} ${path}`);
    assert.equal(r.body.code, 'DEMANDE_ACCES_INTROUVABLE');
  }
});
await check('une demande en attente ne se supprime pas : 409 DEMANDE_ACCES_NON_REFUSEE, compte et demande intacts', async () => {
  const r = await call(diane, 'DELETE', `/access-requests/${applicant.id}`);
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'DEMANDE_ACCES_NON_REFUSEE');
  assert.equal((await requestOf(applicant.id)).status, 'pending');
  assert.equal((await keycloak('GET', `/users/${applicant.id}`)).status, 200);
});
await check('RLS : alice ne refuse pas une demande ; nul ne remet une demande refusée en attente', async () => {
  const r = await query(alice, `UPDATE access_request SET status = 'refused', decided_by = $1, decided_by_name = 'Alice', decided_at = now() WHERE account_id = $2`, [alice.sub, applicant.id]);
  assert.equal(r.rowCount, 0);
  const own = await query({ sub: applicant.id, isAdmin: false }, `UPDATE access_request SET status = 'refused', decided_by = $1, decided_by_name = 'x', decided_at = now() WHERE account_id = $1`, [applicant.id]);
  assert.equal(own.rowCount, 0);
  // Dans une transaction annulée : diane refuse, puis tente de remettre en attente.
  await assert.rejects(
    inDb(diane, async (q) => {
      await q(`UPDATE access_request SET status = 'refused', decided_by = $1, decided_by_name = 'Diane', decided_at = now() WHERE account_id = $2`, [diane.sub, applicant.id]);
      await q(`UPDATE access_request SET status = 'pending', decided_by = NULL, decided_by_name = NULL, decided_at = NULL WHERE account_id = $1`, [applicant.id]);
    }),
    /row-level security/,
  );
  assert.equal((await requestOf(applicant.id)).status, 'pending');
});

await check('diane refuse : la demande passe dans les refusées, avec diane pour auteur et la date', async () => {
  assert.equal((await call(diane, 'POST', `/access-requests/${applicant.id}/refuse`)).status, 204);
  const { body } = await requestsList();
  assert.ok(!body.pending.some((request) => request.id === applicant.id));
  const refused = body.refused.find((request) => request.id === applicant.id);
  assert.equal(refused.refusal.by, 'Diane');
  assert.ok(recent(refused.refusal.at));
  assert.equal(await userRowOf(applicant.id), 0);
});
await check('la personne refusée voit le refus à chaque connexion ; toute autre route lui répond 403', async () => {
  for (let i = 0; i < 2; i++) {
    Object.assign(applicant, await login(applicant.email));
    assert.deepEqual((await call(applicant, 'GET', '/admission')).body, { status: 'refused', email: applicant.email });
    const r = await call(applicant, 'GET', '/projects');
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'ACCES_REFUSE');
  }
  assert.equal(await userRowOf(applicant.id), 0);
});
await check('une demande refusée ne se refuse pas une seconde fois : 409 DEMANDE_ACCES_DEJA_REFUSEE, auteur inchangé', async () => {
  const r = await call(diane, 'POST', `/access-requests/${applicant.id}/refuse`);
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'DEMANDE_ACCES_DEJA_REFUSEE');
  const row = (await query(diane, `SELECT status, decided_by FROM access_request WHERE account_id = $1`, [applicant.id])).rows[0];
  assert.deepEqual(row, { status: 'refused', decided_by: diane.sub });
});
await check('une demande refusée garde son Email réservé : création d’Utilisateur → 409 EMAIL_EXISTANT', async () => {
  const r = created(await call(diane, 'POST', '/users', { login: `reserve2-${RUN}`, email: applicant.email }));
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'EMAIL_EXISTANT');
});

await check('diane accepte la demande refusée : Utilisateur de rôle utilisateur, sans Projet, avec l’auteur et la date', async () => {
  const withoutProjectBefore = (await usersList()).withoutProject;
  assert.equal((await call(diane, 'POST', `/access-requests/${applicant.id}/accept`)).status, 204);
  assert.equal(await requestOf(applicant.id), undefined);
  const { users, withoutProject } = await usersList();
  const user = users.find((u) => u.id === applicant.id);
  assert.deepEqual({ ...user, acceptance: { ...user.acceptance, at: undefined } }, {
    id: applicant.id, login: applicant.email, name: 'Nom Google', email: applicant.email, isAdmin: false,
    acceptance: { by: 'Diane', at: undefined },
  });
  assert.ok(recent(user.acceptance.at));
  assert.equal(withoutProject, withoutProjectBefore + 1);
  assert.equal(await isAdminInKeycloak(applicant.id), false);
  assert.equal((await query(diane, `SELECT count(*)::int AS n FROM project_member WHERE user_id = $1`, [applicant.id])).rows[0].n, 0);
  const { body } = await requestsList();
  assert.ok(![...body.pending, ...body.refused].some((request) => request.id === applicant.id));
});
await check('à sa connexion suivante, la personne acceptée entre dans l’application, sans Projet', async () => {
  Object.assign(applicant, await login(applicant.email));
  assert.deepEqual((await call(applicant, 'GET', '/admission')).body, { status: 'admitted' });
  const r = await call(applicant, 'GET', '/projects');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, []);
  assert.equal((await call(applicant, 'GET', '/time-entries/today')).status, 200);
});
await check('une demande déjà acceptée : 404 DEMANDE_ACCES_INTROUVABLE si un Administrateur décide ensuite', async () => {
  const r = await call(diane, 'POST', `/access-requests/${applicant.id}/refuse`);
  assert.equal(r.status, 404);
  assert.equal(r.body.code, 'DEMANDE_ACCES_INTROUVABLE');
});

await check('diane accepte directement une demande en attente ; la personne entre à sa connexion suivante', async () => {
  const direct = await googleAccount('direct');
  assert.equal((await call(direct, 'GET', '/admission')).body.status, 'pending');
  assert.equal((await call(diane, 'POST', `/access-requests/${direct.id}/accept`)).status, 204);
  Object.assign(direct, await login(direct.email));
  assert.equal((await call(direct, 'GET', '/projects')).status, 200);
});
const rejected = {};
await check('diane supprime une demande refusée : demande et compte de connexion disparaissent', async () => {
  Object.assign(rejected, await googleAccount('rejete'));
  await call(rejected, 'GET', '/admission');
  assert.equal((await call(diane, 'POST', `/access-requests/${rejected.id}/refuse`)).status, 204);
  assert.equal((await call(diane, 'DELETE', `/access-requests/${rejected.id}`)).status, 204);
  assert.equal(await requestOf(rejected.id), undefined);
  assert.equal((await keycloak('GET', `/users/${rejected.id}`)).status, 404);
  const { body } = await requestsList();
  assert.ok(![...body.pending, ...body.refused].some((request) => request.id === rejected.id));
});
await check('après suppression, son jeton encore valide reçoit 401 : la personne ne devient pas Utilisateur', async () => {
  for (const path of ['/admission', '/projects']) assert.equal((await call(rejected, 'GET', path)).status, 401, path);
  assert.equal(await userRowOf(rejected.id), 0);
  assert.equal(await requestOf(rejected.id), undefined);
});
await check('RLS : l’acceptation ne s’écrit que par l’Administrateur, à la création, puis ne change plus', async () => {
  await assert.rejects(
    query(applicant, `UPDATE app_user SET accepted_by_name = 'Faux' WHERE id = $1`, [applicant.id]),
    /acceptation non modifiable/,
  );
  await assert.rejects(
    query(diane, `UPDATE app_user SET accepted_at = now() - interval '1 day' WHERE id = $1`, [applicant.id]),
    /acceptation non modifiable/,
  );
  const ghost = { sub: `fantome-${RUN}`, isAdmin: false };
  await assert.rejects(
    query(ghost, `INSERT INTO app_user (id, login, accepted_by, accepted_by_name, accepted_at) VALUES ($1, $1, $1, 'Moi', now())`, [ghost.sub]),
    /acceptation réservée/,
  );
  assert.equal((await query(diane, `SELECT accepted_by FROM app_user WHERE id = $1`, [applicant.id])).rows[0].accepted_by, diane.sub);
});
await check('après suppression, l’Email est de nouveau libre : diane crée un Utilisateur avec cet Email', async () => {
  const r = created(await call(diane, 'POST', '/users', { login: `libre-${RUN}`, email: rejected.email }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.email, rejected.email);
  assert.equal(r.body.acceptance, null);
});

console.log('\nNettoyage');
await check('suppression des Projets et Utilisateurs de test', async () => {
  await inDb(diane, async (q) => {
    await q(`DELETE FROM app_user WHERE id = $1 OR id = ANY($2)`, [`test-cascade-${RUN}`, createdAccounts]);
    await q(`DELETE FROM access_request WHERE account_id = ANY($1)`, [createdAccounts]);
    await q(`DELETE FROM project WHERE id = ANY($1) OR name = $2`, [[data.p1, data.p2, p3, p4, fixture.p5, fixture.p6, removal.p7, removal.p8, mine.p9, mine.p10, rep.p11, rep.p12, p13, demotion.p14, demotion.p15].filter(Boolean), 'L'.repeat(1000)]);
  }, { commit: true });
  for (const id of createdAccounts) await keycloak('DELETE', `/users/${id}`);
});

console.log(failures ? `\n${failures} échec(s).` : '\nTous les contrôles sont passés.');
process.exit(failures ? 1 : 0);
