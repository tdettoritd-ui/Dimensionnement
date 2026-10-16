'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/calc.js');
const D = require('../js/data.js');

// Les tests vérifient les formules en lisant les valeurs dans les tables : une révision des
// tables (js/data.js) ne les casse pas. Le dernier test vérifie la cohérence des tables.

const proche = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const R = (table, id) => D.find(table, id).r;
const lambda = (id) => D.find(D.ISOLANTS, id).lambda;
const vit = (id) => D.find(D.VITRAGES, id);
const soleil = (id) => D.find(D.ORIENTATIONS, id).w;
const taux = (id) => D.find(D.VENTILATIONS, id).taux;

const climat = {
  zone: 'lorraine', tBaseHiver: '-15', tBaseEte: '32', tConfortEte: '26', tConfortHiver: '20',
  murType: 'parpaing', plancherType: 'dalle', toitureType: 'combles',
  isolantMur: { materiau: 'laine_verre', epaisseur: '10' },
  isolantPlancher: { materiau: 'aucun', epaisseur: '' },
  isolantToiture: { materiau: 'laine_roche', epaisseur: '20' },
  ventilation: 'vmc_auto'
};

const uMur = 1 / (R(D.MURS, 'parpaing') + 0.10 / lambda('laine_verre'));
const uToit = 1 / (R(D.TOITURES, 'combles') + 0.20 / lambda('laine_roche'));
const uPlancher = 1 / R(D.PLANCHERS, 'dalle');

test('num accepte virgule, espaces et vide', () => {
  assert.equal(C.num('2,5'), 2.5);
  assert.equal(C.num('1 200'), 1200);
  assert.equal(C.num('1 200'), 1200);
  assert.equal(C.num(''), 0);
  assert.equal(C.num('abc'), 0);
});

test('U paroi avec et sans isolant', () => {
  proche(C.uParoi(0.30, { materiau: 'laine_verre', epaisseur: '10' }), 1 / (0.30 + 0.1 / lambda('laine_verre')));
  proche(C.uParoi(0.35, { materiau: 'aucun', epaisseur: '10' }), 1 / 0.35);
  assert.equal(C.uParoi(null, { materiau: 'pu', epaisseur: '10' }), 0);
});

test('U vitrage : volet -0,2 et plancher 0,5', () => {
  proche(C.uVitrage({ type: 'double', volet: 'oui' }), vit('double').u - 0.2);
  proche(C.uVitrage({ type: 'double', volet: 'non' }), vit('double').u);
  proche(C.uVitrage({ type: 'triple', volet: 'oui' }), Math.max(vit('triple').u - 0.2, 0.5));
  // le plancher à 0,5 s'applique quelle que soit la table
  const base = D.find(D.VITRAGES, 'triple');
  const u = base.u;
  base.u = 0.6;
  try {
    proche(C.uVitrage({ type: 'triple', volet: 'oui' }), 0.5);
  } finally {
    base.u = u;
  }
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
  const smur = 9 * 2.5 - 2;
  const debit = 50 * taux('vmc_auto');
  proche(r.smur, smur);
  proche(r.debit, debit);
  assert.equal(r.debitAuto, true);
  // Ponts thermiques (ITI par défaut, dalle non isolée, combles bois) : plancher bas + refend + menuiserie.
  const PT = D.PONTS_THERMIQUES;
  const pt = PT.plancherBas.iti[0] * 9 + PT.refend.iti * PT.refendParPiece * 2.5 + PT.menuiserie.iti * 4 * Math.sqrt(2);
  proche(r.pontsThermiques.total, pt);
  const G = uMur * smur + uToit * 20 + uPlancher * 20 + (vit('double').u - 0.2) * 2 + pt + 0.34 * debit;
  proche(r.G, G);
  proche(r.chauffage, G * 35);
  // Été (pointe de la pièce) : soleil, conduction des baies, murs et toiture au soleil (ETD),
  // ponts thermiques hors plancher bas, air, occupants, équipements ; latent ; puissance nominale.
  const ptEte = pt - PT.plancherBas.iti[0] * 9;
  const a = r.apports;
  proche(a.solaires, 2 * vit('double').g * D.find(D.ORIENTATIONS, 'S').wPiece);
  proche(a.vitrages, vit('double').u * 2 * 6);
  proche(a.murs, uMur * smur * D.ETD_MURS.moyen_iti);
  proche(a.toiture, uToit * 20 * D.find(D.TOITURES, 'combles').etd);
  proche(a.pontsThermiques, ptEte * 6);
  proche(a.ventilation, 0.34 * debit * 6);
  proche(a.occupants, 2 * 70);
  proche(a.equipements, 150);
  proche(a.latentOccupants, 2 * 45);
  proche(a.latentAir, 0.83 * debit * 2);
  const sensible = a.solaires + a.vitrages + a.murs + a.toiture + a.pontsThermiques + a.ventilation + a.occupants + a.equipements;
  const latent = a.latentOccupants + a.latentAir;
  proche(r.clim.sensible, sensible);
  proche(r.climatisation, Math.max(sensible + latent, Math.min(sensible / 0.75, 1.3 * (sensible + latent))));
});

