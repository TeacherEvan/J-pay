#!/usr/bin/env python3
"""Structural validation for all mermaid blocks in j-pay.md (guardrail G4).

Rev F: lines beginning with subgraph/end/participant/actor/state-class
definitions carry no edge operator by design — they are exempt from the
edge-operator checks, along with their sequenceDiagram analogues
(alt/else/opt/loop/par/note/activation) and standalone flowchart
node-declaration lines (ID[label] etc.), fixing the known false-positive
where legitimate structural lines were flagged as missing arrows.
"""
import re, sys

doc = open("/home/ewaldt/Documents/VS/Other/J-pay/j-pay.md", encoding="utf-8").read()
FENCE = chr(96) * 3  # avoid literal fence inside this snippet
blocks = re.findall(FENCE + r"mermaid\n(.*?)" + FENCE, doc, re.S)
failures = []

KNOWN_TYPES = {"flowchart", "sequenceDiagram", "erDiagram", "stateDiagram-v2"}

# Structural lines that legitimately contain no edge operator / message arrow.
STRUCTURAL = re.compile(
    r"^(?:"
    r"subgraph\b|end\b|participant\b|actor\b|note\b|alt\b|else\b|opt\b|"
    r"loop\b|par\b|and\b|or\b|activate\b|deactivate\b|autonumber\b|box\b|"
    r"title\b|legend\b|classDef\b|class\b|direction\b"
    r"|state\s+\""  # stateDiagram quoted state-class definition
    r")",
    re.I,
)

for i, b in enumerate(blocks):
    first = b.strip().splitlines()[0].strip()
    kind = first.split()[0]
    if kind not in KNOWN_TYPES:
        failures.append(f"block {i}: unknown diagram type '{kind}'")
        continue
    lines = [l for l in b.strip().splitlines()[1:] if l.strip() and not l.strip().startswith("%%")]
    if not lines:
        failures.append(f"block {i}: empty body")
    # balanced arrows / edges: every non-exempt line must contain a relation operator
    for ln in lines:
        s = ln.strip()
        if STRUCTURAL.match(s):
            continue
        if kind == "flowchart" and re.match(r"^[A-Za-z_]\w*\s*[\[({].*[\])}]$", s):
            continue  # standalone node declaration (ID[label] / ID(label) / ID[(label)])
        if kind == "flowchart" and not re.search(r"-->|---|-\.-|===", s):
            failures.append(f"block {i}: flowchart line lacks edge op: {s[:40]}")
        if kind == "sequenceDiagram" and "-->" not in s and "->>" not in s and "-->>" not in s:
            failures.append(f"block {i}: seq line lacks message arrow: {s[:40]}")
    # stateDiagram notes must close
    if kind == "stateDiagram-v2":
        opens = sum(1 for l in lines if l.strip().startswith("note "))
        closes = sum(1 for l in lines if l.strip() == "end note")
        if opens != closes:
            failures.append(f"block {i}: {opens} note(s) vs {closes} end note")

# content assertions tied to this remediation
joined = "\n".join(blocks)
if "Clerk" in joined:
    failures.append("diagrams: Clerk node still present in §10.1")
if "flushOutbox" not in joined:
    failures.append("diagrams: offline-replay sequence lacks foreground flushOutbox lane")

print("\n".join(failures) if failures else f"ALL {len(blocks)} MERMAID BLOCKS PASS")
sys.exit(1 if failures else 0)
