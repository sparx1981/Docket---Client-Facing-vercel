import React, { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { SealMark } from './AppShell';

interface LoginScreenProps {
  onSignInWithGoogle: () => Promise<void>;
  onContinueAsGuest?: () => void;
  isLoading?: boolean;
  error?: string | null;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  onSignInWithGoogle,
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
          </div>
        </div>
      </div>
    </div>
  );
};
