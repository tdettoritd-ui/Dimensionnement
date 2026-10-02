'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/calc.js');

const proche = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

const climat = {
  zone: 'lorraine', tBaseHiver: '-15', tBaseEte: '32', tConfortEte: '26', tConfortHiver: '20',
  murType: 'parpaing', plancherType: 'dalle', toitureType: 'combles',
  isolantMur: { materiau: 'laine_verre', epaisseur: '10' },
  isolantPlancher: { materiau: 'aucun', epaisseur: '' },
  isolantToiture: { materiau: 'laine_roche', epaisseur: '20' },
  ventilation: 'vmc_auto'
};

test('num accepte virgule, espaces et vide', () => {
  assert.equal(C.num('2,5'), 2.5);
  assert.equal(C.num('1 200'), 1200);
  assert.equal(C.num(''), 0);
  assert.equal(C.num('abc'), 0);
});

test('U paroi avec et sans isolant', () => {
  proche(C.uParoi(0.30, { materiau: 'laine_verre', epaisseur: '10' }), 1 / (0.30 + 0.1 / 0.035));
  proche(C.uParoi(0.35, { materiau: 'aucun', epaisseur: '10' }), 1 / 0.35);
  assert.equal(C.uParoi(null, { materiau: 'pu', epaisseur: '10' }), 0);
});

test('U vitrage : volet -0,2 et plancher 0,5', () => {
  proche(C.uVitrage({ type: 'double', volet: 'oui' }), 2.6);
  assert.equal(C.uVitrage({ type: 'double', volet: 'non' }), 2.8);
  proche(C.uVitrage({ type: 'triple', volet: 'oui' }), 0.6);
});

test('paliers', () => {
  assert.deepEqual(C.palier(3.5, [2.5, 3.5, 5]), { valeur: 3.5, depasse: false });
  assert.deepEqual(C.palier(3.6, [2.5, 3.5, 5]), { valeur: 5, depasse: false });
  assert.deepEqual(C.palier(6, [2.5, 3.5, 5]), { valeur: null, depasse: true });
  assert.deepEqual(C.palier(0, [2.5]), { valeur: null, depasse: false });
});

test('calcul pièce complet', () => {
  const piece = {
    longueur: '5', largeur: '4', hauteur: '2,5', lineaire: '9', sousToiture: 'oui',
    vitrages: [{ orientation: 'S', type: 'double', surface: '2', volet: 'oui' }],
    occupants: '2', activite: 'sedentaire', equipements: '150', debit: ''
  };
  const r = C.calculPiece(piece, climat);
  const uMur = 1 / (0.30 + 0.1 / 0.035);
  const uToit = 1 / (0.20 + 0.2 / 0.038);
  const uPl = 1 / 0.35;
  const smur = 9 * 2.5 - 2;
  const debit = 50 * 0.6;
  proche(r.smur, smur);
  proche(r.debit, debit);
  assert.equal(r.debitAuto, true);
  const G = uMur * smur + uToit * 20 + uPl * 20 + 2.6 * 2 + 0.34 * debit;
  proche(r.G, G);
  proche(r.chauffage, G * 35);
  const clim = 2 * 0.6 * 150 + (uMur * smur + uToit * 20) * 6 + 0.34 * debit * 6 + 2 * 70 + 150;
  proche(r.climatisation, clim);
});

test('pièce hors toiture : U toiture = 0 ; débit saisi prioritaire', () => {
  const piece = { longueur: '4', largeur: '3', hauteur: '2.5', lineaire: '0', sousToiture: 'non', vitrages: [], debit: '10' };
  const r = C.calculPiece(piece, climat);
  assert.equal(r.deperditions.toiture, 0);
  proche(r.debit, 10);
  proche(r.G, (1 / 0.35) * 12 + 3.4);
});

test('radiateurs existants', () => {
  proche(C.radiateurExistant({ materiau: 'acier', typeAcier: '22', hauteur: '60', longueur: '100' }), 2700 * 0.6 * 1);
  assert.equal(C.radiateurExistant({ materiau: 'fonte', hauteurElement: '600', elements: '10' }), 950);
  assert.equal(C.radiateurExistant({ materiau: 'alu', hauteurElement: 700, elements: '8' }), 1320);
  assert.equal(C.radiateurExistant({ materiau: '' }), null);
});

test('badge suffisant à 95 %', () => {
  const piece = { longueur: '4', largeur: '3', hauteur: '2.5', lineaire: '0', sousToiture: 'non', vitrages: [], debit: '0',
    radiateur: { materiau: 'fonte', hauteurElement: '600', elements: '10' } };
  const climatSimple = { ...climat, plancherType: 'dalle', tBaseHiver: '-15' };
  const r = C.calculPiece(piece, climatSimple); // chauffage = 12/0.35*35 = 1200 W
  proche(r.chauffage, 1200);
  assert.equal(r.radiateurExistant.suffisant, false); // 950 < 1140
  proche(r.radiateurExistant.manque, 250);
  piece.radiateur.elements = '12'; // 1140 = 95 %
  assert.equal(C.calculPiece(piece, climatSimple).radiateurExistant.suffisant, true);
});

test('catégories Anah', () => {
  const cat = (p, rfr, zone = 'hors_idf') => C.categorieAnah({ personnes: String(p), rfr: String(rfr), zone }).categorie.id;
  assert.equal(cat(1, 17363), 'bleu');
  assert.equal(cat(1, 17364), 'jaune');
  assert.equal(cat(1, 31185), 'violet');
  assert.equal(cat(1, 31186), 'rose');
  assert.equal(cat(2, 40000, 'idf'), 'jaune');
  assert.deepEqual(C.seuilsAnah(7, 'hors_idf'), [40835 + 2 * 5151, 52348 + 2 * 6598, 73907 + 2 * 9357]);
  assert.deepEqual(C.seuilsAnah(6, 'idf'), [56580 + 7116, 68877 + 8663, 96817 + 12257]);
  assert.equal(C.categorieAnah({ personnes: '', rfr: '1000', zone: 'idf' }), null);
});

test('totaux chantier et préconisation PAC', () => {
  const chantier = {
    climat,
    prime: {},
    pieces: [
      { longueur: '4', largeur: '3', hauteur: '2.5', lineaire: '0', sousToiture: 'non', vitrages: [], debit: '0' },
      { longueur: '4', largeur: '3', hauteur: '2.5', lineaire: '0', sousToiture: 'non', vitrages: [], debit: '0' }
    ]
  };
  const r = C.calculChantier(chantier);
  proche(r.chauffage, 2400);
  assert.equal(r.palierChauffage.valeur, 2.5);
  assert.equal(r.anah, null);
});
