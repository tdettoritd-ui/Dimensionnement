'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fusionner } = require('../js/sync.js');

const loc = (id, savedAt, extra) => Object.assign({ id, savedAt, data: { v: id + '@' + savedAt } }, extra);
const dist = (id, saved_at, extra) => Object.assign({ id, saved_at, data: { v: id + '@' + saved_at }, deleted: false }, extra);
const T1 = '2026-11-20T10:00:00.000Z';
const T2 = '2026-11-20T11:00:00.000Z';

test('un chantier distant inconnu est ajouté, marqué envoyé', () => {
  const r = fusionner([], [dist('a', T1)], []);
  assert.equal(r.locaux.length, 1);
  assert.equal(r.locaux[0].envoye, true);
  assert.deepEqual(r.modifies, ['a']);
});

test('la version distante plus récente remplace la locale', () => {
  const r = fusionner([loc('a', T1, { envoye: true })], [dist('a', T2)], []);
  assert.equal(r.locaux[0].data.v, 'a@' + T2);
  assert.deepEqual(r.modifies, ['a']);
});

test('la version locale plus récente est gardée (elle sera envoyée)', () => {
  const r = fusionner([loc('a', T2, { envoye: false })], [dist('a', T1)], []);
  assert.equal(r.locaux[0].data.v, 'a@' + T2);
  assert.equal(r.locaux[0].envoye, false);
  assert.deepEqual(r.modifies, []);
});

test('même version : la locale est marquée envoyée', () => {
  const r = fusionner([loc('a', T1)], [dist('a', '2026-11-20T10:00:00+00:00')], []);
  assert.equal(r.locaux[0].envoye, true);
  assert.deepEqual(r.modifies, []);
});

test('les chantiers locaux d’avant la synchro restent à envoyer', () => {
  const r = fusionner([loc('a', T1), loc('b', T2)], [], []);
  assert.equal(r.locaux.filter((c) => c.envoye !== true).length, 2);
  assert.deepEqual(r.locaux.map((c) => c.id), ['b', 'a']);
});

test('supprimé ailleurs : supprimé ici', () => {
  const r = fusionner([loc('a', T1, { envoye: true })], [dist('a', T2, { deleted: true, data: null })], []);
  assert.equal(r.locaux.length, 0);
  assert.deepEqual(r.modifies, ['a']);
});

test('supprimé ailleurs mais resauvegardé ici après : gardé', () => {
  const r = fusionner([loc('a', T2, { envoye: false })], [dist('a', T1, { deleted: true, data: null })], []);
  assert.equal(r.locaux.length, 1);
});

test('supprimé ici (pas encore envoyé) : pas recréé par une version distante plus ancienne', () => {
  const r = fusionner([], [dist('a', T1)], [{ id: 'a', at: T2 }]);
  assert.equal(r.locaux.length, 0);
});
