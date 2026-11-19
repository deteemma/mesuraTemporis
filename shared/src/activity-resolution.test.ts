// Tests portés de la source (frontend/src/app/pages/saisie-temps/resolution-activite.spec.ts),
// identifiants traduits en anglais (ADR-0014).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  type ActivityFieldState,
  computeSuggestions,
  initialActivityFieldState,
  recentPairs,
  reduceActivityField,
} from './activity-resolution.js';

describe('computeSuggestions', () => {
  test('propose la seule Activité correspondante, sans option de création si aucun Projet ne reste', () => {
    const suggestions = computeSuggestions({
      text: 'Facturation clients',
      focus: true,
      activities: [{ id: 'a1', name: 'Facturation clients', projectId: 'p3', projectName: 'Support Client' }],
      assignedProjects: [{ id: 'p3', name: 'Support Client' }],
      recentPairs: [],
    });

    assert.deepEqual(suggestions, [
      { type: 'existing', activityId: 'a1', name: 'Facturation clients', projectId: 'p3', projectName: 'Support Client' },
    ]);
  });

  test('trie les correspondances multi-Projets par récence d’usage, la plus récente en premier', () => {
    const suggestions = computeSuggestions({
      text: 'Réunion',
      focus: true,
      activities: [
        { id: 'a1', name: 'Réunion', projectId: 'p1', projectName: 'Refonte Site Vitrine' },
        { id: 'a2', name: 'Réunion', projectId: 'p2', projectName: 'Migration Cloud' },
      ],
      assignedProjects: [
        { id: 'p1', name: 'Refonte Site Vitrine' },
        { id: 'p2', name: 'Migration Cloud' },
      ],
      recentPairs: [
        { activityId: 'a2', name: 'Réunion', projectId: 'p2', projectName: 'Migration Cloud', date: '2026-09-10T09:00' },
        { activityId: 'a1', name: 'Réunion', projectId: 'p1', projectName: 'Refonte Site Vitrine', date: '2026-09-05T11:00' },
      ],
    });

    assert.deepEqual(suggestions, [
      { type: 'existing', activityId: 'a2', name: 'Réunion', projectId: 'p2', projectName: 'Migration Cloud' },
      { type: 'existing', activityId: 'a1', name: 'Réunion', projectId: 'p1', projectName: 'Refonte Site Vitrine' },
    ]);
  });

  test('ne propose que la création quand aucune Activité existante ne correspond', () => {
    const suggestions = computeSuggestions({
      text: 'Rédaction cahier des charges',
      focus: true,
      activities: [],
      assignedProjects: [
        { id: 'p1', name: 'Refonte Site Vitrine' },
        { id: 'p2', name: 'Migration Cloud' },
      ],
      recentPairs: [],
    });

    assert.deepEqual(suggestions, [
      {
        type: 'create',
        text: 'Rédaction cahier des charges',
        availableProjects: [
          { id: 'p1', name: 'Refonte Site Vitrine' },
          { id: 'p2', name: 'Migration Cloud' },
        ],
      },
    ]);
  });

  test('propose aussi la création, à la suite des correspondances existantes, limitée aux Projets qui n’ont pas encore cette Activité', () => {
    const suggestions = computeSuggestions({
      text: 'Réunion',
      focus: true,
      activities: [
        { id: 'a1', name: 'Réunion', projectId: 'p1', projectName: 'Refonte Site Vitrine' },
        { id: 'a2', name: 'Réunion', projectId: 'p2', projectName: 'Migration Cloud' },
      ],
      assignedProjects: [
        { id: 'p1', name: 'Refonte Site Vitrine' },
        { id: 'p2', name: 'Migration Cloud' },
        { id: 'p3', name: 'Support Client' },
      ],
      recentPairs: [],
    });

    assert.deepEqual(suggestions, [
      { type: 'existing', activityId: 'a2', name: 'Réunion', projectId: 'p2', projectName: 'Migration Cloud' },
      { type: 'existing', activityId: 'a1', name: 'Réunion', projectId: 'p1', projectName: 'Refonte Site Vitrine' },
      { type: 'create', text: 'Réunion', availableProjects: [{ id: 'p3', name: 'Support Client' }] },
    ]);
  });

  test('affiche les dernières paires utilisées, plus récente en premier, quand le champ est vide et a le focus', () => {
    const suggestions = computeSuggestions({
      text: '',
      focus: true,
      activities: [],
      assignedProjects: [],
      recentPairs: [
        { activityId: 'a2', name: 'Réunion', projectId: 'p2', projectName: 'Migration Cloud', date: '2026-09-10T09:00' },
        { activityId: 'a4', name: 'Facturation clients', projectId: 'p3', projectName: 'Support Client', date: '2026-09-09T14:00' },
      ],
    });

    assert.deepEqual(suggestions, [
      { type: 'existing', activityId: 'a2', name: 'Réunion', projectId: 'p2', projectName: 'Migration Cloud' },
      { type: 'existing', activityId: 'a4', name: 'Facturation clients', projectId: 'p3', projectName: 'Support Client' },
    ]);
  });

  test('ne propose rien pour un champ vide sans focus', () => {
    const suggestions = computeSuggestions({
      text: '',
      focus: false,
      activities: [],
      assignedProjects: [],
      recentPairs: [
        { activityId: 'a2', name: 'Réunion', projectId: 'p2', projectName: 'Migration Cloud', date: '2026-09-10T09:00' },
      ],
    });

    assert.deepEqual(suggestions, []);
  });

  // Ajouts propres à la cible : préfixe ou sous-chaîne, casse et accents ignorés (ADR-0014).
  test('la frappe trouve un nom en préfixe ou en sous-chaîne, sans tenir compte de la casse ni des accents', () => {
    const activities = [
      { id: 'a1', name: 'Réunion équipe', projectId: 'p1', projectName: 'Alpha' },
      { id: 'a2', name: 'Analyse', projectId: 'p1', projectName: 'Alpha' },
    ];
    const base = { focus: true, activities, assignedProjects: [{ id: 'p1', name: 'Alpha' }], recentPairs: [] };
    const existing = (text: string) =>
      computeSuggestions({ ...base, text }).flatMap((s) => (s.type === 'existing' ? [s.activityId] : []));

    assert.deepEqual(existing('REU'), ['a1']);
    assert.deepEqual(existing('EQUIPE'), ['a1']);
    assert.deepEqual(existing('lys'), ['a2']);
    assert.deepEqual(existing('zzz'), []);
  });

  test('un nom qui ne diffère que par la casse ou les accents n’est pas proposé à la création dans ce Projet', () => {
    const suggestions = computeSuggestions({
      text: 'REUNION',
      focus: true,
      activities: [{ id: 'a1', name: 'Réunion', projectId: 'p1', projectName: 'Alpha' }],
      assignedProjects: [{ id: 'p1', name: 'Alpha' }],
      recentPairs: [],
    });

    assert.deepEqual(suggestions, [
      { type: 'existing', activityId: 'a1', name: 'Réunion', projectId: 'p1', projectName: 'Alpha' },
    ]);
  });
});

