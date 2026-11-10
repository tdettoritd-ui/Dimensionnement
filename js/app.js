/*
 * Interface du relevé : rendu, saisie, persistance locale, export PDF.
 * Tout est local à l'appareil : aucune donnée n'est envoyée à un serveur.
 */
(function () {
  'use strict';

  var D = window.Data;
  var C = window.Calc;
  var F = window.Fmt;

  var CLE_CHANTIERS = 'dimclim.chantiers';
  var CLE_BROUILLON = 'dimclim.brouillon';
  var CLE_THEME = 'dimclim.theme';
  var CLE_ONGLET = 'dimclim.onglet';

  var OUI_NON = [['oui', 'Oui'], ['non', 'Non']];

  /* ---------- Stockage local (tolérant aux erreurs : navigation privée, quota…) ---------- */

  function lire(cle, defaut) {
    try {
      var v = localStorage.getItem(cle);
      return v ? JSON.parse(v) : defaut;
    } catch (e) {
      return defaut;
    }
  }

  function ecrire(cle, valeur) {
    try {
      localStorage.setItem(cle, JSON.stringify(valeur));
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ---------- Modèle ---------- */

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function aujourdhui() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function climatDefaut() {
    return {
      zone: 'lorraine',
      tBaseHiver: '-15',
      tBaseEte: '32',
      tConfortEte: '26',
      tConfortHiver: '20',
      surpuissance: '10',
      majorationClim: '',
      murType: 'parpaing',
      epaisseurMur: '',
      revetementMur: 'aucun',
      agglo: { epaisseur: '5', entre: 'air', lame: '', isolant: { materiau: 'laine_verre', epaisseur: '' } },
      plancherDalle: 'beton',
      plancherLocal: 'terre_plein',
      toitureType: 'combles',
      isolantMur: { materiau: 'aucun', epaisseur: '' },
      isolantPlancher: { materiau: 'aucun', epaisseur: '' },
      isolantToiture: { materiau: 'aucun', epaisseur: '' },
      ventilation: 'vmc_auto',
      positionIsolantMur: 'interieur',
      plancherEtage: 'lourd'
    };
  }

  function nouvellePiece(n) {
    return {
      uid: uid(),
      nom: 'Pièce ' + n,
      saisieSurface: 'dimensions',
      longueur: '',
      largeur: '',
      surface: '',
      hauteur: '2,5',
      tConfortHiver: '',
      isolationMurs: 'chantier',
      mursIsolation: [],
      mursExposes: '',
      lineaire: '',
      sousToiture: 'oui',
      surPlancherBas: 'oui',
      vitrageMode: 'detail',
      vitrages: [],
      vitrageRapide: { niveau: 'moyen', orientation: 'mixte', type: 'double', volet: 'non' },
      occupants: '',
      activite: 'sedentaire',
      equipements: '',
      debit: '',
      radiateurs: [],
      unite: '' // uid de l'unité extérieure (vide : la première)
    };
  }

  // Mur à isolation propre ; longueur vide : le reste du linéaire de la pièce.
  function nouveauMurIsolation(climat) {
    var iso = climat ? climat.isolantMur : { materiau: 'aucun', epaisseur: '' };
    return { uid: uid(), longueur: '', materiau: iso.materiau, epaisseur: iso.epaisseur, position: climat ? climat.positionIsolantMur : 'interieur' };
  }

  function nouveauRadiateur() {
    return { uid: uid(), materiau: 'acier', typeAcier: '22', hauteur: '', longueur: '', hauteurElement: '600', elements: '' };
  }

  function nouveauVitrage() {
    return { uid: uid(), orientation: 'S', type: 'double', surface: '', volet: 'non' };
  }

  // Mode global (volume total) : le logement saisi d'un bloc.
  function nouveauGlobal() {
    return {
      surface: '',
      hauteur: '2,5',
      niveaux: '1',
      perimetre: '',
      sousToiture: 'oui',
      surPlancherBas: 'oui',
      vitrageMode: 'rapide',
      vitrages: [],
      vitrageRapide: { niveau: 'moyen', orientation: 'mixte', type: 'double', volet: 'non' },
      occupants: '',
      equipements: ''
    };
  }

  function nouveauChantier(climat, mode, systeme) {
    return {
      id: null,
      systeme: systeme === 'air_air' ? 'air_air' : 'air_eau',
      mode: mode === 'global' ? 'global' : 'pieces',
      global: nouveauGlobal(),
      client: { nom: '', adresse: '', telephone: '', email: '', annee: '', date: aujourdhui(), generation: '' },
      climat: climat || climatDefaut(),
      installation: {
        ballonTampon: '', volumeTampon: '', ecsPac: '', ballonThermo: '', ecsEmplacement: '',
        electrique: '', regulation: '', miniTableau: '',
        distUiUe: '', distUeTableau: '', distUiTableau: '', condensats: '',
        regimeEau: '55/45',
        hauteurRadiateur: '',
        unites: [] // unités extérieures (prises en compte à partir de deux)
      },
      prime: { personnes: '', rfr: '', zone: 'hors_idf' },
      pieces: [nouvellePiece(1)],
      plans: [] // { id, nom, type, taille } : fichiers stockés à part (js/plans.js)
    };
  }

  // Complète un chantier chargé avec les champs éventuellement absents (versions antérieures).
  function normaliser(c) {
    var base = nouveauChantier();
    var out = Object.assign({}, base, c);
    ['client', 'installation', 'prime'].forEach(function (k) { out[k] = Object.assign({}, base[k], c[k]); });
    if (D.REGIMES_EAU_ANCIENS[out.installation.regimeEau]) out.installation.regimeEau = D.REGIMES_EAU_ANCIENS[out.installation.regimeEau];
    out.climat = Object.assign(climatDefaut(), c.climat);
    // Relevés antérieurs : ancien choix unique du plancher bas.
    var ancien = c.climat && D.PLANCHERS_ANCIENS[c.climat.plancherType];
    if (ancien && !c.climat.plancherDalle) { out.climat.plancherDalle = ancien[0]; out.climat.plancherLocal = ancien[1]; }
    delete out.climat.plancherType;
    var agglo = (c.climat && c.climat.agglo) || {};
    out.climat.agglo = Object.assign(climatDefaut().agglo, agglo);
    out.climat.agglo.isolant = Object.assign(climatDefaut().agglo.isolant, agglo.isolant);
    ['isolantMur', 'isolantPlancher', 'isolantToiture'].forEach(function (k) {
      out.climat[k] = Object.assign({ materiau: 'aucun', epaisseur: '' }, out.climat[k]);
    });
    out.mode = c.mode === 'global' ? 'global' : 'pieces';
    out.systeme = C.systemeChantier(c);
    var g = c.global || {};
    out.global = Object.assign(nouveauGlobal(), g);
    out.global.vitrageRapide = Object.assign(nouveauGlobal().vitrageRapide, g.vitrageRapide);
    out.global.vitrages = (g.vitrages || []).map(function (v) { return Object.assign(nouveauVitrage(), v); });
    out.plans = (c.plans || []).filter(function (pl) { return pl && pl.id; });
    out.pieces = (c.pieces || []).map(function (p, i) {
      var np = Object.assign(nouvellePiece(i + 1), p);
      // Relevés antérieurs : un seul radiateur (« radiateur »), repris s'il était renseigné.
      var anciens = Array.isArray(p.radiateurs) ? p.radiateurs : (p.radiateur && p.radiateur.materiau ? [p.radiateur] : []);
      delete np.radiateur;
      np.radiateurs = anciens.map(function (r) { return Object.assign(nouveauRadiateur(), r, { uid: r.uid || uid() }); });
      // Relevés antérieurs : une seule isolation propre à la pièce, devenue un mur sans longueur.
      np.mursIsolation = C.mursIsolationPiece(p).map(function (m) { return Object.assign(nouveauMurIsolation(), m, { uid: m.uid || uid() }); });
      delete np.isolantMur;
      delete np.positionIsolantMur;
      np.vitrages = (p.vitrages || []).map(function (v) { return Object.assign(nouveauVitrage(), v); });
      np.vitrageRapide = Object.assign(nouvellePiece(1).vitrageRapide, p.vitrageRapide);
      if (!np.uid) np.uid = uid();
      return np;
    });
    return out;
  }

  var state = normaliser(lire(CLE_BROUILLON, null) || nouveauChantier());
  var modifie = false;
  var ui = {
    onglet: lire(CLE_ONGLET, 'type'),
    sous: null, // id de l'élément (section ou pièce) du sous-onglet courant
    replie: {},
    detail: {}
  };

  /* ---------- Chemins de données (« pieces.0.vitrages.1.surface ») ---------- */

  function getPath(obj, path) {
    return path.split('.').reduce(function (o, k) { return o == null ? undefined : o[k]; }, obj);
  }

  function setPath(obj, path, value) {
    var keys = path.split('.');
    var last = keys.pop();
    var target = keys.reduce(function (o, k) { return o[k]; }, obj);
    target[last] = value;
  }

  /* ---------- Formatage (js/format.js) ---------- */

  var esc = F.esc;
  var nf = F.nf;
  var kW = F.kW;
  var W = F.W;
  var euros = F.euros;
  var palierBarre = F.palierBarre;
  var textePalierRadiateur = F.textePalierRadiateur;
  var textePalierSplit = F.textePalierSplit;
  var dateFr = F.dateFr;

  /* ---------- Composants de formulaire ---------- */

  function champ(label, path, o) {
    o = o || {};
    var v = getPath(state, path);
    var kind = o.kind || 'text';
    var attrs = '';
    if (kind === 'num') attrs = ' type="text" inputmode="decimal" autocomplete="off"';
    else if (kind === 'int') attrs = ' type="text" inputmode="numeric" autocomplete="off"';
    else if (kind === 'signed') attrs = ' type="text" autocomplete="off"'; // clavier complet : signe « - » disponible
    else attrs = ' type="' + kind + '"';
    if (o.autocomplete) attrs += ' autocomplete="' + o.autocomplete + '"';
    if (o.list) attrs += ' list="' + o.list + '"';
    var id = 'f-' + path.replace(/\./g, '-');
    var bouton = o.bouton
      ? '<button type="button" class="btn small" data-action="' + o.bouton.action + '"' + (o.bouton.data || '') + '>' + esc(o.bouton.label) + '</button>'
      : '';
    return '<div class="field ' + (o.cls || (o.bouton ? 'span-2' : '')) + '">' +
      '<label class="lbl" for="' + id + '">' + esc(label) + '</label>' +
      '<div class="ctrl">' +
      '<span class="inp"><input id="' + id + '" data-bind="' + path + '"' + attrs + ' value="' + esc(v == null ? '' : v) + '"' +
      (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : '') + '>' +
      (o.unite ? '<span class="unit">' + esc(o.unite) + '</span>' : '') + '</span>' +
      bouton +
      '</div>' +
      (o.aide || o.aideId ? '<p class="hint"' + (o.aideId ? ' id="' + o.aideId + '"' : '') + '>' + (o.aide || '') + '</p>' : '') +
      '</div>';
  }

  function liste(label, path, options, o) {
    o = o || {};
    var v = getPath(state, path);
    var id = 'f-' + path.replace(/\./g, '-');
    var opts = (o.vide ? '<option value="">' + esc(o.vide) + '</option>' : '') +
      options.map(function (op) {
        return '<option value="' + esc(op.value) + '"' + (String(op.value) === String(v) ? ' selected' : '') + '>' + esc(op.label) + '</option>';
      }).join('');
    return '<div class="field ' + (o.cls || '') + '">' +
      '<label class="lbl" for="' + id + '">' + esc(label) + '</label>' +
      '<div class="ctrl"><select id="' + id + '" data-bind="' + path + '">' + opts + '</select></div>' +
      '</div>';
  }

  function table2options(table) {
    return table.map(function (e) { return { value: e.id, label: e.label }; });
  }

  // Bouton segmenté ; data-clear : un second appui sur l'option active la désélectionne.
  function bascule(label, path, options, o) {
    o = o || {};
    var v = getPath(state, path);
    return '<div class="field ' + (o.cls || '') + '">' +
      '<span class="lbl">' + esc(label) + '</span>' +
      '<div class="seg" role="group" aria-label="' + esc(label) + '">' +
      (options || OUI_NON).map(function (op) {
        var actif = v === op[0];
        return '<button type="button" data-set="' + path + '" data-value="' + op[0] + '"' +
          (o.obligatoire ? '' : ' data-clear') + ' aria-pressed="' + actif + '" class="' + (actif ? 'on' : '') + '">' + esc(op[1]) + '</button>';
      }).join('') +
      '</div></div>';
  }

  function encart(key, titre, sousTitre, contenu) {
    return '<section class="card" aria-labelledby="titre-' + key + '">' +
      '<div class="card-head"><h2 class="card-title" id="titre-' + key + '">' + esc(titre) + '</h2>' +
      '<span class="card-sub" id="sub-' + key + '">' + (sousTitre || '') + '</span></div>' +
      '<div class="card-body">' + contenu + '</div></section>';
  }

  /* ---------- Encarts ---------- */

  function renderClient() {
    return encart('client', 'Client', esc(state.client.nom || ''),
      '<div class="grid">' +
      champ('Nom du client', 'client.nom', { cls: 'span-2', autocomplete: 'off' }) +
      champ('Adresse', 'client.adresse', { cls: 'span-2', autocomplete: 'off' }) +
      champ('Téléphone', 'client.telephone', { kind: 'tel', autocomplete: 'off' }) +
      champ('Email', 'client.email', { kind: 'email', autocomplete: 'off' }) +
      champ('Année de construction', 'client.annee', { kind: 'int', placeholder: 'ex. 1975' }) +
      champ('Date du relevé', 'client.date', { kind: 'date' }) +
      liste('Génération de chauffage actuelle', 'client.generation', table2options(D.GENERATIONS), { vide: '— Non renseignée —', cls: 'span-2' }) +
      '</div>');
  }

  function isolant(label, key) {
    var mat = state.climat[key].materiau;
    return '<div class="field-pair span-2">' +
      liste('Isolant ' + label, 'climat.' + key + '.materiau', table2options(D.ISOLANTS)) +
      (mat && mat !== 'aucun'
        ? champ('Épaisseur', 'climat.' + key + '.epaisseur', { kind: 'num', unite: 'cm', cls: 'narrow' })
        : '') +
      '</div>';
  }

  // Contre-cloison agglo : épaisseur, puis lame d'air, isolant ou rien entre l'agglo et le mur.
  function renderContreCloison() {
    var a = state.climat.agglo;
    var mat = a.isolant.materiau;
    return liste('Épaisseur de l\'agglo', 'climat.agglo.epaisseur', Object.keys(D.AGGLO_CONTRE_CLOISON).map(Number).sort(function (x, y) { return x - y; })
      .map(function (e) { return { value: String(e), label: nf(e, e % 1 ? 1 : 0) + ' cm' }; })) +
      '<div class="spacer"></div>' +
      bascule('Entre l\'agglo et le mur', 'climat.agglo.entre', [['air', 'Lame d\'air'], ['isolant', 'Isolant'], ['colle', 'Rien (collé)']], { obligatoire: true, cls: 'span-2' }) +
      (a.entre === 'isolant'
        ? '<div class="field-pair span-2">' +
          liste('Isolant de la contre-cloison', 'climat.agglo.isolant.materiau', table2options(D.ISOLANTS)) +
          (mat && mat !== 'aucun' ? champ('Épaisseur', 'climat.agglo.isolant.epaisseur', { kind: 'num', unite: 'cm', cls: 'narrow' }) : '') +
          '</div>'
        : a.entre === 'colle' ? ''
          : champ('Épaisseur de la lame d\'air', 'climat.agglo.lame', { kind: 'num', unite: 'cm', placeholder: 'auto : 3' }));
  }

  function renderClimat() {
    var c = state.climat;
    var zone = D.find(D.ZONES, c.zone);
    return encart('climat', 'Climat / enveloppe', esc(zone ? zone.label.split(' – ')[0] + ' · ' + c.tBaseHiver + ' °C' : ''),
      '<div class="grid">' +
      liste('Zone climatique hiver', 'climat.zone', D.ZONES.map(function (z) {
        return { value: z.id, label: z.label + ' (' + (z.t > 0 ? '+' : '') + z.t + ' °C)' };
      }), { cls: 'span-2' }) +
      champ('T° ext. de base hiver', 'climat.tBaseHiver', { kind: 'signed', unite: '°C' }) +
      champ('T° ext. de base été', 'climat.tBaseEte', { kind: 'signed', unite: '°C' }) +
      champ('Confort hiver', 'climat.tConfortHiver', { kind: 'num', unite: '°C' }) +
      champ('Confort été', 'climat.tConfortEte', { kind: 'num', unite: '°C' }) +
      champ('Surpuissance de relance', 'climat.surpuissance', { kind: 'num', unite: '%', cls: 'span-2',
        aide: 'Ajoutée à la puissance de chauffage pour remonter en température après un abaissement de nuit ou une absence. 0 % si le chauffage n\'est jamais abaissé.' }) +
      champ('Majoration clim', 'climat.majorationClim', { kind: 'num', unite: '%', cls: 'span-2', placeholder: 'auto : 0',
        aide: 'Ajoutée à la puissance frigorifique (pièces et total). 0 % par défaut : le calcul est déjà une pointe par ciel clair, sans protection solaire. ' +
          '+10 % : construction légère très vitrée à l\'Ouest, véranda. Pour les canicules, relever plutôt la T° de base été.' }) +
      '</div>' +
      '<h3 class="sub-title">Murs</h3><div class="grid">' +
      liste('Type de paroi', 'climat.murType', table2options(D.MURS), { cls: 'span-2' }) +
      (C.epaisseurMur(c) !== null
        ? champ('Épaisseur du mur', 'climat.epaisseurMur', { kind: 'num', unite: 'cm', placeholder: 'auto : ' + C.epaisseurMur({ murType: c.murType }) })
        : '') +
      liste('Revêtement intérieur', 'climat.revetementMur', table2options(D.REVETEMENTS_MUR), { cls: 'span-2' }) +
      (c.revetementMur === 'agglo' ? renderContreCloison() : '') +
      '<p class="hint span-2" id="r-mur"></p>' +
      isolant('murs', 'isolantMur') +
      (c.isolantMur.materiau && c.isolantMur.materiau !== 'aucun'
        ? bascule('Isolant des murs posé', 'climat.positionIsolantMur', [['interieur', 'Par l\'intérieur (ITI)'], ['exterieur', 'Par l\'extérieur (ITE)']], { obligatoire: true, cls: 'span-2' })
        : '') +
      '</div>' +
      '<h3 class="sub-title">Plancher bas</h3><div class="grid">' +
      liste('Type de dalle', 'climat.plancherDalle', table2options(D.PLANCHERS_DALLE), { cls: 'span-2' }) +
      liste('Type de cave', 'climat.plancherLocal', table2options(D.PLANCHERS_LOCAL), { cls: 'span-2' }) +
      (c.plancherLocal !== 'cave_chauffee' ? isolant('plancher', 'isolantPlancher') : '') +
      bascule('Planchers entre étages', 'climat.plancherEtage', D.PLANCHERS_ETAGE.map(function (p) { return [p.id, p.label]; }), { obligatoire: true, cls: 'span-2' }) +
      '</div>' +
      '<h3 class="sub-title">Toiture / plafond</h3><div class="grid">' +
      liste('Toiture / plafond', 'climat.toitureType', D.TOITURES.map(function (m) { return { value: m.id, label: m.label + (m.r ? ' – R ' + nf(m.r, 2) : '') }; }), { cls: 'span-2' }) +
      (c.toitureType !== 'aucune' ? isolant('toiture', 'isolantToiture') : '') +
      '</div>' +
      '<h3 class="sub-title">Ventilation</h3><div class="grid">' +
      liste('Type de ventilation', 'climat.ventilation', D.VENTILATIONS.map(function (v) { return { value: v.id, label: v.label + ' – ' + nf(v.taux, 2) + ' vol/h' }; }), { cls: 'span-2' }) +
      '</div>' +
      '<p class="hint" id="u-enveloppe"></p>');
  }

  function renderInstallation() {
    var i = state.installation;
    var emplacement = bascule('ECS : intégré ou déporté ?', 'installation.ecsEmplacement', [['integre', 'Intégré'], ['deporte', 'Déporté']], { cls: 'span-2' });
    // Air/air : ni circuit d'eau (régime, ballon tampon) ni production d'ECS.
    var circuitEau = airAir() ? '' :
      '<div class="grid">' +
      liste('Température de sortie d\'eau', 'installation.regimeEau', D.REGIMES_EAU.map(function (r) {
        return { value: r.id, label: r.depart + ' °C – ' + r.type };
      }), { cls: 'span-2' }) +
      '</div>' +
      (function () {
        var r = D.find(D.REGIMES_EAU, i.regimeEau);
        return r ? '<p class="reco-note"><strong>' + esc(r.type) + '</strong> · départ ' + r.depart + ' °C, retour ' + r.retour + ' °C</p>' : '';
      })() +
      '<p class="hint">Sert à vérifier les radiateurs existants et à choisir les neufs : les puissances catalogue sont données à ΔT50 (eau à 75 °C).</p>' +
      '<div class="grid">' +
      liste('Hauteur des radiateurs neufs', 'installation.hauteurRadiateur', D.HAUTEURS_RADIATEUR_NEUF.map(function (h) { return { value: String(h), label: h + ' mm' }; }),
        { vide: 'Toutes hauteurs', cls: 'span-2' }) +
      '</div>' +
      '<p class="hint">Radiateur neuf choisi dans le catalogue ' + esc(D.CATALOGUE_RADIATEURS.source) + ' (panneaux acier types 11, 21, 22, 33) : le moins puissant qui couvre le besoin de la pièce. ' +
      'Fixer une hauteur sous une fenêtre, par exemple.</p>' +
      '<div class="grid">' +
      bascule('Ballon tampon', 'installation.ballonTampon') +
      (i.ballonTampon === 'oui' ? champ('Volume du ballon tampon', 'installation.volumeTampon', { kind: 'num', unite: 'L' }) : '<div class="spacer"></div>') +
      bascule('ECS produite par la PAC ?', 'installation.ecsPac') +
      (i.ecsPac === 'non' ? bascule('Ballon thermodynamique ?', 'installation.ballonThermo') : '<div class="spacer"></div>') +
      (i.ecsPac === 'oui' || (i.ecsPac === 'non' && i.ballonThermo === 'oui') ? emplacement : '') +
      '</div>';
    return encart('installation', 'Installation', '',
      circuitEau +
      '<div class="grid">' +
      bascule('Installation électrique', 'installation.electrique', [['mono', 'Monophasé'], ['tri', 'Triphasé']], { cls: 'span-2' }) +
      bascule('Régulation connectée', 'installation.regulation') +
      bascule('Mini tableau électrique dédié', 'installation.miniTableau') +
      champ('Distance UI ↔ UE', 'installation.distUiUe', { kind: 'num', unite: 'm' }) +
      champ('Distance UE ↔ tableau', 'installation.distUeTableau', { kind: 'num', unite: 'm' }) +
      champ('Distance UI ↔ tableau', 'installation.distUiTableau', { kind: 'num', unite: 'm' }) +
      bascule('Évacuation condensats à proximité', 'installation.condensats') +
      '</div>' +
      '<p class="hint">Les autres informations servent au chiffrage, sans effet sur le calcul.</p>' +
      renderUnites());
  }

  // Unités extérieures : à partir de deux, chaque pièce est raccordée à l'une d'elles.
  function renderUnites() {
    var u = state.installation.unites;
    return '<h3 class="sub-title">Unités extérieures</h3>' +
      u.map(function (x, k) {
        return '<div class="unite-ligne">' +
          champ('Unité ' + (k + 1), 'installation.unites.' + k + '.nom', { autocomplete: 'off', placeholder: 'ex. UE garage' }) +
          '<button type="button" class="btn ghost small danger" data-action="supprimer-unite" data-j="' + k + '" aria-label="Supprimer l\'unité ' + (k + 1) + '">Supprimer</button>' +
          '</div>';
      }).join('') +
      '<button type="button" class="btn small" data-action="ajouter-unite">+ Ajouter une unité extérieure</button>' +
      '<p class="hint">' + (u.length >= 2
        ? 'Choisir l\'unité de chaque pièce dans l\'onglet Pièces : bilan et palier par unité dans le récapitulatif et le PDF.'
        : 'Une seule unité extérieure : rien à saisir. Plusieurs : les ajouter ici (au moins deux), puis raccorder chaque pièce à la sienne.') + '</p>';
  }

  function nomUnite(u, k) {
    return u.nom || 'Unité ' + (k + 1);
  }

  function renderPrime() {
    return encart('prime', 'Prime', '<span id="sub-prime-badge"></span>',
      '<div class="grid">' +
      champ('Personnes au foyer', 'prime.personnes', { kind: 'int', aide: '', aideId: 'personnes-aide' }) +
      champ('Revenu fiscal de référence', 'prime.rfr', { kind: 'num', unite: '€' }) +
      bascule('Zone', 'prime.zone', [['hors_idf', 'Hors Île-de-France'], ['idf', 'Île-de-France']], { cls: 'span-2', obligatoire: true }) +
      '</div>' +
      '<div id="anah-resultat" class="anah"></div>' +
      '<p class="hint">Catégorie Anah / MaPrimeRénov\'. Plafonds ' + D.ANAH.annee + ' (RFR N-1), réindexés chaque année : à recontrôler en début d\'année civile.</p>');
  }

  // cible : chemin de l'objet portant les vitrages (« pieces.0 » ou « global »).
  function renderVitrage(cible, j) {
    var base = cible + '.vitrages.' + j;
    return '<div class="vitrage">' +
      '<div class="vitrage-head"><span>Vitrage ' + (j + 1) + '</span>' +
      '<button type="button" class="btn ghost small danger" data-action="supprimer-vitrage" data-base="' + cible + '" data-j="' + j + '" aria-label="Supprimer le vitrage ' + (j + 1) + '">Supprimer</button></div>' +
      '<div class="grid">' +
      liste('Orientation', base + '.orientation', D.ORIENTATIONS.map(function (o) { return { value: o.id, label: o.label }; })) +
      champ('Surface de la baie', base + '.surface', { kind: 'num', unite: 'm²' }) +
      liste('Type de vitrage', base + '.type', table2options(D.VITRAGES), { cls: 'span-2' }) +
      bascule('Volet roulant', base + '.volet', OUI_NON, { obligatoire: true, cls: 'span-2' }) +
      '</div></div>';
  }

  // Saisie rapide : un niveau de vitrage global au lieu de chaque fenêtre.
  function renderVitrageRapide(cible, idAide) {
    var base = cible + '.vitrageRapide';
    var orientations = [{ value: D.ORIENTATION_MIXTE.id, label: D.ORIENTATION_MIXTE.label }]
      .concat(D.ORIENTATIONS.filter(function (o) { return !o.toit; }).map(function (o) { return { value: o.id, label: o.label }; }));
    return '<div class="grid">' +
      bascule('Niveau de vitrage', base + '.niveau', D.NIVEAUX_VITRAGE.map(function (n) { return [n.id, n.label.replace(' vitré', '')]; }), { obligatoire: true, cls: 'span-2' }) +
      '</div>' +
      '<p class="hint" id="' + idAide + '"></p>' +
      '<div class="grid">' +
      liste('Orientation principale', base + '.orientation', orientations, { cls: 'span-2' }) +
      liste('Type de vitrage', base + '.type', table2options(D.VITRAGES), { cls: 'span-2' }) +
      bascule('Volets roulants', base + '.volet', OUI_NON, { obligatoire: true, cls: 'span-2' }) +
      '</div>';
  }

  function renderVitrages(objet, cible, idAide) {
    var rapide = objet.vitrageMode === 'rapide';
    return '<div class="grid">' +
      bascule('Saisie des vitrages', cible + '.vitrageMode', [['detail', 'Détaillée'], ['rapide', 'Rapide (estimation)']], { obligatoire: true, cls: 'span-2' }) +
      '</div>' +
      (rapide
        ? renderVitrageRapide(cible, idAide)
        : objet.vitrages.map(function (v, j) { return renderVitrage(cible, j); }).join('') +
          '<button type="button" class="btn small" data-action="ajouter-vitrage" data-base="' + cible + '">+ Ajouter un vitrage</button>');
  }

  /* ---------- Type d'installation (début de parcours) ---------- */

  function airAir() {
    return state.systeme === 'air_air';
  }

  function renderSysteme() {
    var s = D.find(D.SYSTEMES, state.systeme);
    return '<div class="card mode-card"><div class="card-body">' +
      bascule('Type d\'installation', 'systeme', D.SYSTEMES.map(function (x) { return [x.id, x.label]; }), { obligatoire: true }) +
      '<p class="hint">' + esc(s ? s.detail : '') + '</p>' +
      '</div></div>';
  }

  /* ---------- Mode de dimensionnement ---------- */

  function renderMode() {
    return '<div class="card mode-card"><div class="card-body">' +
      bascule('Dimensionnement', 'mode', [['pieces', 'Pièce par pièce'], ['global', 'Global (volume total)']], { obligatoire: true }) +
      '<p class="hint">' + (state.mode === 'global'
        ? 'Logement saisi d\'un bloc : surface, hauteur, niveaux, périmètre et vitrages. Rapide, mais sans split' + (airAir() ? '' : ' ni radiateur') + ' par pièce.'
        : 'Chaque pièce est saisie : split' + (airAir() ? '' : ' et radiateur') + ' conseillés pièce par pièce.') + '</p>' +
      '<p class="g-global" id="g-global"></p>' +
      '</div></div>';
  }

  function renderGlobal() {
    var g = state.global;
    return '<div class="pieces-head"><h2>Logement</h2><span class="muted">dimensionnement global</span></div>' +
      '<section class="card piece" aria-label="Logement"><div class="card-body">' +
      '<div class="grid">' +
      champ('Surface habitable', 'global.surface', { kind: 'num', unite: 'm²' }) +
      champ('Hauteur sous plafond', 'global.hauteur', { kind: 'num', unite: 'm' }) +
      bascule('Nombre de niveaux', 'global.niveaux', [['1', '1'], ['2', '2'], ['3', '3']], { obligatoire: true, cls: 'span-2' }) +
      champ('Périmètre des murs ext. par niveau', 'global.perimetre', { kind: 'num', unite: 'ml', cls: 'span-2',
        aide: '', aideId: 'global-perimetre-aide' }) +
      bascule('Dernier niveau sous toiture ?', 'global.sousToiture', [['oui', 'Oui'], ['non', 'Non (logement sous un autre)']], { obligatoire: true, cls: 'span-2' }) +
      bascule('Premier niveau sur plancher bas ?', 'global.surPlancherBas', [['oui', 'Oui'], ['non', 'Non (logement sur un autre)']], { obligatoire: true, cls: 'span-2' }) +
      '</div>' +
      '<h4 class="sub-title">Vitrages du logement</h4>' +
      renderVitrages(g, 'global', 'vitrage-rapide-global') +
      '<h4 class="sub-title">Occupants et équipements</h4>' +
      '<div class="grid">' +
      champ('Occupants', 'global.occupants', { kind: 'num' }) +
      champ('Éclairage et appareils', 'global.equipements', { kind: 'num', unite: 'W' }) +
      '<p class="hint span-2">Vides : personnes du foyer (encart Prime, sinon 4) et 7 W/m². La ventilation suit le type choisi dans « Climat ».</p>' +
      '</div>' +
      '<div class="results" id="res-global"></div>' +
      '</div></section>';
  }

  function renderRadiateur(p, i, k) {
    var base = 'pieces.' + i + '.radiateurs.' + k;
    var r = p.radiateurs[k];
    var html = '<div class="vitrage">' +
      '<div class="vitrage-head"><span>Radiateur ' + (k + 1) + '</span>' +
      '<button type="button" class="btn ghost small danger" data-action="supprimer-radiateur" data-i="' + i + '" data-j="' + k + '" aria-label="Supprimer le radiateur ' + (k + 1) + '">Supprimer</button></div>' +
      '<div class="grid">' +
      liste('Matériau', base + '.materiau', table2options(D.MATERIAUX_RADIATEUR), { cls: 'span-2' });
    if (r.materiau === 'acier') {
      html += liste('Type', base + '.typeAcier', D.RADIATEURS_ACIER.map(function (t) {
        return { value: t.id, label: t.label + (C.wParMetreCatalogue(t.id, 600) !== null ? ' (catalogue ' + D.CATALOGUE_RADIATEURS.source + ')' : ' (≈ ' + nf(t.wm2) + ' W/m²)') };
      }), { cls: 'span-2' }) +
        champ('Hauteur', base + '.hauteur', { kind: 'num', unite: 'cm' }) +
        champ('Longueur', base + '.longueur', { kind: 'num', unite: 'cm' });
    } else if (r.materiau) {
      var t = D.RADIATEURS_ELEMENTS[r.materiau];
      html += liste('Hauteur d\'élément', base + '.hauteurElement', D.HAUTEURS_ELEMENT.map(function (h) { return { value: String(h), label: h + ' mm (' + t[h] + ' W/élt)' }; })) +
        champ('Nombre d\'éléments', base + '.elements', { kind: 'int' });
    }
    html += '</div><p class="hint" id="radex-' + p.uid + '-' + k + '"></p></div>';
    return html;
  }

  function renderRadiateurs(p, i) {
    var html = p.radiateurs.map(function (r, k) { return renderRadiateur(p, i, k); }).join('') +
      '<button type="button" class="btn small" data-action="ajouter-radiateur" data-i="' + i + '">+ Ajouter un radiateur</button>';
    if (p.radiateurs.length) {
      html += '<div class="radex" id="radex-' + p.uid + '"></div>' +
        '<p class="hint">Puissance ramenée au régime d\'eau ' + F.esc(state.installation.regimeEau) + ' °C (réglage dans « Installation »).</p>' +
        '<p class="hint warn">Acier types 11, 21, 22 et 33 : puissances ΔT50 du catalogue ' + D.CATALOGUE_RADIATEURS.source + ' (EN 442). ' +
        'Autres types, fonte et aluminium : ordres de grandeur, à recouper avec la documentation du fabricant.</p>';
    }
    return html;
  }

  // Isolation des murs de la pièce, quand elle diffère de celle du chantier.
  function renderIsolationMurs(p, i) {
    var base = 'pieces.' + i;
    var html = bascule('Isolation des murs', base + '.isolationMurs', [['chantier', 'Celle du chantier'], ['perso', 'Différente']], { obligatoire: true, cls: 'span-2' });
    if (p.isolationMurs !== 'perso') return html;
    p.mursIsolation.forEach(function (m, k) {
      var b = base + '.mursIsolation.' + k;
      var isole = m.materiau && m.materiau !== 'aucun';
      html += '<div class="vitrage span-2">' +
        '<div class="vitrage-head"><span>Mur ' + (k + 1) + '</span>' +
        '<button type="button" class="btn ghost small danger" data-action="supprimer-mur-isolation" data-i="' + i + '" data-j="' + k + '" aria-label="Supprimer le mur ' + (k + 1) + '">Supprimer</button></div>' +
        '<div class="grid">' +
        champ('Longueur du mur', b + '.longueur', { kind: 'num', unite: 'ml', cls: 'span-2' }) +
        '<div class="field-pair span-2">' +
        liste('Isolant', b + '.materiau', table2options(D.ISOLANTS)) +
        (isole ? champ('Épaisseur', b + '.epaisseur', { kind: 'num', unite: 'cm', cls: 'narrow' }) : '') +
        '</div>' +
        (isole ? bascule('Isolant posé', b + '.position', [['interieur', 'Par l\'intérieur (ITI)'], ['exterieur', 'Par l\'extérieur (ITE)']], { obligatoire: true, cls: 'span-2' }) : '') +
        '</div><p class="hint" id="mur-iso-' + p.uid + '-' + k + '"></p></div>';
    });
    return html +
      '<div class="span-2"><button type="button" class="btn small" data-action="ajouter-mur-isolation" data-i="' + i + '">+ Ajouter un mur</button></div>' +
      '<p class="hint span-2" id="u-mur-' + p.uid + '"></p>';
  }

  function renderPiece(p, i) {
    var replie = ui.replie[p.uid];
    var corps = '';
    if (!replie) {
      var parSurface = p.saisieSurface === 'surface';
      corps = '<div class="grid">' +
        bascule('Saisie de la surface', 'pieces.' + i + '.saisieSurface', [['dimensions', 'Long. × larg.'], ['surface', 'Surface (m²)']], { obligatoire: true, cls: 'span-2' }) +
        (parSurface
          ? champ('Surface au sol', 'pieces.' + i + '.surface', { kind: 'num', unite: 'm²' })
          : champ('Longueur', 'pieces.' + i + '.longueur', { kind: 'num', unite: 'm' }) +
            champ('Largeur', 'pieces.' + i + '.largeur', { kind: 'num', unite: 'm' })) +
        champ('Hauteur', 'pieces.' + i + '.hauteur', { kind: 'num', unite: 'm' }) +
        champ('Confort hiver', 'pieces.' + i + '.tConfortHiver', { kind: 'num', unite: '°C' }) +
        bascule('Murs extérieurs exposés', 'pieces.' + i + '.mursExposes', [['0', '0'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']], { cls: 'span-2' }) +
        champ('Linéaire de murs ext.', 'pieces.' + i + '.lineaire', {
          kind: 'num', unite: 'ml', cls: 'span-2',
          aide: '', aideId: 'lineaire-aide-' + p.uid
        }) +
        renderIsolationMurs(p, i) +
        (state.installation.unites.length >= 2
          ? liste('Unité extérieure', 'pieces.' + i + '.unite', state.installation.unites.map(function (u, k) { return { value: u.uid, label: nomUnite(u, k) }; }), { cls: 'span-2' })
          : '') +
        bascule('Pièce sous toiture ?', 'pieces.' + i + '.sousToiture', [['oui', 'Oui'], ['non', 'Non (étage interm.)']], { obligatoire: true, cls: 'span-2' }) +
        bascule('Pièce sur plancher bas ?', 'pieces.' + i + '.surPlancherBas', [['oui', 'Oui'], ['non', 'Non (à l\'étage)']], { obligatoire: true, cls: 'span-2' }) +
        '</div>' +
        '<h4 class="sub-title">Vitrages</h4>' +
        renderVitrages(p, 'pieces.' + i, 'vitrage-rapide-' + p.uid) +
        '<h4 class="sub-title">Apports internes et ventilation</h4>' +
        '<div class="grid">' +
        champ('Occupants', 'pieces.' + i + '.occupants', { kind: 'int' }) +
        champ('Équipements', 'pieces.' + i + '.equipements', { kind: 'num', unite: 'W' }) +
        '<p class="hint span-2">Vides : valeurs automatiques selon le nom de la pièce (affichées en grisé). Saisir 0 pour n\'en compter aucun.</p>' +
        liste('Activité des occupants', 'pieces.' + i + '.activite', D.ACTIVITES.map(function (a) { return { value: a.id, label: a.label + ' (' + a.w + ' W / pers.)' }; }), { cls: 'span-2' }) +
        champ('Débit de ventilation', 'pieces.' + i + '.debit', {
          kind: 'num', unite: 'm³/h',
          bouton: { action: 'estimer-debit', label: 'Estimer', data: ' data-i="' + i + '"' },
          aide: '', aideId: 'debit-aide-' + p.uid
        }) +
        '</div>' +
        '<div class="results" id="res-' + p.uid + '"></div>' +
        (airAir() ? '' :
          '<h4 class="sub-title">Radiateurs existants <span class="muted">(optionnel)</span></h4>' +
          renderRadiateurs(p, i));
    }
    return '<section class="card piece" id="piece-' + esc(p.uid) + '" aria-label="' + esc(p.nom) + '">' +
      '<div class="piece-head">' +
      '<button type="button" class="btn ghost icon-btn" data-action="replier" data-i="' + i + '" aria-expanded="' + !replie + '" aria-label="' + (replie ? 'Déplier' : 'Replier') + ' la pièce">' +
      '<svg class="chev' + (replie ? ' closed' : '') + '" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>' +
      '<input class="piece-name" data-bind="pieces.' + i + '.nom" value="' + esc(p.nom) + '" list="noms-pieces" aria-label="Nom de la pièce" autocomplete="off">' +
      '<span class="piece-chips" id="chips-' + p.uid + '"></span>' +
      '<button type="button" class="btn ghost icon-btn" data-action="dupliquer-piece" data-i="' + i + '" aria-label="Dupliquer la pièce" title="Dupliquer">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 9h11v11H9zM5 15H4V4h11v1"/></svg></button>' +
      '<button type="button" class="btn ghost icon-btn danger" data-action="supprimer-piece" data-i="' + i + '" aria-label="Supprimer la pièce" title="Supprimer">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button>' +
      '</div>' +
      (replie ? '' : '<div class="card-body">' + corps + '</div>') +
      '</section>';
  }

  /* ---------- Récapitulatif (fin de saisie) ---------- */

  // Points à compléter d'une pièce, repérés avant d'éditer le PDF.
  function aCompleter(p, r) {
    var manque = [];
    if (!(r.surface > 0)) manque.push('surface');
    if (C.estVide(p.lineaire) && C.estVide(p.mursExposes)) manque.push('murs exposés');
    return manque;
  }

  // « Personnes au foyer » renseigné mais hors de 1 à foyerMax : ignoré par le calcul.
  function personnesInvalides() {
    return !C.estVide(state.prime.personnes) && !C.personnesFoyer(state.prime);
  }

  // Bilan par unité extérieure (à partir de deux unités).
  function renderRecapUnites(res) {
    if (!res.unites.length) return '';
    var vides = res.unites.filter(function (u) { return !u.indices.length; }).length;
    return '<h3 class="sub-title">Par unité extérieure</h3>' +
      (vides ? '<p class="hint warn">⚠ ' + vides + ' unité' + (vides > 1 ? 's' : '') + ' sans pièce raccordée.</p>' : '') +
      '<div class="recap-scroll"><table class="recap"><thead><tr>' +
      '<th scope="col">Unité</th><th scope="col">Pièces</th><th scope="col">Chauffage</th><th scope="col">Clim simultanée</th><th scope="col">Somme des splits</th>' +
      '</tr></thead><tbody>' +
      res.unites.map(function (u) {
        return '<tr><th scope="row">' + esc(u.nom) + '</th>' +
          '<td class="recap-noms">' + (u.indices.map(function (i) { return esc(res.sources[i].nom); }).join(', ') || '—') + '</td>' +
          '<td class="c-heat">' + kW(u.chauffage) + '<small>Palier ' + esc(F.textePalierPac(u.palierChauffage)) + '</small></td>' +
          '<td class="c-cool">' + kW(u.climatisation) + '<small>Palier ' + esc(F.textePalierPac(u.palierClimatisation)) + '</small></td>' +
          '<td>' + kW(u.climSommePieces) + '<small>' + u.indices.length + ' unité' + (u.indices.length > 1 ? 's' : '') + ' int.</small></td></tr>';
      }).join('') +
      '</tbody></table></div>';
  }

  function renderRecap() {
    var res = C.calculChantier(state);
    var global = res.mode === 'global';
    var radiateurs = !airAir();
    var surface = somme(res.pieces, function (r) { return r.surface; });
    var alertes = 0;
    var lignes = res.pieces.map(function (r, k) {
      var p = res.sources[k];
      var ex = r.radiateurExistant;
      var manque = global ? [] : aCompleter(p, r);
      // Puissance par m² anormale : souvent une saisie en cm ou une valeur dans le mauvais champ.
      if (r.surface > 0 && Math.max(r.chauffage, r.climatisation) / r.surface > D.CLIM.densiteMax) manque.push('puissance à vérifier');
      if (manque.length) alertes++;
      var unite = res.unites.filter(function (u) { return u.indices.indexOf(k) >= 0; })[0];
      var nom = global ? esc(p.nom)
        : '<button type="button" class="lien" data-aller-piece="' + esc(p.uid) + '">' + esc(p.nom || 'Pièce ' + (k + 1)) + '</button>' +
          (unite ? '<small class="recap-unite">' + esc(unite.nom) + '</small>' : '') +
          (manque.length ? '<span class="recap-alerte">⚠ ' + esc(manque.join(', ')) + '</span>' : '');
      return '<tr><th scope="row">' + nom + '</th>' +
        '<td>' + nf(r.surface, 1) + ' m²</td>' +
        '<td class="c-heat">' + W(r.chauffage) + '</td>' +
        '<td class="c-cool">' + W(r.climatisation) + '</td>' +
        '<td>' + (global ? '—' : esc(textePalierSplit(r.palierSplit))) + '</td>' +
        (radiateurs
          ? '<td>' + (global ? '—' : esc(F.textePalierRadiateur(r.radiateurNeuf, true)) +
              (r.radiateurNeuf.modele ? '<small>réf. ' + esc(r.radiateurNeuf.modele.ref) + '</small>' : '')) + '</td>' +
            '<td>' + (ex ? W(ex.puissance) + ' <span class="badge ' + (ex.suffisant ? 'ok">Suffisant' : 'ko">Insuffisant') + '</span>' : '—') + '</td>'
          : '') +
        '</tr>';
    }).join('');
    var colonnes = radiateurs ? 7 : 5;
    var anah = res.anah;
    var personnesKo = personnesInvalides();
    return '<section class="card" aria-labelledby="titre-recap"><div class="card-head"><h2 class="card-title" id="titre-recap">Récapitulatif</h2>' +
      '<span class="card-sub">' + esc(F.libelle(D.SYSTEMES, res.systeme)) + (state.client.nom ? ' · ' + esc(state.client.nom) : '') + '</span></div>' +
      '<div class="card-body">' +
      (alertes ? '<p class="hint warn">⚠ ' + alertes + ' pièce' + (alertes > 1 ? 's' : '') + ' à compléter ou à vérifier (voir le tableau).</p>' : '') +
      (personnesKo ? '<p class="hint warn">⚠ Personnes au foyer : « ' + esc(state.prime.personnes) + ' » ignoré (onglet Prime).</p>' : '') +
      '<div class="kpis">' +
      '<div class="kpi heat"><span>Chauffage</span><strong>' + kW(res.chauffage) + '</strong><small>Palier ' + esc(F.textePalierPac(res.palierChauffage)) +
        (surface > 0 ? ' · ' + nf(res.chauffage / surface) + ' W/m²' : '') + '</small></div>' +
      '<div class="kpi cool"><span>Climatisation (groupe ext.)</span><strong>' + kW(res.climatisation) + '</strong><small>Palier ' + esc(F.textePalierPac(res.palierClimatisation)) +
        ' · pic ' + esc(res.climCreneau) + '</small></div>' +
      '</div>' +
      '<table class="mini recap-infos"><tbody>' +
      '<tr><th>Surface / volume chauffés</th><td>' + nf(surface, 1) + ' m² · ' + nf(res.volume) + ' m³</td></tr>' +
      '<tr><th>Coefficient G</th><td>' + nf(res.coefficientG, 2) + ' W/m³.K</td></tr>' +
      (radiateurs ? '<tr><th>Sortie d\'eau PAC</th><td>' + esc(F.libelle(D.REGIMES_EAU, state.installation.regimeEau)) + '</td></tr>' : '') +
      '<tr><th>Catégorie Anah</th><td>' + (anah ? badgeAnah(anah) : '—') + '</td></tr>' +
      '</tbody></table>' +
      renderRecapUnites(res) +
      '<h3 class="sub-title">' + (global ? 'Par niveau' : 'Par pièce') + '</h3>' +
      '<div class="recap-scroll"><table class="recap"><thead><tr>' +
      '<th scope="col">' + (global ? 'Niveau' : 'Pièce') + '</th><th scope="col">Surface</th><th scope="col">Chauffage</th><th scope="col">Clim</th><th scope="col">Split</th>' +
      (radiateurs ? '<th scope="col">Radiateur neuf</th><th scope="col">Radiateurs existants</th>' : '') +
      '</tr></thead><tbody>' + (lignes || '<tr><td colspan="' + colonnes + '">Aucune pièce.</td></tr>') + '</tbody>' +
      '<tfoot><tr><th scope="row">Total</th><td>' + nf(surface, 1) + ' m²</td><td class="c-heat">' + kW(res.chauffage) + '</td><td class="c-cool">' + kW(res.climSommePieces) + '</td><td colspan="' + (colonnes - 4) + '"></td></tr>' +
      '<tr><th scope="row">Clim simultanée</th><td></td><td></td><td class="c-cool">' + kW(res.climatisation) + '</td><td colspan="' + (colonnes - 4) + '"></td></tr></tfoot>' +
      '</table></div>' +
      '<p class="hint">Clim simultanée : puissance du groupe extérieur (toutes les pièces ne sont pas au soleil en même temps). Toucher une pièce pour la modifier.</p>' +
      '<div class="recap-actions"><button type="button" class="btn primary" data-global-recap="pdf">Créer le PDF</button>' +
      '<button type="button" class="btn" data-global-recap="sauver">Sauver le chantier</button></div>' +
      '</div></section>';
  }

  /* ---------- Plans du dossier client ---------- */

  var urlsPlans = {}; // id → URL locale du fichier (vignettes, consultation)

  function renderPlans() {
    var plans = state.plans;
    return encart('plans', 'Plans', plans.length ? plans.length + ' fichier' + (plans.length > 1 ? 's' : '') : '',
      (plans.length
        ? '<div class="plans">' + plans.map(function (pl, k) {
          var image = window.Plans.estImage(pl);
          return '<div class="plan">' +
            '<button type="button" class="plan-apercu" data-action="voir-plan" data-j="' + k + '" aria-label="Voir ' + esc(pl.nom) + '">' +
            (image ? '<img alt="" data-plan-img="' + esc(pl.id) + '">' : '<span class="plan-pdf">PDF</span>') + '</button>' +
            '<div class="plan-infos">' +
            champ('Nom du plan', 'plans.' + k + '.nom', { autocomplete: 'off' }) +
            '<div class="plan-actions"><span class="muted small">' + (pl.taille < 1024 * 1024 ? nf(Math.max(pl.taille / 1024, 1)) + ' Ko' : nf(pl.taille / 1024 / 1024, 1) + ' Mo') + '</span>' +
            '<button type="button" class="btn ghost small danger" data-action="supprimer-plan" data-j="' + k + '">Supprimer</button></div>' +
            '</div></div>';
        }).join('') + '</div>'
        : '<p class="muted">Aucun plan.</p>') +
      '<div class="plans-ajout">' +
      '<label class="btn primary"><input type="file" accept="image/*" capture="environment" data-plan-ajout hidden>Prendre une photo</label>' +
      '<label class="btn"><input type="file" accept="image/*,application/pdf" multiple data-plan-ajout hidden>Ajouter des fichiers</label>' +
      '</div>' +
      '<p class="hint">Plans, croquis ou photos (images ou PDF), enregistrés sur cet appareil avec le chantier. ' +
      'Les images sont ajoutées en fin de PDF (client et détaillé) ; les plans PDF sont joints à l\'envoi par email.</p>');
  }

  // Vignettes : URL locale de chaque fichier, créée une fois puis réutilisée à chaque affichage.
  function vignettesPlans() {
    state.plans.forEach(function (pl) {
      var poser = function () {
        document.querySelectorAll('[data-plan-img="' + pl.id + '"]').forEach(function (img) { if (img.src !== urlsPlans[pl.id]) img.src = urlsPlans[pl.id]; });
      };
      if (urlsPlans[pl.id]) { poser(); return; }
      window.Plans.lire(pl.id).then(function (blob) {
        if (!blob) return;
        urlsPlans[pl.id] = URL.createObjectURL(blob);
        poser();
      }).catch(function () { /* fichier absent : pas de vignette */ });
    });
  }

  function ajouterPlans(fichiers) {
    if (!fichiers.length) return;
    toast('Enregistrement…');
    fichiers.reduce(function (suite, f) {
      return suite.then(function () {
        return window.Plans.ajouter(f).then(function (pl) { state.plans.push(pl); });
      });
    }, Promise.resolve()).then(function () {
      toast(fichiers.length > 1 ? fichiers.length + ' plans ajoutés' : 'Plan ajouté');
    }).catch(function (err) {
      toast('Plan non enregistré : ' + err.message);
    }).then(function () {
      modification();
      render();
    });
  }

  // Supprime de l'appareil les fichiers qui ne sont plus utilisés par le relevé en cours ni par un chantier sauvegardé.
  function nettoyerPlans(ids) {
    var utilises = {};
    state.plans.forEach(function (pl) { utilises[pl.id] = true; });
    chantiers().forEach(function (c) { ((c.data && c.data.plans) || []).forEach(function (pl) { utilises[pl.id] = true; }); });
    ids.forEach(function (id) {
      if (utilises[id]) return;
      window.Plans.supprimer(id).catch(function () { /* déjà absent */ });
      if (urlsPlans[id]) { URL.revokeObjectURL(urlsPlans[id]); delete urlsPlans[id]; }
    });
  }

  function idsPlans(chantier) {
    return ((chantier && chantier.plans) || []).map(function (pl) { return pl.id; });
  }

  /* ---------- Onglets (barre verticale à gauche) ---------- */

  var ONGLETS = [
    { id: 'client', label: 'Type et client', icone: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
      sections: [{ id: 'type', label: 'Type', rendu: function () { return renderSysteme(); } },
        { id: 'client', label: 'Client', rendu: function () { return renderClient(); } },
        { id: 'plans', label: 'Plans', rendu: function () { return renderPlans(); } }] },
    { id: 'enveloppe', label: 'Climat et installation', icone: '<path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/>',
      sections: [{ id: 'climat', label: 'Climat', rendu: function () { return renderClimat(); } },
        { id: 'installation', label: 'Installation', rendu: function () { return renderInstallation(); } }] },
    { id: 'prime', label: 'Prime', icone: '<path d="M18 7a6 6 0 1 0 0 10M4 10h9M4 14h9"/>' },
    { id: 'pieces', label: 'Pièces', icone: '<path d="M3 10l9-7 9 7v10a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>' },
    { id: 'recap', label: 'Récapitulatif', court: 'Récap', icone: '<path d="M4 4h16v16H4zM4 9h16M4 14h16M10 9v11"/>' }
  ];
  // Onglets des versions précédentes (une section par onglet).
  var ONGLETS_ANCIENS = { type: 'client', climat: 'enveloppe', installation: 'enveloppe' };

  function ongletActif() {
    var id = ONGLETS_ANCIENS[ui.onglet] || ui.onglet;
    return ONGLETS.filter(function (o) { return o.id === id; })[0] || ONGLETS[0];
  }

  function libelleOnglet(o) {
    return o.id === 'pieces' && state.mode === 'global' ? 'Logement' : o.label;
  }

  function parPiece() {
    return state.mode !== 'global';
  }

  // Sous-onglets d'un onglet : ses sections, ou les pièces. cible : id de l'élément à atteindre.
  function sousOnglets(o) {
    if (o.sections) return o.sections.map(function (sc) { return { cible: 'sec-' + sc.id, label: sc.label }; });
    if (o.id === 'pieces' && parPiece()) {
      return state.pieces.map(function (p, k) { return { cible: 'piece-' + p.uid, label: p.nom || 'Pièce ' + (k + 1), nomId: 'tab-nom-' + p.uid }; });
    }
    return [];
  }

  // Sous-onglet courant : celui choisi, sinon le premier.
  function sousCourant(liste) {
    for (var k = 0; k < liste.length; k++) if (liste[k].cible === ui.sous) return ui.sous;
    return liste.length ? liste[0].cible : null;
  }

  function renderOnglets() {
    var actif = ongletActif().id;
    return ONGLETS.map(function (o) {
      var on = o.id === actif;
      var badge = o.id === 'pieces' && parPiece() ? '<span class="tab-badge">' + state.pieces.length + '</span>' : '';
      var html = '<button type="button" role="tab" class="tab" data-onglet="' + o.id + '" aria-selected="' + on + '"' + (on ? '' : ' tabindex="-1"') +
        (o.court ? ' aria-label="' + esc(libelleOnglet(o)) + '"' : '') + '>' +
        '<svg viewBox="0 0 24 24" aria-hidden="true">' + o.icone + '</svg>' +
        (o.court
          ? '<span class="tab-long">' + esc(libelleOnglet(o)) + '</span><span class="tab-court" aria-hidden="true">' + esc(o.court) + '</span>'
          : '<span>' + esc(libelleOnglet(o)) + '</span>') + badge + '</button>';
      // Sous-onglets de l'onglet ouvert : sections ou pièces, pour y aller directement.
      var liste = on ? sousOnglets(o) : [];
      if (liste.length || (on && o.id === 'pieces' && parPiece())) {
        var courant = sousCourant(liste);
        html += '<div class="subtabs" role="group" aria-label="' + esc(libelleOnglet(o)) + '">' +
          liste.map(function (sc) {
            return '<button type="button" class="subtab" data-cible="' + esc(sc.cible) + '" aria-current="' + (sc.cible === courant) + '">' +
              '<span' + (sc.nomId ? ' id="' + esc(sc.nomId) + '"' : '') + '>' + esc(sc.label) + '</span></button>';
          }).join('') +
          (o.id === 'pieces' ? '<button type="button" class="subtab add" data-action-nav="ajouter-piece" aria-label="Ajouter une pièce">+ Pièce</button>' : '') +
          '</div>';
      }
      return html;
    }).join('');
  }

  function contenuOnglet(o) {
    if (o.sections) {
      return o.sections.map(function (sc) { return '<div class="ancre" id="sec-' + sc.id + '">' + sc.rendu() + '</div>'; }).join('');
    }
    if (o.id === 'prime') return renderPrime();
    if (o.id === 'recap') return renderRecap();
    if (!parPiece()) return renderMode() + renderGlobal();
    // Toutes les pièces à la suite ; les sous-onglets y mènent directement.
    return renderMode() +
      '<div class="pieces-head"><h2>Pièces</h2><span class="muted" id="nb-pieces"></span></div>' +
      (state.pieces.length ? state.pieces.map(renderPiece).join('') : '<p class="muted">Aucune pièce : en ajouter une.</p>') +
      '<button type="button" class="btn add-piece" data-action="ajouter-piece">+ Ajouter une pièce</button>';
  }

  // Boutons « précédent / suivant » en bas de l'onglet.
  function suiteOnglets() {
    var k = ONGLETS.indexOf(ongletActif());
    var prec = ONGLETS[k - 1];
    var suiv = ONGLETS[k + 1];
    var bPrec = prec ? '<button type="button" class="btn" data-onglet="' + prec.id + '">← ' + esc(libelleOnglet(prec)) + '</button>' : '<span></span>';
    var bSuiv = suiv ? '<button type="button" class="btn primary" data-onglet="' + suiv.id + '">' + esc(libelleOnglet(suiv)) + ' →</button>' : '';
    return '<div class="tabs-suite">' + bPrec + bSuiv + '</div>';
  }

  // Sous-onglet de l'élément affiché.
  function marquer(cible) {
    ui.sous = cible;
    document.querySelectorAll('#onglets .subtab[data-cible]').forEach(function (b) {
      b.setAttribute('aria-current', String(b.dataset.cible === cible));
    });
  }

  // Fait défiler jusqu'à l'élément (sous l'en-tête collé en haut).
  function allerA(cible, doux) {
    var el = document.getElementById(cible);
    if (!el) return;
    marquer(cible);
    suiviPause = Date.now() + (doux ? 800 : 100);
    el.scrollIntoView({ behavior: doux ? 'smooth' : 'auto', block: 'start' });
  }

  function allerPiece(uid, doux) {
    allerA('piece-' + uid, doux);
  }

  // Au défilement, le sous-onglet suit l'élément visible en haut de l'écran.
  var suiviPause = 0;
  function suivreDefilement() {
    if (Date.now() < suiviPause) return;
    var liste = sousOnglets(ongletActif());
    if (!liste.length) return;
    var haut = (document.querySelector('.topbar') || { offsetHeight: 0 }).offsetHeight + 60;
    var courant = liste[0].cible;
    liste.forEach(function (sc) {
      var el = document.getElementById(sc.cible);
      if (el && el.getBoundingClientRect().top <= haut) courant = sc.cible;
    });
    // En bas de page, le dernier élément (souvent court) devient le courant.
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4 && window.scrollY > 0) {
      courant = liste[liste.length - 1].cible;
    }
    if (courant !== ui.sous) marquer(courant);
  }
  window.addEventListener('scroll', function () {
    if (suivreDefilement.attente) return;
    suivreDefilement.attente = true;
    requestAnimationFrame(function () { suivreDefilement.attente = false; suivreDefilement(); });
  }, { passive: true });

  function changerOnglet(id, focus) {
    ui.onglet = id;
    ui.sous = null;
    ecrire(CLE_ONGLET, id);
    window.scrollTo(0, 0);
    sansRecalage = true;
    render();
    sansRecalage = false;
    dernierTouche = null;
    if (focus) {
      var b = document.querySelector('#onglets [data-onglet="' + id + '"]');
      if (b) b.focus();
    }
  }

  var nav = document.getElementById('onglets');
  nav.addEventListener('click', function (e) {
    var b = e.target.closest('[data-onglet], [data-cible], [data-action-nav]');
    if (!b) return;
    if (b.dataset.onglet) changerOnglet(b.dataset.onglet, false);
    else if (b.dataset.cible) allerA(b.dataset.cible, true);
    else if (b.dataset.actionNav === 'ajouter-piece') ajouterPiece();
  });
  // Flèches haut / bas entre les onglets (rôle « tablist » vertical).
  nav.addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    var k = ONGLETS.indexOf(ongletActif()) + (e.key === 'ArrowDown' ? 1 : -1);
    changerOnglet(ONGLETS[(k + ONGLETS.length) % ONGLETS.length].id, true);
  });

  // Hauteur de l'en-tête : la barre d'onglets reste collée juste dessous.
  function hauteurEntete() {
    var t = document.querySelector('.topbar');
    if (t) document.documentElement.style.setProperty('--top-h', t.offsetHeight + 'px');
  }
  window.addEventListener('resize', hauteurEntete);

  /* ---------- Page immobile pendant les mises à jour ---------- */

  // Dernier élément touché, et sa position à l'écran : après reconstruction de la page, on fait
  // défiler pour le remettre au même endroit (la page ne « saute » plus quand on appuie sur un bouton).
  var dernierTouche = null;
  function noterTouche(e) {
    var el = e.target.closest && e.target.closest('button, input, select, textarea, label');
    if (!el || !app.contains(el)) return;
    dernierTouche = { cle: cleElement(el), top: el.getBoundingClientRect().top, quand: Date.now() };
  }
  document.addEventListener('pointerdown', noterTouche, true);
  document.addEventListener('keydown', noterTouche, true);

  // Sélecteur retrouvant le même élément après reconstruction (ou, à défaut, son bloc : pièce, section).
  function cleElement(el) {
    var d = el.dataset || {};
    var attrs = ['set', 'value', 'bind', 'action', 'base', 'i', 'j', 'cible', 'onglet', 'pdf', 'planAjout'];
    var sel = attrs.filter(function (a) { return d[a] !== undefined; }).map(function (a) {
      return '[data-' + a.replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase(); }) + '="' + String(d[a]).replace(/"/g, '\\"') + '"]';
    }).join('');
    var bloc = el.closest('section.piece, .ancre, section.card');
    return { sel: sel || null, bloc: bloc && bloc.id ? '#' + bloc.id : null };
  }

  function ancreActuelle() {
    if (dernierTouche && Date.now() - dernierTouche.quand < 2000) return dernierTouche;
    var a = document.activeElement;
    if (a && a !== document.body && app.contains(a)) return { cle: cleElement(a), top: a.getBoundingClientRect().top };
    return null;
  }

  function recaler(ancre) {
    if (!ancre) return;
    var el = (ancre.cle.sel && document.querySelector('#app ' + ancre.cle.sel)) || (ancre.cle.bloc && document.querySelector(ancre.cle.bloc));
    if (!el) return;
    var ecart = el.getBoundingClientRect().top - ancre.top;
    if (Math.abs(ecart) > 1) window.scrollBy(0, ecart);
    dernierTouche = { cle: ancre.cle, top: ancre.top, quand: Date.now() };
  }

  var sansRecalage = false; // changement d'onglet : on part du haut de la page

  function render() {
    var ancre = sansRecalage ? null : ancreActuelle();
    var actif = document.activeElement;
    var focusBind = actif && actif.dataset ? actif.dataset.bind || actif.dataset.set : null;
    var focusValue = actif && actif.dataset ? actif.dataset.value : null;
    var sel = null;
    try { sel = actif && actif.selectionStart != null ? [actif.selectionStart, actif.selectionEnd] : null; } catch (e) { sel = null; }
    var y = window.scrollY;

    nav.innerHTML = renderOnglets();
    document.getElementById('app').innerHTML =
      contenuOnglet(ongletActif()) + suiteOnglets() +
      '<datalist id="noms-pieces">' +
      ['Séjour', 'Salon', 'Salle à manger', 'Cuisine', 'Chambre', 'Chambre parentale', 'Bureau', 'Salle de bain', 'Salle d\'eau', 'Entrée', 'Couloir', 'Véranda', 'Buanderie']
        .map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') +
      '</datalist>';

    window.scrollTo(0, y);
    if (focusBind) {
      var q = focusValue != null
        ? '[data-set="' + focusBind + '"][data-value="' + focusValue + '"]'
        : '[data-bind="' + focusBind + '"]';
      var el = document.querySelector(q);
      if (el) {
        el.focus({ preventScroll: true });
        if (sel && el.setSelectionRange) try { el.setSelectionRange(sel[0], sel[1]); } catch (e) { /* type sans sélection */ }
      }
    }
    vignettesPlans();
    rafraichir();
    recaler(ancre);
  }

  /* ---------- Résultats (mis à jour à chaque frappe, sans reconstruire les champs) ---------- */

  var LIBELLES_ISOLATION = F.LIBELLES_ISOLATION;

  function blocResultats(r) {
    var d = r.deperditions;
    var a = r.apports;
    return '<div class="kpis">' +
      '<div class="kpi heat"><span>Chauffage</span><strong>' + kW(r.chauffage) + '</strong><small>' + W(r.chauffage) + '</small></div>' +
      '<div class="kpi cool"><span>Climatisation</span><strong>' + kW(r.climatisation) + '</strong><small>' + W(r.climatisation) + ' nominal</small></div>' +
      '</div>' +
      '<div class="reco"><span>Split préconisé (unité intérieure)</span><strong>' + textePalierSplit(r.palierSplit) + '</strong></div>' +
      (airAir() ? '' :
        '<div class="reco"><span>Radiateur neuf préconisé (' + esc(D.CATALOGUE_RADIATEURS.source) + ')</span><strong>' + textePalierRadiateur(r.radiateurNeuf) + '</strong>' +
        (r.radiateurNeuf.valeur && r.facteurRegime !== 1
          ? '<small class="reco-note">soit ' + W(r.radiateurNeuf.valeur * r.facteurRegime) + ' avec une sortie d\'eau à ' + F.esc(String(state.installation.regimeEau).split('/')[0]) + ' °C, pour un besoin de ' + W(r.chauffage) + '</small>'
          : '') +
        '</div>') +
      '<details class="detail" data-key="detail"><summary>Détail du calcul</summary>' +
      '<table class="mini"><tbody>' +
      '<tr><th>Surface au sol</th><td>' + nf(r.surface, 2) + ' m²</td></tr>' +
      '<tr><th>Volume</th><td>' + nf(r.volume, 1) + ' m³</td></tr>' +
      '<tr><th>Surface murs nette</th><td>' + nf(r.smur, 2) + ' m²</td></tr>' +
      '<tr><th>Surface vitrée</th><td>' + nf(r.surfaceVitree, 2) + ' m²</td></tr>' +
      '<tr><th>U mur / toiture / plancher</th><td>' + nf(r.u.mur, 2) + ' / ' + nf(r.u.toiture, 2) + ' / ' + nf(r.u.plancher, 2) + '</td></tr>' +
      '<tr><th>Débit ventilation retenu</th><td>' + nf(r.debit, 1) + ' m³/h' + (r.debitAuto ? ' (estimé)' : '') + '</td></tr>' +
      '<tr class="sep"><th colspan="2">Déperditions (W/K)</th></tr>' +
      '<tr><th>Murs</th><td>' + nf(d.murs, 2) + '</td></tr>' +
      '<tr><th>Toiture</th><td>' + nf(d.toiture, 2) + '</td></tr>' +
      '<tr><th>Plancher</th><td>' + nf(d.plancher, 2) + '</td></tr>' +
      '<tr><th>Vitrages</th><td>' + nf(d.vitrages, 2) + '</td></tr>' +
      '<tr><th>Ponts thermiques (' + LIBELLES_ISOLATION[r.pontsThermiques.isolation] + ')</th><td>' + nf(d.pontsThermiques, 2) + '</td></tr>' +
      '<tr><th>Renouvellement d\'air</th><td>' + nf(d.air, 2) + '</td></tr>' +
      '<tr class="total"><th>G</th><td>' + nf(r.G, 2) + ' W/K</td></tr>' +
      '<tr><th>Confort hiver' + (r.tConfortAuto ? ' (chantier)' : ' (pièce)') + '</th><td>' + nf(r.tConfortHiver, 1) + ' °C</td></tr>' +
      '<tr><th>Puissance de base (G × ΔT)</th><td>' + W(r.chauffageBase) + '</td></tr>' +
      '<tr><th>Surpuissance de relance</th><td>+ ' + nf(r.surpuissance) + ' % = ' + W(r.chauffage) + '</td></tr>' +
      '<tr class="sep"><th colspan="2">Apports été, pointe de la pièce (W)</th></tr>' +
      '<tr><th>Soleil par les baies' + (r.clim.pieceLegere ? ' (pièce légère)' : '') + '</th><td>' + nf(a.solaires) + '</td></tr>' +
      '<tr><th>Conduction des baies</th><td>' + nf(a.vitrages) + '</td></tr>' +
      '<tr><th>Murs au soleil</th><td>' + nf(a.murs) + '</td></tr>' +
      '<tr><th>Toiture / combles</th><td>' + nf(a.toiture) + '</td></tr>' +
      '<tr><th>Ponts thermiques</th><td>' + nf(a.pontsThermiques) + '</td></tr>' +
      '<tr><th>Air (ventilation)</th><td>' + nf(a.ventilation) + '</td></tr>' +
      '<tr><th>Occupants (' + nf(r.clim.occupants) + (r.clim.occupantsAuto ? ', auto' : '') + ')</th><td>' + nf(a.occupants) + '</td></tr>' +
      '<tr><th>Éclairage et appareils' + (r.clim.equipementsAuto ? ' (auto)' : '') + '</th><td>' + nf(a.equipements) + '</td></tr>' +
      '<tr class="total"><th>Sensible</th><td>' + W(r.clim.sensible) + '</td></tr>' +
      '<tr><th>Latent (humidité occupants + air)</th><td>' + W(r.clim.latent) + '</td></tr>' +
      '<tr class="total"><th>Puissance nominale</th><td>' + W(r.climatisation) + '</td></tr>' +
      '</tbody></table>' +
      '<p class="hint">Puissance frigorifique nominale d\'un climatiseur air/air (split, gainable), latent compris. ' +
      'Pour un plancher rafraîchissant, retenir la part sensible.</p></details>';
  }

  function blocRadiateurExistant(r) {
    var ex = r.radiateurExistant;
    if (!ex) return '';
    var badge = ex.suffisant
      ? '<span class="badge ok">Suffisant</span>'
      : '<span class="badge ko">Insuffisant · manque ' + W(ex.manque) + '</span>';
    var regime = state.installation.regimeEau;
    var n = ex.detail.length;
    return '<span>Puissance existante' + (n > 1 ? ' (' + n + ' radiateurs)' : '') + ' en ' + F.esc(regime) + ' °C</span><strong>' + W(ex.puissance) + '</strong>' + badge +
      (r.facteurRegime !== 1 ? '<small class="reco-note">catalogue ΔT50 : ' + W(ex.puissanceCatalogue) + '</small>' : '');
  }

  function badgeAnah(anah) {
    if (!anah) return '';
    return '<span class="badge anah-' + anah.categorie.id + '">' + anah.categorie.label + '</span>';
  }

  function setHTML(id, html) {
    var el = document.getElementById(id);
    if (el && el.innerHTML !== html) el.innerHTML = html;
  }

  // Somme d'un poste sur les niveaux du mode global.
  function somme(liste, f) {
    var t = 0;
    liste.forEach(function (x) { t += f(x); });
    return t;
  }

  function blocGlobal(res) {
    var P = res.pieces;
    var g = state.global;
    var surface = somme(P, function (r) { return r.surface; });
    var d = function (k) { return somme(P, function (r) { return r.deperditions[k]; }); };
    var a = function (k) { return somme(P, function (r) { return r.apports[k]; }); };
    var G = somme(P, function (r) { return r.G; });
    var parNiveau = P.length > 1
      ? '<table class="mini"><tbody><tr class="sep"><th>Niveau</th><td>Chauffage · Clim (pointe)</td></tr>' +
        P.map(function (r, k) {
          return '<tr><th>' + esc(res.sources[k].nom) + (res.sources[k].sousToiture === 'oui' ? ' (sous toiture)' : '') + '</th><td>' +
            kW(r.chauffage) + ' · ' + kW(r.climatisation) + '</td></tr>';
        }).join('') + '</tbody></table>'
      : '';
    return '<div class="kpis">' +
      '<div class="kpi heat"><span>Chauffage</span><strong>' + kW(res.chauffage) + '</strong><small>' + (surface > 0 ? nf(res.chauffage / surface) + ' W/m²' : '') + '</small></div>' +
      '<div class="kpi cool"><span>Climatisation</span><strong>' + kW(res.climatisation) + '</strong><small>pic ' + esc(res.climCreneau) + (surface > 0 ? ' · ' + nf(res.climatisation / surface) + ' W/m²' : '') + '</small></div>' +
      '</div>' +
      '<div class="reco"><span>Paliers PAC / groupe extérieur</span><strong>' + F.textePalierPac(res.palierChauffage) + ' · ' + F.textePalierPac(res.palierClimatisation) + '</strong>' +
      '<small class="reco-note">chauffage · climatisation ; pour les splits' + (airAir() ? '' : ' et radiateurs') + ' pièce par pièce, passer en mode « Pièce par pièce ».</small></div>' +
      parNiveau +
      '<details class="detail" data-key="detail"><summary>Détail du calcul</summary>' +
      '<table class="mini"><tbody>' +
      '<tr><th>Surface / volume</th><td>' + nf(surface, 1) + ' m² · ' + nf(somme(P, function (r) { return r.volume; }), 0) + ' m³</td></tr>' +
      '<tr><th>Périmètre retenu par niveau</th><td>' + nf(C.perimetreGlobal(g), 1) + ' ml' + (C.estVide(g.perimetre) ? ' (estimé)' : '') + '</td></tr>' +
      '<tr><th>Surface murs nette</th><td>' + nf(somme(P, function (r) { return r.smur; }), 1) + ' m²</td></tr>' +
      '<tr><th>Surface vitrée</th><td>' + nf(somme(P, function (r) { return r.surfaceVitree; }), 1) + ' m²</td></tr>' +
      '<tr class="sep"><th colspan="2">Déperditions (W/K)</th></tr>' +
      '<tr><th>Murs</th><td>' + nf(d('murs'), 1) + '</td></tr>' +
      '<tr><th>Toiture</th><td>' + nf(d('toiture'), 1) + '</td></tr>' +
      '<tr><th>Plancher</th><td>' + nf(d('plancher'), 1) + '</td></tr>' +
      '<tr><th>Vitrages</th><td>' + nf(d('vitrages'), 1) + '</td></tr>' +
      '<tr><th>Ponts thermiques (' + LIBELLES_ISOLATION[P.length ? P[0].pontsThermiques.isolation : 'iti'] + ')</th><td>' + nf(d('pontsThermiques'), 1) + '</td></tr>' +
      '<tr><th>Renouvellement d\'air</th><td>' + nf(d('air'), 1) + '</td></tr>' +
      '<tr class="total"><th>Déperditions GV</th><td>' + nf(G, 1) + ' W/K</td></tr>' +
      '<tr class="total"><th>Coefficient G (GV / volume)</th><td>' + nf(res.coefficientG, 2) + ' W/m³.K</td></tr>' +
      '<tr><th>Puissance de base (G × V × ΔT)</th><td>' + W(somme(P, function (r) { return r.chauffageBase; })) + '</td></tr>' +
      '<tr><th>Surpuissance de relance</th><td>+ ' + nf(P.length ? P[0].surpuissance : 0) + ' % = ' + W(res.chauffage) + '</td></tr>' +
      '<tr class="sep"><th colspan="2">Apports été, pointe des niveaux (W)</th></tr>' +
      '<tr><th>Soleil par les baies</th><td>' + nf(a('solaires')) + '</td></tr>' +
      '<tr><th>Conduction des baies</th><td>' + nf(a('vitrages')) + '</td></tr>' +
      '<tr><th>Murs au soleil</th><td>' + nf(a('murs')) + '</td></tr>' +
      '<tr><th>Toiture / combles</th><td>' + nf(a('toiture')) + '</td></tr>' +
      '<tr><th>Ponts thermiques</th><td>' + nf(a('pontsThermiques')) + '</td></tr>' +
      '<tr><th>Air (ventilation)</th><td>' + nf(a('ventilation')) + '</td></tr>' +
      '<tr><th>Occupants (' + nf(res.foyer.n) + ')</th><td>' + nf(a('occupants')) + '</td></tr>' +
      '<tr><th>Éclairage et appareils</th><td>' + nf(a('equipements')) + '</td></tr>' +
      '<tr class="total"><th>Total simultané (pic ' + esc(res.climCreneau) + ')</th><td>' + W(res.climSensible) + ' sensible + ' + W(res.climLatent) + ' latent</td></tr>' +
      '<tr class="total"><th>Puissance nominale</th><td>' + W(res.climatisation) + '</td></tr>' +
      '</tbody></table>' +
      '<p class="hint">Puissance frigorifique nominale air/air, latent compris. Le total tient compte du soleil et des occupants non simultanés.</p></details>';
  }

  function rafraichirGlobal(res) {
    var g = state.global;
    var cible = document.getElementById('res-global');
    if (cible) {
      setHTML('res-global', blocGlobal(res));
      var det = cible.querySelector('details');
      if (det) { det.open = !!ui.detail.global; det.dataset.uid = 'global'; }
    }
    var surface = somme(res.pieces, function (r) { return r.surface; });
    var champPerimetre = document.querySelector('[data-bind="global.perimetre"]');
    if (champPerimetre) champPerimetre.placeholder = 'auto : ' + nf(C.perimetreGlobal(g), 1);
    setHTML('global-perimetre-aide', C.estVide(g.perimetre)
      ? 'Vide : estimation 4,1 × √(surface par niveau) pour une maison isolée. Réduire si mitoyenne.'
      : '');
    var occ = document.querySelector('[data-bind="global.occupants"]');
    if (occ) occ.placeholder = 'auto : ' + nf(res.foyer.n);
    var equip = document.querySelector('[data-bind="global.equipements"]');
    if (equip) equip.placeholder = 'auto : ' + nf(Math.round(somme(res.pieces, function (r) { return r.clim.equipements; })));
    var niveau = D.find(D.NIVEAUX_VITRAGE, g.vitrageRapide.niveau);
    setHTML('vitrage-rapide-global', niveau
      ? 'Surface vitrée estimée : ' + nf(somme(res.pieces, function (r) { return r.surfaceVitree; }), 1) + ' m² (' +
        nf(niveau.ratio * 100) + ' % de la surface habitable' + (surface > 0 ? '' : ', à calculer après saisie de la surface') + ').'
      : '');
  }

  function rafraichir() {
    var res = C.calculChantier(state);

    if (res.mode === 'global') rafraichirGlobal(res);
    else state.pieces.forEach(function (p, i) {
      var r = res.pieces[i];
      setHTML('chips-' + p.uid, '<span class="chip heat">' + nf(r.chauffage / 1000, 2) + '</span><span class="chip cool">' + nf(r.climatisation / 1000, 2) + '</span>');
      var cible = document.getElementById('res-' + p.uid);
      if (cible) {
        var ouvert = !!ui.detail[p.uid];
        setHTML('res-' + p.uid, blocResultats(r));
        var det = cible.querySelector('details');
        if (det) { det.open = ouvert; det.dataset.uid = p.uid; }
      }
      setHTML('radex-' + p.uid, blocRadiateurExistant(r));
      // Puissance de chaque radiateur, sous sa saisie.
      p.radiateurs.forEach(function (rad, k) {
        var d = r.radiateurExistant && r.radiateurExistant.detail.filter(function (x) { return x.index === k; })[0];
        setHTML('radex-' + p.uid + '-' + k, d ? W(d.puissance) + ' en ' + F.esc(state.installation.regimeEau) + ' °C' +
          (r.facteurRegime !== 1 ? ' (catalogue ΔT50 : ' + W(d.puissanceCatalogue) + ')' : '') : '');
      });
      var niveau = D.find(D.NIVEAUX_VITRAGE, p.vitrageRapide.niveau);
      setHTML('vitrage-rapide-' + p.uid, niveau
        ? 'Surface vitrée estimée : ' + nf(r.surfaceVitree, 1) + ' m² (' + nf(niveau.ratio * 100) + ' % de la surface au sol' +
          (r.surface > 0 ? '' : ', à calculer après saisie des dimensions') + ').'
        : '');
      var input = document.querySelector('[data-bind="pieces.' + i + '.debit"]');
      if (input) input.placeholder = 'auto : ' + nf(r.debitEstime, 1);
      var restant = r.mursIsolation.filter(function (m) { return m.chantier; })[0];
      setHTML('u-mur-' + p.uid, (restant && restant.longueur > 0 ? 'Reste ' + nf(restant.longueur, 2) + ' ml avec l\'isolation du chantier. ' : '') +
        'U mur moyen de la pièce : ' + nf(r.u.mur, 2) + ' W/m².K (chantier : ' + nf(C.uEnveloppe(state.climat).mur, 2) + ').');
      p.mursIsolation.forEach(function (m, k) {
        var sg = r.mursIsolation[k];
        var champLong = document.querySelector('[data-bind="pieces.' + i + '.mursIsolation.' + k + '.longueur"]');
        if (champLong) champLong.placeholder = C.estVide(m.longueur) ? 'auto : ' + nf(sg ? sg.longueur : 0, 2) + ' (reste)' : '';
        setHTML('mur-iso-' + p.uid + '-' + k, sg ? nf(sg.longueur, 2) + ' ml retenus · U ' + nf(sg.u, 2) + ' W/m².K' : '');
      });
      var champConfort = document.querySelector('[data-bind="pieces.' + i + '.tConfortHiver"]');
      if (champConfort) champConfort.placeholder = 'auto : ' + nf(C.num(state.climat.tConfortHiver), 1);
      var champOcc = document.querySelector('[data-bind="pieces.' + i + '.occupants"]');
      if (champOcc) champOcc.placeholder = 'auto : ' + nf(r.clim.occupants);
      var champEquip = document.querySelector('[data-bind="pieces.' + i + '.equipements"]');
      if (champEquip) champEquip.placeholder = 'auto : ' + nf(Math.round(r.clim.equipements));
      setHTML('debit-aide-' + p.uid, r.debitAuto ? 'Vide : estimation volume × taux utilisée (' + nf(r.debitEstime, 1) + ' m³/h).' : '');
      // Alerte : sans linéaire, aucun mur extérieur n'est compté (cause fréquente de sous-évaluation).
      var aideLineaire = document.getElementById('lineaire-aide-' + p.uid);
      if (aideLineaire) {
        var oubli = C.estVide(p.lineaire) && C.estVide(p.mursExposes) && r.surface > 0;
        aideLineaire.classList.toggle('warn', oubli);
        setHTML('lineaire-aide-' + p.uid, oubli
          ? '⚠ Non saisi : aucun mur extérieur n\'est compté. Choisir le nombre de murs exposés (0 si aucun) ou saisir le linéaire.'
          : r.lineaireAuto
            ? 'Calculé : ' + nf(r.lineaire, 2) + ' ml pour ' + esc(p.mursExposes) + ' mur' + (C.num(p.mursExposes) > 1 ? 's' : '') +
              (p.saisieSurface === 'surface' ? ' (pièce carrée de même surface)' : ' (grands côtés d\'abord)') + '. Saisir une valeur pour la remplacer.'
            : !C.estVide(p.lineaire) && !C.estVide(p.mursExposes) ? 'Valeur saisie retenue ; vider le champ pour le calcul automatique.' : '');
      }
      var champLin = document.querySelector('[data-bind="pieces.' + i + '.lineaire"]');
      if (champLin) champLin.placeholder = C.estVide(p.mursExposes) ? '' : 'auto : ' + nf(C.lineaireMurs(p, C.num(p.mursExposes)), 2);
    });

    var u = C.uEnveloppe(state.climat);
    setHTML('r-mur', 'R du mur et du revêtement (hors « Isolant murs ») : ' + nf(C.rMur(state.climat), 2) + ' m².K/W' +
      (C.epaisseurMur(state.climat) !== null ? ' (' + nf(C.epaisseurMur(state.climat), 1) + ' cm' + (C.estVide(state.climat.epaisseurMur) ? ', épaisseur courante' : '') + ')' : '') + '.');
    setHTML('u-enveloppe', 'U mur ' + nf(u.mur, 2) + ' · U toiture ' + nf(u.toiture, 2) + ' · U plancher ' + nf(u.plancher, 2) + ' W/m².K');
    setHTML('g-global', res.volume > 0
      ? 'Coefficient G estimé : <strong>' + nf(res.coefficientG, 2) + ' W/m³.K</strong> · déperditions ' + nf(res.deperditionsTotales) +
        ' W/K pour ' + nf(res.volume) + ' m³ chauffés'
      : '');
    setHTML('nb-pieces', state.pieces.length + (state.pieces.length > 1 ? ' pièces' : ' pièce'));
    // Nom des sous-onglets, mis à jour pendant la saisie du nom de la pièce.
    state.pieces.forEach(function (p, k) { setHTML('tab-nom-' + p.uid, esc(p.nom || 'Pièce ' + (k + 1))); });

    var anah = res.anah;
    setHTML('sub-prime-badge', badgeAnah(anah));
    var aidePers = document.getElementById('personnes-aide');
    if (aidePers) {
      aidePers.classList.toggle('warn', personnesInvalides());
      setHTML('personnes-aide', personnesInvalides()
        ? '⚠ Valeur improbable (1 à ' + D.CLIM.foyerMax + ' personnes) : ignorée. Le revenu fiscal a-t-il été saisi ici ?'
        : '');
    }
    setHTML('anah-resultat', anah
      ? '<div class="anah-cat anah-' + anah.categorie.id + '"><span>Catégorie</span><strong>' + anah.categorie.label + '</strong><small>' + anah.categorie.detail + '</small></div>' +
        '<table class="mini"><tbody>' +
        '<tr><th>Bleu ≤</th><td>' + euros(anah.seuils[0]) + '</td></tr>' +
        '<tr><th>Jaune ≤</th><td>' + euros(anah.seuils[1]) + '</td></tr>' +
        '<tr><th>Violet ≤</th><td>' + euros(anah.seuils[2]) + '</td></tr>' +
        '<tr><th>Rose ></th><td>' + euros(anah.seuils[2]) + '</td></tr>' +
        '</tbody></table>'
      : '<p class="muted">Renseigner le nombre de personnes et le RFR.</p>');

    setHTML('totals-figures',
      '<div class="tot heat"><span>Chauffage</span><small>' + palierBarre(res.palierChauffage) + '</small><strong>' + kW(res.chauffage) + '</strong></div>' +
      '<div class="tot cool" title="Besoin simultané de la maison ; somme des pièces : ' + kW(res.climSommePieces) + '">' +
      '<span>Clim · pic ' + F.esc(res.climCreneau || '') + '</span><small>' + palierBarre(res.palierClimatisation) + '</small><strong>' + kW(res.climatisation) + '</strong></div>');

    setHTML('sub-client', esc(state.client.nom || ''));
    var z = D.find(D.ZONES, state.climat.zone);
    setHTML('sub-climat', esc((z ? z.label.split(' – ')[0] : '') + ' · ' + state.climat.tBaseHiver + ' °C'));
    document.getElementById('chantier-courant').textContent =
      (state.client.nom || 'Nouveau relevé') + (state.id ? '' : ' · non sauvegardé') + (modifie && state.id ? ' · modifié' : '');
  }

  /* ---------- Saisie ---------- */

  var minuterie = null;
  function modification() {
    modifie = true;
    clearTimeout(minuterie);
    minuterie = setTimeout(function () { ecrire(CLE_BROUILLON, state); }, 300);
  }

  var app = document.getElementById('app');

  app.addEventListener('input', function (e) {
    var el = e.target;
    if (!el.dataset.bind || el.tagName === 'SELECT') return;
    setPath(state, el.dataset.bind, el.value);
    modification();
    rafraichir();
  });

  app.addEventListener('change', function (e) {
    var el = e.target;
    if (el.hasAttribute('data-plan-ajout')) {
      ajouterPlans(Array.prototype.slice.call(el.files || []));
      el.value = '';
      return;
    }
    if (!el.dataset.bind || el.tagName !== 'SELECT') return;
    setPath(state, el.dataset.bind, el.value);
    // Autre type de paroi : l'épaisseur saisie ne vaut plus, retour à l'épaisseur courante.
    if (el.dataset.bind === 'climat.murType') state.climat.epaisseurMur = '';
    if (el.dataset.bind === 'climat.zone') {
      var z = D.find(D.ZONES, el.value);
      if (z) state.climat.tBaseHiver = String(z.t);
    }
    modification();
    render();
  });

  // L'évènement « toggle » ne remonte pas : écoute en phase de capture.
  app.addEventListener('toggle', function (e) {
    var el = e.target;
    if (!el.dataset || !el.dataset.key) return;
    if (el.dataset.key === 'detail') ui.detail[el.dataset.uid] = el.open;
  }, true);

  app.addEventListener('click', function (e) {
    var bt = e.target.closest('button');
    if (!bt) return;

    if (bt.dataset.onglet) { changerOnglet(bt.dataset.onglet, false); return; }
    // Récapitulatif : une pièce ouvre l'onglet Pièces sur elle ; raccourcis PDF / sauvegarde.
    if (bt.dataset.allerPiece) { changerOnglet('pieces', false); allerPiece(bt.dataset.allerPiece, false); return; }
    if (bt.dataset.globalRecap === 'pdf') { document.getElementById('dlg-pdf').showModal(); return; }
    if (bt.dataset.globalRecap === 'sauver') { sauvegarder(); render(); return; }

    if (bt.dataset.set) {
      var path = bt.dataset.set;
      var v = bt.dataset.value;
      setPath(state, path, getPath(state, path) === v && bt.hasAttribute('data-clear') ? '' : v);
      // Choix du nombre de murs exposés : le linéaire est recalculé (saisie manuelle effacée).
      var mm = /^pieces\.(\d+)\.mursExposes$/.exec(path);
      if (mm) state.pieces[+mm[1]].lineaire = '';
      // Isolation différente : part de celle du chantier, à modifier.
      var mi = /^pieces\.(\d+)\.isolationMurs$/.exec(path);
      if (mi && v === 'perso') {
        var pi = state.pieces[+mi[1]];
        if (!pi.mursIsolation.length) pi.mursIsolation = [nouveauMurIsolation(state.climat)];
      }
      // Passage à la saisie en m² : reprend la surface longueur × largeur déjà saisie.
      var m = /^pieces\.(\d+)\.saisieSurface$/.exec(path);
      var pc = m && state.pieces[+m[1]];
      if (pc && v === 'surface' && C.estVide(pc.surface) && C.num(pc.longueur) * C.num(pc.largeur) > 0) {
        pc.surface = String(Math.round(C.num(pc.longueur) * C.num(pc.largeur) * 100) / 100).replace('.', ',');
      }
      modification();
      render();
      return;
    }

    var i = parseInt(bt.dataset.i, 10);
    var j = parseInt(bt.dataset.j, 10);
    var p = state.pieces[i];
    switch (bt.dataset.action) {
      case 'ajouter-piece':
        ajouterPiece();
        return;
      case 'dupliquer-piece':
        var copie = JSON.parse(JSON.stringify(p));
        copie.uid = uid();
        copie.nom = p.nom + ' (copie)';
        copie.vitrages.forEach(function (v) { v.uid = uid(); });
        copie.radiateurs.forEach(function (r) { r.uid = uid(); });
        copie.mursIsolation.forEach(function (m) { m.uid = uid(); });
        state.pieces.splice(i + 1, 0, copie);
        modification();
        render();
        allerPiece(copie.uid, false);
        return;
      case 'supprimer-piece':
        if (!confirm('Supprimer la pièce « ' + p.nom + ' » ?')) return;
        state.pieces.splice(i, 1);
        // Affiche la pièce suivante (ou la précédente pour la dernière).
        var voisine = state.pieces[Math.min(i, state.pieces.length - 1)];
        ui.sous = voisine ? 'piece-' + voisine.uid : null;
        break;
      case 'replier':
        ui.replie[p.uid] = !ui.replie[p.uid];
        render();
        return;
      case 'ajouter-vitrage':
        getPath(state, bt.dataset.base).vitrages.push(nouveauVitrage());
        break;
      case 'ajouter-mur-isolation':
        p.mursIsolation.push(nouveauMurIsolation(state.climat));
        break;
      case 'supprimer-mur-isolation':
        p.mursIsolation.splice(j, 1);
        if (!p.mursIsolation.length) p.isolationMurs = 'chantier';
        break;
      case 'ajouter-radiateur':
        p.radiateurs.push(nouveauRadiateur());
        break;
      case 'supprimer-radiateur':
        p.radiateurs.splice(j, 1);
        break;
      case 'voir-plan':
        var pl = state.plans[j];
        if (!pl) return;
        if (urlsPlans[pl.id]) { window.open(urlsPlans[pl.id], '_blank'); return; }
        var fenetre = window.open('', '_blank');
        window.Plans.lire(pl.id).then(function (blob) {
          if (!blob) throw new Error('fichier introuvable sur cet appareil');
          urlsPlans[pl.id] = URL.createObjectURL(blob);
          if (fenetre) fenetre.location = urlsPlans[pl.id]; else window.open(urlsPlans[pl.id], '_blank');
        }).catch(function (err) { if (fenetre) fenetre.close(); toast('Plan illisible : ' + err.message); });
        return;
      case 'supprimer-plan':
        var retire = state.plans[j];
        if (!retire || !confirm('Supprimer le plan « ' + retire.nom + ' » ?')) return;
        state.plans.splice(j, 1);
        nettoyerPlans([retire.id]);
        break;
      case 'ajouter-unite':
        var unites = state.installation.unites;
        // La première unité ajoutée représente l'existant : on en crée deux d'emblée.
        if (!unites.length) unites.push({ uid: uid(), nom: '' });
        unites.push({ uid: uid(), nom: '' });
        break;
      case 'supprimer-unite':
        var retiree = state.installation.unites.splice(j, 1)[0];
        state.pieces.forEach(function (pc) { if (pc.unite === retiree.uid) pc.unite = ''; });
        if (state.installation.unites.length < 2) state.installation.unites = [];
        break;
      case 'supprimer-vitrage':
        getPath(state, bt.dataset.base).vitrages.splice(j, 1);
        break;
      case 'estimer-debit':
        p.debit = String(Math.round(C.debitEstime(p, state.climat) * 10) / 10).replace('.', ',');
        break;
      default:
        return;
    }
    modification();
    render();
  });

  /* ---------- Chantiers sauvegardés ---------- */

  function chantiers() {
    var l = lire(CLE_CHANTIERS, []);
    return Array.isArray(l) ? l : [];
  }

  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  function sauvegarder() {
    var l = chantiers();
    if (!state.id) state.id = uid();
    var entree = { id: state.id, savedAt: new Date().toISOString(), data: JSON.parse(JSON.stringify(state)) };
    var idx = l.findIndex(function (c) { return c.id === state.id; });
    if (idx >= 0) l[idx] = entree; else l.unshift(entree);
    if (ecrire(CLE_CHANTIERS, l)) {
      modifie = false;
      ecrire(CLE_BROUILLON, state);
      toast('Chantier sauvegardé');
    } else {
      toast('Échec de la sauvegarde (stockage indisponible ou plein)');
    }
    rafraichir();
  }


  function afficherChantiers() {
    var l = chantiers();
    var html = l.length
      ? '<ul class="chantiers">' + l.map(function (c) {
        var cl = c.data.client || {};
        var res = C.calculChantier(normaliser(c.data));
        return '<li' + (c.id === state.id ? ' class="current"' : '') + '>' +
          '<button type="button" class="chantier-load" data-load="' + esc(c.id) + '">' +
          '<strong>' + esc(cl.nom || 'Sans nom') + '</strong>' +
          '<span class="muted small">' + esc(dateFr(cl.date)) + (cl.adresse ? ' · ' + esc(cl.adresse) : '') + '</span>' +
          '<span class="small">' + esc(F.libelle(D.SYSTEMES, res.systeme)) + ' · ' + kW(res.chauffage) + ' chauffage · ' + kW(res.climatisation) + ' clim</span>' +
          '</button>' +
          '<button type="button" class="btn ghost icon-btn danger" data-delete="' + esc(c.id) + '" aria-label="Supprimer ce chantier">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button>' +
          '</li>';
      }).join('') + '</ul>'
      : '<p class="muted empty">Aucun chantier sauvegardé sur cet appareil.</p>';
    document.getElementById('liste-chantiers').innerHTML = html +
      '<p class="hint">Les chantiers sont stockés uniquement sur cet appareil, dans ce navigateur.</p>';
  }

  var dlg = document.getElementById('dlg-chantiers');

  dlg.addEventListener('click', function (e) {
    if (e.target === dlg || e.target.closest('[data-close]')) { dlg.close(); return; }
    var load = e.target.closest('[data-load]');
    var del = e.target.closest('[data-delete]');
    if (load) {
      var c = chantiers().find(function (x) { return x.id === load.dataset.load; });
      if (!c) return;
      if (modifie && !confirm('Les modifications non sauvegardées du relevé en cours seront perdues. Continuer ?')) return;
      var avant = idsPlans(state);
      state = normaliser(c.data);
      nettoyerPlans(avant);
      state.id = c.id;
      modifie = false;
      ui.replie = {};
      ui.sous = null;
      ui.detail = {};
      ecrire(CLE_BROUILLON, state);
      dlg.close();
      render();
      window.scrollTo(0, 0);
      toast('Chantier chargé');
    } else if (del) {
      var l = chantiers();
      var cible = l.find(function (x) { return x.id === del.dataset.delete; });
      if (!cible) return;
      if (!confirm('Supprimer définitivement le chantier « ' + ((cible.data.client || {}).nom || 'Sans nom') + ' » ?')) return;
      ecrire(CLE_CHANTIERS, l.filter(function (x) { return x.id !== cible.id; }));
      nettoyerPlans(idsPlans(cible.data));
      if (state.id === cible.id) { state.id = null; ecrire(CLE_BROUILLON, state); rafraichir(); }
      afficherChantiers();
    }
  });

  function ajouterPiece() {
    var np = nouvellePiece(state.pieces.length + 1);
    state.pieces.push(np);
    modification();
    render();
    allerPiece(np.uid, false);
  }

  function nouveauReleve() {
    if (!confirm('Démarrer un nouveau relevé ?\nClient, installation, prime, plans et pièces seront réinitialisés (les réglages climat / enveloppe sont conservés).' +
      (modifie ? '\n\nAttention : des modifications ne sont pas sauvegardées.' : ''))) return;
    var avant = idsPlans(state);
    state = nouveauChantier(JSON.parse(JSON.stringify(state.climat)), state.mode, state.systeme);
    nettoyerPlans(avant);
    modifie = false;
    ui.replie = {};
    ui.sous = null;
    ui.detail = {};
    ecrire(CLE_BROUILLON, state);
    changerOnglet('client', false);
  }

  /* ---------- Export PDF ---------- */

  var dlgPdf = document.getElementById('dlg-pdf');
  dlgPdf.addEventListener('click', function (e) {
    if (e.target === dlgPdf || e.target.closest('[data-close]')) { dlgPdf.close(); return; }
    var b = e.target.closest('[data-pdf]');
    if (!b) return;
    dlgPdf.close();
    exporterPdf(b.dataset.pdf);
  });

  function exporterPdf(version) {
    toast('Création du PDF…');
    window.Rapport.generer(state, version).then(function (f) {
      window.Rapport.telecharger(f);
      toast('PDF enregistré : ' + f.nom);
    }).catch(function (err) {
      toast('PDF impossible : ' + err.message);
    });
  }

  /* ---------- Barre d'actions et thème ---------- */

  document.querySelector('.totals-actions').addEventListener('click', function (e) {
    var bt = e.target.closest('[data-global]');
    if (!bt) return;
    switch (bt.dataset.global) {
      case 'nouveau': nouveauReleve(); break;
      case 'chantiers': afficherChantiers(); dlg.showModal(); break;
      case 'pdf': dlgPdf.showModal(); break;
      case 'email': window.Envoi.ouvrir(state); break;
      case 'sauver': sauvegarder(); break;
    }
  });

  var THEMES = ['auto', 'light', 'dark'];
  var ICONES_THEME = {
    auto: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>',
    light: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    dark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>'
  };
  var NOMS_THEME = { auto: 'automatique', light: 'clair', dark: 'sombre' };

  function appliquerTheme(t) {
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
    var b = document.getElementById('btn-theme');
    b.innerHTML = ICONES_THEME[t];
    b.setAttribute('aria-label', 'Thème ' + NOMS_THEME[t] + ' (changer)');
    b.title = 'Thème ' + NOMS_THEME[t];
  }

  var theme = 'auto';
  try { theme = localStorage.getItem(CLE_THEME) || 'auto'; } catch (e) { /* stockage indisponible */ }
  if (THEMES.indexOf(theme) < 0) theme = 'auto';
  appliquerTheme(theme);
  document.getElementById('btn-theme').addEventListener('click', function () {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    try { localStorage.setItem(CLE_THEME, theme); } catch (e) { /* stockage indisponible */ }
    appliquerTheme(theme);
  });

  // Rappel avant de quitter avec des modifications non sauvegardées (le brouillon reste conservé).
  window.addEventListener('beforeunload', function () { ecrire(CLE_BROUILLON, state); });

  window.Entreprise.initialiser();
  window.Envoi.initialiser();

  // Mises à jour : vérifiées à chaque retour sur l'application (une application installée reste
  // ouverte en arrière-plan) ; quand la nouvelle version prend la main, la page se recharge
  // (le brouillon est conservé).
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    var dejaControlee = !!navigator.serviceWorker.controller;
    var rechargement = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!dejaControlee || rechargement) return;
      rechargement = true;
      ecrire(CLE_BROUILLON, state);
      window.location.reload();
    });
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') reg.update().catch(function () { /* hors ligne */ });
      });
    }).catch(function () { /* hors ligne non disponible */ });
  }

  hauteurEntete();
  render();
})();
