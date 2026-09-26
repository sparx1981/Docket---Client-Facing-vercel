import React from 'react';

/**
 * __APP_VERSION__ and __APP_BUILD_TIME__ are injected at build time by
 * vite.config.ts (from Vercel's VERCEL_GIT_COMMIT_SHA, falling back to
 * 'dev' for local runs) — this is how you tell which deployed commit is
 * actually live without checking Vercel directly.
 */
export const VersionBadge: React.FC = () => (
  <div className="fixed bottom-2 left-2 z-50 select-none rounded bg-black/60 px-2 py-1 font-mono text-[10px] text-white/70">
    v{__APP_VERSION__} · {__APP_BUILD_TIME__}
  </div>
);
