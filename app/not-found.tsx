import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-6 text-center">
      <div className="w-16 h-16 rounded-2xl bg-sky-500/20 text-sky-400 flex items-center justify-center font-bold text-2xl mb-4 border border-sky-500/30">
        404
      </div>
      <h1 className="text-2xl font-bold mb-2">Page Not Found</h1>
      <p className="text-slate-400 text-sm max-w-md mb-6">
        The requested resource or inspection dashboard view does not exist.
      </p>
      <Link
        href="/"
        className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-semibold transition-colors"
      >
        Return to Inspection Monitor
      </Link>
    </div>
  );
}
