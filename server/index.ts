import 'dotenv/config';
import app from './app.js';

// A closed/backpressured stdout pipe (a host's log capture disconnecting,
// or just falling behind) makes Node's next console.log throw an unhandled
// EPIPE — and with no listener on the stream's own 'error' event, that
// crashes the entire process. Logging is not worth a process crash, so any
// write error here is swallowed instead.
process.stdout.on('error', (err: { code?: string }) => {
  if (err.code !== 'EPIPE') throw err;
});
process.stderr.on('error', (err: { code?: string }) => {
  if (err.code !== 'EPIPE') throw err;
});

// Local/non-Vercel dev entry point only — app.listen() has no effect on
// Vercel, which instead imports the same app (see api/index.ts) and invokes
// it per-request as a serverless function.
const PORT = Number(process.env.API_PORT) || 8787;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] Provider proxy listening on http://0.0.0.0:${PORT}`);
});
