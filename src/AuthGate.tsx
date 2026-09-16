import { useEffect, useState, type ReactNode } from 'react';
import { auth, type AuthUser } from '@appdeploy/client';

export default function AuthGate({
  children,
  onExit,
}: {
  children: ReactNode;
  onExit: () => void;
}) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    auth
      .getUser()
      .then((value) => {
        if (active) setUser(value);
      })
      .catch(() => {
        if (active) {
          setUser(null);
          setError('Your session could not be restored. Please sign in again.');
        }
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const signIn = async () => {
    setError('');
    try {
      const result = await auth.signIn({
        scope: 'openid email profile offline_access',
      });
      setUser(result.user);
    } catch (cause) {
      const code =
        cause && typeof cause === 'object' && 'code' in cause
          ? String((cause as { code?: string }).code || '')
          : '';
      setError(
        code === 'popup_blocked'
          ? 'Sign-in popup was blocked. Allow popups and try again.'
          : code === 'popup_closed'
            ? 'Sign-in was cancelled.'
            : 'Sign-in failed. Please try again.',
      );
    }
  };

  const signOut = async () => {
    try {
      await auth.signOut();
      setUser(null);
      onExit();
    } catch {
      setError('Sign-out could not be completed. Please try again.');
    }
  };

  if (checking)
    return (
      <div className="auth-gate">
        <strong>Checking secure access…</strong>
      </div>
    );
  if (!user)
    return (
      <div className="auth-gate">
        <div className="auth-panel">
          <small>HIRE INTELLIGENCE</small>
          <h1>Secure workspace</h1>
          <p>
            The public market pages remain open. Operational intelligence, CRM
            outcomes, reports and source administration require an authenticated
            account.
          </p>
          {error && <div className="auth-error">{error}</div>}
          <button onClick={() => void signIn()}>
            Sign in to Hire Intelligence
          </button>
          <button className="secondary" onClick={onExit}>
            Return to public site
          </button>
        </div>
      </div>
    );

  return (
    <div className="authenticated-shell">
      <div className="auth-userbar">
        <span>{user.name || user.email || 'Signed in'}</span>
        <button className="public-site-button" onClick={onExit}>
          Public site
        </button>
        <button onClick={() => void signOut()}>Sign out</button>
      </div>
      {error && (
        <div className="auth-error" role="alert">
          {error}
        </div>
      )}
      {children}
    </div>
  );
}
