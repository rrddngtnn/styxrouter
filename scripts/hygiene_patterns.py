"""Pattern catalog (PUBLIC part) for the public-hygiene gate.

This file is tracked in git, so it must contain NO operator-specific literal: no usernames, hostnames,
domains, IPs, handles, ports, keys or passwords. Those live in scripts/hygiene_private.py, which is
gitignored and loaded by the gate when present (see public-hygiene-gate.py).

Each PatternDef has:
  name:       short identifier like "P-STRUCT-OMNI"
  regex:      python-regex string (compiled by the gate, case-SENSITIVE)
  severity:   "fatal" blocks publish; "warn" is reported but does not fail the gate
  surfaces:   set of surface names the pattern applies to
              {"tracked_file", "commit_message", "filename", "panel_bundle", "runtime"}
"""
from dataclasses import dataclass, field

ALL_SURFACES = frozenset(
    {"tracked_file", "commit_message", "filename", "panel_bundle", "runtime"}
)


@dataclass(frozen=True)
class PatternDef:
    name: str
    regex: str
    severity: str = "fatal"
    surfaces: frozenset = field(default_factory=lambda: ALL_SURFACES)


def _p(name, regex, severity="fatal", surfaces=ALL_SURFACES):
    return PatternDef(name=name, regex=regex, severity=severity, surfaces=surfaces)


PATTERNS = [
    # --- Canaries: the sanitized placeholders used in tests/fixtures/hygiene/dirty/. They are not
    #     operator identifiers; flagging them in real source means a fixture value was pasted there. ---
    _p("P-OP-PLACEHOLDER-USER", r"\bacmeuser\b"),
    _p("P-OP-PLACEHOLDER-IP", r"\b203\.0\.113\.10\b"),  # RFC 5737 TEST-NET-3
    _p("P-INFRA-PLACEHOLDER-PORT", r"\b54321\b"),

    # --- Shape-based secret check (no literal needed). 64 hex chars is the shape of a 256-bit key,
    #     but also of a SHA-256 digest, so this only warns; the exact live key is checked by the
    #     private catalog. ---
    _p("P-INFRA-HEX64", r"\b[0-9a-f]{64}\b", severity="warn"),

    # --- Code constants that are already public in source ---
    _p("P-INFRA-SALT", r"styx-field-encryption-v1", severity="warn"),
    _p("P-INFRA-SALT-LEGACY", r"omniroute-field-encryption-v1"),

    # --- Planning vocabulary that only makes sense to people who sat through private sessions ---
    # nest/crumb are also ordinary words (breadcrumb UI, nested config): warn, not a blocker.
    _p("P-VOCAB-NEST", r"\bnest(?:-warm)?\b", severity="warn"),
    _p("P-VOCAB-GNAW", r"\bgnaw(?:ed|ing)?\b"),
    _p("P-VOCAB-CRUMB", r"\bcrumb\b", severity="warn"),
    _p("P-VOCAB-WAVE", r"(?<!signal-)\bwave\s+\d"),
    _p("P-VOCAB-PHASE", r"\bphase\s+\d\b"),
    _p("P-VOCAB-TASK-NO", r"\bT\d+\.\d+\b"),
    _p("P-VOCAB-TASK-SLASH", r"\bT\d{2}/T\d{2}"),   # T06/T10/T36 task lists
    _p("P-VOCAB-REQ-NO", r"\bR\d+\.\d+\b"),          # R0.3 requirement ids
    _p("P-VOCAB-PLAN-VER", r"\bv\d+ plan\b"),        # "v4 plan" roadmap refs
    _p("P-VOCAB-ADR", r"\bADR[- ]?\d+\b"),
    _p("P-VOCAB-SDD", r"\bSDD\b"),
    # YAGNI is a common engineering term, not identifying: warn.
    _p("P-VOCAB-YAGNI-CAPS", r"\bYAGNI\b", severity="warn"),
    _p("P-VOCAB-SHIPPED", r"\*\*SHIPPED\*\*|\(SHIPPED\)"),
    # Only the distinctive informal pronouns; 2-letter tokens over-match code and minified bundles.
    _p("P-VOCAB-PRONOUNS", r"\b(?:ente|aing|gue)\b"),

    # --- Legacy upstream identifiers used as code identifiers (allowlisted in README's
    #     "Credits & lineage" section and CREDITS.md) ---
    _p("P-STRUCT-OMNI", r"\b[Oo]mni[Rr]oute\b"),
    _p("P-STRUCT-OMNI-CAPS", r"\bOMNIROUTE\b"),
    _p("P-STRUCT-OMNI-SCOPE", r"@omniroute/"),
    # 9router/ninerouter is a REAL upstream provider this router dispatches to (executors/ninerouter.ts)
    # and is credited in CREDITS.md: warn, not a leak.
    _p("P-STRUCT-9ROUTER", r"\b9[Rr]outer\b|\b9router\b", severity="warn"),
    _p("P-STRUCT-NINEROUTER", r"\bNINEROUTER\b", severity="warn"),
]

# Internal-doc path patterns (filenames gate only). A hit is an immediate fatal: these artefacts must
# never be tracked.
INTERNAL_DOC_PATHS = [
    r"^specs/",
    r"^plans/",
    r"^evidence/",
    r"^backups/",
    r"^snapshots/",
    r"^\.specs/",
    r"^SDD\.md$",
    r"^adr-.*\.md$",
    r"^ADR-.*\.md$",
    r"/AGENTS\.md$",
    r"^AGENTS\.md$",
    r"SKILL\.md$",
    r"^scripts/hygiene_private\.py$",
]