test('pièce hors toiture : U toiture = 0 ; débit saisi prioritaire', () => {
  const piece = { longueur: '4', largeur: '3', hauteur: '2.5', lineaire: '0', sousToiture: 'non', vitrages: [], debit: '10' };
  const r = C.calculPiece(piece, climat);
  assert.equal(r.deperditions.toiture, 0);
  proche(r.debit, 10);
  proche(r.G, uPlancher * 12 + 3.4);
});

test('radiateurs existants', () => {
  const t22 = D.find(D.RADIATEURS_ACIER, '22').wm2;
  proche(C.radiateurExistant({ materiau: 'acier', typeAcier: '22', hauteur: '60', longueur: '100' }), t22 * 0.6 * 1);
  assert.equal(C.radiateurExistant({ materiau: 'fonte', hauteurElement: '600', elements: '10' }), D.RADIATEURS_ELEMENTS.fonte[600] * 10);
  assert.equal(C.radiateurExistant({ materiau: 'alu', hauteurElement: 700, elements: '8' }), D.RADIATEURS_ELEMENTS.alu[700] * 8);
  assert.equal(C.radiateurExistant({ materiau: '' }), null);
});

test('badge suffisant à 95 %', () => {
  // Pièce sans mur extérieur ni vitrage : seule la ventilation déperd. 10 m³/h × 0,34 × 35 K = 119 W.
  const piece = { longueur: '4', largeur: '3', hauteur: '2.5', lineaire: '0', sousToiture: 'non', vitrages: [], debit: '10',
    radiateur: { materiau: 'fonte', hauteurElement: '600', elements: '1' } };
  const climatSansPlancher = { ...climat, plancherType: 'aucun' };
  const r = C.calculPiece(piece, climatSansPlancher);
  proche(r.chauffage, 119);
  const parElement = D.RADIATEURS_ELEMENTS.fonte[600];
  const n = Math.ceil(0.95 * 119 / parElement); // nombre d'éléments juste suffisant
  piece.radiateur.elements = String(n - 1);
  const insuffisant = C.calculPiece(piece, climatSansPlancher).radiateurExistant;
  assert.equal(insuffisant.suffisant, false);
  proche(insuffisant.manque, 119 - (n - 1) * parElement);
  piece.radiateur.elements = String(n);
  assert.equal(C.calculPiece(piece, climatSansPlancher).radiateurExistant.suffisant, true);
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
  const piece = { longueur: '4', largeur: '3', hauteur: '2.5', lineaire: '0', sousToiture: 'non', vitrages: [], debit: '0' };
  const r = C.calculChantier({ climat, prime: {}, pieces: [piece, { ...piece }] });
  const attendu = 2 * uPlancher * 12 * 35;
  proche(r.chauffage, attendu);
  assert.equal(r.palierChauffage.valeur, D.PALIERS_PAC.find(p => p >= attendu / 1000));
  assert.equal(r.anah, null);
});

test('saisie rapide des vitrages : surface = ratio × surface au sol', () => {
  const ratio = D.find(D.NIVEAUX_VITRAGE, 'moyen').ratio;
  const base = { longueur: '5', largeur: '4', hauteur: '2.5', lineaire: '18', sousToiture: 'non', debit: '0',
    vitrages: [{ orientation: 'N', type: 'simple', surface: '9', volet: 'non' }] };
  const rapide = { ...base, vitrageMode: 'rapide', vitrageRapide: { niveau: 'moyen', orientation: 'S', type: 'double', volet: 'oui' } };
  const r = C.calculPiece(rapide, climat);
  proche(r.surfaceVitree, 20 * ratio);
  proche(r.deperditions.vitrages, 20 * ratio * (vit('double').u - 0.2));
  proche(r.apports.solaires, 20 * ratio * vit('double').g * D.find(D.ORIENTATIONS, 'S').wPiece);
  proche(r.smur, 18 * 2.5 - 20 * ratio);
  // la liste détaillée est ignorée en mode rapide, et réutilisée en mode détaillé
  proche(C.calculPiece(base, climat).surfaceVitree, 9);
});

