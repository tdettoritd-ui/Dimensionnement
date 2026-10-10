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

  function uEnveloppe(climat) {
    var mur = D.find(D.MURS, climat.murType);
    var toit = D.find(D.TOITURES, climat.toitureType);
    var plancher = D.find(D.PLANCHERS, climat.plancherType);
    return {
      mur: mur ? uParoi(mur.r, climat.isolantMur) : 0,
      toiture: toit ? uParoi(toit.r, climat.isolantToiture) : 0,
      plancher: plancher ? uParoi(plancher.r, climat.isolantPlancher) : 0
    };
  }

  function uVitrage(vitrage) {
    var t = D.find(D.VITRAGES, vitrage.type);
    if (!t) return 0;
    return Math.max(t.u - (vitrage.volet === 'oui' ? REDUCTION_VOLET : 0), U_VITRAGE_MIN);
  }

  // Rayonnement d'été (W/m²) d'une orientation ; « mixte » = moyenne des orientations.
  function rayonnement(orientationId) {
    if (orientationId === D.ORIENTATION_MIXTE.id) {
      var somme = 0;
      D.ORIENTATIONS.forEach(function (o) { somme += o.w; });
      return somme / D.ORIENTATIONS.length;
    }
    var o = D.find(D.ORIENTATIONS, orientationId);
    return o ? o.w : 0;
  }

  // Vitrages pris en compte : la liste détaillée, ou en saisie rapide un vitrage
  // équivalent dont la surface vaut ratio du niveau × surface au sol.
  function vitragesPiece(piece) {
    if (piece.vitrageMode !== 'rapide') return piece.vitrages || [];
    var g = piece.vitrageRapide || {};
    var niveau = D.find(D.NIVEAUX_VITRAGE, g.niveau);
    var surfaceSol = num(piece.longueur) * num(piece.largeur);
    return [{
      orientation: g.orientation,
      type: g.type,
      volet: g.volet,
      surface: niveau ? surfaceSol * niveau.ratio : 0
    }];
  }

  function debitEstime(piece, climat) {
    var v = D.find(D.VENTILATIONS, climat.ventilation);
    var volume = num(piece.longueur) * num(piece.largeur) * num(piece.hauteur);
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

  function radiateurExistant(radiateur) {
    if (!radiateur || !radiateur.materiau) return null;
    var puissance = 0;
    if (radiateur.materiau === 'acier') {
      var t = D.find(D.RADIATEURS_ACIER, radiateur.typeAcier);
      if (t) puissance = t.wm2 * (num(radiateur.hauteur) / 100) * (num(radiateur.longueur) / 100);
    } else {
      var table = D.RADIATEURS_ELEMENTS[radiateur.materiau];
      var parElement = table ? table[radiateur.hauteurElement] : 0;
      if (parElement) puissance = parElement * Math.max(Math.floor(num(radiateur.elements)), 0);
    }
    return Math.max(puissance, 0);
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
    var plancher = D.find(D.PLANCHERS, climat.plancherType);
    var toit = D.find(D.TOITURES, climat.toitureType);
    var L = Math.max(num(piece.lineaire), 0);
    var H = Math.max(num(piece.hauteur), 0);
    var l = { plancherBas: 0, plancherHaut: 0, plancherIntermediaire: 0, refend: 0, menuiserie: 0 };
    var d = { plancherBas: 0, plancherHaut: 0, plancherIntermediaire: 0, refend: 0, menuiserie: 0 };
    if (L > 0) {
      // Sol : plancher bas lourd, sinon plancher d'étage (moitié comptée de chaque côté).
      if (piece.surPlancherBas !== 'non' && plancher && plancher.r !== null) {
        if (!mur.bois && !plancher.leger) {
          l.plancherBas = L;
          d.plancherBas = T.plancherBas[iso][rIsolant(climat.isolantPlancher) > 0 ? 1 : 0] * L;
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
      l.refend = T.refendParPiece * H;
      d.refend = T.refend[iso] * l.refend;
      if (!mur.bois) {
        if (piece.vitrageMode === 'rapide') {
          var S = 0;
          vitragesPiece(piece).forEach(function (v) { S += Math.max(num(v.surface), 0); });
          l.menuiserie = S > 0 ? Math.max(4 * Math.sqrt(S), T.perimetreRapide * S) : 0;
        } else {
          (piece.vitrages || []).forEach(function (v) { l.menuiserie += 4 * Math.sqrt(Math.max(num(v.surface), 0)); });
        }
        d.menuiserie = T.menuiserie[iso] * l.menuiserie;
      }
    }
    var total = d.plancherBas + d.plancherHaut + d.plancherIntermediaire + d.refend + d.menuiserie;
    return { isolation: iso, longueurs: l, detail: d, total: total };
  }

  // regimeEau (facultatif) : régime d'eau des radiateurs, id de D.REGIMES_EAU.
  function calculPiece(piece, climat, regimeEau) {
    var u = uEnveloppe(climat);
    var s = num(piece.longueur) * num(piece.largeur);
    var volume = s * num(piece.hauteur);
    var sousToiture = piece.sousToiture !== 'non';
    var uToiture = sousToiture ? u.toiture : 0;
    var surPlancherBas = piece.surPlancherBas !== 'non';
    var uPlancher = surPlancherBas ? u.plancher : 0;

    var surfaceVitree = 0;
    var deperditionsVitrages = 0;
    var apportsSolaires = 0;
    vitragesPiece(piece).forEach(function (v) {
      var surface = Math.max(num(v.surface), 0);
      var type = D.find(D.VITRAGES, v.type);
      surfaceVitree += surface;
      deperditionsVitrages += uVitrage(v) * surface;
      if (type) apportsSolaires += surface * type.g * rayonnement(v.orientation);
    });

    var smur = Math.max(num(piece.lineaire) * num(piece.hauteur) - surfaceVitree, 0);
    var debit = debitRetenu(piece, climat);
    var pt = pontsThermiques(piece, climat);

    var deperditions = {
      murs: u.mur * smur,
      toiture: uToiture * s,
      plancher: uPlancher * s,
      vitrages: deperditionsVitrages,
      pontsThermiques: pt.total,
      air: COEF_AIR * debit
    };
    var G = deperditions.murs + deperditions.toiture + deperditions.plancher +
      deperditions.vitrages + deperditions.pontsThermiques + deperditions.air;
    var deltaHiver = num(climat.tConfortHiver) - num(climat.tBaseHiver);
    var chauffageBase = Math.max(G * deltaHiver, 0);
    // Surpuissance de relance (% de la puissance de base), après abaissement de nuit ou absence.
    var surpuissance = Math.max(num(climat.surpuissance), 0);
    var chauffage = chauffageBase * (1 + surpuissance / 100);

    var ecartEte = Math.max(num(climat.tBaseEte) - num(climat.tConfortEte), 0);
    var activite = D.find(D.ACTIVITES, piece.activite);
    var apports = {
      solaires: apportsSolaires,
      // Le plancher bas (sur sol ou local non chauffé) n'apporte pas de chaleur l'été.
      transmission: (u.mur * smur + uToiture * s + pt.total - pt.detail.plancherBas) * ecartEte,
      ventilation: COEF_AIR * debit * ecartEte,
      internes: Math.max(num(piece.occupants), 0) * (activite ? activite.w : 0) + Math.max(num(piece.equipements), 0)
    };
    var climatisation = apports.solaires + apports.transmission + apports.ventilation + apports.internes;

    // Radiateurs : puissances catalogue (ΔT50) ramenées au régime d'eau de l'installation.
    var facteur = facteurRegime(regimeEau, climat.tConfortHiver);
    var existant = radiateurExistant(piece.radiateur);
    var radiateur = null;
    if (existant !== null) {
      var puissance = existant * facteur;
      var suffisant = chauffage > 0 ? puissance >= SEUIL_RADIATEUR_SUFFISANT * chauffage : true;
      radiateur = {
        puissance: puissance,
        puissanceCatalogue: existant,
        suffisant: suffisant,
        manque: suffisant ? 0 : chauffage - puissance
      };
    }

    return {
      surface: s,
      volume: volume,
      surfaceVitree: surfaceVitree,
      smur: smur,
      u: { mur: u.mur, toiture: uToiture, plancher: uPlancher },
      debit: debit,
      debitAuto: estVide(piece.debit),
      debitEstime: debitEstime(piece, climat),
      deperditions: deperditions,
      pontsThermiques: pt,
      G: G,
      chauffageBase: chauffageBase,
      surpuissance: surpuissance,
      chauffage: chauffage,
      apports: apports,
      climatisation: climatisation,
      facteurRegime: facteur,
      // Palier catalogue (ΔT50) dont la puissance au régime d'eau couvre le besoin.
      radiateurNeuf: facteur > 0 ? palier(chauffage / facteur, D.PALIERS_RADIATEUR) : { valeur: null, depasse: chauffage > 0 },
      radiateurExistant: radiateur
    };
  }

  function calculChantier(chantier) {
    var regimeEau = chantier.installation ? chantier.installation.regimeEau : undefined;
    var pieces = (chantier.pieces || []).map(function (p) { return calculPiece(p, chantier.climat, regimeEau); });
    var chauffage = 0;
    var climatisation = 0;
    pieces.forEach(function (r) { chauffage += r.chauffage; climatisation += r.climatisation; });
    return {
      pieces: pieces,
      chauffage: chauffage,
      climatisation: climatisation,
      palierChauffage: palier(chauffage / 1000, D.PALIERS_PAC),
      palierClimatisation: palier(climatisation / 1000, D.PALIERS_PAC),
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
    if (!prime || estVide(prime.personnes) || estVide(prime.rfr)) return null;
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
    uVitrage: uVitrage,
    debitEstime: debitEstime,
    palier: palier,
    radiateurExistant: radiateurExistant,
    facteurRegime: facteurRegime,
    isolationMur: isolationMur,
    pontsThermiques: pontsThermiques,
    rayonnement: rayonnement,
    vitragesPiece: vitragesPiece,
    calculPiece: calculPiece,
    calculChantier: calculChantier,
    seuilsAnah: seuilsAnah,
    categorieAnah: categorieAnah
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Calc = api;
})(this);
