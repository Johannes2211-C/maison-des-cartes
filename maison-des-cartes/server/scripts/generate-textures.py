"""Génère les textures architecturales de la boutique (procédurales, libres de droits).

Usage : python3 server/scripts/generate-textures.py
Sortie : public/textures/*.webp  (couleur en sRGB, cartes de rugosité en niveaux de gris)

Ces textures peuvent être remplacées à l'identique (mêmes noms de fichiers) par des
textures photographiques PBR (par ex. Poly Haven, licence CC0) pour un rendu encore plus réaliste.
"""
import os
import numpy as np
from PIL import Image, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), "..", "..", "public", "textures")
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(42)


def noise(size, cells, seed=None):
    """Bruit de valeur lissé (périodique) dans [0,1]."""
    r = np.random.default_rng(seed) if seed is not None else rng
    g = r.random((cells, cells)).astype(np.float32)
    g = np.tile(g, (3, 3))  # pavage pour rester périodique
    img = Image.fromarray((g * 255).astype(np.uint8)).resize((size * 3, size * 3), Image.BICUBIC)
    a = np.asarray(img, dtype=np.float32)[size:2 * size, size:2 * size] / 255.0
    return a


def fbm(size, base=4, octaves=5, seed=0):
    total = np.zeros((size, size), np.float32)
    amp, norm = 1.0, 0.0
    for o in range(octaves):
        total += amp * noise(size, base * 2 ** o, seed + o)
        norm += amp
        amp *= 0.5
    return total / norm


def save_rgb(name, arr, q=86):
    arr = np.clip(arr, 0, 1)
    Image.fromarray((arr * 255).astype(np.uint8), "RGB").save(os.path.join(OUT, name), "WEBP", quality=q, method=6)


def save_gray(name, arr, q=80):
    arr = np.clip(arr, 0, 1)
    Image.fromarray((arr * 255).astype(np.uint8), "L").convert("RGB").save(os.path.join(OUT, name), "WEBP", quality=q, method=6)


def tint(gray, c1, c2):
    c1, c2 = np.array(c1, np.float32) / 255, np.array(c2, np.float32) / 255
    return c1[None, None, :] * (1 - gray[..., None]) + c2[None, None, :] * gray[..., None]