test('orientation mixte = moyenne des orientations', () => {
  const verticales = D.ORIENTATIONS.filter(o => !o.toit);
  proche(C.rayonnement('mixte'), verticales.reduce((s, o) => s + o.w, 0) / verticales.length);
  proche(C.rayonnementPiece('mixte'), verticales.reduce((s, o) => s + o.wPiece, 0) / verticales.length);
  assert.equal(C.rayonnement('inconnue'), 0);
});

test('cohérence des tables de référence', () => {
  const ids = (t) => t.map(e => e.id);
  [D.ZONES, D.MURS, D.TOITURES, D.PLANCHERS, D.ISOLANTS, D.VITRAGES, D.ORIENTATIONS, D.ACTIVITES,
    D.VENTILATIONS, D.RADIATEURS_ACIER, D.NIVEAUX_VITRAGE].forEach(t => {
    assert.equal(new Set(ids(t)).size, t.length, 'identifiants en double');
  });
  D.MURS.forEach(m => assert.ok(m.r > 0, m.id));
  D.VITRAGES.forEach(v => assert.ok(v.u > 0 && v.g > 0 && v.g < 1, v.id));
  D.ORIENTATIONS.forEach(o => assert.ok(o.w > 0 && o.wPiece >= o.w, o.id));
  // Façades : l'Ouest est la plus chargée en pointe simultanée, le Nord la moins chargée.
  const verticales = D.ORIENTATIONS.filter(o => !o.toit);
  assert.equal(Math.max(...verticales.map(o => o.w)), soleil('O'));
  assert.equal(Math.min(...verticales.map(o => o.w)), soleil('N'));
  assert.equal(Math.min(...verticales.map(o => o.wPiece)), D.find(D.ORIENTATIONS, 'N').wPiece);
  D.ACTIVITES.forEach(a => assert.ok(a.lat > 0, a.id));
  D.MURS.forEach(m => assert.ok(m.inertie, m.id));
  // Paliers strictement croissants.
  [D.PALIERS_PAC, D.PALIERS_RADIATEUR].forEach(p => p.forEach((v, i) => i && assert.ok(v > p[i - 1])));
  // Seuils Anah croissants pour chaque taille de foyer.
  ['hors_idf', 'idf'].forEach(z => D.ANAH[z].seuils.forEach(s => assert.ok(s[0] < s[1] && s[1] < s[2])));
});

test('pièce à l\'étage : pas de plancher bas', () => {
  const piece = { longueur: '4', largeur: '3', hauteur: '2.5', lineaire: '0', sousToiture: 'non', vitrages: [], debit: '0' };
  proche(C.calculPiece(piece, climat).deperditions.plancher, uPlancher * 12);
  const etage = C.calculPiece({ ...piece, surPlancherBas: 'non' }, climat);
  assert.equal(etage.deperditions.plancher, 0);
  assert.equal(etage.u.plancher, 0);
});

test('régime d\'eau : correction des puissances de radiateurs', () => {
  // Référence catalogue : 75/65 °C pour 20 °C ambiant → coefficient 1.
  proche(C.facteurRegime('75/65', '20'), 1);
  proche(C.facteurRegime(undefined, '20'), 1);
  // (ΔTlm / 49,83)^1,3 : 55/45 → 0,511 ; 45/35 → 0,297.
  proche(C.facteurRegime('55/45', '20'), 0.511, 1e-3);
  proche(C.facteurRegime('45/35', '20'), 0.297, 1e-3);
  assert.ok(C.facteurRegime('55/45', '22') < C.facteurRegime('55/45', '20'));

  const piece = { longueur: '4', largeur: '3', hauteur: '2.5', lineaire: '0', sousToiture: 'non', vitrages: [], debit: '10',
    radiateur: { materiau: 'alu', hauteurElement: '600', elements: '2' } };
  const sansPlancher = { ...climat, plancherType: 'aucun' }; // besoin = 119 W
  const catalogue = 2 * D.RADIATEURS_ELEMENTS.alu[600];
  const ref = C.calculPiece(piece, sansPlancher);
  proche(ref.radiateurExistant.puissance, catalogue);
  const pac = C.calculPiece(piece, sansPlancher, '45/35');
  proche(pac.radiateurExistant.puissanceCatalogue, catalogue);
  proche(pac.radiateurExistant.puissance, catalogue * C.facteurRegime('45/35', '20'));
  assert.equal(pac.radiateurExistant.suffisant, catalogue * C.facteurRegime('45/35', '20') >= 0.95 * 119);
  // Radiateur neuf : palier catalogue couvrant le besoin au régime choisi.
  assert.equal(pac.radiateurNeuf.valeur, D.PALIERS_RADIATEUR.find(p => p * C.facteurRegime('45/35', '20') >= 119));
  // Le régime est lu dans l'installation par calculChantier.
  const r = C.calculChantier({ climat: sansPlancher, prime: {}, installation: { regimeEau: '45/35' }, pieces: [piece] });
  proche(r.pieces[0].radiateurExistant.puissance, pac.radiateurExistant.puissance);
});

