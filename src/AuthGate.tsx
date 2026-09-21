import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ownerAuth,
  ownerSession,
  ownerSessionChanged,
  ownerSessionKey,
  statusOf,
  type OwnerUser,
} from './owner-auth';

export default function AuthGate({
  children,
  onExit,
}: {
  children: ReactNode;
  onExit: () => void;
}) {
  const [user, setUser] = useState<OwnerUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<'sign-in' | 'sign-out' | null>(null);
  const pendingRef = useRef(false);
  const [username, setUsername] = useState('hireowner');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);

  useEffect(() => {
    let active = true;
    let sequence = 0;
    const restore = async () => {
      const current = ++sequence;
      setUser(null);
      setChecking(true);
      try {
        const value = await ownerAuth.getUser();
        if (active && current === sequence) setUser(value);
      } catch {
        if (active && current === sequence)
          setError('Your session could not be restored. Please sign in again.');
      } finally {
        if (active && current === sequence) setChecking(false);
      }
    };
    const expired = () => {
      if (active) {
        setUser(null);
        setChecking(false);
      }
    };
    const storageChanged = (event: StorageEvent) => {
      if (event.key === ownerSessionKey || event.key === null) void restore();
    };
    void restore();
    window.addEventListener(ownerSessionChanged, expired);
    window.addEventListener('storage', storageChanged);
    const timer = window.setInterval(() => {
      if (!ownerSession()) expired();
    }, 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener(ownerSessionChanged, expired);
      window.removeEventListener('storage', storageChanged);
    };
  }, []);

  const signIn = async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending('sign-in');
    setError('');
    try {
      const verifiedUser = await ownerAuth.signIn(username, password, remember);
      setPassword('');
      setUser(verifiedUser);
    } catch (cause) {
      setError(
        statusOf(cause) === 401
          ? 'Username or password is incorrect. Please try again.'
          : statusOf(cause) === 429
            ? 'Too many sign-in attempts. Please wait and try again.'
            : 'Sign-in failed. Please try again.',
      );
    } finally {
      pendingRef.current = false;
      setPending(null);
    }
  };

  const signOut = async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending('sign-out');
    setError('');
    let signedOut = false;
    try {
      await ownerAuth.signOut();
      setUser(null);
      signedOut = true;
    } catch {
      setError('Sign-out could not be completed. Please try again.');
    } finally {
      pendingRef.current = false;
      setPending(null);
    }
    if (signedOut) onExit();
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
            outcomes, reports and source administration require the private
            owner account.
          </p>
          {error && (
            <div className="auth-error" role="alert">
              {error}
            </div>
          )}
          <form
            className="owner-login"
            onSubmit={(event) => {
              event.preventDefault();
              void signIn();
            }}
          >
            <label htmlFor="owner-username">Username</label>
            <input
              id="owner-username"
              name="username"
              autoComplete="username"
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              disabled={pending !== null}
            />
            <label htmlFor="owner-password">Password</label>
            <input
              id="owner-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={pending !== null}
            />
            <label className="owner-remember">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
                disabled={pending !== null}
              />{' '}
              Remember this browser
            </label>
            <p className="owner-session-note">
              Stay signed in for 30 days, or 12 hours when unchecked.
            </p>
            <button type="submit" disabled={pending === 'sign-in'}>
              {pending === 'sign-in'
                ? 'Signing in…'
                : 'Sign in to Hire Intelligence'}
            </button>
          </form>
          <button className="secondary" onClick={onExit}>
            Return to public site
          </button>
        </div>
      </div>
    );

  return (
    <div className="authenticated-shell">
      <div className="auth-userbar">
        <span>{user.name || 'Owner'}</span>
        <button className="public-site-button" onClick={onExit}>
          Public site
        </button>
        <button
          disabled={pending === 'sign-out'}
          onClick={() => void signOut()}
        >
          {pending === 'sign-out' ? 'Signing out…' : 'Sign out'}
        </button>
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
