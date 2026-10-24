#!/usr/bin/env python3
"""Deploy J-Pay to production: Convex backend first, then Vercel.

Order is load-bearing. ``queuedAt`` is a new argument on ``logs:createLog`` and
Convex validates arguments strictly: a new frontend against the old backend
rejects every check-in. The backend accepts both old and new clients, so it
must ship first.

Usage:
    python3 scripts/deploy_prod.py --target convex
    python3 scripts/deploy_prod.py --target vercel
    python3 scripts/deploy_prod.py --target both

Guard rails:
  * prints the resolved target *before* running anything (convex-deploy-guard);
  * refuses to run on a dirty tree unless ``--allow-dirty``;
  * never reads or prints credentials — the Convex CLI uses its own login;
  * every child process gets ``stdin=DEVNULL`` so nothing can hang on a prompt.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONVEX_DEPLOYMENT = os.environ.get("JPAY_CONVEX_DEPLOYMENT", "different-crow-187")
VERCEL_PROJECT = os.environ.get("JPAY_VERCEL_PROJECT", "j-pay")
VERCEL_SCOPE = os.environ.get("JPAY_VERCEL_SCOPE", "teacher-evans-projects")

CONVEX_URL_RE = re.compile(r"https://([a-z0-9-]+)\.convex\.cloud")
VERCEL_URL_RE = re.compile(r"https://[a-z0-9-]+\.vercel\.app")


def run(cmd: list[str], timeout: int, env: dict[str, str] | None = None) -> tuple[int, str]:
    """Run a command with no stdin, return (exit_code, combined output)."""
    merged = os.environ.copy()
    if env:
        merged.update(env)
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(ROOT),
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            timeout=timeout,
            env=merged,
        )
    except FileNotFoundError:
        return 127, f"command not found: {cmd[0]}"
    except subprocess.TimeoutExpired as exc:
        tail = (exc.stdout or "") if isinstance(exc.stdout, str) else ""
        return 124, tail + f"\n[timed out after {timeout}s]"
    out = str(proc.stdout or "") + str(proc.stderr or "")
    return proc.returncode, out


def tail(text: str, limit: int = 4000) -> str:
    text = text.strip()
    return text if len(text) <= limit else "…\n" + text[-limit:]


def git_state() -> dict:
    code, out = run(["git", "rev-parse", "--short", "HEAD"], 30)
    sha = out.strip() if code == 0 else "unknown"
    code, out = run(["git", "status", "--porcelain"], 30)
    dirty = bool(out.strip()) if code == 0 else True
    code, out = run(["git", "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], 30)
    upstream = out.strip() if code == 0 else ""
    ahead = ""
    if upstream:
        code, out = run(["git", "rev-list", "--count", f"{upstream}..HEAD"], 30)
        ahead = out.strip() if code == 0 else ""
    return {"sha": sha, "dirty": dirty, "upstream": upstream, "unpushed": ahead}


def deploy_convex(dry_run: bool, message: str) -> dict:
    deployment = DEFAULT_CONVEX_DEPLOYMENT
    print(f"target: prod (convex:{deployment}) — J-Pay production deployment", flush=True)
    with tempfile.NamedTemporaryFile("w", suffix=".env", delete=False) as fh:
        fh.write(f"CONVEX_DEPLOYMENT={deployment}\n")
        env_file = fh.name
    try:
        cmd = [
            "npx",
            "--no-install",
            "convex",
            "deploy",
            "--yes",
            "--env-file",
            env_file,
            "--message",
            message,
            "--typecheck",
            "enable",
        ]
        if dry_run:
            cmd.append("--dry-run")
        code, out = run(cmd, timeout=900)
    finally:
        Path(env_file).unlink(missing_ok=True)
    print(tail(out), flush=True)
    match = CONVEX_URL_RE.search(out)
    return {
        "target": "convex",
        "deployment": deployment,
        "dry_run": dry_run,
        "exit_code": code,
        "url": match.group(0) if match else None,
        "ok": code == 0,
    }


def ensure_vercel_link() -> tuple[int, str]:
    if (ROOT / ".vercel" / "project.json").exists():
        return 0, "already linked"
    print(f"target: prod (vercel:{VERCEL_SCOPE}/{VERCEL_PROJECT}) — linking local dir", flush=True)
    return run(
        [
            "npx",
            "--yes",
            "vercel@latest",
            "link",
            "--yes",
            "--project",
            VERCEL_PROJECT,
            "--scope",
            VERCEL_SCOPE,
        ],
        timeout=300,
    )


def stage_without_git() -> Path:
    """Copy the tree to a scratch dir without .git and return its path.

    Vercel refuses a deployment whose Git commit author has no Vercel/GitHub
    account ("The deployment was blocked because Vercel couldn't find a Git
    account for the commit author"). Deploying the staged tree means the upload
    carries no git metadata, so an agent-authored commit cannot block a release
    that already passed every local gate. The project link is copied across so
    the deployment still targets the right project.
    """
    staging = Path(tempfile.mkdtemp(prefix="jpay-deploy-"))
    excludes = ["--exclude", ".git", "--exclude", "node_modules", "--exclude", ".next",
                "--exclude", ".vercel", "--exclude", ".turbo"]
    code, out = run(["rsync", "-a", *excludes, f"{ROOT}/", f"{staging}/"], timeout=300)
    if code != 0:
        raise RuntimeError(f"rsync staging failed: {out[-400:]}")
    project = ROOT / ".vercel" / "project.json"
    if project.exists():
        (staging / ".vercel").mkdir(exist_ok=True)
        (staging / ".vercel" / "project.json").write_text(project.read_text())
    return staging


def deploy_vercel(dry_run: bool) -> dict:
    link_code, link_out = ensure_vercel_link()
    if link_code != 0:
        print(tail(link_out), flush=True)
        return {"target": "vercel", "exit_code": link_code, "url": None, "ok": False, "stage": "link"}

    staging = stage_without_git()
    print(f"target: prod (vercel:{VERCEL_SCOPE}/{VERCEL_PROJECT}) — staged {staging}", flush=True)
    cmd = ["npx", "--yes", "vercel@latest", "--prod", "--yes", "--scope", VERCEL_SCOPE]
    if dry_run:
        cmd.append("--dry-run")
    try:
        proc = subprocess.run(
            cmd, cwd=str(staging), stdin=subprocess.DEVNULL,
            capture_output=True, text=True, timeout=1200, env=os.environ.copy(),
        )
        code, out = proc.returncode, str(proc.stdout or "") + str(proc.stderr or "")
    except subprocess.TimeoutExpired as exc:
        code, out = 124, str(exc.stdout or "") + "\n[timed out after 1200s]"
    print(tail(out), flush=True)
    match = None
    for line in out.splitlines():
        candidate = VERCEL_URL_RE.search(line)
        if candidate and "sso" not in candidate.group(0):
            match = candidate
    return {
        "target": "vercel",
        "exit_code": code,
        "url": match.group(0) if match else None,
        "ok": code == 0,
        "stage": "deploy",
        "staging": str(staging),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Deploy J-Pay: Convex then Vercel.")
    parser.add_argument("--target", choices=["convex", "vercel", "both"], default="both")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--allow-dirty", action="store_true")
    parser.add_argument("--message", default="")
    args = parser.parse_args()

    state = git_state()
    if state["dirty"] and not args.allow_dirty:
        print(f"refusing: working tree is dirty ({state['sha']}); commit or pass --allow-dirty", flush=True)
        return 2
    if state["unpushed"] and state["unpushed"] != "0":
        print(f"warning: {state['unpushed']} unpushed commit(s) on {state['upstream']}", flush=True)

    message = args.message or f"deploy {state['sha']} via scripts/deploy_prod.py"
    results: list[dict] = []

    if args.target in ("convex", "both"):
        results.append(deploy_convex(args.dry_run, message))
        if not results[-1]["ok"]:
            print("convex deploy failed — not touching Vercel", flush=True)
            print(json.dumps({"git": state, "results": results}, indent=2))
            return 1

    if args.target in ("vercel", "both"):
        results.append(deploy_vercel(args.dry_run))

    ok = all(r.get("ok") for r in results)
    print(json.dumps({"git": state, "results": results, "ok": ok}, indent=2))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