test('surpuissance de relance : % ajouté à la puissance de chauffage', () => {
  const piece = { longueur: '4', largeur: '3', hauteur: '2.5', lineaire: '0', sousToiture: 'non', vitrages: [], debit: '10' };
  const sans = C.calculPiece(piece, { ...climat, plancherType: 'aucun' });
  proche(sans.chauffage, 119);
  const avec = C.calculPiece(piece, { ...climat, plancherType: 'aucun', surpuissance: '15' });
  proche(avec.chauffageBase, 119);
  proche(avec.chauffage, 119 * 1.15);
  assert.equal(C.calculPiece(piece, { ...climat, plancherType: 'aucun', surpuissance: '-5' }).chauffage, sans.chauffage);
});

test('ponts thermiques 3CL selon la position de l\'isolant des murs', () => {
  const c = { ...climat, isolantToiture: { materiau: 'laine_verre', epaisseur: '20' } };
  const sejour = { longueur: '5', largeur: '5', hauteur: '2,5', lineaire: '10',
    vitrages: [{ orientation: 'S', type: 'double_argon', surface: '1,5', volet: 'non' }, { orientation: 'O', type: 'double_argon', surface: '2,5', volet: 'non' }] };
  // Valeurs contre-vérifiées (plain-pied, dalle non isolée, combles bois) :
  proche(C.pontsThermiques(sejour, c).total, 3.6125, 1e-3); // ITI
  proche(C.pontsThermiques(sejour, { ...c, positionIsolantMur: 'exterieur' }).total, 7.787, 1e-3); // ITE
  proche(C.pontsThermiques(sejour, { ...c, isolantMur: { materiau: 'aucun', epaisseur: '' } }).total, 8.621, 1e-3); // non isolé
  assert.equal(C.isolationMur({ ...c, murType: 'monomur', isolantMur: { materiau: 'aucun' } }), 'itr');
  assert.equal(C.isolationMur({ ...c, murType: 'monomur', positionIsolantMur: 'exterieur' }), 'ite_itr');
  // Sans mur extérieur : aucun pont thermique.
  assert.equal(C.pontsThermiques({ ...sejour, lineaire: '' }, c).total, 0);
  // Ossature bois : seul le refend reste.
  const bois = C.pontsThermiques(sejour, { ...c, murType: 'ossature_bois' });
  proche(bois.total, D.PONTS_THERMIQUES.refend.iti_itr * 0.25 * 2.5);
  // Étage en ITI : plancher intermédiaire (moitié par face) ; nul si plancher d'étage en bois.
  const etage = { ...sejour, surPlancherBas: 'non', sousToiture: 'non' };
  proche(C.pontsThermiques(etage, c).detail.plancherIntermediaire, 0.92 * 10);
  assert.equal(C.pontsThermiques(etage, { ...c, plancherEtage: 'leger' }).detail.plancherIntermediaire, 0);
  // Combles sur dalle béton : pont thermique plancher haut ; combles bois : aucun.
  proche(C.pontsThermiques(sejour, { ...c, toitureType: 'combles_dalle' }).detail.plancherHaut, 0.75 * 10);
  assert.equal(C.pontsThermiques(sejour, c).detail.plancherHaut, 0);
});

