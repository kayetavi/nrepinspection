import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'NREP Inspection Monitor | NRL',
  description:
    'Industrial inspection and system acceptance tracking system with real-time Firebase synchronization, role-based access control, Excel upload/export, and administrative user moderation.',
  openGraph: {
    title: 'NREP Inspection Monitor | NRL',
    description:
      'Industrial inspection and system acceptance tracking system with real-time Firebase synchronization, role-based access control, Excel upload/export, and administrative user moderation.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'NREP Inspection Monitor | NRL',
    description:
      'Industrial inspection and system acceptance tracking system with real-time Firebase synchronization, role-based access control, Excel upload/export, and administrative user moderation.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                function recoverChunkError(msg) {
                  var s = String(msg || '');
                  if (s.indexOf('ChunkLoadError') !== -1 || s.indexOf('Loading chunk') !== -1) {
                    var key = 'nrep_chunk_reload_ts';
                    var last = parseInt(sessionStorage.getItem(key) || '0', 10);
                    if (Date.now() - last > 5000) {
                      sessionStorage.setItem(key, String(Date.now()));
                      var url = new URL(window.location.href);
                      url.searchParams.set('_r', String(Date.now()));
                      window.location.replace(url.toString());
                    }
                  }
                }
                window.addEventListener('error', function(e) {
                  recoverChunkError((e && e.message) || (e && e.error && e.error.message) || '');
                }, true);
                window.addEventListener('unhandledrejection', function(e) {
                  var reason = e && e.reason;
                  recoverChunkError((reason && (reason.name + ' ' + reason.message)) || reason || '');
                });
              })();
            `,
          }}
        />
      </head>
      <body suppressHydrationWarning className="bg-slate-100 text-slate-900 antialiased selection:bg-sky-200">
        {children}
      </body>
    </html>
  );
}
