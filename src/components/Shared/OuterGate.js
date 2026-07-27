// OUTER GATE — daily email/password sign-in fronting every route.
//
// The 4-digit PIN alone is too weak as an internet-facing credential (10k space; the per-PIN
// lockout doesn't slow an attacker sweeping DIFFERENT pins). This gate makes the PIN a
// user-switcher BEHIND a real credential: staff sign in once per day with a company email
// (allow-listed domains below; shared station accounts for floor tablets), then PIN-switch as
// usual. authenticatePin server-side refuses to mint PIN tokens without a fresh outer session,
// so the gate can't be bypassed by calling the function directly.
//
// The email session lives on a secondary Firebase app instance (see firebase.js) so PIN
// custom-token sign-ins never displace it.
import React, { useState, useEffect } from 'react';
import { signInWithEmailAndPassword, onAuthStateChanged, signOut, sendPasswordResetEmail } from 'firebase/auth';
import { outerAuth } from '../../firebase';

export const ALLOWED_EMAIL_DOMAINS = [
  'classicalelements.com',
  'm2cstudio.com',
  'uniquitystyle.com',
  'leylagans.com',
  'thelab-hp.com',
];

// Client-side daily expiry; the server enforces its own (slightly longer) window in
// authenticatePin, so this is UX, not the security boundary.
const MAX_SESSION_HOURS = 14;

const domainOf = (email) => String(email || '').toLowerCase().split('@')[1] || '';
const domainAllowed = (email) => ALLOWED_EMAIL_DOMAINS.includes(domainOf(email));

const theme = {
  paper: '#faf8f4', ink: '#1c1a16', inkSoft: '#524e46', brass: '#b08d57',
  line: 'rgba(28,26,22,.14)',
  serif: "'Cormorant Garamond', Georgia, serif",
  sans: "'Inter', -apple-system, sans-serif",
  mono: "'IBM Plex Mono', monospace",
};

const OuterGate = ({ children }) => {
  const [checking, setChecking] = useState(true);
  const [gateUser, setGateUser] = useState(null);
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(outerAuth, async (u) => {
      if (!u) { setGateUser(null); setChecking(false); return; }
      try {
        // Reject sessions older than the daily window. Off-domain accounts are NOT bounced here:
        // outside collaborators (per-email grants — see externalAccessAllowed in functions) are
        // legitimate and the client cannot read the admin-locked allow-list while signed out.
        // authenticatePin is the authority — an unlisted address gets a real gate session and
        // still cannot mint a PIN token, and this session alone grants NO Firestore access
        // (it lives on the secondary 'outer-gate' app instance, never the one db uses).
        const res = await u.getIdTokenResult();
        const authedAt = new Date(res.claims.auth_time * 1000).getTime();
        const ageHours = (Date.now() - authedAt) / 3600000;
        if (ageHours > MAX_SESSION_HOURS) {
          await signOut(outerAuth);
          setGateUser(null);
        } else {
          setGateUser(u);
        }
      } catch (e) {
        setGateUser(null);
      }
      setChecking(false);
    });
    return unsub;
  }, []);

  const handleSignIn = async (e) => {
    e.preventDefault();
    setErr('');
    // No client-side domain block: an admin can grant a single outside address access (contract
    // engineers), and only the server knows who is on that list. A wrong-domain guess simply
    // fails on credentials, and even a valid off-domain session is refused at the PIN step.
    setBusy(true);
    try {
      await signInWithEmailAndPassword(outerAuth, email.trim(), pw);
      setPw('');
    } catch (error) {
      const code = error?.code || '';
      const badCreds = code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found';
      // Most failures here are a typo'd company address; say so rather than leaving them guessing.
      setErr(badCreds && !domainAllowed(email)
        ? 'Email or password is incorrect. Company addresses end in ' + ALLOWED_EMAIL_DOMAINS.join(', ') + ' — outside collaborators need an admin to grant their address access first.'
        : badCreds
        ? 'Email or password is incorrect.'
        : code === 'auth/too-many-requests'
          ? 'Too many attempts — try again in a few minutes.'
          : 'Sign-in failed: ' + (error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const handleForgot = async () => {
    setErr('');
    if (!email.trim()) { setErr('Enter your email above first, then tap "Forgot password".'); return; }
    try {
      await sendPasswordResetEmail(outerAuth, email.trim());
      setErr('Password reset email sent to ' + email.trim() + '.');
    } catch (error) {
      setErr('Could not send reset email: ' + (error?.message || error));
    }
  };

  if (checking) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: theme.paper, fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.2em', textTransform: 'uppercase', color: theme.inkSoft }}>
        Verifying session…
      </div>
    );
  }

  if (gateUser) return children;

  return (
    <div style={{ minHeight: '100vh', backgroundColor: theme.paper, color: theme.ink, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', fontFamily: theme.sans, fontWeight: 300 }}>
      <div style={{ background: '#fff', border: `1px solid ${theme.line}`, width: '100%', maxWidth: '420px', padding: '50px 40px', boxShadow: '0 4px 24px rgba(0,0,0,0.02)' }}>
        <div style={{ paddingBottom: '26px', marginBottom: '26px', textAlign: 'center', borderBottom: `1px solid ${theme.line}` }}>
          <span style={{ fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.25em', textTransform: 'uppercase', color: theme.brass, display: 'block', marginBottom: '1rem' }}>
            Secure Access
          </span>
          <h1 style={{ fontFamily: theme.serif, margin: 0, fontSize: '2rem', fontWeight: 500, letterSpacing: '0.05em' }}>
            Factory Portal
          </h1>
          <p style={{ fontFamily: theme.sans, fontSize: '0.85rem', color: theme.inkSoft, marginTop: '12px', marginBottom: 0 }}>
            Sign in with your company email to open the portal for the day.
          </p>
        </div>

        <form onSubmit={handleSignIn} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <input
            type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="name@classicalelements.com" autoComplete="username" autoFocus
            style={{ padding: '14px', border: `1px solid ${theme.line}`, outline: 'none', fontFamily: theme.sans, fontSize: '0.95rem', background: theme.paper }}
          />
          <input
            type="password" value={pw} onChange={(e) => setPw(e.target.value)}
            placeholder="Password" autoComplete="current-password"
            style={{ padding: '14px', border: `1px solid ${theme.line}`, outline: 'none', fontFamily: theme.sans, fontSize: '0.95rem', background: theme.paper }}
          />
          <button
            type="submit" disabled={busy || !email || !pw}
            style={{ padding: '16px', background: theme.ink, color: '#fff', border: 'none', cursor: busy ? 'wait' : 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.15em', opacity: (!email || !pw) ? 0.5 : 1 }}
          >
            {busy ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        {err && (
          <div style={{ marginTop: '16px', padding: '12px', border: `1px solid ${theme.line}`, background: theme.paper, fontFamily: theme.sans, fontSize: '0.85rem', color: err.startsWith('Password reset') ? '#3a7d44' : '#a33', textAlign: 'center' }}>
            {err}
          </div>
        )}

        <div style={{ marginTop: '24px', paddingTop: '18px', borderTop: `1px solid ${theme.line}`, textAlign: 'center' }}>
          <button onClick={handleForgot} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.15em', textTransform: 'uppercase', color: theme.inkSoft }}>
            Forgot password
          </button>
        </div>
      </div>
    </div>
  );
};

export default OuterGate;
