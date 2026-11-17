// Entry point: Express app, static SPA, route mounting.
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');

const { PIXEL_GIF, markOpened } = require('./mail');

const SPA_DIR = path.join(__dirname, '..', '..', 'spa');
const BASE = process.env.APP_BASE_URL || '';

const app = express();
app.use(express.urlencoded({ extended: false, limit: '25mb' }));
app.use(express.json({ limit: '25mb' }));

// ── static: serve the SPA + assets (mirrors the old ORDS /app, /assets, /sw) ──
app.get('/api/app', (_req, res) => res.type('text/html').send(fs.readFileSync(path.join(SPA_DIR, 'index.html'))));

const ASSETS = {
  arkia:   { file: 'assets/arkia-logo.svg',  type: 'image/svg+xml' },
  teltos:  { file: 'assets/teltos-logo.jpeg', type: 'image/jpeg' },
  appicon: { file: 'assets/appicon.png',      type: 'image/png' },
  guide:   { file: 'guide.html',              type: 'text/html; charset=utf-8' },
};
app.get('/api/assets/:name', (req, res) => {
  if (req.params.name === 'manifest') {
    return res.type('application/manifest+json').json({
      name: 'הזמנת טיסות מטלטוס', short_name: 'הזמנות',
      start_url: '/api/app?pwa=1', scope: '/api/', display: 'standalone',
      background_color: '#123a86', theme_color: '#123a86', lang: 'he', dir: 'rtl',
      icons: [{ src: '/api/assets/appicon', sizes: '512x512', type: 'image/png', purpose: 'any' }],
    });
  }
  const a = ASSETS[req.params.name];
  if (!a) return res.status(404).end();
  res.type(a.type).send(fs.readFileSync(path.join(SPA_DIR, a.file)));
});
app.get('/api/sw', (_req, res) => res.type('application/javascript').send(
  `self.addEventListener('install',e=>self.skipWaiting());
   self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
   self.addEventListener('fetch',e=>{if(e.request.url.indexOf('/api/app')!==-1){
     e.respondWith(fetch(e.request,{cache:'reload'}).catch(()=>caches.match(e.request)));}});`));

// ── email read-tracking pixel (anonymous) ──
app.get('/api/track', async (req, res) => {
  await markOpened(req.query.t);
  res.type('image/gif').send(PIXEL_GIF);
});

// ── API routes ──
app.use('/api', require('./routes/public'));
app.use('/api', require('./routes/bookings'));
app.use('/api', require('./routes/notifications'));
app.use('/api', require('./routes/admin'));

// health
app.get('/healthz', (_req, res) => res.json({ ok: true }));

const PORT = Number(process.env.PORT || 8080);
app.listen(PORT, () => console.log(`arkia-bookings-server on :${PORT}  (SPA /api/app, base ${BASE})`));
