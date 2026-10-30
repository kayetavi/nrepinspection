import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'NREP Inspection & Acceptance Monitor | NRL',
  description:
    'Industrial inspection and system acceptance tracking system with real-time Firebase synchronization, role-based access control, Excel upload/export, and administrative user moderation.',
  openGraph: {
    title: 'NREP Inspection & Acceptance Monitor | NRL',
    description:
      'Industrial inspection and system acceptance tracking system with real-time Firebase synchronization, role-based access control, Excel upload/export, and administrative user moderation.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'NREP Inspection & Acceptance Monitor | NRL',
    description:
      'Industrial inspection and system acceptance tracking system with real-time Firebase synchronization, role-based access control, Excel upload/export, and administrative user moderation.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body suppressHydrationWarning className="bg-slate-100 text-slate-900 antialiased selection:bg-sky-200">
        {children}
      </body>
    </html>
  );
}
