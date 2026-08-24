export default function OfflinePage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-neutral-950 p-6 text-center text-neutral-300">
      <div className="max-w-sm space-y-3">
        <h1 className="text-xl font-semibold">You are offline</h1>
        <p className="text-sm text-neutral-400">
          J-Pay could not reach the network. Check-ins made while offline are
          stored on this device and will sync automatically when the connection
          returns.
        </p>
        <a
          href="/"
          className="inline-block rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
        >
          Retry
        </a>
      </div>
    </main>
  );
}