# 1. Carrelage grand format (grès cérame effet pierre) : 1 texture = 1,2 m x 1,2 m, deux dalles 120x60
S = 1024
base = fbm(S, 3, 6, 10)
fine = fbm(S, 64, 3, 20)
veins = np.abs(np.sin((np.linspace(0, 1, S)[None, :] * 7 + fbm(S, 2, 5, 30) * 6) * np.pi))
veins = 1 - np.clip(veins * 7, 0, 1)
g = 0.55 + 0.18 * (base - 0.5) + 0.06 * (fine - 0.5) - 0.05 * veins
albedo = tint(np.clip(g, 0, 1), (150, 142, 131), (232, 226, 216))
grout = np.zeros((S, S), bool)
gw = 3
grout[:gw, :] = True
grout[S // 2 - gw // 2:S // 2 + (gw + 1) // 2, :] = True
grout[:, :gw] = True
albedo[grout] = np.array([118, 112, 104]) / 255
# légère variation de teinte entre les deux dalles
albedo[S // 2:, :] *= 0.985
save_rgb("floor-tile.webp", albedo)
rough = 0.32 + 0.12 * (fine - 0.5) + 0.08 * (base - 0.5)
rough[grout] = 0.95
save_gray("floor-tile-rough.webp", rough)

# 2. Enduit mural blanc cassé (très subtil)
S = 512
p = fbm(S, 6, 6, 40)
save_rgb("plaster.webp", tint(p, (226, 220, 209), (240, 236, 228)))

# 3. Bois (chêne clair, noyer) — fil du bois dans l'axe U
def wood(seed, dark, light, rings=14, warp=1.2):
    """Fil droit (débit sur quartier) : stries longues dans l'axe U, faible ondulation."""
    S = 1024
    r = np.random.default_rng(seed)
    def stretch(rows, cols, out_h, out_w):
        a = (r.random((rows, cols)) * 255).astype(np.uint8)
        return np.asarray(Image.fromarray(a).resize((out_w, out_h), Image.BICUBIC), np.float32) / 255
    y = np.linspace(0, 1, S)[:, None]
    slow = stretch(6, 3, S, S)                     # ondulation lente
    pattern = np.sin((y * rings + slow * warp) * np.pi * 2) * 0.5 + 0.5
    fine = stretch(S // 2, 6, S, S)                # stries fines, très allongées
    mid = stretch(S // 10, 4, S, S)
    pores = stretch(S, 160, S, S)
    g = 0.58 - 0.13 * pattern + 0.16 * (fine - 0.5) + 0.12 * (mid - 0.5) + 0.05 * (pores - 0.5)
    color = tint(np.clip(g, 0, 1), dark, light)
    rough = np.clip(0.5 + 0.18 * (fine - 0.5) + 0.12 * pattern, 0, 1)
    return color, rough

oak, oak_r = wood(50, (156, 120, 82), (214, 182, 140))
save_rgb("oak.webp", oak)
save_gray("oak-rough.webp", oak_r)
walnut, walnut_r = wood(60, (52, 34, 24), (116, 80, 56), rings=11, warp=1.6)
save_rgb("walnut.webp", walnut)
save_gray("walnut-rough.webp", walnut_r)

# 4. Marbre blanc chaud (plans de comptoir)
S = 1024
x = np.linspace(0, 1, S)[None, :]
yy = np.linspace(0, 1, S)[:, None]
turb = fbm(S, 3, 7, 70)
v1 = np.abs(np.sin((x * 3 + yy * 1.2 + turb * 4.5) * np.pi))
v2 = np.abs(np.sin((x * 1.4 - yy * 2.2 + fbm(S, 4, 6, 80) * 5) * np.pi))
vein = (1 - np.clip(v1 * 5, 0, 1)) * 0.55 + (1 - np.clip(v2 * 11, 0, 1)) * 0.3
vein = np.asarray(Image.fromarray((vein * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.6)), np.float32) / 255
cloud = fbm(S, 5, 5, 90)
g = 0.93 - 0.06 * (cloud - 0.5) - 0.42 * vein
save_rgb("marble.webp", tint(np.clip(g, 0, 1), (120, 116, 112), (244, 240, 233)))

# 5. Pierre de façade (travertin clair) — panneaux 1 m x 0,5 m
S = 1024
p = fbm(S, 4, 6, 100)
holes = np.clip((fbm(S, 64, 2, 110) - 0.68) * 8, 0, 1) * 0.5
bands = np.sin((yy * 22 + fbm(S, 3, 4, 120) * 3) * np.pi) * 0.5 + 0.5
g = 0.62 + 0.14 * (p - 0.5) + 0.05 * (bands - 0.5) - 0.12 * holes
stone = tint(np.clip(g, 0, 1), (150, 132, 108), (226, 212, 190))
j = np.zeros((S, S), bool)
j[:3, :] = True
j[S // 2:S // 2 + 3, :] = True
j[:S // 2, :3] = True
j[S // 2:, S // 2:S // 2 + 3] = True
stone[j] = np.array([120, 108, 92]) / 255
save_rgb("stone.webp", stone)

# 6. Pavés de trottoir (granit gris)
S = 512
p = fbm(S, 32, 3, 130)
g = 0.45 + 0.2 * (p - 0.5)
pav = tint(np.clip(g, 0, 1), (70, 70, 70), (150, 148, 144))
pav[:4, :] = 0.22
pav[:, :4] = 0.22
pav[S // 2:S // 2 + 4, :] = 0.22
save_rgb("paving.webp", pav)

# 7. Métal brossé (rugosité)
S = 512
streaks = np.asarray(Image.fromarray((rng.random((S, 8)) * 255).astype(np.uint8)).resize((S, S), Image.BICUBIC), np.float32) / 255
streaks = streaks * 0.5 + fbm(S, 8, 3, 140) * 0.1
save_gray("brushed-rough.webp", 0.28 + 0.18 * streaks)

# 8. Feutrine anthracite (fond de vitrine)
S = 256
p = fbm(S, 96, 2, 150)
save_rgb("felt.webp", tint(p, (34, 34, 36), (54, 53, 54)))

# 9. Ombres de contact / lavage de lumière (PNG avec alpha)
S = 256
u = np.linspace(-1, 1, S)
X, Y = np.meshgrid(u, u)
d = np.clip(np.maximum(np.abs(X), np.abs(Y)), 0, 1)
ao = (1 - d) ** 1.4
Image.fromarray((np.dstack([np.zeros_like(ao)] * 3 + [ao]) * 255).astype(np.uint8), "RGBA").filter(ImageFilter.GaussianBlur(6)).save(os.path.join(OUT, "contact-shadow.png"))
r = np.sqrt(X ** 2 + Y ** 2)
spot = np.clip(1 - r, 0, 1) ** 2.2
Image.fromarray((np.dstack([np.ones_like(spot)] * 3 + [spot]) * 255).astype(np.uint8), "RGBA").save(os.path.join(OUT, "glow.png"))
v = np.linspace(1, 0, S)[:, None] * np.ones((1, S))
wash = (v ** 2.5) * np.clip(1 - np.abs(np.linspace(-1, 1, S))[None, :] ** 8, 0, 1)
Image.fromarray((np.dstack([np.ones_like(wash)] * 3 + [wash]) * 255).astype(np.uint8), "RGBA").save(os.path.join(OUT, "wash.png"))
print("Textures générées dans", os.path.abspath(OUT))
