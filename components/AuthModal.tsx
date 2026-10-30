'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/lib/auth-context';

const USERS = {
  admin: { h: '4e089f2da94eb0ca20d6914d33fd32a2c92e262e9daef473dd502e24ce25096c', r: 'Admin' },
  viewer: { h: 'ad943c304c5b4aa137af856f43cdd030ff6198e172c3955a6b78dcdd2c41260a', r: 'Viewer' },
};

const sha = async (s: string) => {
  if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
    return [...new Uint8Array(await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))]
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('');
  }
  return '';
};

export default function AuthModal() {
  const { loginWithCredentials, signInWithGoogle } = useAuth();
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [fails, setFails] = useState(0);
  const [lockUntil, setLockUntil] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleLogin = async () => {
    if (Date.now() < lockUntil) {
      setErrorMsg('Too many attempts. Wait ' + Math.ceil((lockUntil - Date.now()) / 1000) + 's.');
      return;
    }

    const u = userId.trim();
    const p = password.trim();

    if (!u) {
      setErrorMsg('Please enter User ID or Email.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg('');

    try {
      await loginWithCredentials(u, p);
      setFails(0);
    } catch (err: any) {
      const newFails = fails + 1;
      setFails(newFails);
      setErrorMsg(err.message || 'Invalid user ID or password.');
      if (newFails >= 5) {
        setLockUntil(Date.now() + 30000);
        setFails(0);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleLogin();
    }
  };

  return (
    <div id="lg">
      <div className="lb">
        <div style={{ fontSize: '30px' }}>🏭</div>
        <h2>NREP Inspection Monitor</h2>
        <p>NRL · Please sign in to continue</p>
        <label htmlFor="lu">User ID</label>
        <input
          id="lu"
          ref={inputRef}
          autoComplete="username"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <label htmlFor="lp">Password</label>
        <input
          id="lp"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button id="li" type="button" onClick={handleLogin} disabled={isSubmitting}>
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </button>
        <div id="le">{errorMsg}</div>

        <div style={{ marginTop: '12px', textAlign: 'center' }}>
          <button
            type="button"
            onClick={() => signInWithGoogle()}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--ac)',
              fontSize: '11.5px',
              cursor: 'pointer',
              padding: '4px',
              textDecoration: 'none',
            }}
          >
            🔐 Sign in with Google Workspace
          </button>
        </div>
      </div>
    </div>
  );
}
