// Service worker : met l'application en cache pour un usage hors ligne sur le terrain.
// Incrémenter VERSION à chaque modification des fichiers listés.
var VERSION = 'releve-pac-v14';
var FICHIERS = [
  './',
  './index.html',
  './css/styles.css',
  './js/data.js',
  './js/calc.js',
  './js/format.js',
  './js/entreprise.js',
  './js/rapport.js',
  './js/envoi.js',
  './js/app.js',
  './vendor/jspdf.umd.min.js',
  './vendor/jspdf.plugin.autotable.min.js'
];

// Images : mises en cache une par une, sans bloquer l'installation si l'une manque.
var IMAGES = [
  './manifest.webmanifest',
  './logo.png',
  './logo-embleme.png',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

// cache: 'reload' : télécharge depuis le serveur, sans reprendre une copie périmée du cache du navigateur.
function frais(url) { return new Request(url, { cache: 'reload' }); }

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) {
    return c.addAll(FICHIERS.map(frais)).then(function () {
      return Promise.all(IMAGES.map(function (url) { return c.add(frais(url)).catch(function () {}); }));
    });
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (cles) {
    return Promise.all(cles.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// Réseau d'abord (pour récupérer les mises à jour), cache en secours hors ligne.
// cache: 'no-cache' : le navigateur revalide chaque fichier auprès du serveur au lieu de servir
// sa copie gardée jusqu'à 10 min par GitHub Pages.
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  var requete = new Request(e.request.mode === 'navigate' ? e.request.url : e.request, { cache: 'no-cache' });
  e.respondWith(
    fetch(requete).then(function (r) {
      var copie = r.clone();
      caches.open(VERSION).then(function (c) { c.put(e.request, copie); });
      return r;
    }).catch(function () {
      return caches.match(e.request, { ignoreSearch: true }).then(function (r) { return r || caches.match('./index.html'); });
    })
  );
});
