/*
 * Envoi du relevé par email. Sans serveur, l'application ne peut pas expédier le message elle-même :
 * - « Partager le PDF » ouvre le menu de partage du téléphone (Mail, Gmail, Outlook…) avec le PDF joint ;
 * - « Ouvrir ma messagerie » prépare un email (destinataire, objet, message) ; le PDF y est joint à la main.
 */
(function (root) {
  'use strict';

  var F = root.Fmt;
  var C = root.Calc;

  var fichier = null;
  var etat = null;

  function partageFichiersPossible() {
    try {
      return !!(navigator.canShare && navigator.share &&
        navigator.canShare({ files: [new File(['%PDF'], 'test.pdf', { type: 'application/pdf' })] }));
    } catch (e) {
      return false;
    }
  }

  function objet(state) {
    var c = state.client;
    return ['Relevé technique', c.nom, c.date ? F.dateFr(c.date) : ''].filter(Boolean).join(' – ');
  }

  function message(state) {
    var ent = root.Entreprise.get();
    var res = C.calculChantier(state);
    var c = state.client;
    var l = [
      'Bonjour,',
      '',
      'Veuillez trouver ci-joint le relevé technique' + (c.date ? ' réalisé le ' + F.dateFr(c.date) : '') + '.',
      '',
      'Synthèse :',
      '- Besoin de chauffage : ' + F.kW(res.chauffage) + ' (palier PAC conseillé : ' + F.textePalierPac(res.palierChauffage) + ')',
      '- Besoin de climatisation : ' + F.kW(res.climatisation) + ' (palier conseillé : ' + F.textePalierPac(res.palierClimatisation) + ')'
    ];
    if (res.anah) {
      l.push('- Catégorie Anah / MaPrimeRénov\' : ' + res.anah.categorie.label + ' (' + res.anah.categorie.detail.toLowerCase() + ')');
    }
    l.push('- Pièces relevées : ' + state.pieces.length, '', 'Nous restons à votre disposition pour toute question.', '', 'Cordialement,');
    [ent.technicien, ent.nom, [ent.telephone, ent.email].filter(Boolean).join(' · ')]
      .filter(Boolean).forEach(function (x) { l.push(x); });
    return l.join('\n');
  }

  function el(id) { return document.getElementById(id); }

  function statut(texte) { el('env-statut').textContent = texte; }

  function boutonsPdf(actifs) {
    ['env-partager', 'env-pdf'].forEach(function (id) {
      if (el(id)) el(id).disabled = !actifs;
    });
  }

  function ouvrir(state) {
    var dlg = el('dlg-envoi');
    var partage = partageFichiersPossible();
    var c = state.client;
    etat = state;
    fichier = null;

    el('form-envoi').innerHTML =
      '<div class="grid">' +
      '<div class="field span-2"><label class="lbl" for="env-a">Destinataire</label>' +
      '<div class="ctrl"><span class="inp"><input id="env-a" type="email" autocomplete="off" placeholder="email du client" value="' + F.esc(c.email) + '"></span></div></div>' +
      '<div class="field span-2"><label class="lbl" for="env-objet">Objet</label>' +
      '<div class="ctrl"><span class="inp"><input id="env-objet" type="text" autocomplete="off" value="' + F.esc(objet(state)) + '"></span></div></div>' +
      '<div class="field span-2"><label class="lbl" for="env-message">Message</label>' +
      '<textarea id="env-message" rows="10">' + F.esc(message(state)) + '</textarea></div>' +
      '</div>' +
      '<p class="hint" id="env-statut" role="status"></p>' +
      '<div class="envoi-actions">' +
      (partage ? '<button type="button" class="btn primary" id="env-partager" disabled>Partager le PDF…</button>' : '') +
      '<button type="button" class="btn' + (partage ? '' : ' primary') + '" id="env-mail">Ouvrir ma messagerie</button>' +
      '<button type="button" class="btn" id="env-pdf" disabled>Télécharger le PDF</button>' +
      '</div>' +
      '<p class="hint">' + (partage
        ? '« Partager le PDF » : choisissez votre messagerie, le PDF est joint ; l\'adresse du destinataire est copiée, collez-la dans « À ». ' +
          '« Ouvrir ma messagerie » prépare l\'email sans pièce jointe.'
        : '« Ouvrir ma messagerie » télécharge le PDF puis prépare l\'email : joignez-y le PDF téléchargé.') + '</p>';

    dlg.showModal();
    statut('Préparation du PDF…');
    root.Rapport.generer(state).then(function (f) {
      if (etat !== state) return;
      fichier = f;
      statut('PDF prêt : ' + f.nom);
      boutonsPdf(true);
    }).catch(function (err) {
      statut('PDF indisponible (' + err.message + '). Le message peut tout de même être envoyé.');
    });
  }

  function partager() {
    if (!fichier) return;
    var a = el('env-a').value.trim();
    if (a && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(a).catch(function () { /* copie facultative */ });
    }
    var pdf = new File([fichier.blob], fichier.nom, { type: 'application/pdf' });
    navigator.share({ files: [pdf], title: el('env-objet').value, text: el('env-message').value })
      .then(function () { statut('Relevé partagé.'); })
      .catch(function (err) {
        if (err && err.name === 'AbortError') return;
        statut('Partage impossible (' + (err && err.message) + '). Utilisez « Ouvrir ma messagerie ».');
      });
  }

  function ouvrirMessagerie() {
    var a = el('env-a').value.trim();
    var corps = el('env-message').value.replace(/\r?\n/g, '\r\n');
    var lien = 'mailto:' + encodeURI(a) +
      '?subject=' + encodeURIComponent(el('env-objet').value) +
      '&body=' + encodeURIComponent(corps);
    var differe = 0;
    if (!partageFichiersPossible() && fichier) {
      root.Rapport.telecharger(fichier);
      statut('PDF téléchargé (' + fichier.nom + ') : joignez-le à votre email.');
      differe = 400;
    }
    setTimeout(function () { window.location.href = lien; }, differe);
  }

  function initialiser() {
    var dlg = el('dlg-envoi');
    dlg.addEventListener('click', function (e) {
      if (e.target === dlg || e.target.closest('[data-close]')) { dlg.close(); return; }
      var bt = e.target.closest('button');
      if (!bt) return;
      if (bt.id === 'env-partager') partager();
      else if (bt.id === 'env-mail') ouvrirMessagerie();
      else if (bt.id === 'env-pdf' && fichier) root.Rapport.telecharger(fichier);
    });
    dlg.addEventListener('close', function () { etat = null; fichier = null; });
  }

  root.Envoi = {
    ouvrir: ouvrir,
    initialiser: initialiser,
    message: message,
    objet: objet
  };
})(this);
