// public/config.js
// ---------------------------------------------------------------------------
// This is the ONLY file you edit to point the dashboard at a different API.
//
// Local development: leave it empty (""). The page is served by the same
// Express server that answers /api/*, so relative URLs just work.
//
// Deployed: the frontend lives on Vercel and the API lives on Railway, so put
// the Railway URL here, e.g.
//   window.APP_CONFIG = { API_URL: "https://omnisync-api.up.railway.app" };
//
// Note: this is a plain static file, so Vercel environment variables cannot be
// read here. That is one reason real projects move to Vite, where
// import.meta.env.VITE_API_URL works at build time.
// ---------------------------------------------------------------------------
window.APP_CONFIG = {
  API_URL: 'https://omnisync-crm-hub-production.up.railway.app',
};
