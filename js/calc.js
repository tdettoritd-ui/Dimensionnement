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

  // Personnes du foyer : occupants saisis en mode global ; encart Prime ; sinon nombre de
  // chambres + 1 (mode pièce par pièce) ; sinon valeur par défaut.
  function foyerChantier(chantier) {
    if (chantier.mode === 'global') {
      var occ = chantier.global ? num(chantier.global.occupants) : 0;
      if (occ > 0) return { n: occ, source: 'global' };
    }
    var n = chantier.prime ? Math.floor(num(chantier.prime.personnes)) : 0;
    if (n >= 1) return { n: n, source: 'prime' };
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
        radiateur: null
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

    var murs = r.u.mur * r.smur * etdMur(climat, supplement);
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
  function calculPiece(piece, climat, regimeEau, foyer) {
    var u = uEnveloppe(climat);
    var s = num(piece.longueur) * num(piece.largeur);
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
    var smur = Math.max(num(piece.lineaire) * num(piece.hauteur) - (surfaceVitree - surfaceFenetresToit), 0);
    var surfaceToiture = Math.max(s - surfaceFenetresToit, 0);
    var debit = debitRetenu(piece, climat);
    var pt = pontsThermiques(piece, climat);

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
    var deltaHiver = num(climat.tConfortHiver) - num(climat.tBaseHiver);
    var chauffageBase = Math.max(G * deltaHiver, 0);
    // Surpuissance de relance (% de la puissance de base), après abaissement de nuit ou absence.
    var surpuissance = Math.max(num(climat.surpuissance), 0);
    var chauffage = chauffageBase * (1 + surpuissance / 100);

    var clim = climatisationPiece(piece, climat, foyer || D.CLIM.foyerDefaut, {
      u: { mur: u.mur, toiture: uToiture }, smur: smur, surface: s, surfaceToiture: surfaceToiture,
      debit: debit, pontsThermiques: pt
    });

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
      surfaceFenetresToit: surfaceFenetresToit,
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
      apports: clim.apports,
      clim: clim,
      // Puissance frigorifique nominale de la pièce (choix du split).
      climatisation: clim.nominale,
      palierSplit: palier(clim.nominale / 1000, D.PALIERS_SPLIT),
      facteurRegime: facteur,
      // Palier catalogue (ΔT50) dont la puissance au régime d'eau couvre le besoin.
      radiateurNeuf: facteur > 0 ? palier(chauffage / facteur, D.PALIERS_RADIATEUR) : { valeur: null, depasse: chauffage > 0 },
      radiateurExistant: radiateur
    };
  }

  function calculChantier(chantier) {
    var regimeEau = chantier.installation ? chantier.installation.regimeEau : undefined;
    var foyer = foyerChantier(chantier);
    var global = chantier.mode === 'global';
    // Pièces calculées : celles du relevé, ou les niveaux virtuels du mode global.
    var sources = global ? piecesGlobales(chantier.global, foyer.n) : (chantier.pieces || []);
    var pieces = sources.map(function (p) { return calculPiece(p, chantier.climat, regimeEau, foyer.n); });
    var K = D.CLIM;
    var chauffage = 0;
    var sommePieces = 0;
    var sommeSensible = 0;
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
      chauffage += r.chauffage;
      sommePieces += c.nominale;
      sommeSensible += c.sensible;
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
    var plafond = Math.max(foyer.n, occupantsMax);
    var part = occupants > plafond ? plafond / occupants : 1;
    // Total simultané : maximum sur les créneaux horaires (soleil de la maison + écart extérieur de l'heure),
    // sans dépasser la somme des pointes des pièces.
    var sensible = 0;
    var creneau = 0;
    var parCreneau = solaires.map(function (q, j) {
      var sj = equipements + part * occupantsSensible + K.partEcartCreneaux[j] * transmission + q;
      if (sj > sensible) { sensible = sj; creneau = j; }
      return sj;
    });
    sensible = Math.min(sensible, sommeSensible);
    var latent = latentAir + part * occupantsLatent;
    var climatisation = puissanceNominale(sensible, latent) * majorationClim(chantier.climat || {});
    return {
      mode: global ? 'global' : 'pieces',
      sources: sources,
      pieces: pieces,
      chauffage: chauffage,
      // Puissance frigorifique nominale simultanée (groupe extérieur, PAC air/air, gainable).
      climatisation: climatisation,
      climSensible: sensible,
      climLatent: latent,
      climCreneau: K.heuresCreneaux[creneau],
      climParCreneau: parCreneau,
      climMajoration: majorationClim(chantier.climat || {}),
      // Somme des puissances des pièces (unités intérieures) : non simultanée, indicative.
      climSommePieces: sommePieces,
      foyer: foyer,
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
    vitragesPiece: vitragesPiece,
    calculPiece: calculPiece,
    calculChantier: calculChantier,
    seuilsAnah: seuilsAnah,
    categorieAnah: categorieAnah
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Calc = api;
})(this);
