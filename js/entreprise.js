/*
 * « Mon entreprise » : logo et coordonnées affichés dans l'en-tête, les PDF et les emails.
 * Stockés sur l'appareil uniquement. Logo : celui choisi dans l'application, sinon le fichier
 * logo.png déposé à la racine du site (s'il existe).
 */
(function (root) {
  'use strict';

  var CLE = 'dimclim.entreprise';
  var FICHIER_LOGO = 'logo.png';
  var LARGEUR_MAX_LOGO = 900; // px : suffisant pour l'impression, léger pour le stockage local

  var DEFAUT = {
    nom: 'C&H Énergie',
    activite: 'Pompe à chaleur – Climatisation – Ventilation – Électricité – Panneaux solaires photovoltaïques',
    adresse: '',
    telephone: '',
    email: '',
    siret: '',
    technicien: '',
    logo: ''
  };

  var CHAMPS = [
    ['nom', 'Nom de l\'entreprise', 'text'],
    ['activite', 'Activité (sous le nom)', 'text'],
    ['adresse', 'Adresse', 'text'],
    ['telephone', 'Téléphone', 'tel'],
    ['email', 'Email', 'email'],
    ['siret', 'SIRET', 'text'],
    ['technicien', 'Technicien / signataire', 'text']
  ];

  function lire() {
    var d = {};
    try { d = JSON.parse(localStorage.getItem(CLE)) || {}; } catch (e) { d = {}; }
    return Object.assign({}, DEFAUT, d);
  }

  var donnees = lire();

  function enregistrer() {
    try {
      localStorage.setItem(CLE, JSON.stringify(donnees));
      return true;
    } catch (e) {
      return false;
    }
  }

  // Charge une image (URL ou data URL) et la convertit en PNG redimensionné.
  // Résout { dataUrl, w, h } ou null si l'image est absente ou illisible.
  function versPng(src, largeurMax) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth || 600;
        var h = img.naturalHeight || 200;
        var k = Math.min(1, largeurMax / w);
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(w * k));
        canvas.height = Math.max(1, Math.round(h * k));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        try {
          resolve({ dataUrl: canvas.toDataURL('image/png'), w: canvas.width, h: canvas.height });
        } catch (e) {
          resolve(null);
        }
      };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
  }

  var cacheLogo = null;

  function logo() {
    if (!cacheLogo) cacheLogo = versPng(donnees.logo || FICHIER_LOGO, LARGEUR_MAX_LOGO);
    return cacheLogo;
  }

  function afficherEntete() {
    var img = document.getElementById('logo-entete');
    var barre = document.querySelector('.topbar');
    if (!img) return;
    img.onload = function () { barre.classList.add('has-logo'); };
    img.onerror = function () { barre.classList.remove('has-logo'); };
    img.alt = donnees.nom;
    img.src = donnees.logo || FICHIER_LOGO;
  }

  function esc(s) { return root.Fmt.esc(s); }

  function rendreDialogue() {
    var corps = document.getElementById('form-entreprise');
    corps.innerHTML =
      '<div class="logo-zone">' +
      '<div class="logo-apercu"><img id="logo-apercu" alt="Logo"><span class="muted small" id="logo-absent">Aucun logo</span></div>' +
      '<div class="logo-actions">' +
      '<label class="btn small">Choisir un logo…<input type="file" accept="image/*" id="logo-fichier" hidden></label>' +
      (donnees.logo ? '<button type="button" class="btn ghost small danger" id="logo-retirer">Retirer</button>' : '') +
      '</div></div>' +
      '<p class="hint">' + (donnees.logo
        ? 'Logo choisi sur cet appareil.'
        : 'Par défaut : fichier « logo.png » du site, s\'il existe. Vous pouvez aussi choisir une image du téléphone.') + '</p>' +
      '<div class="grid">' +
      CHAMPS.map(function (c) {
        return '<div class="field span-2"><label class="lbl" for="ent-' + c[0] + '">' + esc(c[1]) + '</label>' +
          '<div class="ctrl"><span class="inp"><input id="ent-' + c[0] + '" data-ent="' + c[0] + '" type="' + c[2] + '" autocomplete="off" value="' + esc(donnees[c[0]]) + '"></span></div></div>';
      }).join('') +
      '</div>' +
      '<p class="hint">Ces informations restent sur cet appareil ; elles apparaissent sur les PDF et les emails.</p>';

    var apercu = document.getElementById('logo-apercu');
    var absent = document.getElementById('logo-absent');
    apercu.onload = function () { apercu.hidden = false; absent.hidden = true; };
    apercu.onerror = function () { apercu.hidden = true; absent.hidden = false; };
    apercu.src = donnees.logo || FICHIER_LOGO;
  }

  function changerLogo(dataUrl) {
    donnees.logo = dataUrl;
    cacheLogo = null;
    if (!enregistrer()) {
      donnees.logo = '';
      enregistrer();
      alert('Impossible d\'enregistrer ce logo (stockage plein ou indisponible). Essayez une image plus petite.');
    }
    rendreDialogue();
    afficherEntete();
  }

  function initialiser() {
    var dlg = document.getElementById('dlg-entreprise');
    afficherEntete();

    document.getElementById('btn-entreprise').addEventListener('click', function () {
      rendreDialogue();
      dlg.showModal();
    });

    dlg.addEventListener('click', function (e) {
      if (e.target === dlg || e.target.closest('[data-close]')) { dlg.close(); return; }
      if (e.target.closest('#logo-retirer')) changerLogo('');
    });

    dlg.addEventListener('input', function (e) {
      var k = e.target.dataset.ent;
      if (!k) return;
      donnees[k] = e.target.value;
      enregistrer();
      if (k === 'nom') afficherEntete();
    });

    dlg.addEventListener('change', function (e) {
      if (e.target.id !== 'logo-fichier' || !e.target.files || !e.target.files[0]) return;
      var lecteur = new FileReader();
      lecteur.onload = function () {
        versPng(lecteur.result, LARGEUR_MAX_LOGO).then(function (png) {
          if (png) changerLogo(png.dataUrl);
          else alert('Image illisible. Utilisez un fichier PNG ou JPG.');
        });
      };
      lecteur.readAsDataURL(e.target.files[0]);
    });
  }

  root.Entreprise = {
    get: function () { return donnees; },
    logo: logo,
    initialiser: initialiser
  };
})(this);
