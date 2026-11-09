/*
 * Moteur de calcul : fonctions pures, sans accès au DOM.
 * Les champs saisis sont stockés tels que tapés (chaînes) ; num() les convertit.
 */
(function (root) {
  'use strict';

  var D = typeof module !== 'undefined' && module.exports ? require('./data.js') : root.Data;

  var COEF_AIR = 0.34; // W/(m³/h).K
  var REDUCTION_VOLET = 0.2; // W/m².K
  var U_VITRAGE_MIN = 0.5; // W/m².K
  var SEUIL_RADIATEUR_SUFFISANT = 0.95;

  // Convertit une saisie (« 2,5 », « 2.5 », « 1 200 ») en nombre ; 0 si vide ou invalide.
  function num(v) {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var n = parseFloat(String(v).replace(/[\s\u00a0\u202f]/g, '').replace(',', '.'));
    return isFinite(n) ? n : 0;
  }

  function estVide(v) {
    return v === null || v === undefined || String(v).trim() === '';
  }

  // R de l'isolant rapporté = épaisseur (m) / λ ; 0 si « Aucun isolant »
  function rIsolant(isolant) {
    if (!isolant) return 0;
    var m = D.find(D.ISOLANTS, isolant.materiau);
    if (!m || !m.lambda) return 0;
    return Math.max(num(isolant.epaisseur), 0) / 100 / m.lambda;
  }

  // U = 1 / (R base + R isolant) ; rBase null (« Aucun ») → U = 0
  function uParoi(rBase, isolant) {
    if (rBase === null || rBase === undefined) return 0;
    var r = rBase + rIsolant(isolant);
    return r > 0 ? 1 / r : 0;
  }

  // Plancher bas : { dalle, local } d'après la saisie, ou l'ancien choix unique (plancherType).
  function plancherBas(climat) {
    var ancien = D.PLANCHERS_ANCIENS[climat.plancherType] || D.PLANCHERS_ANCIENS.dalle;
    return {
      dalle: D.find(D.PLANCHERS_DALLE, climat.plancherDalle) || D.find(D.PLANCHERS_DALLE, ancien[0]),
      local: D.find(D.PLANCHERS_LOCAL, climat.plancherLocal) || D.find(D.PLANCHERS_LOCAL, ancien[1])
    };
  }

  // Coefficient appliqué aux déperditions du plancher bas : b du local dessous (1 sur terre-plein).
  function bPlancher(climat) {
    var local = plancherBas(climat).local;
    return local.rSol != null ? 1 : local.b;
  }

  function uPlancher(climat) {
    var p = plancherBas(climat);
    var r = p.dalle.r + rIsolant(climat.isolantPlancher);
    if (p.local.rSol != null) return 1 / (r + p.local.rSol);
    return p.local.b / (r + D.R_SE_LOCAL);
  }

  // Épaisseur du mur retenue (cm) : la saisie, sinon l'épaisseur courante du type de paroi.
  function epaisseurMur(climat) {
    var mur = D.find(D.MURS, climat.murType);
    if (!mur || !mur.e) return null;
    return estVide(climat.epaisseurMur) || !(num(climat.epaisseurMur) > 0) ? mur.e : num(climat.epaisseurMur);
  }

  // Résistance du mur hors isolant : maçonnerie à l'épaisseur retenue + revêtement intérieur.
  function rMur(climat) {
    var mur = D.find(D.MURS, climat.murType);
    if (!mur) return null;
    var r = mur.r;
    if (mur.e) {
      var lambda = mur.e / 100 / (mur.r - D.R_SURFACE_MUR);
      r = D.R_SURFACE_MUR + epaisseurMur(climat) / 100 / lambda;
    }
    var rev = D.find(D.REVETEMENTS_MUR, climat.revetementMur);
    return r + (rev ? rev.r : 0);
  }

  function uEnveloppe(climat) {
    var toit = D.find(D.TOITURES, climat.toitureType);
    return {
      mur: uParoi(rMur(climat), climat.isolantMur),
      toiture: toit ? uParoi(toit.r, climat.isolantToiture) : 0,
      plancher: uPlancher(climat)
    };
  }

  function uVitrage(vitrage) {
    var t = D.find(D.VITRAGES, vitrage.type);
    if (!t) return 0;
    return Math.max(t.u - (vitrage.volet === 'oui' ? REDUCTION_VOLET : 0), U_VITRAGE_MIN);
  }

  // Rayonnement d'été (W/m²) d'une orientation ; « mixte » = moyenne des orientations.
  // Moyenne d'une colonne de rayonnement sur les orientations verticales (hors fenêtres de toit).
  function moyenneVerticales(cle) {
    var somme = 0;
    var n = 0;
    D.ORIENTATIONS.forEach(function (o) {
      if (!o.toit) { somme += o[cle]; n++; }
    });
    return n ? somme / n : 0;
  }

  // Rayonnement de pointe simultané (maison entière, total chantier) ; « mixte » = moyenne.
  function rayonnement(orientationId) {
    if (orientationId === D.ORIENTATION_MIXTE.id) return moyenneVerticales('w');
    var o = D.find(D.ORIENTATIONS, orientationId);
    return o ? o.w : 0;
  }

  // Rayonnement de pointe propre à la pièce (choix du split).
  function rayonnementPiece(orientationId) {
    if (orientationId === D.ORIENTATION_MIXTE.id) return moyenneVerticales('wPiece');
    var o = D.find(D.ORIENTATIONS, orientationId);
    return o ? o.wPiece : 0;
  }

  // Charge solaire simultanée de la maison aux créneaux horaires (W/m² de baie × g) ; « mixte » = moyenne.
  function rayonnementCreneaux(orientationId) {
    var n = D.CLIM.heuresCreneaux.length;
    var valeurs = [];
    for (var j = 0; j < n; j++) valeurs.push(0);
    if (orientationId === D.ORIENTATION_MIXTE.id) {
      var verticales = D.ORIENTATIONS.filter(function (o) { return !o.toit; });
      verticales.forEach(function (o) { for (var k = 0; k < n; k++) valeurs[k] += o.cren[k] / verticales.length; });
      return valeurs;
    }
    var o = D.find(D.ORIENTATIONS, orientationId);
    return o && o.cren ? o.cren.slice() : valeurs;
  }

  function fenetreDeToit(vitrage) {
    var o = D.find(D.ORIENTATIONS, vitrage.orientation);
    return !!(o && o.toit);
  }

  // Surface au sol de la pièce : saisie directe en m², ou longueur × largeur.
  function surfacePiece(piece) {
    if (piece.saisieSurface === 'surface') return Math.max(num(piece.surface), 0);
    return num(piece.longueur) * num(piece.largeur);
  }

  // Linéaire de murs extérieurs d'après le nombre de murs exposés (0 à 4), côtés a ≥ b :
  // 1 mur = a, 2 murs (angle) = a + b, 3 murs = 2a + b, 4 murs = 2(a + b).
  // En saisie par surface, pièce carrée de même surface (côté √S).
  function lineaireMurs(piece, n) {
    var a, b;
    if (piece.saisieSurface === 'surface') {
      a = b = Math.sqrt(surfacePiece(piece));
    } else {
      a = Math.max(num(piece.longueur), num(piece.largeur), 0);
      b = Math.max(Math.min(num(piece.longueur), num(piece.largeur)), 0);
    }
    return [0, a, a + b, 2 * a + b, 2 * (a + b)][Math.min(Math.max(Math.round(n), 0), 4)];
  }

  // Linéaire retenu : la saisie en ml, sinon le calcul d'après le nombre de murs exposés,
  // sinon la somme des longueurs des murs à isolation propre.
  function lineairePiece(piece) {
    if (!estVide(piece.lineaire)) return Math.max(num(piece.lineaire), 0);
    if (!estVide(piece.mursExposes)) return lineaireMurs(piece, num(piece.mursExposes));
    var somme = 0;
    mursIsolationPiece(piece).forEach(function (m) { somme += Math.max(num(m.longueur), 0); });
    return somme;
  }

  // Murs à isolation propre de la pièce (isolationMurs « perso ») ; relevés antérieurs : une seule
  // isolation pour tous les murs (isolantMur de la pièce), soit un mur sans longueur.
  function mursIsolationPiece(piece) {
    if (piece.isolationMurs !== 'perso') return [];
    if (Array.isArray(piece.mursIsolation)) return piece.mursIsolation;
    var iso = piece.isolantMur || {};
    return [{ longueur: '', materiau: iso.materiau, epaisseur: iso.epaisseur, position: piece.positionIsolantMur }];
  }

  // Répartition du linéaire de murs extérieurs entre isolations : chaque mur saisi compte sa longueur,
  // le premier mur sans longueur prend le reste ; le linéaire restant garde l'isolation du chantier.
  // Les baies sont réparties au prorata des longueurs. Retourne [{ climat, f, longueur, chantier }].
  function segmentsMurs(piece, climat) {
    var murs = mursIsolationPiece(piece);
    if (!murs.length) return [{ climat: climat, f: 1, longueur: lineairePiece(piece), chantier: true }];
    var L = lineairePiece(piece);
    var saisi = 0;
    murs.forEach(function (m) { saisi += Math.max(num(m.longueur), 0); });
    // Longueurs saisies plus grandes que le linéaire : ramenées au linéaire.
    var echelle = saisi > L && saisi > 0 ? L / saisi : 1;
    var reste = Math.max(L - saisi * echelle, 0);
    var segments = murs.map(function (m) {
      var longueur = Math.max(num(m.longueur), 0) * echelle;
      if (estVide(m.longueur) && reste > 0) { longueur = reste; reste = 0; }
      return {
        climat: Object.assign({}, climat, {
          isolantMur: { materiau: m.materiau || 'aucun', epaisseur: m.epaisseur || '' },
          positionIsolantMur: m.position === 'exterieur' ? 'exterieur' : 'interieur'
        }),
        longueur: longueur,
        chantier: false
      };
    });
    if (reste > 0) segments.push({ climat: climat, longueur: reste, chantier: true });
    // Linéaire nul : une seule isolation retenue (la première), sans effet sur les murs.
    segments.forEach(function (sg, k) { sg.f = L > 0 ? sg.longueur / L : (k === 0 ? 1 : 0); });
    return segments;
  }

  // Vitrages pris en compte : la liste détaillée, ou en saisie rapide un vitrage
  // équivalent dont la surface vaut ratio du niveau × surface au sol.
  function vitragesPiece(piece) {
    if (piece.vitrageMode !== 'rapide') return piece.vitrages || [];
    var g = piece.vitrageRapide || {};
    var niveau = D.find(D.NIVEAUX_VITRAGE, g.niveau);
    var surfaceSol = surfacePiece(piece);
    return [{
      orientation: g.orientation,
      type: g.type,
      volet: g.volet,
      surface: niveau ? surfaceSol * niveau.ratio : 0
    }];
  }

  function debitEstime(piece, climat) {
    var v = D.find(D.VENTILATIONS, climat.ventilation);
    var volume = surfacePiece(piece) * num(piece.hauteur);
    return v ? volume * v.taux : 0;
  }

  // Débit retenu : la saisie si renseignée, sinon l'estimation volume × taux.
  function debitRetenu(piece, climat) {
    return estVide(piece.debit) ? debitEstime(piece, climat) : Math.max(num(piece.debit), 0);
  }

  // Plus petit palier ≥ valeur ; null si valeur nulle ; depasse si au-delà du dernier palier.
  function palier(valeur, paliers) {
    if (!(valeur > 0)) return { valeur: null, depasse: false };
    for (var i = 0; i < paliers.length; i++) {
      if (paliers[i] >= valeur - 1e-9) return { valeur: paliers[i], depasse: false };
    }
    return { valeur: null, depasse: true };
  }

  // Puissance ΔT50 par mètre de largeur d'un type du catalogue, pour une hauteur (mm) :
  // moyenne des modèles de cette hauteur, interpolée (ou prolongée) entre les hauteurs voisines.
  function wParMetreCatalogue(type, hauteur) {
    var parHauteur = {};
    D.CATALOGUE_RADIATEURS.modeles.forEach(function (m) {
      if (m.type !== type) return;
      (parHauteur[m.hauteur] = parHauteur[m.hauteur] || []).push(m.p50 / (m.largeur / 1000));
    });
    var hs = Object.keys(parHauteur).map(Number).sort(function (a, b) { return a - b; });
    if (!hs.length) return null;
    var w = function (h) { var v = parHauteur[h]; return v.reduce(function (s, x) { return s + x; }, 0) / v.length; };
    if (hs.length === 1) return w(hs[0]) * hauteur / hs[0];
    var k = 1;
    while (k < hs.length - 1 && hauteur > hs[k]) k++;
    var h0 = hs[k - 1], h1 = hs[k];
    return Math.max(w(h0) + (w(h1) - w(h0)) * (hauteur - h0) / (h1 - h0), 0);
  }

  // Radiateur neuf du catalogue : le moins puissant couvrant le besoin ΔT50, à la hauteur souhaitée
  // (toutes sinon) ; au-delà du plus puissant, plusieurs radiateurs identiques.
  function radiateurNeuf(besoin50, hauteur) {
    if (!(besoin50 > 0)) return { valeur: null, depasse: false };
    var modeles = D.CATALOGUE_RADIATEURS.modeles;
    var choix = modeles.filter(function (m) { return m.hauteur === num(hauteur); });
    if (!choix.length) choix = modeles;
    var plusPuissant = Math.max.apply(null, choix.map(function (m) { return m.p50; }));
    var nombre = Math.ceil(besoin50 / plusPuissant - 1e-9);
    var unitaire = besoin50 / nombre;
    var retenu = null;
    choix.forEach(function (m) {
      if (m.p50 < unitaire - 1e-9) return;
      if (!retenu || m.p50 < retenu.p50 || (m.p50 === retenu.p50 && m.largeur < retenu.largeur)) retenu = m;
    });
    return { valeur: retenu.p50 * nombre, depasse: false, nombre: nombre, modele: retenu };
  }

  function radiateurExistant(radiateur) {
    if (!radiateur || !radiateur.materiau) return null;
    var puissance = 0;
    if (radiateur.materiau === 'acier') {
      var t = D.find(D.RADIATEURS_ACIER, radiateur.typeAcier);
      var wm = wParMetreCatalogue(radiateur.typeAcier, num(radiateur.hauteur) * 10);
      if (wm !== null) puissance = wm * num(radiateur.longueur) / 100;
      else if (t) puissance = t.wm2 * (num(radiateur.hauteur) / 100) * (num(radiateur.longueur) / 100);
    } else {
      var table = D.RADIATEURS_ELEMENTS[radiateur.materiau];
      var parElement = table ? table[radiateur.hauteurElement] : 0;
      if (parElement) puissance = parElement * Math.max(Math.floor(num(radiateur.elements)), 0);
    }
    return Math.max(puissance, 0);
  }

  // Radiateurs relevés d'une pièce : la liste, sinon l'unique radiateur des relevés antérieurs.
  function radiateursPiece(piece) {
    if (Array.isArray(piece.radiateurs)) return piece.radiateurs;
    return piece.radiateur ? [piece.radiateur] : [];
  }

  // Écart de température logarithmique moyen entre l'eau du radiateur et la pièce.
  function ecartLogarithmique(depart, retour, ambiance) {
    var a = depart - ambiance;
    var b = retour - ambiance;
    if (a <= 0 || b <= 0) return 0;
    return Math.abs(a - b) < 1e-9 ? a : (a - b) / Math.log(a / b);
  }

  // Coefficient appliqué à une puissance catalogue (ΔT50) pour un régime d'eau donné :
  // (ΔTlm régime / ΔTlm 75/65/20)^1,3. Régime inconnu ou absent : 1 (référence catalogue).
  function facteurRegime(regimeId, tAmbiance) {
    var regime = D.find(D.REGIMES_EAU, regimeId);
    if (!regime) return 1;
    var ambiance = estVide(tAmbiance) ? 20 : num(tAmbiance);
    var reference = ecartLogarithmique(75, 65, 20);
    return Math.pow(ecartLogarithmique(regime.depart, regime.retour, ambiance) / reference, D.EXPOSANT_RADIATEUR);
  }

  // Type d'isolation du mur pour les ponts thermiques : non_isole, iti, ite, itr, iti_itr, ite_itr.
  // Position non renseignée : par l'intérieur (cas le plus courant, défaut 3CL).
  function isolationMur(climat) {
    var mur = D.find(D.MURS, climat.murType) || {};
    if (!(rIsolant(climat.isolantMur) > 0)) return mur.itr ? 'itr' : 'non_isole';
    var position = climat.positionIsolantMur === 'exterieur' ? 'ite' : 'iti';
    return mur.itr ? position + '_itr' : position;
  }

  // Ponts thermiques de la pièce (W/K) = Σ ψ × longueur, d'après la 3CL-DPE 2021 (§ 3.4).
  // Les longueurs sont déduites de la pièce : linéaire de murs extérieurs L, hauteur H, baies.
  function pontsThermiques(piece, climat) {
    var T = D.PONTS_THERMIQUES;
    var iso = isolationMur(climat);
    var mur = D.find(D.MURS, climat.murType) || {};
    var plancher = plancherBas(climat);
    var b = bPlancher(climat);
    var toit = D.find(D.TOITURES, climat.toitureType);
    var L = lineairePiece(piece);
    var H = Math.max(num(piece.hauteur), 0);
    var l = { plancherBas: 0, plancherHaut: 0, plancherIntermediaire: 0, refend: 0, menuiserie: 0 };
    var d = { plancherBas: 0, plancherHaut: 0, plancherIntermediaire: 0, refend: 0, menuiserie: 0 };
    if (L > 0) {
      // Sol : plancher bas lourd, sinon plancher d'étage (moitié comptée de chaque côté).
      // Sur cave chauffée, le plancher bas se comporte comme un plancher d'étage.
      if (piece.surPlancherBas !== 'non' && b > 0) {
        if (!mur.bois && !plancher.dalle.leger) {
          l.plancherBas = L;
          d.plancherBas = T.plancherBas[iso][rIsolant(climat.isolantPlancher) > 0 ? 1 : 0] * L * b;
        }
      } else {
        l.plancherIntermediaire += 0.5 * L;
      }
      // Plafond : toiture lourde (terrasse, dalle sous combles), sinon plancher d'étage.
      if (piece.sousToiture !== 'non' && toit && toit.r !== null) {
        if (!mur.bois && toit.lourd) {
          l.plancherHaut = L;
          d.plancherHaut = T.plancherHaut[iso][rIsolant(climat.isolantToiture) > 0 ? 1 : 0] * L;
        }
      } else {
        l.plancherIntermediaire += 0.5 * L;
      }
      if (climat.plancherEtage === 'leger') l.plancherIntermediaire = 0;
      d.plancherIntermediaire = T.plancherIntermediaire[iso] * l.plancherIntermediaire;
      // Pièce virtuelle du mode global : longueur de refends fournie (au prorata de la surface).
      l.refend = typeof piece.longueurRefend === 'number' ? piece.longueurRefend : T.refendParPiece * H;
      d.refend = T.refend[iso] * l.refend;
      if (!mur.bois) {
        if (piece.vitrageMode === 'rapide') {
          var S = 0;
          vitragesPiece(piece).forEach(function (v) { S += Math.max(num(v.surface), 0); });
          l.menuiserie = S > 0 ? Math.max(4 * Math.sqrt(S), T.perimetreRapide * S) : 0;
        } else {
          (piece.vitrages || []).forEach(function (v) {
            if (!fenetreDeToit(v)) l.menuiserie += 4 * Math.sqrt(Math.max(num(v.surface), 0));
          });
        }
        d.menuiserie = T.menuiserie[iso] * l.menuiserie;
      }
    }
    var total = d.plancherBas + d.plancherHaut + d.plancherIntermediaire + d.refend + d.menuiserie;
    return { isolation: iso, longueurs: l, detail: d, total: total };
  }

  /* ---------- Été : bilan de climatisation ---------- */

  // Écart équivalent (K) des murs au soleil, selon l'inertie et l'isolation, recalé sur l'écart été.
  function etdMur(climat, supplement) {
    var mur = D.find(D.MURS, climat.murType);
    if (!mur || !mur.inertie) return Math.max(D.CLIM.ecartReferenceEtd + supplement, 0);
    var cle = mur.inertie;
    if (cle === 'moyen') {
      var iso = isolationMur(climat);
      cle = 'moyen_' + (iso === 'iti' || iso === 'ite' ? iso : 'non_isole');
    }
    return Math.max(D.ETD_MURS[cle] + supplement, 0);
  }

  // Écart équivalent (K) de la toiture : combles chauds, rampants ou terrasse au soleil.
  function etdToiture(climat, supplement) {
    var toit = D.find(D.TOITURES, climat.toitureType);
    if (!toit || toit.r === null || toit.r === undefined) return 0;
    var etd = toit.etdNonIsole && !(rIsolant(climat.isolantToiture) > 0) ? toit.etdNonIsole : toit.etd;
    return Math.max((etd || D.CLIM.ecartReferenceEtd) + supplement, 0);
  }

  // Types reconnus dans le nom de la pièce (« Séjour-cuisine » = séjour + cuisine).
  function typesPiece(nom) {
    return D.TYPES_PIECE.filter(function (t) { return new RegExp(t.motif, 'i').test(nom || ''); });
  }

  // Occupants et équipements par défaut, utilisés quand le champ est vide.
  function defautsPiece(piece, surface, foyer) {
    var types = typesPiece(piece.nom);
    if (!types.length) return { occupants: D.CLIM.occupantsInconnu, equipements: D.CLIM.equipementsParM2 * surface };
    var occupants = 0;
    var equipements = 0;
    types.forEach(function (t) {
      occupants = Math.max(occupants, t.occupants === 'foyer' ? foyer : t.occupants);
      equipements += t.equipements;
    });
    return { occupants: occupants, equipements: equipements };
  }

  // Personnes du foyer saisies dans l'encart Prime, si plausibles (1 à foyerMax) ; sinon null.
  // Un revenu fiscal tapé dans ce champ donnait des dizaines de milliers d'occupants.
  function personnesFoyer(prime) {
    var n = prime ? Math.floor(num(prime.personnes)) : 0;
    return n >= 1 && n <= D.CLIM.foyerMax ? n : null;
  }

  // Personnes du foyer : occupants saisis en mode global ; encart Prime ; sinon nombre de
  // chambres + 1 (mode pièce par pièce) ; sinon valeur par défaut.
  function foyerChantier(chantier) {
    if (chantier.mode === 'global') {
      var occ = chantier.global ? num(chantier.global.occupants) : 0;
      if (occ > 0) return { n: occ, source: 'global' };
    }
    var n = personnesFoyer(chantier.prime);
    if (n) return { n: n, source: 'prime' };
    if (chantier.mode === 'global') return { n: D.CLIM.foyerDefaut, source: 'defaut' };
    var chambres = 0;
    (chantier.pieces || []).forEach(function (p) {
      if (typesPiece(p.nom).some(function (t) { return t.id === 'chambre'; })) chambres++;
    });
    return chambres ? { n: chambres + 1, source: 'chambres' } : { n: D.CLIM.foyerDefaut, source: 'defaut' };
  }

  /* ---------- Mode global (volume total) ---------- */

  function niveauxGlobal(g) {
    var n = Math.floor(num(g.niveaux)) || 1;
    return Math.max(1, Math.min(n, D.GLOBAL.niveauxMax));
  }

  // Périmètre des murs extérieurs d'un niveau : la saisie, sinon l'estimation 4,1 × √emprise.
  function perimetreGlobal(g) {
    if (!estVide(g.perimetre)) return Math.max(num(g.perimetre), 0);
    return D.GLOBAL.facteurPerimetre * Math.sqrt(Math.max(num(g.surface), 0) / niveauxGlobal(g));
  }

  // Le logement saisi d'un bloc est découpé en niveaux virtuels, calculés comme des pièces :
  // plancher bas au premier niveau, toiture au dernier, planchers d'étage entre les deux.
  // Les baies sont réparties entre les niveaux (fenêtres de toit au dernier niveau).
  function piecesGlobales(g, foyer) {
    g = g || {};
    var n = niveauxGlobal(g);
    var surface = Math.max(num(g.surface), 0);
    var emprise = surface / n;
    var hauteur = estVide(g.hauteur) ? 2.5 : Math.max(num(g.hauteur), 0);
    var perimetre = perimetreGlobal(g);
    var occupants = estVide(g.occupants) ? foyer : Math.max(num(g.occupants), 0);
    var niveaux = [];
    for (var k = 0; k < n; k++) {
      niveaux.push({
        uid: 'global-' + k,
        virtuel: true,
        nom: n > 1 ? 'Niveau ' + (k + 1) : 'Logement',
        longueur: String(emprise),
        largeur: '1',
        hauteur: String(hauteur),
        lineaire: String(perimetre),
        sousToiture: k === n - 1 && g.sousToiture !== 'non' ? 'oui' : 'non',
        surPlancherBas: k === 0 && g.surPlancherBas !== 'non' ? 'oui' : 'non',
        vitrageMode: g.vitrageMode === 'rapide' ? 'rapide' : 'detail',
        vitrageRapide: g.vitrageRapide,
        vitrages: [],
        occupants: String(occupants / n),
        activite: 'sedentaire',
        equipements: estVide(g.equipements) ? '' : String(Math.max(num(g.equipements), 0) / n),
        debit: '',
        longueurRefend: D.PONTS_THERMIQUES.refendParM2 * emprise * hauteur,
        radiateurs: []
      });
    }
    // Baies : la plus grande d'abord, sur le niveau le moins vitré ; fenêtres de toit en haut.
    var vitrees = niveaux.map(function () { return 0; });
    (g.vitrages || []).slice().sort(function (a, b) { return num(b.surface) - num(a.surface); }).forEach(function (v) {
      var cible = 0;
      if (fenetreDeToit(v)) {
        cible = n - 1;
      } else {
        for (var j = 1; j < n; j++) if (vitrees[j] < vitrees[cible]) cible = j;
      }
      niveaux[cible].vitrages.push(v);
      vitrees[cible] += Math.max(num(v.surface), 0);
    });
    return niveaux;
  }

  // Puissance nominale (totale, conditions EN 14511) couvrant le total ET la part sensible,
  // sans dépasser 1,3 × le besoin total (compresseur inverter).
  function puissanceNominale(sensible, latent) {
    var K = D.CLIM;
    return Math.max(sensible + latent, Math.min(sensible / K.rapportSensible, K.surdimMax * (sensible + latent)));
  }

  // Majoration réglable de la puissance nominale d'été (%, champ « Majoration clim » ; vide = défaut).
  function majorationClim(climat) {
    var m = estVide(climat.majorationClim) ? D.CLIM.majorationDefaut : num(climat.majorationClim);
    return 1 + Math.max(m, 0) / 100;
  }

  // Bilan d'été de la pièce (pointe de la pièce), et termes simultanés pour le total chantier.
  // r : déperditions déjà calculées (u, smur, surface, débit, ponts thermiques).
  function climatisationPiece(piece, climat, foyer, r) {
    var K = D.CLIM;
    var ecart = Math.max(num(climat.tBaseEte) - num(climat.tConfortEte), 0);
    var supplement = ecart - K.ecartReferenceEtd;
    var mur = D.find(D.MURS, climat.murType) || {};
    var toit = D.find(D.TOITURES, climat.toitureType);
    var legere = !!mur.bois || (piece.sousToiture !== 'non' && !!(toit && toit.leger));

    // Baies : soleil (pointe de la pièce / simultané maison) et conduction (volets ouverts le jour).
    var solaires = 0;
    var solairesSimultanes = 0;
    var solairesCreneaux = rayonnementCreneaux(null);
    var vitrages = 0;
    vitragesPiece(piece).forEach(function (v) {
      var s = Math.max(num(v.surface), 0);
      var type = D.find(D.VITRAGES, v.type);
      if (!type || !(s > 0)) return;
      var verticale = !fenetreDeToit(v);
      solaires += s * type.g * rayonnementPiece(v.orientation) * (legere && verticale ? K.solaireLeger : 1);
      solairesSimultanes += s * type.g * rayonnement(v.orientation);
      var facteur = legere && verticale ? K.solaireLeger : 1;
      rayonnementCreneaux(v.orientation).forEach(function (w, j) { solairesCreneaux[j] += s * type.g * w * facteur; });
      vitrages += Math.max(type.u, U_VITRAGE_MIN) * s * ecart;
    });

    // Murs au soleil : chaque isolation avec son écart équivalent, au prorata du linéaire.
    var murs = 0;
    (r.segments || [{ climat: climat, f: 1, uMur: r.u.mur }]).forEach(function (sg) {
      murs += sg.f * sg.uMur * r.smur * etdMur(sg.climat, supplement);
    });
    var toiture = r.surfaceToiture * r.u.toiture * etdToiture(climat, supplement);
    // Le plancher bas (sur sol ou local non chauffé) n'apporte pas de chaleur l'été.
    var ponts = (r.pontsThermiques.total - r.pontsThermiques.detail.plancherBas) * ecart;
    var ventilation = COEF_AIR * r.debit * ecart;

    var activite = D.find(D.ACTIVITES, piece.activite) || D.ACTIVITES[0];
    var defauts = defautsPiece(piece, r.surface, foyer);
    var occupantsAuto = estVide(piece.occupants);
    var equipementsAuto = estVide(piece.equipements);
    var occupants = occupantsAuto ? defauts.occupants : Math.max(num(piece.occupants), 0);
    var equipements = equipementsAuto ? defauts.equipements : Math.max(num(piece.equipements), 0);

    var apports = {
      solaires: solaires,
      vitrages: vitrages,
      murs: murs,
      toiture: toiture,
      pontsThermiques: ponts,
      ventilation: ventilation,
      occupants: occupants * activite.w,
      equipements: equipements,
      latentOccupants: occupants * activite.lat,
      latentAir: K.latentAir * r.debit * K.dwEte
    };
    var sensible = solaires + vitrages + murs + toiture + ponts + ventilation + apports.occupants + equipements;
    var latent = apports.latentOccupants + apports.latentAir;
    return {
      apports: apports,
      sensible: sensible,
      latent: latent,
      nominale: puissanceNominale(sensible, latent) * majorationClim(climat),
      occupants: occupants,
      occupantsAuto: occupantsAuto,
      equipements: equipements,
      equipementsAuto: equipementsAuto,
      pieceLegere: legere,
      solairesSimultanes: solairesSimultanes,
      solairesCreneaux: solairesCreneaux,
      // Termes proportionnels à l'écart été (T ext - T int), pondérés à chaque créneau.
      transmission: vitrages + murs + toiture + ponts + ventilation
    };
  }

  // regimeEau (facultatif) : régime d'eau des radiateurs, id de D.REGIMES_EAU.
  // foyer (facultatif) : personnes du foyer, pour les occupants par défaut des pièces de vie.
  // Ponts thermiques pondérés par la part de linéaire de chaque isolation de murs.
  function pontsThermiquesMurs(piece, segments) {
    var res = null;
    segments.forEach(function (sg) {
      var pt = pontsThermiques(piece, sg.climat);
      if (!res) {
        res = { isolation: pt.isolation, longueurs: pt.longueurs, detail: {}, total: 0 };
        Object.keys(pt.detail).forEach(function (k) { res.detail[k] = 0; });
      } else if (pt.isolation !== res.isolation && sg.f > 0) {
        res.isolation = 'mixte';
      }
      Object.keys(pt.detail).forEach(function (k) { res.detail[k] += sg.f * pt.detail[k]; });
      res.total += sg.f * pt.total;
    });
    return res;
  }

  // hauteurRadiateur (facultatif) : hauteur souhaitée des radiateurs neufs (mm), vide = toutes.
  function calculPiece(piece, climat, regimeEau, foyer, hauteurRadiateur) {
    // Isolation des murs : celle du chantier, ou propre à la pièce (un ou plusieurs murs).
    var segments = segmentsMurs(piece, climat);
    segments.forEach(function (sg) { sg.uMur = uEnveloppe(sg.climat).mur; });
    var u = uEnveloppe(climat);
    u.mur = 0;
    segments.forEach(function (sg) { u.mur += sg.f * sg.uMur; });
    var s = surfacePiece(piece);
    var volume = s * num(piece.hauteur);
    var sousToiture = piece.sousToiture !== 'non';
    var uToiture = sousToiture ? u.toiture : 0;
    var surPlancherBas = piece.surPlancherBas !== 'non';
    var uPlancher = surPlancherBas ? u.plancher : 0;

    var surfaceVitree = 0;
    var surfaceFenetresToit = 0;
    var deperditionsVitrages = 0;
    vitragesPiece(piece).forEach(function (v) {
      var surface = Math.max(num(v.surface), 0);
      surfaceVitree += surface;
      if (fenetreDeToit(v)) surfaceFenetresToit += surface;
      deperditionsVitrages += uVitrage(v) * surface;
    });

    // Les baies verticales sont prises sur les murs, les fenêtres de toit sur la toiture.
    var lineaire = lineairePiece(piece);
    var smur = Math.max(lineaire * num(piece.hauteur) - (surfaceVitree - surfaceFenetresToit), 0);
    var surfaceToiture = Math.max(s - surfaceFenetresToit, 0);
    var debit = debitRetenu(piece, climat);
    var pt = pontsThermiquesMurs(piece, segments);

    var deperditions = {
      murs: u.mur * smur,
      toiture: uToiture * surfaceToiture,
      plancher: uPlancher * s,
      vitrages: deperditionsVitrages,
      pontsThermiques: pt.total,
      air: COEF_AIR * debit
    };
    var G = deperditions.murs + deperditions.toiture + deperditions.plancher +
      deperditions.vitrages + deperditions.pontsThermiques + deperditions.air;
    // Confort hiver de la pièce : sa saisie, sinon celle du chantier.
    var confortAuto = estVide(piece.tConfortHiver);
    var tConfort = confortAuto ? climat.tConfortHiver : piece.tConfortHiver;
    var deltaHiver = num(tConfort) - num(climat.tBaseHiver);
    var chauffageBase = Math.max(G * deltaHiver, 0);
    // Surpuissance de relance (% de la puissance de base), après abaissement de nuit ou absence.
    var surpuissance = Math.max(num(climat.surpuissance), 0);
    var chauffage = chauffageBase * (1 + surpuissance / 100);

    var clim = climatisationPiece(piece, climat, foyer || D.CLIM.foyerDefaut, {
      u: { mur: u.mur, toiture: uToiture }, smur: smur, surface: s, surfaceToiture: surfaceToiture,
      debit: debit, pontsThermiques: pt, segments: segments
    });

    // Radiateurs : puissances catalogue (ΔT50) ramenées au régime d'eau de l'installation.
    var facteur = facteurRegime(regimeEau, tConfort);
    // Plusieurs radiateurs dans la pièce : leurs puissances s'additionnent.
    var detailRadiateurs = [];
    var existant = null;
    radiateursPiece(piece).forEach(function (rad, k) {
      var p = radiateurExistant(rad);
      if (p === null) return;
      existant = (existant || 0) + p;
      detailRadiateurs.push({ index: k, puissanceCatalogue: p, puissance: p * facteur });
    });
    var radiateur = null;
    if (existant !== null) {
      var puissance = existant * facteur;
      var suffisant = chauffage > 0 ? puissance >= SEUIL_RADIATEUR_SUFFISANT * chauffage : true;
      radiateur = {
        puissance: puissance,
        puissanceCatalogue: existant,
        detail: detailRadiateurs,
        suffisant: suffisant,
        manque: suffisant ? 0 : chauffage - puissance
      };
    }

    return {
      surface: s,
      volume: volume,
      surfaceVitree: surfaceVitree,
      surfaceFenetresToit: surfaceFenetresToit,
      smur: smur,
      lineaire: lineaire,
      lineaireAuto: estVide(piece.lineaire) && !estVide(piece.mursExposes),
      u: { mur: u.mur, toiture: uToiture, plancher: uPlancher },
      debit: debit,
      debitAuto: estVide(piece.debit),
      debitEstime: debitEstime(piece, climat),
      deperditions: deperditions,
      pontsThermiques: pt,
      G: G,
      tConfortHiver: num(tConfort),
      tConfortAuto: confortAuto,
      isolationMursPerso: !segments[0].chantier || segments.length > 1,
      mursIsolation: segments.map(function (sg) {
        return { longueur: sg.longueur, f: sg.f, u: sg.uMur, chantier: sg.chantier, isolantMur: sg.climat.isolantMur, position: sg.climat.positionIsolantMur };
      }),
      chauffageBase: chauffageBase,
      surpuissance: surpuissance,
      chauffage: chauffage,
      apports: clim.apports,
      clim: clim,
      // Puissance frigorifique nominale de la pièce (choix du split).
      climatisation: clim.nominale,
      palierSplit: palier(clim.nominale / 1000, D.PALIERS_SPLIT),
      facteurRegime: facteur,
      // Palier catalogue (ΔT50) dont la puissance au régime d'eau couvre le besoin.
      radiateurNeuf: facteur > 0 ? radiateurNeuf(chauffage / facteur, hauteurRadiateur) : { valeur: null, depasse: chauffage > 0 },
      radiateurExistant: radiateur
    };
  }

  // Type d'installation : 'air_eau' (défaut, relevés antérieurs) ou 'air_air'.
  function systemeChantier(chantier) {
    return chantier && chantier.systeme === 'air_air' ? 'air_air' : 'air_eau';
  }

  // Unités extérieures déclarées dans l'installation, prises en compte à partir de deux.
  function unitesChantier(chantier) {
    var u = chantier.installation && Array.isArray(chantier.installation.unites) ? chantier.installation.unites : [];
    return u.length >= 2 ? u : [];
  }

  // Unité d'une pièce : celle choisie si elle existe, sinon la première.
  function uniteDePiece(piece, unites) {
    for (var k = 0; k < unites.length; k++) if (unites[k].uid === piece.unite) return piece.unite;
    return unites.length ? unites[0].uid : null;
  }

  // Climatisation simultanée d'un ensemble de pièces (groupe extérieur) : maximum sur les créneaux
  // horaires (soleil des pièces + écart extérieur de l'heure), sans dépasser la somme des pointes,
  // au moins la plus grosse pièce (pièce par pièce : les niveaux du mode global ne sont pas des unités).
  function bilanClim(pieces, foyerN, climat, global) {
    var K = D.CLIM;
    var sommePieces = 0;
    var sommeSensible = 0;
    var piecesMax = 0;
    var equipements = 0;
    var transmission = 0;
    var latentAir = 0;
    var occupants = 0;
    var occupantsMax = 0;
    var occupantsSensible = 0;
    var occupantsLatent = 0;
    var solaires = rayonnementCreneaux(null);
    pieces.forEach(function (r) {
      var c = r.clim;
      sommePieces += c.nominale;
      sommeSensible += c.sensible;
      piecesMax = Math.max(piecesMax, c.nominale);
      equipements += c.apports.equipements;
      transmission += c.transmission;
      latentAir += c.apports.latentAir;
      occupants += c.occupants;
      occupantsMax = Math.max(occupantsMax, c.occupants);
      occupantsSensible += c.apports.occupants;
      occupantsLatent += c.apports.latentOccupants;
      c.solairesCreneaux.forEach(function (q, j) { solaires[j] += q; });
    });
    // Occupants simultanés plafonnés au foyer (ou à la pièce la plus occupée).
    var plafond = Math.max(foyerN, occupantsMax);
    var part = occupants > plafond ? plafond / occupants : 1;
    var sensible = 0;
    var creneau = 0;
    var parCreneau = solaires.map(function (q, j) {
      var sj = equipements + part * occupantsSensible + K.partEcartCreneaux[j] * transmission + q;
      if (sj > sensible) { sensible = sj; creneau = j; }
      return sj;
    });
    sensible = Math.min(sensible, sommeSensible);
    var latent = latentAir + part * occupantsLatent;
    var climatisation = pieces.length
      ? Math.max(puissanceNominale(sensible, latent) * majorationClim(climat), global ? 0 : piecesMax)
      : 0;
    return {
      climatisation: climatisation, sensible: sensible, latent: latent, sommePieces: sommePieces,
      creneau: K.heuresCreneaux[creneau], parCreneau: parCreneau
    };
  }

  function calculChantier(chantier) {
    var airAir = systemeChantier(chantier) === 'air_air';
    // Air/air : pas de circuit d'eau, les radiateurs relevés sont ignorés.
    var regimeEau = !airAir && chantier.installation ? chantier.installation.regimeEau : undefined;
    var foyer = foyerChantier(chantier);
    var global = chantier.mode === 'global';
    // Pièces calculées : celles du relevé, ou les niveaux virtuels du mode global.
    var sources = global ? piecesGlobales(chantier.global, foyer.n) : (chantier.pieces || []);
    if (airAir) sources = sources.map(function (p) { return Object.assign({}, p, { radiateur: null, radiateurs: [] }); });
    var hauteurRadiateur = chantier.installation ? chantier.installation.hauteurRadiateur : '';
    var pieces = sources.map(function (p) { return calculPiece(p, chantier.climat, regimeEau, foyer.n, hauteurRadiateur); });
    var chauffage = 0;
    var deperditionsTotales = 0;
    var volume = 0;
    pieces.forEach(function (r) {
      chauffage += r.chauffage;
      deperditionsTotales += r.G;
      volume += r.volume;
    });
    var bilan = bilanClim(pieces, foyer.n, chantier.climat || {}, global);
    // Plusieurs unités extérieures : chaque pièce est raccordée à l'une d'elles (la première par défaut).
    var unites = global ? [] : unitesChantier(chantier).map(function (u, k, liste) {
      var indices = [];
      sources.forEach(function (p, i) { if (uniteDePiece(p, liste) === u.uid) indices.push(i); });
      var sel = indices.map(function (i) { return pieces[i]; });
      var ch = sel.reduce(function (t, r) { return t + r.chauffage; }, 0);
      var b = bilanClim(sel, foyer.n, chantier.climat || {}, false);
      return {
        uid: u.uid, nom: u.nom || 'Unité ' + (k + 1), indices: indices,
        chauffage: ch, climatisation: b.climatisation, climSommePieces: b.sommePieces, climCreneau: b.creneau,
        palierChauffage: palier(ch / 1000, D.PALIERS_PAC), palierClimatisation: palier(b.climatisation / 1000, D.PALIERS_PAC)
      };
    });
    return {
      mode: global ? 'global' : 'pieces',
      systeme: airAir ? 'air_air' : 'air_eau',
      sources: sources,
      pieces: pieces,
      chauffage: chauffage,
      // Bilan global : déperditions GV (W/K, air compris), volume chauffé (m³) et coefficient
      // volumique G = GV / V (W/m³.K), tel que P = G × V × ΔT (avant surpuissance de relance).
      deperditionsTotales: deperditionsTotales,
      volume: volume,
      coefficientG: volume > 0 ? deperditionsTotales / volume : 0,
      // Puissance frigorifique nominale simultanée (groupe extérieur, PAC air/air, gainable).
      climatisation: bilan.climatisation,
      climSensible: bilan.sensible,
      climLatent: bilan.latent,
      climCreneau: bilan.creneau,
      climParCreneau: bilan.parCreneau,
      climMajoration: majorationClim(chantier.climat || {}),
      // Somme des puissances des pièces (unités intérieures) : non simultanée, indicative.
      climSommePieces: bilan.sommePieces,
      // Unités extérieures (au moins deux déclarées) : bilan de chacune ; vide sinon.
      unites: unites,
      foyer: foyer,
      palierChauffage: palier(chauffage / 1000, D.PALIERS_PAC),
      palierClimatisation: palier(bilan.climatisation / 1000, D.PALIERS_PAC),
      anah: categorieAnah(chantier.prime)
    };
  }

  // Seuils [bleu, jaune, violet] pour n personnes, avec extrapolation au-delà de 5.
  function seuilsAnah(personnes, zone) {
    var table = D.ANAH[zone] || D.ANAH.hors_idf;
    var n = Math.floor(personnes);
    if (n < 1) return null;
    if (n <= 5) return table.seuils[n - 1].slice();
    return table.seuils[4].map(function (s, i) { return s + (n - 5) * table.parPersonne[i]; });
  }

  function categorieAnah(prime) {
    if (!prime || estVide(prime.personnes) || estVide(prime.rfr) || !personnesFoyer(prime)) return null;
    var seuils = seuilsAnah(num(prime.personnes), prime.zone);
    if (!seuils) return null;
    var rfr = num(prime.rfr);
    var index = 3;
    for (var i = 0; i < 3; i++) {
      if (rfr <= seuils[i]) { index = i; break; }
    }
    return { categorie: D.CATEGORIES_ANAH[index], seuils: seuils, rfr: rfr };
  }

  var api = {
    num: num,
    estVide: estVide,
    rIsolant: rIsolant,
    uParoi: uParoi,
    uEnveloppe: uEnveloppe,
    personnesFoyer: personnesFoyer,
    segmentsMurs: segmentsMurs,
    mursIsolationPiece: mursIsolationPiece,
    epaisseurMur: epaisseurMur,
    rMur: rMur,
    plancherBas: plancherBas,
    uVitrage: uVitrage,
    debitEstime: debitEstime,
    palier: palier,
    radiateurExistant: radiateurExistant,
    radiateurNeuf: radiateurNeuf,
    wParMetreCatalogue: wParMetreCatalogue,
    radiateursPiece: radiateursPiece,
    facteurRegime: facteurRegime,
    isolationMur: isolationMur,
    pontsThermiques: pontsThermiques,
    rayonnement: rayonnement,
    rayonnementPiece: rayonnementPiece,
    rayonnementCreneaux: rayonnementCreneaux,
    majorationClim: majorationClim,
    etdMur: etdMur,
    etdToiture: etdToiture,
    typesPiece: typesPiece,
    defautsPiece: defautsPiece,
    foyerChantier: foyerChantier,
    niveauxGlobal: niveauxGlobal,
    perimetreGlobal: perimetreGlobal,
    piecesGlobales: piecesGlobales,
    puissanceNominale: puissanceNominale,
    surfacePiece: surfacePiece,
    lineaireMurs: lineaireMurs,
    lineairePiece: lineairePiece,
    vitragesPiece: vitragesPiece,
    calculPiece: calculPiece,
    calculChantier: calculChantier,
    uniteDePiece: uniteDePiece,
    systemeChantier: systemeChantier,
    seuilsAnah: seuilsAnah,
    categorieAnah: categorieAnah
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Calc = api;
})(this);
