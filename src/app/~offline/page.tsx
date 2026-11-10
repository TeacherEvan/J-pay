export default function OfflinePage() {
  return (
    <main className="grid min-h-dvh place-items-center p-6 text-center text-[var(--paper)]">
      <div className="card-surgical max-w-sm p-6 space-y-4 shadow-2xl">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[var(--hivis)]/10 text-[var(--hivis)] mx-auto">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 4.243a9 9 0 01-2.828-6.364 9 9 0 012.828-6.364m4.243 4.243a5 5 0 01-1.414 3.536m-4.243 4.243L3 21" />
          </svg>
        </div>
        <h1 className="text-xl font-bold tracking-tight text-[var(--paper)]">You are offline</h1>
        <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
          J-Pay could not reach the network. Check-ins made while offline are
          stored on this device and will sync automatically when the connection
          returns.
        </p>
        <a
          href="/"
          className="btn-surgical-mint inline-block rounded px-5 py-2.5 text-xs font-semibold uppercase tracking-wider"
        >
          Retry Connection
        </a>
      </div>
    </main>
  );
}
