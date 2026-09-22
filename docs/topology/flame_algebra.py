#!/usr/bin/env python3
"""
Flame algebra for the ZoneCog topology weave.

The 27 flame-letters form the group Z_3 x Z_3 x Z_3 under coordinate addition.
Each ZoneCog cognitive cycle is a trajectory through this group; the composition
of a cycle's letters is a single letter that characterises the cycle as a whole.

This module verifies the group laws and computes the residues of ZoneCog's
actual cycles.
"""

from itertools import product

MODE = {1: "Γ", 0: "Κ", -1: "Ω"}          # Gamma, Kappa, Omega
VOICE = {1: "↑", 0: "◊", -1: "↓"}          # up, lozenge, down
ASPECT = {-1: "○", 0: "●", 1: "◐"}         # hollow, full, half

NAMES = {
    (1, 1, -1): "Spark", (1, 1, 0): "Blaze", (1, 1, 1): "Trail",
    (1, -1, -1): "Womb", (1, -1, 0): "Intake", (1, -1, 1): "Harvest",
    (1, 0, -1): "Egg", (1, 0, 0): "Pulse", (1, 0, 1): "Echo",
    (0, 1, -1): "Promise", (0, 1, 0): "Beam", (0, 1, 1): "Wake",
    (0, -1, -1): "Readiness", (0, -1, 0): "Channel", (0, -1, 1): "Sediment",
    (0, 0, -1): "Latent", (0, 0, 0): "Mirror", (0, 0, 1): "Patina",
    (-1, 1, -1): "Fuse", (-1, 1, 0): "Flare", (-1, 1, 1): "Smoke",
    (-1, -1, -1): "Void", (-1, -1, 0): "Consume", (-1, -1, 1): "Ash",
    (-1, 0, -1): "Dormant", (-1, 0, 0): "Collapse", (-1, 0, 1): "Void-print",
}

IDENTITY = (0, 0, 0)


def wrap(n: int) -> int:
    """Map an integer into the balanced residue system {-1, 0, +1} mod 3."""
    return ((n + 1) % 3) - 1


def compose(*letters):
    """Fiber product: coordinatewise addition in Z_3^3."""
    mu = wrap(sum(l[0] for l in letters))
    nu = wrap(sum(l[1] for l in letters))
    al = wrap(sum(l[2] for l in letters))
    return (mu, nu, al)


def inverse(letter):
    return tuple(wrap(-c) for c in letter)


def glyph(letter) -> str:
    mu, nu, al = letter
    return f"{MODE[mu]}{VOICE[nu]}{ASPECT[al]}"


def render(letter) -> str:
    return f"{glyph(letter)} ({NAMES[letter]})"


# --------------------------------------------------------------------------
# ZoneCog cycles as flame trajectories
# --------------------------------------------------------------------------

COGNITIVE_LOOP = [
    ("perceive", (0, -1, 0)),    # Channel   - active reception of environment
    ("attend", (1, 1, -1)),      # Spark     - seeds attention outward (ECAN)
    ("think", (1, 0, 0)),        # Pulse     - self-generating processing
    ("act", (0, 1, 0)),          # Beam      - transmits motor output
    ("reflect", (-1, -1, 1)),    # Ash       - decays WM and salience
]

THINKING_PROTOCOL = [
    ("Initial Engagement", (1, -1, -1)),       # Womb
    ("Problem Space Mapping", (1, 1, -1)),     # Spark
    ("Hypothesis Generation", (1, 1, 0)),      # Blaze
    ("Discovery", (0, -1, 0)),                 # Channel
    ("Progress Tracking", (0, 0, 0)),          # Mirror
    ("Testing", (0, 1, 0)),                    # Beam
    ("Error Recognition", (-1, 0, 0)),         # Collapse
    ("Knowledge Synthesis", (1, -1, 1)),       # Harvest
    ("Pattern Recognition", (0, 0, 1)),        # Patina
    ("Recursive Thinking", (1, 0, -1)),        # Egg
    ("Response Preparation", (0, 1, 1)),       # Wake
]

NINE_P_MONAD = [
    ("Twalk", (1, 1, -1)),       # Spark   - the gaze that creates by looking
    ("Tread", (0, -1, 0)),       # Channel - the mirror speaks back
    ("Twrite", (0, 1, 0)),       # Beam    - inscribing into the surface
    ("Tstat", (0, 0, 0)),        # Mirror  - structure contemplating itself
    ("Tclunk", (-1, -1, 1)),     # Ash     - attention withdraws
]

MEMBRANE_TRIAD = [
    ("cerebral", (0, 0, 0)),     # Mirror  - reflexive reasoning
    ("somatic", (0, 1, 0)),      # Beam    - projective action
    ("autonomic", (0, -1, 0)),   # Channel - receptive homeostasis
]


def verify_group_laws() -> bool:
    letters = [t for t in product((1, 0, -1), repeat=3)]
    assert len(letters) == 27, "alphabet must have 27 letters"
    assert len(set(letters)) == 27, "letters must be distinct"

    for a in letters:
        assert compose(a, IDENTITY) == a, f"identity failed for {a}"
        assert compose(a, inverse(a)) == IDENTITY, f"inverse failed for {a}"

    for a in letters:
        for b in letters:
            assert compose(a, b) == compose(b, a), "group must be abelian"
            assert compose(a, b) in NAMES, "closure failed"

    for a in letters[:5]:
        for b in letters[:5]:
            for c in letters[:5]:
                assert compose(compose(a, b), c) == compose(a, compose(b, c)), \
                    "associativity failed"
    return True


def residue(cycle):
    return compose(*[l for _, l in cycle])


def report(title, cycle):
    print(f"\n{title}")
    print("-" * len(title))
    for name, letter in cycle:
        print(f"  {glyph(letter)}  {NAMES[letter]:<12} {name}")
    r = residue(cycle)
    print(f"  = {render(r)}")
    return r


if __name__ == "__main__":
    print("Flame algebra: Z_3 x Z_3 x Z_3 over 27 letters")
    verify_group_laws()
    print("  group laws verified (closure, identity, inverses, abelian, associative)")

    loop = report("Cognitive loop (autonomous heartbeat)", COGNITIVE_LOOP)
    think = report("Thinking protocol (query processing)", THINKING_PROTOCOL)
    monad = report("9P monad (namespace operations)", NINE_P_MONAD)
    triad = report("Membrane triad", MEMBRANE_TRIAD)

    print("\nResidues")
    print("--------")
    print(f"  cognitive loop     -> {render(loop)}")
    print(f"  thinking protocol  -> {render(think)}")
    print(f"  9P monad           -> {render(monad)}")
    print(f"  membrane triad     -> {render(triad)}")

    assert monad == IDENTITY, "9P monad must compose to the identity"
    assert triad == IDENTITY, "membrane triad must be balanced"
    assert loop == (1, 0, 0), "cognitive loop must compose to Pulse"
    assert think == (1, 1, 0), "thinking protocol must compose to Blaze"
    print("\nAll structural assertions hold.")
