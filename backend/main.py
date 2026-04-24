import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:4173"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

# ── Profile functions ────────────────────────────────────────────────────────
# Each profile defines the cross-sectional radius r = f(u) of a revolution
# surface.  The frontend evaluates:
#   r = amp * sin(freq*u + phaseAdj + 6π) - 6.2
#       + (-logAmp * log10(-(u + logShift) + 20) + 1)
#       + offset
# where u is the height parameter (0 → base, ~5.6 → bud tip).
PROFILES = {
    "1":  {"amp": 0.50, "freq": 1.00, "phaseAdj": -18.9, "logAmp": 12.0, "offset": 22.00, "logShift": 0},
    "2":  {"amp": 0.50, "freq": 0.95, "phaseAdj": -18.7, "logAmp": 12.0, "offset": 21.80, "logShift": 0},
    "3":  {"amp": 0.50, "freq": 0.90, "phaseAdj": -18.7, "logAmp": 12.0, "offset": 21.50, "logShift": 0},
    "4":  {"amp": 0.50, "freq": 0.90, "phaseAdj": -18.5, "logAmp": 12.0, "offset": 21.40, "logShift": 0},
    "5":  {"amp": 0.50, "freq": 0.93, "phaseAdj": -18.5, "logAmp": 11.9, "offset": 21.14, "logShift": 0},
    "6":  {"amp": 0.25, "freq": 0.93, "phaseAdj": -18.5, "logAmp": 11.9, "offset": 20.76, "logShift": 0},
    "7":  {"amp": 0.25, "freq": 0.93, "phaseAdj": -18.5, "logAmp": 11.9, "offset": 20.63, "logShift": 0},
    "8":  {"amp": 0.25, "freq": 0.93, "phaseAdj": -18.5, "logAmp": 11.9, "offset": 20.46, "logShift": 0},
    "9":  {"amp": 0.25, "freq": 0.93, "phaseAdj": -18.5, "logAmp": 11.9, "offset": 20.30, "logShift": 0},
    "10": {"amp": 0.25, "freq": 0.93, "phaseAdj": -18.5, "logAmp": 11.9, "offset": 20.20, "logShift": 0},
    "11": {"amp": 0.25, "freq": 0.93, "phaseAdj": -18.5, "logAmp": 11.9, "offset": 19.98, "logShift": 0},
    "12": {"amp": 0.25, "freq": 0.93, "phaseAdj": -18.5, "logAmp": 11.9, "offset": 19.90, "logShift": 0},
    "13": {"amp": 0.25, "freq": 0.93, "phaseAdj": -19.0, "logAmp": 11.9, "offset": 19.40, "logShift": 1},
    "14": {"amp": 0.25, "freq": 0.93, "phaseAdj": -19.0, "logAmp": 11.9, "offset": 19.25, "logShift": 1},
    "15": {"amp": 0.25, "freq": 0.93, "phaseAdj": -19.0, "logAmp": 11.9, "offset": 19.14, "logShift": 1},
}

