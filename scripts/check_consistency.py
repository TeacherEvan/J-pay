#!/usr/bin/env python3
"""Mechanical consistency gate for j-pay.md. Fails while contradictions exist."""
import re, sys

doc = open("/home/ewaldt/Documents/VS/Other/J-pay/j-pay.md", encoding="utf-8").read()
failures = []

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
if "stateDiagram-v2" in doc and "side_mission" not in doc.split("stateDiagram-v2")[1].split(FENCE)[0]:
    failures.append("B2: state diagram lacks quick_side_mission substate")
# B2: unpaired side-mission rule must parallel unpaired-lunch rule
if "unpaired lunch" in doc.lower() and "unpaired side mission" not in doc.lower():
    failures.append("B2: unpaired side-mission rule missing (parallel to rule 4)")

print("\n".join(failures) if failures else "ALL CONSISTENCY CHECKS PASS")
sys.exit(1 if failures else 0)
