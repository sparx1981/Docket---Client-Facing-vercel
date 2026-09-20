import React, { useState } from 'react';
import {
  ShieldCheck,
  Cloud,
  Lock,
  ExternalLink,
  AlertCircle,
  Database,
  ArrowRight,
} from 'lucide-react';
import { SealMark } from './AppShell';

interface LoginScreenProps {
  onSignInWithGoogle: () => Promise<void>;
  onContinueAsGuest?: () => void;
  isLoading?: boolean;
  error?: string | null;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  onSignInWithGoogle,
  onContinueAsGuest,
  isLoading = false,
  error = null,
}) => {
  const [internalError, setInternalError] = useState<string | null>(null);

  const handleGoogleClick = async () => {
    setInternalError(null);
    try {
      await onSignInWithGoogle();
    } catch (err: any) {
      console.error('Google Sign-In Error:', err);
      // Give clear, helpful feedback if popup was blocked or closed
      if (err?.code === 'auth/popup-closed-by-user') {
        setInternalError('Sign-in cancelled. The Google sign-in popup was closed.');
      } else if (err?.code === 'auth/popup-blocked') {
        setInternalError('Popup blocked by browser. Please allow popups for this site and try again.');
      } else {
        setInternalError(err?.message || 'Failed to sign in with Google. Please try again.');
      }
    }
  };

  const displayedError = error || internalError;

  return (
    <div className="min-h-screen bg-bg flex flex-col justify-center items-center px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-brand text-white shadow-lift">
            <SealMark className="h-8 w-8" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-text">
            The Docket
          </h1>
          <p className="text-sm font-medium text-text-2">
            Rules-Based Sports Selection Engine &amp; Verification Audit
          </p>
        </div>

        {/* Main Authentication Card */}
        <div className="rounded-2xl border border-line bg-surface p-6 sm:p-8 shadow-plate space-y-6">
          <div className="space-y-1.5 text-center">
            <h2 className="text-base font-extrabold text-text">
              Sign In to Your Account
            </h2>
            <p className="text-xs text-text-2 leading-relaxed">
              Connect your Google account to access your private Firebase database,
              cloud-persisted API keys, and synced betting archive across all your devices.
            </p>
          </div>

          {displayedError && (
            <div
              id="auth-error-message"
              className="rounded-xl border border-bad-line bg-bad-soft p-3 text-xs text-bad-ink flex items-start gap-2.5"
            >
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div className="leading-snug">{displayedError}</div>
            </div>
          )}

          {/* Primary Action: Google Sign In Button */}
          <div className="space-y-3">
            <button
              id="btn-google-login"
              type="button"
              disabled={isLoading}
              onClick={handleGoogleClick}
              className="w-full flex items-center justify-center gap-3 rounded-xl border border-line-strong bg-white px-4 py-3 text-sm font-bold text-text shadow-sm transition-all hover:bg-surface-2 hover:border-text-3 active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
            >
              {isLoading ? (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-text border-t-transparent" />
              ) : (
                <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="#4285F4"
                    d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.35 24 12 24z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.35 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                  />
                </svg>
              )}
              <span>{isLoading ? 'Signing In…' : 'Sign in with Google'}</span>
            </button>

            {onContinueAsGuest && (
              <div className="pt-2 text-center">
                <button
                  id="btn-guest-login"
                  type="button"
                  onClick={onContinueAsGuest}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-3 hover:text-brand-ink transition-colors cursor-pointer"
                >
                  <span>Continue to Local Sandbox (Offline Preview)</span>
                  <ArrowRight className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>

          {/* Value props / Cloud storage architecture details */}
          <div className="border-t border-line pt-5 space-y-3">
            <h3 className="text-[11px] font-extrabold uppercase tracking-wider text-text-3">
              Cloud Persistence &amp; Security Architecture
            </h3>
            <ul className="space-y-2.5 text-xs text-text-2">
              <li className="flex items-start gap-2.5">
                <Database className="h-4 w-4 shrink-0 text-brand mt-0.5" />
                <span>
                  <strong className="text-text">Firebase Cloud Database:</strong> Your TheStatsAPI
                  and Betfair API credentials are saved directly to your private Firebase Firestore document.
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <Cloud className="h-4 w-4 shrink-0 text-brand mt-0.5" />
                <span>
                  <strong className="text-text">Cross-Device Sync:</strong> All verified qualifiers, settled bets,
                  and sync audit records follow your account on desktop, tablet, and mobile.
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <Lock className="h-4 w-4 shrink-0 text-brand mt-0.5" />
                <span>
                  <strong className="text-text">Role-Based Security:</strong> Strict Firestore security rules
                  guarantee that only your authenticated Google account can read or write your data.
                </span>
              </li>
            </ul>
          </div>
        </div>

        {/* Footer Notice */}
        <p className="text-center text-[11px] text-text-3 leading-relaxed">
          The Docket · Firebase Firestore backend with Google Identity Services.
        </p>
      </div>
    </div>
  );
};