# ── Surface list ─────────────────────────────────────────────────────────────
# Each surface is a revolution solid clipped by a domain restriction.
# clip.type:
#   0 = none
#   1 = half-plane  : show where  nx*dx + ny*dy [< or >] 0
#                     gt=0 → show where < 0 ; gt=1 → show where > 0
#   2 = ellipse-X   : show where  dx²/ea2 + (dz-cz)²/eb2  < 1
#   3 = ellipse-Y   : show where  dy²/ea2 + (dz-cz)²/eb2  < 1
#   4 = ellipse-XpY : show where (dx+dy)²/ea2 + (dz-cz)²/eb2 < 1
#   5 = ellipse-XmY : show where (dx-dy)²/ea2 + (dz-cz)²/eb2 < 1
# (dx,dy,dz) are Desmos-unit coordinates reconstructed in the fragment shader.
SURFACES = [
    # ── Layer 1: outermost envelope petals (ellipse clips) ──────────────────
    {"profileId": "1", "uMax": 5.5, "clip": {"type": 2, "ea2": 4.0, "eb2": 9.0, "cz": 2.52}},
    {"profileId": "1", "uMax": 5.5, "clip": {"type": 3, "ea2": 4.0, "eb2": 9.0, "cz": 2.52}},
    # ── Layer 2: full round shell (no clip) ─────────────────────────────────
    {"profileId": "2", "uMax": 4.7, "clip": {"type": 0}},
    # ── Layer 3: diagonal petal pair ────────────────────────────────────────
    {"profileId": "3", "uMax": 5.3, "clip": {"type": 4, "ea2": 4.0, "eb2": 8.0, "cz": 2.44}},
    {"profileId": "3", "uMax": 5.3, "clip": {"type": 5, "ea2": 4.0, "eb2": 8.0, "cz": 2.44}},
    # ── Layers 4-15: inner petals with half-plane clips ─────────────────────
    {"profileId": "4",  "uMax": 4.70, "clip": {"type": 1, "nx":  1, "ny": -1, "gt": 0}},
    {"profileId": "5",  "uMax": 4.85, "clip": {"type": 1, "nx":  1, "ny":  0, "gt": 0}},
    {"profileId": "6",  "uMax": 5.00, "clip": {"type": 1, "nx":  1, "ny":  2, "gt": 0}},
    {"profileId": "7",  "uMax": 5.15, "clip": {"type": 1, "nx":  1, "ny":  1, "gt": 1}},
    {"profileId": "12", "uMax": 4.80, "clip": {"type": 1, "nx": -5, "ny":  1, "gt": 0}},
    {"profileId": "8",  "uMax": 5.25, "clip": {"type": 1, "nx": -1, "ny":  3, "gt": 0}},
    {"profileId": "9",  "uMax": 5.35, "clip": {"type": 1, "nx":  1, "ny":  0, "gt": 0}},
    {"profileId": "10", "uMax": 5.45, "clip": {"type": 1, "nx":  2, "ny": -1, "gt": 1}},
    {"profileId": "11", "uMax": 5.60, "clip": {"type": 1, "nx":  0, "ny":  1, "gt": 1}},
    {"profileId": "12", "uMax": 5.60, "clip": {"type": 1, "nx": -1, "ny":  1, "gt": 0}},
    {"profileId": "13", "uMax": 5.60, "clip": {"type": 1, "nx":  1, "ny":  1, "gt": 0}},
    {"profileId": "14", "uMax": 5.60, "clip": {"type": 1, "nx":  1, "ny":  1, "gt": 1}},
    {"profileId": "15", "uMax": 5.60, "clip": {"type": 1, "nx":  1, "ny":  1, "gt": 0}},
]

COLORS = {
    "outer": [178, 34,  34],   # firebrick — outer petals
    "inner": [139,  0,   0],   # dark red  — inner petals
    "glow":  [220,  80,  80],  # warm crimson glow (bloom)
}


@app.get("/api/flower")
def get_flower():
    # Annotate each surface with a color based on its layer position
    surfaces = []
    for idx, s in enumerate(SURFACES):
        surface = dict(s)
        surface["color"] = COLORS["outer"] if idx < 5 else COLORS["inner"]
        surface["glowColor"] = COLORS["glow"]
        surfaces.append(surface)

    return {
        "profiles": PROFILES,
        "surfaces": surfaces,
        # scale: converts Desmos units → Three.js world units
        # At scale=0.15: bud height = 5.6*0.15 = 0.84, max radius ≈ 0.40
        "scale": 0.15,
        "flowerY": 1.0,   # Three.js Y where the bud base sits (top of stem)
    }


dist_dir = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.exists(dist_dir):
    app.mount("/", StaticFiles(directory=dist_dir, html=True), name="static")
