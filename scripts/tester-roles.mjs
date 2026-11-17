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

console.log('\nNettoyage');
await check('suppression des Projets et Utilisateurs de test', async () => {
  await inDb(diane, async (q) => {
    await q(`DELETE FROM app_user WHERE id = $1`, [`test-cascade-${RUN}`]);
    await q(`DELETE FROM project WHERE id = ANY($1) OR name = $2`, [[data.p1, data.p2, p3, p4].filter(Boolean), 'L'.repeat(1000)]);
  }, { commit: true });
});

console.log(failures ? `\n${failures} échec(s).` : '\nTous les contrôles sont passés.');
process.exit(failures ? 1 : 0);
