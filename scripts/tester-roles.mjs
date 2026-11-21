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
  assert.equal(r.body.status, 'actif');
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
  assert.equal(r.body.status, 'actif');
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
  const logins = r.body.map((u) => u.login);
  for (const l of ['alice', 'bruno', 'chloe', 'diane']) assert.ok(logins.includes(l), l);
  assert.deepEqual(r.body.find((u) => u.login === 'alice'), { id: alice.sub, login: 'alice' });
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

console.log('\nNettoyage');
await check('suppression des Projets et Utilisateurs de test', async () => {
  await inDb(diane, async (q) => {
    await q(`DELETE FROM app_user WHERE id = $1`, [`test-cascade-${RUN}`]);
    await q(`DELETE FROM project WHERE id = ANY($1) OR name = $2`, [[data.p1, data.p2, p3, p4, fixture.p5, fixture.p6, removal.p7, removal.p8, mine.p9, mine.p10, rep.p11, rep.p12].filter(Boolean), 'L'.repeat(1000)]);
  }, { commit: true });
});

console.log(failures ? `\n${failures} échec(s).` : '\nTous les contrôles sont passés.');
process.exit(failures ? 1 : 0);