describe('initialActivityFieldState', () => {
  test('démarre sans focus, sans texte, sans résolution ni création', () => {
    assert.deepEqual(initialActivityFieldState(), {
      focus: false,
      text: '',
      suggestions: [],
      highlighted: null,
      resolution: null,
      creation: null,
    });
  });
});

describe('reduceActivityField', () => {
  const context = {
    activities: [],
    assignedProjects: [],
    recentPairs: [
      { activityId: 'a2', name: 'Réunion', projectId: 'p2', projectName: 'Migration Cloud', date: '2026-09-10T09:00' },
    ],
  };

  test('FOCUS peuple les suggestions avec les dernières paires utilisées', () => {
    const state = reduceActivityField(initialActivityFieldState(), { type: 'FOCUS' }, context);

    assert.equal(state.focus, true);
    assert.deepEqual(state.suggestions, [
      { type: 'existing', activityId: 'a2', name: 'Réunion', projectId: 'p2', projectName: 'Migration Cloud' },
    ]);
  });

  test('SET_TEXT recalcule les suggestions et réinitialise surlignement et résolution', () => {
    const contextWithActivity = {
      activities: [{ id: 'a4', name: 'Facturation clients', projectId: 'p3', projectName: 'Support Client' }],
      assignedProjects: [{ id: 'p3', name: 'Support Client' }],
      recentPairs: [],
    };
    const beforeTyping: ActivityFieldState = {
      ...initialActivityFieldState(),
      highlighted: 0,
      resolution: { activity: 'Ancien', activityId: 'a9', projectId: 'p9', projectName: 'Ancien Projet', isNew: false },
    };

    const state = reduceActivityField(beforeTyping, { type: 'SET_TEXT', text: 'Facturation clients' }, contextWithActivity);

    assert.equal(state.text, 'Facturation clients');
    assert.equal(state.highlighted, null);
    assert.equal(state.resolution, null);
    assert.deepEqual(state.suggestions, [
      { type: 'existing', activityId: 'a4', name: 'Facturation clients', projectId: 'p3', projectName: 'Support Client' },
    ]);
  });

  test('ARROW_DOWN puis ENTER résout la suggestion existante surlignée', () => {
    const contextWithActivity = {
      activities: [{ id: 'a1', name: 'Réunion', projectId: 'p1', projectName: 'Refonte Site Vitrine' }],
      assignedProjects: [],
      recentPairs: [],
    };
    const afterTyping = reduceActivityField(initialActivityFieldState(), { type: 'SET_TEXT', text: 'Réunion' }, contextWithActivity);
    const afterArrow = reduceActivityField(afterTyping, { type: 'ARROW_DOWN' }, contextWithActivity);

    const state = reduceActivityField(afterArrow, { type: 'ENTER' }, contextWithActivity);

    assert.deepEqual(state.resolution, {
      activity: 'Réunion',
      activityId: 'a1',
      projectId: 'p1',
      projectName: 'Refonte Site Vitrine',
      isNew: false,
    });
  });

  test('CLICK_SUGGESTION vide la liste de suggestions une fois la résolution faite (la liste déroulante doit se fermer)', () => {
    const contextWithActivity = {
      activities: [{ id: 'a1', name: 'Réunion', projectId: 'p1', projectName: 'Refonte Site Vitrine' }],
      assignedProjects: [],
      recentPairs: [],
    };
    const afterTyping = reduceActivityField(initialActivityFieldState(), { type: 'SET_TEXT', text: 'Réunion' }, contextWithActivity);

    const state = reduceActivityField(afterTyping, { type: 'CLICK_SUGGESTION', index: 0 }, contextWithActivity);

    assert.notEqual(state.resolution, null);
    assert.deepEqual(state.suggestions, []);
  });

  test('ENTER sans suggestion surlignée ne résout rien, même si le texte correspond déjà exactement à une seule Activité', () => {
    const contextWithActivity = {
      activities: [{ id: 'a1', name: 'Réunion', projectId: 'p1', projectName: 'Refonte Site Vitrine' }],
      assignedProjects: [],
      recentPairs: [],
    };
    const afterTyping = reduceActivityField(initialActivityFieldState(), { type: 'SET_TEXT', text: 'Réunion' }, contextWithActivity);

    const state = reduceActivityField(afterTyping, { type: 'ENTER' }, contextWithActivity);

    assert.equal(state.resolution, null);
  });

  test('ENTER sur la suggestion de création ouvre le chemin création, sans résolution immédiate', () => {
    const contextWithoutMatch = {
      activities: [],
      assignedProjects: [{ id: 'p1', name: 'Migration Cloud' }, { id: 'p2', name: 'Support Client' }],
      recentPairs: [],
    };
    const afterTyping = reduceActivityField(
      initialActivityFieldState(),
      { type: 'SET_TEXT', text: 'Rédaction cahier des charges' },
      contextWithoutMatch,
    );
    const afterArrow = reduceActivityField(afterTyping, { type: 'ARROW_DOWN' }, contextWithoutMatch);

    const state = reduceActivityField(afterArrow, { type: 'ENTER' }, contextWithoutMatch);

    assert.equal(state.resolution, null);
    assert.deepEqual(state.creation, {
      text: 'Rédaction cahier des charges',
      availableProjects: [{ id: 'p1', name: 'Migration Cloud' }, { id: 'p2', name: 'Support Client' }],
      chosenProjectId: null,
    });
  });

  test('CHOOSE_CREATION_PROJECT résout la nouvelle Activité dans le Projet choisi', () => {
    const contextWithoutMatch = {
      activities: [],
      assignedProjects: [{ id: 'p1', name: 'Migration Cloud' }, { id: 'p2', name: 'Support Client' }],
      recentPairs: [],
    };
    const afterTyping = reduceActivityField(
      initialActivityFieldState(),
      { type: 'SET_TEXT', text: 'Rédaction cahier des charges' },
      contextWithoutMatch,
    );
    const afterArrow = reduceActivityField(afterTyping, { type: 'ARROW_DOWN' }, contextWithoutMatch);
    const afterOpening = reduceActivityField(afterArrow, { type: 'ENTER' }, contextWithoutMatch);

    const state = reduceActivityField(afterOpening, { type: 'CHOOSE_CREATION_PROJECT', projectId: 'p2' }, contextWithoutMatch);

    assert.deepEqual(state.resolution, {
      activity: 'Rédaction cahier des charges',
      activityId: null,
      projectId: 'p2',
      projectName: 'Support Client',
      isNew: true,
    });
  });
});

describe('recentPairs', () => {
  test('les dernières paires viennent des Imputations, une par Activité, la plus récente en premier', () => {
    const pairs = recentPairs([
      { activityId: 'a1', activityName: 'Réunion', projectId: 'p1', projectName: 'Alpha', startedAt: '2026-09-10T08:00:00.000Z' },
      { activityId: 'a2', activityName: 'Analyse', projectId: 'p1', projectName: 'Alpha', startedAt: '2026-09-10T09:00:00.000Z' },
      { activityId: 'a1', activityName: 'Réunion', projectId: 'p1', projectName: 'Alpha', startedAt: '2026-09-10T10:00:00.000Z' },
    ]);

    assert.deepEqual(pairs, [
      { activityId: 'a1', name: 'Réunion', projectId: 'p1', projectName: 'Alpha', date: '2026-09-10T10:00:00.000Z' },
      { activityId: 'a2', name: 'Analyse', projectId: 'p1', projectName: 'Alpha', date: '2026-09-10T09:00:00.000Z' },
    ]);
  });
});
