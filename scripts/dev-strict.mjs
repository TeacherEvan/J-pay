import net from "node:net";
import { spawn } from "node:child_process";

// Refuses to start `next dev` when :3000 is already occupied.
// Why: when another app holds :3000, Next silently drifts to :3001+ and the
// operator opens the wrong app at the canonical URL (2026-08-25 incident:
// a sibling project served DaggaBank at localhost:3000 for hours).
const PORT = Number(process.env.PORT ?? 3000);

const occupied = await new Promise((resolve) => {
  const s = net.connect({ port: PORT, host: "127.0.0.1", timeout: 1500 });
  s.on("connect", () => { s.destroy(); resolve(true); });
  s.on("error", () => resolve(false));
  s.on("timeout", () => { s.destroy(); resolve(false); });
});

if (occupied) {
  console.error(`\nREFUSING TO START: port ${PORT} is already in use by another process.`);
  console.error(`J-pay must own its canonical URL (http://localhost:${PORT}) — silently drifting`);
  console.error(`to another port has served the WRONG app at this URL before.\n`);
  console.error(`Fix: stop the other process (see: ss -tlnp | grep :${PORT}), or run`);
  console.error(`'PORT=${PORT + 1} npm run dev' and open http://localhost:${PORT + 1} explicitly.\n`);
  process.exit(1);
}

const child = spawn("npx", ["next", "dev"], { stdio: "inherit", env: { ...process.env, PORT: String(PORT) } });
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
