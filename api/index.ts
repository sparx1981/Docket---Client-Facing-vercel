// Node's ESM loader (this project runs under "type": "module") requires an
// explicit extension on relative imports at runtime, unlike Vite/bundler
// resolution — omitting it here produced an ERR_MODULE_NOT_FOUND crash the
// first time this ran as a Vercel function (no bundler rewrites this path).
import app from '../server/app.js';

// Vercel's Node.js runtime accepts a plain (req, res) handler — an Express
// app already is one, so no adapter is needed. vercel.json rewrites every
// /api/* request to this one function; the Express app's own route table
// (server/app.ts) does the actual dispatching from there, unchanged from
// how it runs locally via server/index.ts.
export default app;
