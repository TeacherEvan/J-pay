#!/usr/bin/env python3
"""Mechanical consistency gate for j-pay.md. Fails while contradictions exist."""
import re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
doc_path = ROOT / "j-pay.md"
doc = doc_path.read_text(encoding="utf-8")
failures = []

def anchor_after(anchor, context):
    """Return the text after the first occurrence of `anchor`, or None after
    recording a readable anchor-drift failure (never a raw traceback)."""
    parts = doc.split(anchor, 1)
    if len(parts) < 2:
        failures.append(
            f"ANCHOR: expected anchor {anchor!r} missing in {context} "
            f"(file examined: {doc_path}) — the section moved or was renamed; update the anchor in scripts/check_consistency.py"
        )
        return None
    return parts[1]

# D4: Clerk must be fully removed
if re.search(r"\bClerk\b", doc):
    failures.append("D4: Clerk still referenced — replace with Convex Auth")

# B1: no claim that ALL convex access flows through route handlers
if re.search(r"All Convex access flows through", doc):
    failures.append("B1: 'All Convex access flows through Next.js route handlers' still present")

# B1: reactive queries must not be described as proxied
if re.search(r"reactive quer.*through (Next|route)", doc, re.I):
    failures.append("B1: reactive queries still described as routed through Next.js")

# B3: 'via that index' skew-filter claim must match an actual index name in schema
if "clockSkewMs" in doc:
    if "by_user_skew" not in doc and re.search(r"filter.*via that index", doc):
        failures.append("B3: skew filter claims index use but by_user_skew absent")

# B4: Background Sync must not be sole replay mechanism
if re.search(r"replay.*Serwist Background Sync when connectivity returns(?!\s*\()", doc) \
   and "foreground reconciliation" not in doc:
    failures.append("B4: offline replay still names Background Sync without foreground-primary language")

# M4: purge must reference native cron or justified Vercel Cron
if "Vercel Cron" in doc and "convex/crons.ts" not in doc:
    failures.append("M4: Vercel Cron referenced without native crons.ts alternative noted")

# M7: push sender must be named
if "web-push" not in doc:
    failures.append("M7: no push sender named (expect web-push via Convex Action)")

# B2: state diagram must contain side-mission substate
FENCE = chr(96) * 3  # avoid literal fence inside this snippet
sd_block = anchor_after("stateDiagram-v2", "§6.1 state diagram") if "stateDiagram-v2" in doc else None
if sd_block is not None and "side_mission" not in sd_block.split(FENCE)[0]:
    failures.append("B2: state diagram lacks quick_side_mission substate")
# B2: unpaired side-mission rule must parallel unpaired-lunch rule
if "unpaired lunch" in doc.lower() and "unpaired side mission" not in doc.lower():
    failures.append("B2: unpaired side-mission rule missing (parallel to rule 4)")

# B3: skew filtering must either name by_user_skew index or admit filtered scan
if "clockSkewMs" in doc:
    has_index_claim = bool(re.search(r"filter.*index|via that index", doc))
    has_two_tail = "by_user_skew" in doc
    has_scan_admission = "filtered scan" in doc
    if has_index_claim and not (has_two_tail and has_scan_admission):
        failures.append("B3: skew-index claim inconsistent with schema/indexes")
# M1: impossible travel must specify lookup method
if "impossibleTravelFlag" in doc and "previous fix" in doc.lower():
    if 'order("desc")' not in doc and "by_user_time descending" not in doc:
        failures.append("M1: impossible-travel previous-fix lookup unspecified")

# B4 strict: platform support table must exist
if "Background Sync support:" not in doc and "background-sync" not in doc.lower():
    failures.append("B4: no platform-support statement for Background Sync")

# M2: transaction-limit mislabel must be gone
if "1MB transaction limit" in doc or "1 MB transaction" in doc.lower():
    failures.append("M2: '1MB transaction limit' mislabel present")
if "Fluid compute" not in doc and "300s" not in doc:
    failures.append("M2/V2: Vercel duration figure not updated to Fluid compute reality")

