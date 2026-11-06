'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  Lock,
  ArrowRight,
  ArrowLeft,
  KeyRound,
  Mail,
  ShieldCheck,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

export default function AuthModal() {
  const {
    loginWithCredentials,
    resetPassword,
    sessionExpiredNotice,
  } = useAuth();
  const [mode, setMode] = useState<'login' | 'reset'>('login');

  // Login form state
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [errorCount, setErrorCount] = useState(0);
  const [fails, setFails] = useState(0);
  const [lockUntil, setLockUntil] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [authStep, setAuthStep] = useState<'idle' | 'verifying' | 'session' | 'authenticated'>('idle');

  // Reset password form state
  const [resetUserId, setResetUserId] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');
  const [showResetNewPassword, setShowResetNewPassword] = useState(false);
  const [showResetConfirmPassword, setShowResetConfirmPassword] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [resetSuccessMsg, setResetSuccessMsg] = useState('');
  const [resetErrorMsg, setResetErrorMsg] = useState('');

  const loginInputRef = useRef<HTMLInputElement>(null);
  const resetInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode === 'login') {
      loginInputRef.current?.focus();
    } else {
      resetInputRef.current?.focus();
    }
  }, [mode]);

  const handleLogin = async () => {
    if (isSubmitting) return;

    if (Date.now() < lockUntil) {
      setErrorMsg('Too many attempts. Wait ' + Math.ceil((lockUntil - Date.now()) / 1000) + 's.');
      setErrorCount((c) => c + 1);
      return;
    }

    const u = userId.trim();
    const p = password.trim();

    if (!u) {
      setErrorMsg('Please enter Username.');
      setErrorCount((c) => c + 1);
      loginInputRef.current?.focus();
      return;
    }

    setIsSubmitting(true);
    setAuthStep('verifying');
    setErrorMsg('');

    try {
      await loginWithCredentials(u, p, (step) => {
        setAuthStep(step);
      });
      setFails(0);
    } catch (err: any) {
      setAuthStep('idle');
      const newFails = fails + 1;
      setFails(newFails);
      setErrorMsg(err.message || 'Invalid user ID or password.');
      setErrorCount((c) => c + 1);
      if (newFails >= 5) {
        setLockUntil(Date.now() + 30000);
        setFails(0);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetPassword = async () => {
    if (isResetting) return;

    const u = resetUserId.trim();
    const np = resetNewPassword.trim();
    const cp = resetConfirmPassword.trim();

    setResetErrorMsg('');
    setResetSuccessMsg('');

    if (!u) {
      setResetErrorMsg('Please enter your Username.');
      setErrorCount((c) => c + 1);
      resetInputRef.current?.focus();
      return;
    }

    if (!np) {
      setResetErrorMsg('Please enter a new password.');
      setErrorCount((c) => c + 1);
      return;
    }

    if (np.length < 4) {
      setResetErrorMsg('New password must be at least 4 characters.');
      setErrorCount((c) => c + 1);
      return;
    }

    if (np !== cp) {
      setResetErrorMsg('New password and confirm password do not match.');
      setErrorCount((c) => c + 1);
      return;
    }

    setIsResetting(true);

    try {
      const res = await resetPassword({
        usernameOrEmail: u,
        newPassword: np,
      });
      setResetSuccessMsg(res.message || 'Password successfully updated in Supabase Cloud!');
      setUserId(u);
      setPassword('');

      // Automatically return to login mode with the Username prefilled after 2 seconds
      setTimeout(() => {
        setMode('login');
        setResetSuccessMsg('');
        setResetErrorMsg('');
        setResetNewPassword('');
        setResetConfirmPassword('');
      }, 2000);
    } catch (err: any) {
      setResetErrorMsg(err.message || 'Failed to update password in Supabase.');
      setErrorCount((c) => c + 1);
    } finally {
      setIsResetting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (mode === 'login') {
        handleLogin();
      } else {
        handleResetPassword();
      }
    }
  };

  const progressWidth =
    authStep === 'verifying'
      ? '45%'
      : authStep === 'session'
      ? '82%'
      : authStep === 'authenticated'
      ? '100%'
      : '0%';

  const stepLabel =
    authStep === 'verifying'
      ? 'Verifying credentials…'
      : authStep === 'session'
      ? 'Establishing cloud session…'
      : authStep === 'authenticated'
      ? 'Authenticated'
      : 'Sign in';

  return (
    <div id="lg">
      <motion.div
        key={`${mode}-${errorCount}`}
        className="lb"
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={
          errorCount === 0
            ? { opacity: 1, y: 0, scale: 1 }
            : { opacity: 1, y: 0, scale: 1, x: [0, -8, 8, -6, 6, -3, 3, 0] }
        }
        transition={{ duration: 0.28, ease: 'easeInOut' }}
        style={{ position: 'relative', overflow: 'hidden' }}
      >
        {/* Real-time network authentication/reset progress bar */}
        <AnimatePresence>
          {(isSubmitting || isResetting) && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: '3.5px',
                background: 'rgba(20, 89, 143, 0.14)',
                overflow: 'hidden',
              }}
            >
              <motion.div
                initial={{ width: '15%' }}
                animate={{ width: isResetting ? '90%' : progressWidth }}
                transition={{ duration: isResetting ? 0.8 : 0.25, ease: 'easeOut' }}
                style={{
                  height: '100%',
                  background: 'linear-gradient(90deg, #14598f 0%, #0284c7 50%, #38bdf8 100%)',
                  borderRadius: '0 2px 2px 0',
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Top Icon and Mode Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
          <motion.div
            animate={
              isSubmitting || isResetting
                ? { scale: [1, 1.08, 1], rotate: [0, -3, 3, 0] }
                : { scale: 1, rotate: 0 }
            }
            transition={
              isSubmitting || isResetting
                ? { duration: 0.9, repeat: Infinity, ease: 'easeInOut' }
                : { duration: 0.2 }
            }
            style={{ fontSize: '30px', display: 'inline-block' }}
          >
            {mode === 'login' ? '🏭' : '🔑'}
          </motion.div>
          <AnimatePresence>
            {(isSubmitting || isResetting) && (
              <motion.span
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  fontSize: '11px',
                  fontWeight: 600,
                  color: 'var(--ac, #14598f)',
                  background: '#f0f9ff',
                  border: '1px solid #bae6fd',
                  padding: '3px 8px',
                  borderRadius: '999px',
                }}
              >
                <Loader2 size={12} className="animate-spin" />
                <span>{mode === 'login' ? 'Live Auth' : 'Syncing Supabase'}</span>
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        {mode === 'login' ? (
          /* ==================== LOGIN MODE ==================== */
          <div>
            <h2>NREP Inspection Monitor</h2>
            <p>NRL · Please sign in to continue</p>

            {sessionExpiredNotice && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                style={{
                  background: '#fffbeb',
                  border: '1px solid #fde68a',
                  color: '#92400e',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  fontSize: '11.5px',
                  fontWeight: 600,
                  margin: '8px 0 12px',
                  textAlign: 'center',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  lineHeight: 1.35,
                }}
              >
                <span>⏱️</span>
                <span>{sessionExpiredNotice}</span>
              </motion.div>
            )}

            <label htmlFor="lu">Username</label>
            <input
              id="lu"
              ref={loginInputRef}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              disabled={isSubmitting}
              value={userId}
              onChange={(e) => {
                setUserId(e.target.value);
                if (errorMsg) setErrorMsg('');
              }}
              onKeyDown={handleKeyDown}
              placeholder="Username"
              style={{
                opacity: isSubmitting ? 0.68 : 1,
                transition: 'border-color 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease',
              }}
            />

            <label htmlFor="lp">Password</label>

            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <input
                id="lp"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                disabled={isSubmitting}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (errorMsg) setErrorMsg('');
                }}
                onKeyDown={handleKeyDown}
                placeholder="Enter your password"
                style={{
                  opacity: isSubmitting ? 0.68 : 1,
                  paddingRight: '38px',
                  transition: 'border-color 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease',
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute',
                  right: '8px',
                  background: 'none',
                  border: 'none',
                  color: 'var(--mu, #64748b)',
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>

            <motion.button
              id="li"
              type="button"
              onClick={handleLogin}
              disabled={isSubmitting}
              whileTap={!isSubmitting ? { scale: 0.985 } : undefined}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                position: 'relative',
                overflow: 'hidden',
                opacity: isSubmitting ? 0.92 : 1,
                transition: 'background 0.2s ease, opacity 0.2s ease',
                background: authStep === 'authenticated' ? 'var(--gr, #10b981)' : 'var(--ac, #14598f)',
                borderColor: authStep === 'authenticated' ? 'var(--gr, #10b981)' : 'var(--ac, #14598f)',
              }}
            >
              <AnimatePresence mode="wait" initial={false}>
                {isSubmitting ? (
                  <motion.span
                    key={authStep}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.15 }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '7px',
                    }}
                  >
                    {authStep === 'authenticated' ? (
                      <CheckCircle2 size={16} />
                    ) : (
                      <Loader2 size={16} className="animate-spin" />
                    )}
                    <span>{stepLabel}</span>
                  </motion.span>
                ) : (
                  <motion.span
                    key="idle"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.15 }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <Lock size={14} />
                    <span>Sign in</span>
                    <ArrowRight size={14} />
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>

            <div style={{ display: 'flex', justifyContent: 'center', marginTop: '14px', marginBottom: '2px' }}>
              <button
                type="button"
                onClick={() => {
                  setErrorMsg('');
                  setResetSuccessMsg('');
                  setResetErrorMsg('');
                  setResetUserId(userId);
                  setMode('reset');
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: '4px 8px',
                  color: 'var(--ac, #0284c7)',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                Forgot Password?
              </button>
            </div>

            <div id="le" style={{ minHeight: '22px', display: 'flex', alignItems: 'center' }}>
              <AnimatePresence mode="wait">
                {errorMsg && (
                  <motion.div
                    key={errorMsg}
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.16 }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      color: '#dc2626',
                      fontSize: '12px',
                      fontWeight: 600,
                    }}
                  >
                    <AlertCircle size={14} style={{ flexShrink: 0 }} />
                    <span>{errorMsg}</span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        ) : (
          /* ==================== INSTANT RESET PASSWORD MODE ==================== */
          <div>
            <h2>Reset Password</h2>
            <p>Update your login credentials in Supabase Cloud</p>

            <label htmlFor="lu_reset">Username</label>
            <input
              id="lu_reset"
              ref={resetInputRef}
              autoComplete="username"
              disabled={isResetting}
              value={resetUserId}
              onChange={(e) => {
                setResetUserId(e.target.value);
                if (resetErrorMsg) setResetErrorMsg('');
              }}
              onKeyDown={handleKeyDown}
              placeholder="Username"
              style={{
                opacity: isResetting ? 0.68 : 1,
                transition: 'border-color 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease',
              }}
            />

            <label htmlFor="lp_new">New Password</label>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <input
                id="lp_new"
                type={showResetNewPassword ? 'text' : 'password'}
                autoComplete="new-password"
                disabled={isResetting}
                value={resetNewPassword}
                onChange={(e) => {
                  setResetNewPassword(e.target.value);
                  if (resetErrorMsg) setResetErrorMsg('');
                }}
                onKeyDown={handleKeyDown}
                placeholder="Enter new password (min. 4 characters)"
                style={{
                  opacity: isResetting ? 0.68 : 1,
                  paddingRight: '38px',
                  transition: 'border-color 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease',
                }}
              />
              <button
                type="button"
                onClick={() => setShowResetNewPassword(!showResetNewPassword)}
                style={{
                  position: 'absolute',
                  right: '8px',
                  background: 'none',
                  border: 'none',
                  color: 'var(--mu, #64748b)',
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                title={showResetNewPassword ? 'Hide password' : 'Show password'}
              >
                {showResetNewPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>

            <label htmlFor="lp_confirm">Confirm New Password</label>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <input
                id="lp_confirm"
                type={showResetConfirmPassword ? 'text' : 'password'}
                autoComplete="new-password"
                disabled={isResetting}
                value={resetConfirmPassword}
                onChange={(e) => {
                  setResetConfirmPassword(e.target.value);
                  if (resetErrorMsg) setResetErrorMsg('');
                }}
                onKeyDown={handleKeyDown}
                placeholder="Re-enter new password"
                style={{
                  opacity: isResetting ? 0.68 : 1,
                  paddingRight: '38px',
                  transition: 'border-color 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease',
                }}
              />
              <button
                type="button"
                onClick={() => setShowResetConfirmPassword(!showResetConfirmPassword)}
                style={{
                  position: 'absolute',
                  right: '8px',
                  background: 'none',
                  border: 'none',
                  color: 'var(--mu, #64748b)',
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                title={showResetConfirmPassword ? 'Hide password' : 'Show password'}
              >
                {showResetConfirmPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>

            <motion.button
              id="li"
              type="button"
              onClick={handleResetPassword}
              disabled={isResetting}
              whileTap={!isResetting ? { scale: 0.985 } : undefined}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                position: 'relative',
                overflow: 'hidden',
                opacity: isResetting ? 0.92 : 1,
                marginTop: '16px',
                background: 'var(--ac, #14598f)',
                borderColor: 'var(--ac, #14598f)',
              }}
            >
              {isResetting ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px' }}>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Updating Password…</span>
                </span>
              ) : (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <KeyRound size={15} />
                  <span>Update Password</span>
                </span>
              )}
            </motion.button>

            <div style={{ display: 'flex', justifyContent: 'center', marginTop: '12px' }}>
              <button
                type="button"
                onClick={() => {
                  setResetErrorMsg('');
                  setResetSuccessMsg('');
                  setMode('login');
                }}
                disabled={isResetting}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--mu, #64748b)',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <ArrowLeft size={13} />
                <span>Back to Sign in</span>
              </button>
            </div>

            <div id="le" style={{ minHeight: '22px', display: 'flex', alignItems: 'center', marginTop: '8px' }}>
              <AnimatePresence mode="wait">
                {resetErrorMsg && (
                  <motion.div
                    key={resetErrorMsg}
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.16 }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      color: '#dc2626',
                      fontSize: '12px',
                      fontWeight: 600,
                    }}
                  >
                    <AlertCircle size={14} style={{ flexShrink: 0 }} />
                    <span>{resetErrorMsg}</span>
                  </motion.div>
                )}
                {resetSuccessMsg && (
                  <motion.div
                    key={resetSuccessMsg}
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.16 }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      color: '#16a34a',
                      fontSize: '12px',
                      fontWeight: 600,
                    }}
                  >
                    <CheckCircle2 size={14} style={{ flexShrink: 0 }} />
                    <span>{resetSuccessMsg}</span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
