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
const uPlancher = 1 / (R(D.PLANCHERS_DALLE, 'beton') + D.find(D.PLANCHERS_LOCAL, 'terre_plein').rSol);
// Sol sur terre-plein (NF EN 12831) : fg1 × fg2 × Uequiv, dalle béton non isolée (U 4 → colonne U 3),
// 20 °C intérieur, -15 °C de base (moyenne annuelle 8 °C).
const solU = (bPrime) => D.SOL.fg1 * (20 - 8) / 35 * C.uEquivalentSol(1 / R(D.PLANCHERS_DALLE, 'beton'), bPrime);
// Infiltrations : 2 × V × n50 (étanchéité moyenne : 7) × e (site moyennement abrité).
const vinf = (V, facades) => 2 * V * 7 * D.find(D.EXPOSITIONS, 'modere').e[Math.min(facades, 2)];

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
  // Pièce seule : VMC au taux forfaitaire ; + infiltrations (1 façade exposée).
  const vmc = 50 * taux('vmc_auto');
  const debit = vmc + vinf(50, 1);
  proche(r.smur, smur);
  proche(r.debit, debit);
  assert.equal(r.debitAuto, true);
  // Ponts thermiques (ITI par défaut, combles bois) : refend + menuiserie ; sol sur terre-plein : non comptés.
  const PT = D.PONTS_THERMIQUES;
  const pt = PT.refend.iti * PT.refendParPiece * 2.5 + PT.menuiserie.iti * 4 * Math.sqrt(2);
  proche(r.pontsThermiques.total, pt);
  const G = uMur * smur + uToit * 20 + solU(20 / (0.5 * 9)) * 20 + (vit('double').u - 0.2) * 2 + pt + 0.34 * debit;
  proche(r.G, G);
  proche(r.chauffage, G * 35);
  // Été (pointe de la pièce) : soleil, conduction des baies, murs et toiture au soleil (ETD),
  // ponts thermiques hors plancher bas, air, occupants, équipements ; latent ; puissance nominale.
  const ptEte = pt;
  const a = r.apports;
  proche(a.solaires, 2 * vit('double').g * D.find(D.ORIENTATIONS, 'S').wPiece);
  proche(a.vitrages, vit('double').u * 2 * 6);
  proche(a.murs, uMur * smur * D.ETD_MURS.moyen_iti);
  proche(a.toiture, uToit * 20 * D.find(D.TOITURES, 'combles').etd);
  proche(a.pontsThermiques, ptEte * 6);
  // Été : renouvellement d'air sans infiltrations (VMC, au moins le minimum hygiénique).
  proche(a.ventilation, 0.34 * vmc * 6);
  proche(a.occupants, 2 * 70);
  proche(a.equipements, 150);
  proche(a.latentOccupants, 2 * 45);
  proche(a.latentAir, 0.83 * vmc * 2);
  const sensible = a.solaires + a.vitrages + a.murs + a.toiture + a.pontsThermiques + a.ventilation + a.occupants + a.equipements;
  const latent = a.latentOccupants + a.latentAir;
  proche(r.clim.sensible, sensible);
  proche(r.climatisation, Math.max(sensible + latent, Math.min(sensible / 0.75, 1.3 * (sensible + latent))));
});

test('pièce hors toiture : U toiture = 0 ; débit saisi prioritaire', () => {
  const piece = { longueur: '4', largeur: '3', hauteur: '2.5', lineaire: '0', sousToiture: 'non', vitrages: [], debit: '20' };
  const r = C.calculPiece(piece, climat);
  assert.equal(r.deperditions.toiture, 0);
  // Débit VMC saisi + infiltrations (pièce sans façade exposée).
  proche(r.ventilation.vmech, 20);
  proche(r.debit, 20 + vinf(30, 0));
  // Sans mur extérieur ni plancher bas connu du bâtiment : B' plafonné à 20.
  proche(r.G, solU(20) * 12 + 0.34 * r.debit);
});

test('radiateurs existants', () => {
  // Acier type 22, 600 × 1000 mm : catalogue Altech (1 747 W à ΔT50).
  proche(C.radiateurExistant({ materiau: 'acier', typeAcier: '22', hauteur: '60', longueur: '100' }), 1747, 2);
  // Type hors catalogue : W/m² indicatif.
  const t20 = D.find(D.RADIATEURS_ACIER, '20').wm2;
  proche(C.radiateurExistant({ materiau: 'acier', typeAcier: '20', hauteur: '60', longueur: '100' }), t20 * 0.6 * 1);
  assert.equal(C.radiateurExistant({ materiau: 'fonte', hauteurElement: '600', elements: '10' }), D.RADIATEURS_ELEMENTS.fonte[600] * 10);
  assert.equal(C.radiateurExistant({ materiau: 'alu', hauteurElement: 700, elements: '8' }), D.RADIATEURS_ELEMENTS.alu[700] * 8);
  assert.equal(C.radiateurExistant({ materiau: '' }), null);
});

