/*
 * Mise en forme partagée (écran, PDF, email) : nombres, libellés, descriptions textuelles.
 */
(function (root) {
  'use strict';

  var D = root.Data;
  var C = root.Calc;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function nf(v, dec) {
    return v.toLocaleString('fr-FR', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 });
  }

  function kW(w) { return nf(w / 1000, 2) + ' kW'; }
  function W(w) { return nf(Math.round(w)) + ' W'; }
  function euros(v) { return nf(Math.round(v)) + ' €'; }

  function libelle(table, id) {
    var e = D.find(table, id);
    return e ? e.label : '—';
  }

  function libelleOrientation(id) {
    return id === D.ORIENTATION_MIXTE.id ? D.ORIENTATION_MIXTE.label : libelle(D.ORIENTATIONS, id);
  }

  function texteOuiNon(v) {
    return v === 'oui' ? 'Oui' : v === 'non' ? 'Non' : '—';
  }

  function textePalierPac(p) {
    if (p.depasse) return 'Étude multi-splits';
    return p.valeur === null ? '—' : nf(p.valeur, p.valeur % 1 ? 1 : 0) + ' kW';
  }

  function palierBarre(p) {
    return p.depasse ? textePalierPac(p) : 'Palier ' + textePalierPac(p);
  }

  function textePalierRadiateur(p) {
    if (p.depasse) return 'Plusieurs émetteurs';
    return p.valeur === null ? '—' : W(p.valeur);
  }

  function dateFr(iso) {
    if (!iso) return '';
    var d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
    return isNaN(d) ? iso : d.toLocaleDateString('fr-FR');
  }

  function avecUnite(v, u) {
    return C.estVide(v) ? '' : v + ' ' + u;
  }

  function isolantTexte(iso) {
    var m = D.find(D.ISOLANTS, iso.materiau);
    if (!m || !m.lambda) return 'Aucun isolant';
    return m.label + ' ' + (C.estVide(iso.epaisseur) ? '(épaisseur non saisie)' : iso.epaisseur + ' cm');
  }

  function texteEcs(ins) {
    var ecs = ins.ecsPac === 'oui' ? 'Par la PAC'
      : ins.ecsPac === 'non' ? (ins.ballonThermo === 'oui' ? 'Ballon thermodynamique' : ins.ballonThermo === 'non' ? 'Autre (hors PAC / thermo.)' : 'Hors PAC')
        : '';
    if (ecs && ins.ecsEmplacement && (ins.ecsPac === 'oui' || ins.ballonThermo === 'oui')) {
      ecs += ' – ' + (ins.ecsEmplacement === 'integre' ? 'intégré' : 'déporté');
    }
    return ecs;
  }

  // Une ligne par vitrage ; en saisie rapide, le niveau choisi et la surface estimée.
  function lignesVitrages(piece, resultat) {
    if (piece.vitrageMode === 'rapide') {
      var g = piece.vitrageRapide;
      var niveau = D.find(D.NIVEAUX_VITRAGE, g.niveau);
      return [(niveau ? niveau.label + ' (' + nf(niveau.ratio * 100) + ' % du sol)' : 'Saisie rapide') +
        ' · ' + libelleOrientation(g.orientation) + ' · ' + libelle(D.VITRAGES, g.type) +
        ' · ≈ ' + nf(resultat.surfaceVitree, 1) + ' m²' + (g.volet === 'oui' ? ' · volets' : '')];
    }
    return piece.vitrages.map(function (v) {
      return libelleOrientation(v.orientation) + ' · ' + libelle(D.VITRAGES, v.type) + ' · ' + (v.surface || '0') + ' m²' + (v.volet === 'oui' ? ' · volet' : '');
    });
  }

  function texteRadiateurExistant(piece, resultat, regimeEau) {
    var ex = resultat.radiateurExistant;
    if (!ex) return '—';
    var pr = piece.radiateur;
    var desc = pr.materiau === 'acier'
      ? 'Acier ' + libelle(D.RADIATEURS_ACIER, pr.typeAcier) + ' ' + (pr.hauteur || '?') + ' × ' + (pr.longueur || '?') + ' cm'
      : libelle(D.MATERIAUX_RADIATEUR, pr.materiau) + ' ' + (pr.elements || '0') + ' élts de ' + pr.hauteurElement + ' mm';
    var puissance = resultat.facteurRegime !== 1
      ? W(ex.puissanceCatalogue) + ' à ΔT50, soit ' + W(ex.puissance) + ' en ' + regimeEau + ' °C'
      : W(ex.puissance);
    return desc + ' → ' + puissance + ' · ' + (ex.suffisant ? 'Suffisant' : 'Insuffisant (manque ' + W(ex.manque) + ')');
  }

  // Type d'isolation des murs (ponts thermiques), tel que renvoyé par Calc.isolationMur.
  var LIBELLES_ISOLATION = {
    non_isole: 'murs non isolés', iti: 'ITI', ite: 'ITE', itr: 'isolation répartie',
    iti_itr: 'ITI sur isolation répartie', ite_itr: 'ITE sur isolation répartie'
  };

  root.Fmt = {
    LIBELLES_ISOLATION: LIBELLES_ISOLATION,
    esc: esc,
    nf: nf,
    kW: kW,
    W: W,
    euros: euros,
    libelle: libelle,
    libelleOrientation: libelleOrientation,
    texteOuiNon: texteOuiNon,
    textePalierPac: textePalierPac,
    palierBarre: palierBarre,
    textePalierRadiateur: textePalierRadiateur,
    dateFr: dateFr,
    avecUnite: avecUnite,
    isolantTexte: isolantTexte,
    texteEcs: texteEcs,
    lignesVitrages: lignesVitrages,
    texteRadiateurExistant: texteRadiateurExistant
  };
})(this);
