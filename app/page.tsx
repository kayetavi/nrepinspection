'use client';

import React from 'react';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { EquipmentProvider } from '@/lib/equipment-context';
import Dashboard from '@/components/Dashboard';
import AuthModal from '@/components/AuthModal';

function MainApp() {
  const { user, profile, isGuest, loading } = useAuth();

  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--hd)',
          color: '#fff',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '36px', marginBottom: '12px' }}>🏭</div>
          <div style={{ fontSize: '16px', fontWeight: 600 }}>NRL · NREP Inspection Monitor</div>
          <div style={{ fontSize: '12px', opacity: 0.7, marginTop: '4px' }}>Connecting to Cloud Firestore...</div>
        </div>
      </div>
    );
  }

  // If user is not logged in and not in guest mode, display ONLY the Login Page!
  const isLoggedIn = Boolean(user || profile || isGuest);

  if (!isLoggedIn) {
    return <AuthModal />;
  }

  return (
    <EquipmentProvider>
      <Dashboard />
    </EquipmentProvider>
  );
}

export default function Home() {
  return (
    <AuthProvider>
      <MainApp />
    </AuthProvider>
  );
}