# M3: coord purge must state anonymize-vs-delete choice
if "purge" in doc.lower() and "zero out lat/lng" not in doc and "anonymize (zero" not in doc:
    failures.append("M3: coordinate purge outcome (anonymize vs delete) unspecified")
# M6: sites audit fields
sites_block = anchor_after("sites: defineTable", "§6 schema (sites table)")
if sites_block is not None and "createdBy" not in sites_block.split("}),")[0]:
    failures.append("M6: sites table lacks createdBy audit field")
# M7 covered by base script (web-push presence) — tighten to require Convex Action wording
if "web-push" in doc and "Convex Action" not in doc:
    failures.append("M7: web-push named but sender runtime unspecified")

# M5: HMAC secret single-surface
if "HMAC" in doc and "Vercel env" in doc and "Convex env holds the HMAC" not in doc:
    failures.append("M5: HMAC secret appears bound to Vercel env (two-surface problem)")
# version bump gate
if "**Version:** 1.2" not in doc and "Version:** 1.1" in doc:
    failures.append("VERSION: header not bumped to 1.2")
# D4 case-insensitive residual sweep
if re.search(r"clerk", doc, re.I):
    failures.append("D4: lowercase/residual Clerk reference remains")

# ERD sync (AGENTS.md rule 2): every §6 schema field must appear in §10.2
ts_block = re.search(r"```ts\n(.*?)```", doc, re.S)
erd_block = re.search(r"```mermaid\n(erDiagram.*?)```", doc, re.S)
if not (ts_block and erd_block):
    failures.append("ERD-SYNC: §6 ts block or §10.2 erDiagram block missing")
else:
    schema_fields = {}
    for m in re.finditer(r"(\w+): defineTable\(\{(.*?)\n  \}\)", ts_block.group(1), re.S):
        schema_fields[m.group(1)] = set(re.findall(r"^    (\w+):", m.group(2), re.M))
    erd_attrs = {}
    for m in re.finditer(r"^    (\w+) \{\n(.*?)^    \}", erd_block.group(1), re.S | re.M):
        erd_attrs[m.group(1)] = set(re.findall(r"^\s+\w+\s+(\w+)", m.group(2), re.M))
    if not schema_fields or not erd_attrs:
        failures.append("ERD-SYNC: extraction found no tables — check regex vs doc structure")
    else:
        for t in sorted(schema_fields):
            missing = sorted(schema_fields[t] - erd_attrs.get(t, set()))
            if missing:
                failures.append(f"ERD-SYNC: {t} attributes missing from §10.2: {missing}")
        unknown = sorted(set(erd_attrs) - set(schema_fields))
        if unknown:
            failures.append(f"ERD-SYNC: §10.2 entities absent from schema: {unknown}")

# README must cite the live TRD version (drift guard)
version = re.search(r"\*\*Version:\*\* ([\d.]+)", doc)
readme_path = ROOT / "README.md"
if version and readme_path.exists():
    if version.group(1) not in readme_path.read_text(encoding="utf-8"):
        failures.append(f"README: stale — does not cite TRD version {version.group(1)}")

# R26: side-mission implicit exits must include day_finish (§6.1 rule 8)
if "stateDiagram-v2" in doc:
    sd = (anchor_after("stateDiagram-v2", "§6.1 state diagram (R26)") or "").split(FENCE)[0]
    if "side_mission --> checkpoint" in sd and "side_mission --> day_finish" not in sd:
        failures.append("B2/R26: side-mission lacks day_finish implicit exit (§6.1 rule 8)")

# messages.retentionDays must be wired into §9 policy text, not exist in schema only
if "retentionDays" in doc:
    sec9_body = anchor_after("## 9.", "§9 retention policy")
    if sec9_body is not None:
        sec9 = sec9_body.split("\n## ")[0]
        if "retentionDays" not in sec9:
            failures.append("RESIDUE: messages.retentionDays in schema but unwired in §9 policy text")

print("\n".join(failures) if failures else "ALL CONSISTENCY CHECKS PASS")
sys.exit(1 if failures else 0)