test('badge suffisant à 95 %', () => {
  // Pièce sans mur extérieur ni vitrage : seule la ventilation déperd. Débit VMC 10 m³/h + infiltrations
  // sous le minimum hygiénique (0,5 vol/h = 15 m³/h) : 15 m³/h × 0,34 × 35 K = 178,5 W.
  const piece = { longueur: '4', largeur: '3', hauteur: '2.5', lineaire: '0', sousToiture: 'non', vitrages: [], debit: '10',
    radiateur: { materiau: 'fonte', hauteurElement: '600', elements: '1' } };
  const climatSansPlancher = { ...climat, plancherType: 'aucun' };
  const r = C.calculPiece(piece, climatSansPlancher);
  proche(r.debit, 15);
  const besoin = 0.34 * 15 * 35;
  proche(r.chauffage, besoin);
  const parElement = D.RADIATEURS_ELEMENTS.fonte[600];
  const n = Math.ceil(0.95 * besoin / parElement); // nombre d'éléments juste suffisant
  piece.radiateur.elements = String(n - 1);
  const insuffisant = C.calculPiece(piece, climatSansPlancher).radiateurExistant;
  assert.equal(insuffisant.suffisant, false);
  proche(insuffisant.manque, besoin - (n - 1) * parElement);
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
  // Débit VMC nul saisi : minimum hygiénique 0,5 vol/h (15 m³/h) par pièce.
  const attendu = 2 * (solU(20) * 12 + 0.34 * 15) * 35;
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
  [D.ZONES, D.MURS, D.TOITURES, D.PLANCHERS_DALLE, D.PLANCHERS_LOCAL, D.ISOLANTS, D.VITRAGES, D.ORIENTATIONS, D.ACTIVITES,
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
  [D.PALIERS_PAC].forEach(p => p.forEach((v, i) => i && assert.ok(v > p[i - 1])));
  // Seuils Anah croissants pour chaque taille de foyer.
  ['hors_idf', 'idf'].forEach(z => D.ANAH[z].seuils.forEach(s => assert.ok(s[0] < s[1] && s[1] < s[2])));
});

test('pièce à l\'étage : pas de plancher bas', () => {
  const piece = { longueur: '4', largeur: '3', hauteur: '2.5', lineaire: '0', sousToiture: 'non', vitrages: [], debit: '0' };
  proche(C.calculPiece(piece, climat).deperditions.plancher, solU(20) * 12);
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
  const sansPlancher = { ...climat, plancherType: 'aucun' }; // besoin = 15 m³/h × 0,34 × 35 K = 178,5 W
  const catalogue = 2 * D.RADIATEURS_ELEMENTS.alu[600];
  const ref = C.calculPiece(piece, sansPlancher);
  proche(ref.radiateurExistant.puissance, catalogue);
  const pac = C.calculPiece(piece, sansPlancher, '45/35');
  proche(pac.radiateurExistant.puissanceCatalogue, catalogue);
  proche(pac.radiateurExistant.puissance, catalogue * C.facteurRegime('45/35', '20'));
  assert.equal(pac.radiateurExistant.suffisant, catalogue * C.facteurRegime('45/35', '20') >= 0.95 * 178.5);
  // Radiateur neuf : palier catalogue couvrant le besoin au régime choisi.
  const besoin50 = 178.5 / C.facteurRegime('45/35', '20');
  assert.equal(pac.radiateurNeuf.valeur, Math.min(...D.CATALOGUE_RADIATEURS.modeles.map(m => m.p50).filter(p => p >= besoin50)));
  // Le régime est lu dans l'installation par calculChantier.
  const r = C.calculChantier({ climat: sansPlancher, prime: {}, installation: { regimeEau: '45/35' }, pieces: [piece] });
  proche(r.pieces[0].radiateurExistant.puissance, pac.radiateurExistant.puissance);
});

test('surpuissance de relance : % ajouté à la puissance de chauffage', () => {
  const piece = { longueur: '4', largeur: '3', hauteur: '2.5', lineaire: '0', sousToiture: 'non', vitrages: [], debit: '10' };
  const sans = C.calculPiece(piece, { ...climat, plancherType: 'aucun' });
  proche(sans.chauffage, 178.5);
  const avec = C.calculPiece(piece, { ...climat, plancherType: 'aucun', surpuissance: '15' });
  proche(avec.chauffageBase, 178.5);
  proche(avec.chauffage, 178.5 * 1.15);
  assert.equal(C.calculPiece(piece, { ...climat, plancherType: 'aucun', surpuissance: '-5' }).chauffage, sans.chauffage);
});

test('ponts thermiques 3CL selon la position de l\'isolant des murs', () => {
  const c = { ...climat, isolantToiture: { materiau: 'laine_verre', epaisseur: '20' } };
  const sejour = { longueur: '5', largeur: '5', hauteur: '2,5', lineaire: '10',
    vitrages: [{ orientation: 'S', type: 'double_argon', surface: '1,5', volet: 'non' }, { orientation: 'O', type: 'double_argon', surface: '2,5', volet: 'non' }] };
  // Valeurs contre-vérifiées (plain-pied, dalle non isolée, combles bois), plancher bas sur un local
  // non chauffé de b = 1 ; sur terre-plein, le pont thermique du plancher bas n'est pas compté (EN 12831).
  const PB = D.PONTS_THERMIQUES.plancherBas;
  const surCave = { ...c, plancherDalle: 'beton', plancherLocal: 'cave_semi' };
  const bCave = D.find(D.PLANCHERS_LOCAL, 'cave_semi').b;
  proche(C.pontsThermiques(sejour, c).total, 3.6125 - PB.iti[0] * 10, 1e-3); // ITI
  proche(C.pontsThermiques(sejour, { ...c, positionIsolantMur: 'exterieur' }).total, 7.787 - PB.ite[0] * 10, 1e-3); // ITE
  proche(C.pontsThermiques(sejour, { ...c, isolantMur: { materiau: 'aucun', epaisseur: '' } }).total, 8.621 - PB.non_isole[0] * 10, 1e-3); // non isolé
  proche(C.pontsThermiques(sejour, surCave).total, 3.6125 - PB.iti[0] * 10 * (1 - bCave), 1e-3);
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

test('climatisation : total simultané par créneaux horaires (occupants plafonnés au foyer)', () => {
  const P = (nom, vit, occ) => ({ nom, longueur: '4', largeur: '4', hauteur: '2,5', lineaire: '4', sousToiture: 'non', vitrages: vit, occupants: occ, equipements: '', debit: '' });
  const pieces = [P('Chambre 1', [{ orientation: 'E', type: 'double', surface: '2', volet: 'non' }], '2'),
    P('Chambre 2', [{ orientation: 'O', type: 'double', surface: '2', volet: 'non' }], '2'),
    P('Séjour', [{ orientation: 'S', type: 'double', surface: '4', volet: 'non' }], '4')];
  const r = C.calculChantier({ climat, prime: { personnes: '4' }, pieces });
  assert.ok(r.climatisation < r.climSommePieces);
  // Recalcul à la main : 4 personnes sur 8 ; maximum sur les créneaux.
  const g = D.find(D.VITRAGES, 'double').g;
  const cren = (id) => D.find(D.ORIENTATIONS, id).cren;
  let base = 0, transm = 0, latent = 0;
  r.pieces.forEach(x => { base += x.apports.equipements + 0.5 * x.apports.occupants; transm += x.clim.transmission; latent += x.apports.latentAir + 0.5 * x.apports.latentOccupants; });
  const sj = D.CLIM.heuresCreneaux.map((h, j) => base + D.CLIM.partEcartCreneaux[j] * transm + 2 * g * cren('E')[j] + 2 * g * cren('O')[j] + 4 * g * cren('S')[j]);
  const sensible = Math.min(Math.max(...sj), r.pieces.reduce((s, x) => s + x.clim.sensible, 0));
  proche(r.climSensible, sensible);
  proche(r.climLatent, latent);
  proche(r.climatisation, C.puissanceNominale(sensible, latent));
  assert.equal(r.climCreneau, D.CLIM.heuresCreneaux[sj.indexOf(Math.max(...sj))]);
});

test('climatisation : maison vitrée au Sud, pas de foisonnement solaire ; majoration réglable', () => {
  const P = (nom, or) => ({ nom, longueur: '4', largeur: '4', hauteur: '2,5', lineaire: '4', sousToiture: 'non', occupants: '', equipements: '', debit: '',
    vitrages: [{ orientation: or, type: 'double', surface: '3', volet: 'non' }] });
  const sud = C.calculChantier({ climat, prime: { personnes: '4' }, pieces: [P('Séjour', 'S'), P('Chambre 1', 'S'), P('Chambre 2', 'S')] });
  const mixte = C.calculChantier({ climat, prime: { personnes: '4' }, pieces: [P('Séjour', 'S'), P('Chambre 1', 'E'), P('Chambre 2', 'N')] });
  // Sud : le soleil des 3 pièces culmine ensemble (15 h) ; le total reste ≤ somme des pièces.
  assert.ok(sud.climSensible / sud.pieces.reduce((s, x) => s + x.clim.sensible, 0) > mixte.climSensible / mixte.pieces.reduce((s, x) => s + x.clim.sensible, 0));
  assert.ok(sud.climSensible <= sud.pieces.reduce((s, x) => s + x.clim.sensible, 0) + 1e-9);
  const maj = C.calculChantier({ climat: { ...climat, majorationClim: '10' }, prime: { personnes: '4' }, pieces: [P('Séjour', 'S')] });
  const sans = C.calculChantier({ climat, prime: { personnes: '4' }, pieces: [P('Séjour', 'S')] });
  proche(maj.climatisation, 1.1 * sans.climatisation);
  proche(maj.pieces[0].climatisation, 1.1 * sans.pieces[0].climatisation);
  assert.equal(C.majorationClim({ majorationClim: '-5' }), 1);
  assert.equal(C.majorationClim({}), 1 + D.CLIM.majorationDefaut / 100);
});

test('climatisation : créneaux cohérents avec les pointes des pièces et la table w', () => {
  const verticales = D.ORIENTATIONS.filter(o => !o.toit);
  D.ORIENTATIONS.forEach(o => {
    assert.equal(o.cren.length, D.CLIM.heuresCreneaux.length, o.id);
    assert.ok(Math.max(...o.cren) <= 1.2 * o.wPiece, o.id);
  });
  // À 17 h, la moyenne des façades redonne la table w « maison entière » à ±10 %.
  const moy17 = verticales.reduce((s, o) => s + o.cren[3], 0) / verticales.length;
  const moyW = verticales.reduce((s, o) => s + o.w, 0) / verticales.length;
  assert.ok(Math.abs(moy17 / moyW - 1) < 0.1);
  proche(C.rayonnementCreneaux('mixte')[3], moy17);
});

test('mode global : niveaux virtuels, périmètre estimé, fenêtres réparties', () => {
  const g = { surface: '120', hauteur: '2,5', niveaux: '2', perimetre: '', sousToiture: 'oui', surPlancherBas: 'oui',
    vitrageMode: 'detail', occupants: '', equipements: '',
    vitrages: [{ orientation: 'S', type: 'double', surface: '4', volet: 'non' }, { orientation: 'O', type: 'double', surface: '3', volet: 'non' },
      { orientation: 'N', type: 'double', surface: '2', volet: 'non' }, { orientation: 'toit', type: 'double_argon', surface: '1', volet: 'non' }] };
  proche(C.perimetreGlobal(g), D.GLOBAL.facteurPerimetre * Math.sqrt(60));
  assert.equal(C.perimetreGlobal({ ...g, perimetre: '25' }), 25);
  const niveaux = C.piecesGlobales(g, 4);
  assert.equal(niveaux.length, 2);
  // Plancher bas au niveau 1, toiture au dernier niveau.
  assert.deepEqual(niveaux.map(n => [n.surPlancherBas, n.sousToiture]), [['oui', 'non'], ['non', 'oui']]);
  // Toutes les baies réparties une seule fois ; fenêtre de toit au dernier niveau.
  assert.equal(niveaux.reduce((s, n) => s + n.vitrages.length, 0), 4);
  assert.ok(niveaux[1].vitrages.some(v => v.orientation === 'toit'));
  // Occupants : le foyer réparti sur les niveaux.
  proche(niveaux.reduce((s, n) => s + C.num(n.occupants), 0), 4);
  const r = C.calculChantier({ mode: 'global', climat, prime: { personnes: '4' }, global: g, pieces: [] });
  assert.equal(r.mode, 'global');
  assert.equal(r.pieces.length, 2);
  proche(r.pieces.reduce((s, x) => s + x.surface, 0), 120);
  // Plancher d'étage compté une seule fois (moitié de chaque côté).
  proche(r.pieces[0].pontsThermiques.longueurs.plancherIntermediaire + r.pieces[1].pontsThermiques.longueurs.plancherIntermediaire,
    C.perimetreGlobal(g));
  assert.ok(r.chauffage > 0 && r.climatisation > 0);
});

test('mode global : cohérent avec le calcul pièce par pièce du même logement', () => {
  const iso = (m, e) => ({ materiau: m, epaisseur: String(e) });
  const A = { ...climat, isolantMur: iso('pse', 4), isolantToiture: iso('laine_verre', 10), positionIsolantMur: 'interieur', surpuissance: '10' };
  const PM = (nom, L, l, lin, vit, occ) => ({ nom, longueur: String(L), largeur: String(l), hauteur: '2,5', lineaire: String(lin), sousToiture: 'oui',
    surPlancherBas: 'oui', vitrageMode: 'detail', occupants: String(occ), activite: 'sedentaire', equipements: '', debit: '',
    vitrages: vit.map(([o, s]) => ({ orientation: o, type: 'double', surface: String(s), volet: 'oui' })) });
  const pieces = [PM('Séjour', 7, 5, 12, [['S', 4], ['O', 2]], 4), PM('Cuisine', 4, 3, 4, [['E', 1.5]], 2), PM('Chambre 1', 4, 3.5, 7.5, [['E', 1.6]], 2),
    PM('Chambre 2', 4, 3, 7, [['N', 1.2]], 1), PM('Chambre 3', 3.7, 3, 3.7, [['O', 1.4]], 1), PM('Salle de bain', 3.5, 2, 3.5, [['N', 0.6]], 0),
    PM('Entrée', 3, 3, 3, [['N', 0.5]], 0)];
  const parPiece = C.calculChantier({ mode: 'pieces', climat: A, prime: { personnes: '4' }, pieces });
  const g = { surface: '100.1', hauteur: '2,5', niveaux: '1', perimetre: '', sousToiture: 'oui', surPlancherBas: 'oui', vitrageMode: 'detail',
    vitrages: [].concat(...pieces.map(p => p.vitrages)), occupants: '', equipements: '' };
  const global = C.calculChantier({ mode: 'global', climat: A, prime: { personnes: '4' }, global: g, pieces });
  assert.ok(Math.abs(global.chauffage / parPiece.chauffage - 1) < 0.05, 'chauffage à ±5 %');
  assert.ok(Math.abs(global.climatisation / parPiece.climatisation - 1) < 0.05, 'climatisation à ±5 %');
});

test('coefficient G estimé = déperditions totales / volume chauffé', () => {
  const p = (L, l, lin) => ({ nom: 'Pièce', longueur: L, largeur: l, hauteur: '2,5', lineaire: lin, vitrages: [], debit: '' });
  const r = C.calculChantier({ climat, prime: {}, pieces: [p('5', '4', '9'), p('4', '3', '4')] });
  const gv = r.pieces[0].G + r.pieces[1].G;
  proche(r.deperditionsTotales, gv);
  proche(r.volume, (20 + 12) * 2.5);
  proche(r.coefficientG, gv / 80);
  // P = G × V × ΔT, avant surpuissance de relance.
  proche(r.coefficientG * r.volume * 35, r.pieces[0].chauffageBase + r.pieces[1].chauffageBase);
  assert.equal(C.calculChantier({ climat, prime: {}, pieces: [] }).coefficientG, 0);
});

test('pièce saisie en m² : même résultat que longueur × largeur', () => {
  const base = { nom: 'Séjour', hauteur: '2,5', lineaire: '9', vitrages: [], debit: '', vitrageMode: 'rapide',
    vitrageRapide: { niveau: 'moyen', orientation: 'S', type: 'double', volet: 'non' } };
  const lxl = Object.assign({ longueur: '5', largeur: '4' }, base);
  const m2 = Object.assign({ saisieSurface: 'surface', surface: '20', longueur: '9', largeur: '9' }, base);
  assert.equal(C.surfacePiece(m2), 20);
  assert.equal(C.surfacePiece(lxl), 20);
  const a = C.calculPiece(lxl, climat);
  const b = C.calculPiece(m2, climat);
  proche(b.surface, 20);
  proche(b.volume, 50);
  proche(b.chauffage, a.chauffage);
  proche(b.climatisation, a.climatisation);
  proche(b.surfaceVitree, a.surfaceVitree);
  proche(b.debit, a.debit);
  // Surface vide ou négative : pièce sans surface.
  assert.equal(C.surfacePiece({ saisieSurface: 'surface', surface: '' }), 0);
  assert.equal(C.surfacePiece({ saisieSurface: 'surface', surface: '-3' }), 0);
});

test('climatisation : total simultané jamais inférieur à la plus grosse pièce', () => {
  // Grande baie Est : la pièce culmine le matin, le créneau maison de 10 h ne la couvre pas.
  const P = (nom, vit, toit) => ({ nom, longueur: '5', largeur: '4', hauteur: '2,5', lineaire: '9', sousToiture: toit, vitrages: vit, occupants: '', equipements: '', debit: '' });
  const pieces = [P('Séjour', [{ orientation: 'E', type: 'double', surface: '8', volet: 'non' }], 'oui'),
    P('Chambre 1', [{ orientation: 'N', type: 'double', surface: '1', volet: 'non' }], 'non')];
  const r = C.calculChantier({ climat, prime: { personnes: '2' }, pieces });
  proche(r.climatisation, Math.max(...r.pieces.map(x => x.climatisation)));
  assert.ok(r.climatisation <= r.climSommePieces + 1e-9);
});

test('type d\'installation : air/eau par défaut, air/air sans radiateur ni régime d\'eau', () => {
  const piece = { nom: 'Séjour', longueur: '5', largeur: '4', hauteur: '2,5', lineaire: '9', sousToiture: 'oui', vitrages: [], occupants: '', equipements: '', debit: '',
    radiateur: { materiau: 'acier', typeAcier: '22', hauteur: '60', longueur: '100' } };
  const base = { climat, prime: { personnes: '2' }, installation: { regimeEau: '45/35' }, pieces: [piece] };
  const eau = C.calculChantier(base);
  const air = C.calculChantier({ ...base, systeme: 'air_air' });
  assert.equal(C.systemeChantier({}), 'air_eau');
  assert.equal(eau.systeme, 'air_eau');
  assert.equal(air.systeme, 'air_air');
  assert.ok(eau.pieces[0].radiateurExistant);
  assert.equal(air.pieces[0].radiateurExistant, null);
  // Mêmes besoins : seul l'émetteur change.
  proche(air.chauffage, eau.chauffage);
  proche(air.climatisation, eau.climatisation);
});

test('plusieurs radiateurs existants dans une pièce : puissances additionnées', () => {
  const r1 = { materiau: 'acier', typeAcier: '22', hauteur: '60', longueur: '100' };
  const r2 = { materiau: 'fonte', hauteurElement: '600', elements: '10' };
  const piece = { nom: 'Séjour', longueur: '5', largeur: '4', hauteur: '2,5', lineaire: '9', sousToiture: 'oui', vitrages: [], occupants: '', equipements: '', debit: '',
    radiateurs: [r1, { materiau: '' }, r2] };
  const ex = C.calculPiece(piece, climat, '45/35').radiateurExistant;
  const cat = C.radiateurExistant(r1) + C.radiateurExistant(r2);
  proche(ex.puissanceCatalogue, cat);
  proche(ex.puissance, cat * C.facteurRegime('45/35', climat.tConfortHiver));
  assert.deepEqual(ex.detail.map(d => d.index), [0, 2]);
  assert.equal(C.calculPiece({ ...piece, radiateurs: [] }, climat).radiateurExistant, null);
  // Relevés antérieurs : un seul radiateur.
  proche(C.calculPiece({ ...piece, radiateurs: undefined, radiateur: r1 }, climat).radiateurExistant.puissanceCatalogue, C.radiateurExistant(r1));
});

test('plancher bas : type de dalle et local dessous (b), relevés antérieurs repris', () => {
  const k = (dalle, local, iso) => ({ ...climat, plancherDalle: dalle, plancherLocal: local, isolantPlancher: iso || { materiau: 'aucun', epaisseur: '' } });
  const rD = (id) => R(D.PLANCHERS_DALLE, id);
  const b = (id) => D.find(D.PLANCHERS_LOCAL, id).b;
  proche(C.uEnveloppe(k('beton', 'terre_plein')).plancher, 1 / (rD('beton') + 1.75));
  proche(C.uEnveloppe(k('machefer', 'cave_enterree')).plancher, b('cave_enterree') / (rD('machefer') + D.R_SE_LOCAL));
  proche(C.uEnveloppe(k('bois', 'vide_sanitaire', { materiau: 'laine_verre', epaisseur: '10' })).plancher,
    b('vide_sanitaire') / (rD('bois') + 0.10 / lambda('laine_verre') + D.R_SE_LOCAL));
  assert.equal(C.uEnveloppe(k('beton', 'cave_chauffee')).plancher, 0);
  // Cave plus ventilée : plus de déperditions.
  const u = (l) => C.uEnveloppe(k('beton', l)).plancher;
  assert.ok(u('cave_enterree') < u('cave_semi') && u('cave_semi') < u('sous_sol_ventile'));
  // Pont thermique du plancher bas réduit par b ; nul sur cave chauffée ou dalle bois.
  const piece = { longueur: '4', largeur: '4', hauteur: '2,5', lineaire: '8', sousToiture: 'non', vitrages: [] };
  const pt = (c) => C.calculPiece(piece, c).pontsThermiques.detail.plancherBas;
  proche(pt(k('beton', 'cave_enterree')) / b('cave_enterree'), pt(k('beton', 'cave_semi')) / b('cave_semi'));
  assert.ok(pt(k('beton', 'cave_enterree')) > 0);
  assert.equal(pt(k('beton', 'terre_plein')), 0); // sol : méthode simplifiée de la NF EN 12831
  assert.equal(pt(k('beton', 'cave_chauffee')), 0);
  assert.equal(pt(k('bois', 'cave_enterree')), 0);
  // Ancien choix unique (plancherType) : correspondance dalle + dessous.
  const ancien = { ...climat, plancherType: 'bois_vs' };
  proche(C.uEnveloppe(ancien).plancher, C.uEnveloppe(k('bois', 'vide_sanitaire')).plancher);
});

test('murs exposés : linéaire calculé d\'après le nombre de murs, saisie prioritaire', () => {
  const p = { longueur: '5', largeur: '3', hauteur: '2,5', sousToiture: 'non', vitrages: [] };
  assert.deepEqual([0, 1, 2, 3, 4].map(n => C.lineaireMurs(p, n)), [0, 5, 8, 13, 16]);
  const carre = { saisieSurface: 'surface', surface: '16' };
  assert.deepEqual([1, 2, 4].map(n => C.lineaireMurs(carre, n)), [4, 8, 16]);
  assert.equal(C.lineairePiece({ ...p, mursExposes: '2', lineaire: '' }), 8);
  assert.equal(C.lineairePiece({ ...p, mursExposes: '2', lineaire: '6,5' }), 6.5);
  assert.equal(C.lineairePiece({ ...p, mursExposes: '', lineaire: '' }), 0);
  // Même résultat qu'avec le linéaire saisi à la main.
  const auto = C.calculPiece({ ...p, mursExposes: '3', lineaire: '' }, climat);
  const main = C.calculPiece({ ...p, lineaire: '13', mursExposes: '3' }, climat);
  proche(auto.G, main.G);
  assert.equal(auto.lineaireAuto, true);
  assert.equal(main.lineaireAuto, false);
});

test('confort hiver propre à une pièce : vide = celui du chantier', () => {
  // À l'étage : déperditions proportionnelles à l'écart de température (le sol ne l'est pas, fg2).
  const p = { longueur: '4', largeur: '4', hauteur: '2,5', lineaire: '8', sousToiture: 'non', surPlancherBas: 'non', vitrages: [], debit: '20',
    radiateurs: [{ materiau: 'fonte', hauteurElement: '600', elements: '10' }] };
  const ref = C.calculPiece(p, climat, '45/35');
  const meme = C.calculPiece({ ...p, tConfortHiver: '' }, climat, '45/35');
  proche(meme.chauffage, ref.chauffage);
  assert.equal(ref.tConfortAuto, true);
  proche(ref.tConfortHiver, C.num(climat.tConfortHiver));
  const sdb = C.calculPiece({ ...p, tConfortHiver: '24' }, climat, '45/35');
  assert.equal(sdb.tConfortAuto, false);
  const dt = (t) => t - C.num(climat.tBaseHiver);
  proche(sdb.chauffageBase, ref.chauffageBase * dt(24) / dt(C.num(climat.tConfortHiver)));
  // Radiateur : facteur de régime calculé à la température de la pièce.
  proche(sdb.facteurRegime, C.facteurRegime('45/35', '24'));
  // Le total chantier additionne les pièces.
  const tot = C.calculChantier({ climat, prime: {}, pieces: [p, { ...p, tConfortHiver: '24' }] });
  proche(tot.chauffage, ref.chauffage + sdb.chauffage);
});

test('murs : épaisseur et revêtement intérieur', () => {
  const k = (o) => ({ ...climat, isolantMur: { materiau: 'aucun', epaisseur: '' }, ...o });
  const RS = D.R_SURFACE_MUR;
  // Épaisseur vide : R du type de paroi, inchangé.
  proche(C.rMur(k({ murType: 'parpaing' })), R(D.MURS, 'parpaing'));
  assert.equal(C.epaisseurMur(k({ murType: 'parpaing' })), 20);
  // Épaisseur doublée : la part maçonnerie double.
  proche(C.rMur(k({ murType: 'parpaing', epaisseurMur: '40' })), RS + 2 * (R(D.MURS, 'parpaing') - RS));
  proche(C.rMur(k({ murType: 'pierre', epaisseurMur: '60' })), RS + 1.2 * (R(D.MURS, 'pierre') - RS));
  // Ossature bois : épaisseur sans effet.
  assert.equal(C.epaisseurMur(k({ murType: 'ossature_bois', epaisseurMur: '15' })), null);
  proche(C.rMur(k({ murType: 'ossature_bois', epaisseurMur: '15' })), R(D.MURS, 'ossature_bois'));
  // Revêtement intérieur ajouté.
  const rev = (id) => D.find(D.REVETEMENTS_MUR, id).r;
  ['platre', 'ba13', 'bois', 'ytong'].forEach(id =>
    proche(C.rMur(k({ murType: 'parpaing', revetementMur: id })), R(D.MURS, 'parpaing') + rev(id)));
  proche(C.uEnveloppe(k({ murType: 'parpaing', revetementMur: 'ba13', isolantMur: { materiau: 'laine_verre', epaisseur: '10' } })).mur,
    1 / (R(D.MURS, 'parpaing') + rev('ba13') + 0.10 / lambda('laine_verre')));
});

test('isolation des murs propre à une pièce, sinon celle du chantier', () => {
  const p = { longueur: '4', largeur: '4', hauteur: '2,5', lineaire: '8', sousToiture: 'non', vitrages: [] };
  const ref = C.calculPiece(p, climat);
  // « chantier » (ou absent) : isolation du chantier.
  proche(C.calculPiece({ ...p, isolationMurs: 'chantier', isolantMur: { materiau: 'aucun', epaisseur: '' } }, climat).G, ref.G);
  assert.equal(ref.isolationMursPerso, false);
  // « perso » non isolée : U mur et ponts thermiques sans isolant.
  const nu = C.calculPiece({ ...p, isolationMurs: 'perso', isolantMur: { materiau: 'aucun', epaisseur: '' } }, climat);
  assert.equal(nu.isolationMursPerso, true);
  proche(nu.u.mur, 1 / R(D.MURS, 'parpaing'));
  assert.equal(nu.pontsThermiques.isolation, 'non_isole');
  assert.ok(nu.chauffage > ref.chauffage);
  // « perso » en ITE : ponts thermiques ITE, U selon l'isolant de la pièce.
  const ite = C.calculPiece({ ...p, isolationMurs: 'perso', isolantMur: { materiau: 'laine_verre', epaisseur: '14' }, positionIsolantMur: 'exterieur' }, climat);
  proche(ite.u.mur, 1 / (R(D.MURS, 'parpaing') + 0.14 / lambda('laine_verre')));
  assert.equal(ite.pontsThermiques.isolation, 'ite');
});

test('deux murs d\'une même pièce avec deux isolations différentes', () => {
  const p = { longueur: '5', largeur: '4', hauteur: '2,5', mursExposes: '2', lineaire: '', sousToiture: 'non', vitrages: [] };
  const nu = { materiau: 'aucun', epaisseur: '' };
  const lv = { materiau: 'laine_verre', epaisseur: '10' };
  const k = { ...climat, isolantMur: nu };
  const uNu = 1 / R(D.MURS, 'parpaing');
  const uLv = 1 / (R(D.MURS, 'parpaing') + 0.10 / lambda('laine_verre'));
  // Mur de 5 m isolé en ITE, le reste (4 m) avec l'isolation du chantier (aucune).
  const r = C.calculPiece({ ...p, isolationMurs: 'perso', mursIsolation: [{ longueur: '5', ...lv, position: 'exterieur' }] }, k);
  assert.deepEqual(r.mursIsolation.map(m => [m.longueur, m.chantier]), [[5, false], [4, true]]);
  proche(r.u.mur, (5 * uLv + 4 * uNu) / 9);
  assert.equal(r.pontsThermiques.isolation, 'mixte');
  // Ponts thermiques : moyenne pondérée des deux isolations.
  const ptIte = C.calculPiece(p, { ...k, isolantMur: lv, positionIsolantMur: 'exterieur' }).pontsThermiques.total;
  const ptNu = C.calculPiece(p, k).pontsThermiques.total;
  proche(r.pontsThermiques.total, (5 * ptIte + 4 * ptNu) / 9);
  // Deux murs saisis : le second sans longueur prend le reste.
  const deux = C.calculPiece({ ...p, isolationMurs: 'perso', mursIsolation: [{ longueur: '5', ...lv }, { longueur: '', ...nu }] }, { ...climat });
  assert.deepEqual(deux.mursIsolation.map(m => m.longueur), [5, 4]);
  proche(deux.u.mur, (5 * uLv + 4 * uNu) / 9);
  // Longueurs saisies > linéaire : ramenées au linéaire.
  const trop = C.calculPiece({ ...p, isolationMurs: 'perso', mursIsolation: [{ longueur: '9', ...lv }, { longueur: '9', ...nu }] }, k);
  proche(trop.mursIsolation.reduce((s, m) => s + m.longueur, 0), 9);
  // Sans linéaire ni nombre de murs : le linéaire vient des longueurs des murs.
  const sansL = C.calculPiece({ ...p, mursExposes: '', isolationMurs: 'perso', mursIsolation: [{ longueur: '3', ...lv }, { longueur: '2', ...nu }] }, k);
  proche(sansL.lineaire, 5);
  // Relevé antérieur : une seule isolation propre à la pièce, sur tout le linéaire.
  const ancien = C.calculPiece({ ...p, isolationMurs: 'perso', isolantMur: lv, positionIsolantMur: 'interieur' }, k);
  proche(ancien.u.mur, uLv);
});

test('température de sortie d\'eau : 35 à 60 °C par pas de 5, type de PAC indiqué', () => {
  assert.deepEqual(D.REGIMES_EAU.map(r => r.depart), [35, 40, 45, 50, 55, 60]);
  D.REGIMES_EAU.forEach(r => {
    assert.equal(r.id, r.depart + '/' + r.retour);
    assert.ok(/^PAC /.test(r.type), r.id);
    assert.ok(r.label.indexOf(r.type) >= 0);
  });
  // Plus l'eau est chaude, plus un radiateur donné émet.
  const f = D.REGIMES_EAU.map(r => C.facteurRegime(r.id, '20'));
  f.slice(1).forEach((x, k) => assert.ok(x > f[k]));
  assert.ok(f[f.length - 1] < 1);
});

test('catalogue Altech : radiateurs neufs et existants acier', () => {
  const M = D.CATALOGUE_RADIATEURS.modeles;
  assert.equal(M.length, 112);
  // Cohérence de la saisie : puissance proportionnelle à la largeur (±3 %) et ΔT30 ≈ 0,51 × ΔT50.
  const groupes = {};
  M.forEach(m => { (groupes[m.type + '-' + m.hauteur] = groupes[m.type + '-' + m.hauteur] || []).push(m); });
  Object.values(groupes).forEach(g => {
    const moy = g.reduce((s, m) => s + m.p50 / m.largeur, 0) / g.length;
    g.forEach(m => assert.ok(Math.abs(m.p50 / m.largeur / moy - 1) < 0.03, m.ref));
  });
  M.forEach(m => assert.ok(m.p30 / m.p50 > 0.49 && m.p30 / m.p50 < 0.53, m.ref));
  // Exposant n déduit de ΔT30 / ΔT50 ≈ celui du calcul (1,3).
  const n = Math.log(1747 / 879) / Math.log(50 / 30);
  assert.ok(Math.abs(n - D.EXPOSANT_RADIATEUR) < 0.06);
  // Existant : catalogue exact à la cote, interpolé entre hauteurs.
  proche(C.wParMetreCatalogue('11', 600), 1014, 2);
  const w650 = C.wParMetreCatalogue('22', 650);
  assert.ok(w650 > C.wParMetreCatalogue('22', 600) && w650 < C.wParMetreCatalogue('22', 700));
  assert.equal(C.wParMetreCatalogue('10', 600), null);
  // Neuf : le moins puissant couvrant le besoin ; hauteur imposée ; plusieurs au-delà du plus puissant.
  const r = C.radiateurNeuf(1500);
  assert.equal(r.modele.p50, Math.min(...M.map(m => m.p50).filter(p => p >= 1500)));
  assert.equal(r.nombre, 1);
  const h = C.radiateurNeuf(1500, '600');
  assert.equal(h.modele.hauteur, 600);
  assert.ok(h.modele.p50 >= 1500);
  const gros = C.radiateurNeuf(6000);
  assert.equal(gros.nombre, 2);
  assert.ok(gros.modele.p50 * 2 >= 6000);
  assert.equal(C.radiateurNeuf(0).valeur, null);
  // Hauteur lue dans l'installation par calculChantier.
  const piece = { longueur: '5', largeur: '4', hauteur: '2,5', lineaire: '9', sousToiture: 'oui', vitrages: [] };
  const ch = C.calculChantier({ climat, prime: {}, installation: { regimeEau: '45/35', hauteurRadiateur: '500' }, pieces: [piece] });
  assert.equal(ch.pieces[0].radiateurNeuf.modele.hauteur, 500);
});

test('personnes au foyer improbables (RFR saisi à la place) : ignorées', () => {
  const p = { nom: 'Pièce de vie', longueur: '6', largeur: '5', hauteur: '2,5', mursExposes: '2', vitrages: [], occupants: '', equipements: '' };
  const ok = C.calculChantier({ climat, prime: { personnes: '4' }, pieces: [p] });
  const ko = C.calculChantier({ climat, prime: { personnes: '43250', rfr: '43250' }, pieces: [p] });
  assert.equal(C.personnesFoyer({ personnes: '43250' }), null);
  assert.equal(C.personnesFoyer({ personnes: '4' }), 4);
  assert.equal(C.personnesFoyer({ personnes: '0' }), null);
  // Pièce de vie : occupants = foyer ; valeur ignorée → défaut (4), clim raisonnable.
  assert.equal(ko.foyer.source, 'defaut');
  proche(ko.pieces[0].climatisation, ok.pieces[0].climatisation);
  assert.ok(ko.pieces[0].climatisation < 10000);
  assert.equal(ko.anah, null);
});

test('plusieurs unités extérieures : bilan par unité', () => {
  const P = (nom, or, unite) => ({ nom, longueur: '4', largeur: '4', hauteur: '2,5', lineaire: '8', sousToiture: 'non', occupants: '', equipements: '', debit: '20',
    vitrages: [{ orientation: or, type: 'double', surface: '3', volet: 'non' }], unite });
  const pieces = [P('Séjour', 'S', 'a'), P('Chambre 1', 'E', 'b'), P('Chambre 2', 'O', 'b'), P('Bureau', 'N', 'inconnue')];
  const unites = [{ uid: 'a', nom: 'UE garage' }, { uid: 'b', nom: 'UE étage' }];
  const r = C.calculChantier({ climat, prime: { personnes: '4' }, installation: { unites }, pieces });
  assert.equal(r.unites.length, 2);
  // Unité inconnue ou vide : première unité.
  assert.deepEqual(r.unites.map(u => u.indices), [[0, 3], [1, 2]]);
  // Chauffage : somme des pièces de l'unité ; clim : bilan simultané des seules pièces de l'unité.
  proche(r.unites[0].chauffage + r.unites[1].chauffage, r.chauffage);
  const seul = C.calculChantier({ climat, prime: { personnes: '4' }, pieces: [pieces[1], pieces[2]] });
  proche(r.unites[1].climatisation, seul.climatisation);
  r.unites.forEach(u => assert.ok(u.climatisation <= u.climSommePieces + 1e-9));
  // Le total maison est inchangé ; une seule unité déclarée : pas de bilan par unité.
  proche(r.climatisation, C.calculChantier({ climat, prime: { personnes: '4' }, pieces }).climatisation);
  assert.equal(C.calculChantier({ climat, prime: {}, installation: { unites: [unites[0]] }, pieces }).unites.length, 0);
});

test('contre-cloison agglo : épaisseur, lame d\'air ou isolant', () => {
  const k = (agglo) => ({ ...climat, murType: 'parpaing', isolantMur: { materiau: 'aucun', epaisseur: '' }, revetementMur: 'agglo', agglo });
  const A = D.AGGLO_CONTRE_CLOISON;
  // Défaut : agglo 5 cm + lame d'air 3 cm.
  proche(C.rRevetement(k({})), A[5] + 0.18);
  proche(C.rRevetement(k({ epaisseur: '10', entre: 'air', lame: '1' })), A[10] + 0.15);
  proche(C.rLameAir('0,7'), 0.13);
  proche(C.rLameAir('2'), 0.17 + 0.01 * 0.5);
  proche(C.rRevetement(k({ epaisseur: '7.5', entre: 'colle' })), A[7.5]);
  proche(C.rRevetement(k({ epaisseur: '5', entre: 'isolant', isolant: { materiau: 'laine_verre', epaisseur: '4' } })), A[5] + 0.04 / lambda('laine_verre'));
  proche(C.rMur(k({ entre: 'colle' })), R(D.MURS, 'parpaing') + A[5]);
  // Isolant derrière la contre-cloison : ponts thermiques en ITI ; lame d'air : mur non isolé.
  assert.equal(C.isolationMur(k({ entre: 'isolant', isolant: { materiau: 'laine_verre', epaisseur: '4' } })), 'iti');
  assert.equal(C.isolationMur(k({ entre: 'air' })), 'non_isole');
});

test('NF EN 12831 : température de base par département, altitude et côte', () => {
  const tb = (departement, altitude, cote) => C.temperatureBase({ departement, altitude, cote });
  assert.equal(C.temperatureBase({}), null);
  assert.equal(D.DEPARTEMENTS.length, 95);
  assert.equal(tb('57', '').t, -15);           // Moselle, plaine
  assert.equal(tb('57', '450').t, -16);        // 401-500 m
  assert.equal(tb('88', '1000').t, -21);       // Vosges, 901-1000 m
  assert.equal(tb('06', '50', 'oui').t, -4);   // Alpes-Maritimes, côte (< 25 km)
  assert.equal(tb('06', '50', 'non').t, -5);
  assert.equal(tb('05', '1500').t, -22);       // Hautes-Alpes (-10), 1401-1500 m
  assert.equal(tb('20', '0', 'oui').t, -2);    // Corse
  const hors = tb('14', '800');                // Calvados (-7) : tableau limité à 500 m
  assert.equal(hors.horsTable, true);
  assert.equal(hors.t, -9);
  // Moyenne annuelle (sol) : -15 °C → 8 °C ; -7 → 11 ; -2 → 13.
  assert.deepEqual([-15, -7, -2, -30].map(C.temperatureMoyenne), [8, 11, 13, 5]);
});

test('NF EN 12831 : plancher sur terre-plein (U équivalent, B\', fg1, fg2)', () => {
  // Points du tableau.
  proche(C.uEquivalentSol(3, 2), 1.3);
  proche(C.uEquivalentSol(0.5, 10), 0.23);
  proche(C.uEquivalentSol(0.25, 20), 0.12);
  // Interpolation entre colonnes et lignes ; bornes.
  proche(C.uEquivalentSol(2.5, 4), (0.88 + 0.59) / 2);
  proche(C.uEquivalentSol(1, 7), (0.38 + 0.33) / 2);
  proche(C.uEquivalentSol(6, 1), 1.3);
  // Exemple Thermexcel : U 0,82, B' 7,5, 20 / 12 / -7 °C → fg1 × fg2 = 0,4296 (fg1 1,45).
  proche(D.SOL.fg1 * (20 - 12) / 27, 0.4296, 1e-3);
  // Pièce : B' de la pièce (surface / ½ linéaire) si dalle non isolée ; du bâtiment si dalle isolée.
  const k = { ...climat, plancherDalle: 'beton', plancherLocal: 'terre_plein' };
  const p = { longueur: '5', largeur: '4', hauteur: '2,5', lineaire: '9', sousToiture: 'non', vitrages: [] };
  const r = C.calculPiece(p, k);
  proche(r.sol.bPrime, 20 / 4.5);
  proche(r.u.plancher, D.SOL.fg1 * 12 / 35 * C.uEquivalentSol(4, 20 / 4.5));
  const iso = { ...k, isolantPlancher: { materiau: 'pse', epaisseur: '10' } };
  const ch = C.calculChantier({ climat: iso, prime: {}, pieces: [p, { ...p, lineaire: '4' }] });
  assert.equal(ch.pieces[0].sol.parBatiment, true);
  proche(ch.pieces[0].sol.bPrime, 40 / (0.5 * 13));
  // Plus chaud dedans : fg2 plus grand.
  assert.ok(C.calculPiece({ ...p, tConfortHiver: '24' }, k).sol.fg2 > r.sol.fg2);
});

test('NF EN 12831 : ventilation (infiltrations, minimum hygiénique, VMC, double flux)', () => {
  const V = 50; // 5 × 4 × 2,5
  const p = { nom: 'Séjour', longueur: '5', largeur: '4', hauteur: '2,5', mursExposes: '2', vitrages: [] };
  const ctx = { sommeVolumes: 200, vex: 120 };
  const e = (expo, f) => D.find(D.EXPOSITIONS, expo).e[f];
  // Sans VMC : max(infiltrations, 0,5 vol/h).
  const nat = C.ventilationPiece(p, { ventilation: 'aucune' }, ctx);
  proche(nat.vinf, 2 * V * 7 * e('modere', 2));
  proche(nat.debit, Math.max(nat.vinf, 0.5 * V));
  // Classe d'étanchéité, n50 mesuré, exposition.
  proche(C.ventilationPiece(p, { ventilation: 'aucune', etancheite: 'faible' }, ctx).vinf, 2 * V * 12 * e('modere', 2));
  proche(C.ventilationPiece(p, { ventilation: 'aucune', n50: '2,5', exposition: 'non_abrite' }, ctx).vinf, 2 * V * 2.5 * e('non_abrite', 2));
  // VMC simple flux : débit extrait au prorata du volume, ajouté aux infiltrations.
  const sf = C.ventilationPiece(p, { ventilation: 'vmc_auto' }, ctx);
  proche(sf.vmech, 120 * 50 / 200);
  proche(sf.debit, sf.vinf + 30);
  proche(sf.debitEte, 30);
  // Double flux 80 % : air soufflé compté à 20 %, minimum hygiénique respecté.
  const df = C.ventilationPiece(p, { ventilation: 'double_flux', rendementDF: '80' }, ctx);
  proche(df.debit, df.vinf + 30 * 0.2);
  assert.ok(df.debit < sf.debit);
  // Pièce humide : 1,5 vol/h minimum.
  const sdb = C.ventilationPiece({ ...p, nom: 'Salle de bain', mursExposes: '0' }, { ventilation: 'aucune' }, ctx);
  proche(sdb.debit, 1.5 * V);
  // Débit extrait de la VMC selon le logement (arrêté de 1982) : F4, 1 SdB + 1 WC → 111 m³/h ; 2 SdB → 126.
  const P = (nom) => ({ nom, longueur: '4', largeur: '4', hauteur: '2,5' });
  const logement = ['Séjour', 'Chambre 1', 'Chambre 2', 'Chambre 3', 'Cuisine', 'Salle de bain', 'WC'].map(P);
  assert.equal(C.contexteChantier({ ventilation: 'vmc_auto' }, logement).vex, 111);
  assert.equal(C.contexteChantier({ ventilation: 'vmc_auto' }, logement.concat([P('Salle d\'eau')])).vex, 126);
  assert.equal(C.contexteChantier({ ventilation: 'double_flux' }, logement.concat([P('Salle d\'eau')])).vex, 141);
  assert.equal(C.contexteChantier({ ventilation: 'vmc_auto', debitExtrait: '150' }, logement).vex, 150);
  assert.equal(C.contexteChantier({ ventilation: 'aucune' }, logement).vex, 0);
});

test('NF EN 12831 : murs sur local non chauffé (bu)', () => {
  const p = { longueur: '4', largeur: '4', hauteur: '2,5', lineaire: '8', sousToiture: 'non', vitrages: [], debit: '20' };
  const sans = C.calculPiece(p, climat);
  const avec = C.calculPiece({ ...p, paroisLnc: [{ longueur: '4', local: 'garage' }, { longueur: '2', local: 'logement' }] }, climat);
  proche(avec.deperditions.localNonChauffe, uMur * 4 * 2.5 * 0.6);
  proche(avec.G - sans.G, uMur * 4 * 2.5 * 0.6);
  assert.deepEqual(D.LOCAUX_NON_CHAUFFES.map(l => l.b).filter(b => b < 0 || b > 1), []);
});