test('climatisation : valeurs de référence contre-vérifiées (pièces types)', () => {
  const iso = (m, e) => ({ materiau: m, epaisseur: String(e) });
  const A = { ...climat, isolantMur: iso('laine_verre', 10), isolantToiture: iso('laine_verre', 20), positionIsolantMur: 'interieur' };
  const P = o => ({ nom: 'Chambre', longueur: '4', largeur: '3', hauteur: '2,5', lineaire: '4', sousToiture: 'non', surPlancherBas: 'oui',
    vitrageMode: 'detail', vitrages: [], occupants: '2', activite: 'sedentaire', equipements: '', debit: '', ...o });
  const V = (o, s, t = 'double') => ({ orientation: o, type: t, surface: String(s), volet: 'non' });
  const cas = [
    [P({ vitrages: [V('S', 1.5)] }), A, 781],
    [P({ vitrages: [V('O', 1.5)] }), A, 885],
    [P({ nom: 'Séjour', longueur: '6', largeur: '5', lineaire: '11', vitrages: [V('O', 6), V('S', 2)] }), A, 3328],
    [P({ sousToiture: 'oui', surPlancherBas: 'non', vitrages: [V('O', 1.5)] }), { ...A, toitureType: 'rampants' }, 1026],
    [P({ sousToiture: 'oui', surPlancherBas: 'non', lineaire: '0', vitrages: [V('toit', 1, 'double_argon')] }), { ...A, toitureType: 'rampants' }, 793]
  ];
  cas.forEach(([p, c, attendu]) => assert.equal(Math.round(C.calculPiece(p, c, undefined, 4).climatisation), attendu, p.nom));
});

test('climatisation : défauts selon le nom de la pièce et foyer', () => {
  assert.deepEqual(C.defautsPiece({ nom: 'Chambre parentale' }, 14, 4), { occupants: 2, equipements: 50 });
  assert.deepEqual(C.defautsPiece({ nom: 'Séjour-cuisine' }, 40, 3), { occupants: 3, equipements: 450 });
  assert.deepEqual(C.defautsPiece({ nom: 'Salle de bain' }, 6, 4), { occupants: 0, equipements: 0 });
  assert.deepEqual(C.defautsPiece({ nom: 'Atelier' }, 10, 4), { occupants: 1, equipements: 70 });
  assert.deepEqual(C.foyerChantier({ prime: { personnes: '5' }, pieces: [] }), { n: 5, source: 'prime' });
  assert.deepEqual(C.foyerChantier({ prime: {}, pieces: [{ nom: 'Chambre 1' }, { nom: 'Chambre 2' }, { nom: 'Séjour' }] }), { n: 3, source: 'chambres' });
  // Saisie prioritaire, même à 0.
  const p = { nom: 'Chambre', longueur: '4', largeur: '3', hauteur: '2,5', lineaire: '0', vitrages: [], occupants: '0', equipements: '0', debit: '0' };
  const r = C.calculPiece(p, climat, undefined, 4);
  assert.equal(r.apports.occupants, 0);
  assert.equal(r.apports.equipements, 0);
});

test('climatisation : fenêtre de toit retirée de la toiture, pas des murs', () => {
  const p = { nom: 'Chambre', longueur: '4', largeur: '3', hauteur: '2,5', lineaire: '4', sousToiture: 'oui', debit: '0',
    vitrages: [{ orientation: 'toit', type: 'double_argon', surface: '1', volet: 'non' }] };
  const r = C.calculPiece(p, climat);
  proche(r.smur, 4 * 2.5);
  proche(r.deperditions.toiture, uToit * 11);
  assert.equal(r.pontsThermiques.longueurs.menuiserie, 0);
});

test('climatisation : total simultané (soleil maison entière, occupants plafonnés au foyer)', () => {
  const P = (nom, vit, occ) => ({ nom, longueur: '4', largeur: '4', hauteur: '2,5', lineaire: '4', sousToiture: 'non', vitrages: vit, occupants: occ, equipements: '', debit: '' });
  const pieces = [P('Chambre 1', [{ orientation: 'E', type: 'double', surface: '2', volet: 'non' }], '2'),
    P('Chambre 2', [{ orientation: 'O', type: 'double', surface: '2', volet: 'non' }], '2'),
    P('Séjour', [{ orientation: 'S', type: 'double', surface: '4', volet: 'non' }], '4')];
  const r = C.calculChantier({ climat, prime: { personnes: '4' }, pieces });
  // Soleil simultané < pointes des pièces ; occupants ramenés à 4 personnes sur 8.
  assert.ok(r.climatisation < r.climSommePieces);
  let sensible = 0;
  let latent = 0;
  r.pieces.forEach(x => {
    sensible += x.clim.sensible - x.apports.solaires + x.clim.solairesSimultanes - x.apports.occupants + 0.5 * x.apports.occupants;
    latent += x.clim.latent - 0.5 * x.apports.latentOccupants;
  });
  proche(r.climSensible, sensible);
  proche(r.climLatent, latent);
  proche(r.climatisation, C.puissanceNominale(sensible, latent));
});
