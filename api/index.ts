import app from '../server/app';

// Vercel's Node.js runtime accepts a plain (req, res) handler — an Express
// app already is one, so no adapter is needed. vercel.json rewrites every
// /api/* request to this one function; the Express app's own route table
// (server/app.ts) does the actual dispatching from there, unchanged from
// how it runs locally via server/index.ts.
export default app;
