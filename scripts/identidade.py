# Gera as imagens da identidade Finanway a partir da arte original (docs/identidade/finanway-original.jpg, fundo carvão):
#   public/marca.png (símbolo, 512 px), public/logo.png (símbolo + FINAN WAY + slogan + "by ONE WAY"), icon-192/512 (PWA,
#   com o símbolo dentro da área segura), apple-touch-icon (180) e favicon (64). Tudo com o próprio fundo escuro da arte:
#   as telas mostram a logo sobre fundo carvão.
#   python scripts/identidade.py   (precisa do Pillow: pip install pillow)
import os
from PIL import Image

RAIZ = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
ORIGEM = os.path.join(RAIZ, "docs", "identidade", "finanway-original.jpg")
PUBLIC = os.path.join(RAIZ, "public")

im = Image.open(ORIGEM).convert("RGB")
W, H = im.size
px = im.load()
desenho = lambda p: max(p) > 110 or (p[0] - p[2]) > 70   # traço claro ou laranja sobre o fundo carvão

# faixas da arte (separadas por linhas só de fundo): símbolo, nome, slogan, "by ONE WAY"
linhas = [sum(1 for x in range(0, W, 2) if desenho(px[x, y])) > 2 for y in range(H)]
faixas, ini = [], None
for y, tem in enumerate(linhas + [False]):
    if tem and ini is None: ini = y
    if not tem and ini is not None:
        if y - ini > 5: faixas.append((ini, y))
        ini = None

def colunas(y0, y1):
    xs = [x for y in range(y0, y1) for x in range(W) if desenho(px[x, y])]
    return min(xs), max(xs) + 1

def fundo(lado):
    """quadrado no degradê radial da arte (centro grafite, bordas carvão)"""
    centro, borda = (58, 64, 70), (20, 23, 26)
    q = Image.new("RGB", (lado, lado))
    qp = q.load(); r = lado / 2
    for y in range(lado):
        for x in range(lado):
            t = min(1.0, (((x - r) ** 2 + (y - r) ** 2) ** 0.5) / (r * 1.25))
            qp[x, y] = tuple(int(centro[i] + (borda[i] - centro[i]) * t) for i in range(3))
    return q

def icone(lado, ocupa):
    """símbolo (retângulo com folga) mesclado no fundo: bordas esfumadas para não aparecer a emenda"""
    m = 40   # embaixo a folga vai até perto do nome (a ponta do W some no degradê da arte)
    simb = im.crop((max(0, sx0 - m), max(0, sy0 - m), min(W, sx1 + m), min(H, faixas[1][0] - 12)))
    esc = lado * ocupa / max(simb.size)
    simb = simb.resize((int(simb.size[0] * esc), int(simb.size[1] * esc)), Image.LANCZOS)
    mascara = Image.new("L", simb.size, 0)
    mp = mascara.load(); fx, fy = simb.size[0] * 0.06, simb.size[1] * 0.08
    for y in range(simb.size[1]):
        for x in range(simb.size[0]):
            d = min(x / fx, (simb.size[0] - 1 - x) / fx, y / fy, (simb.size[1] - 1 - y) / fy, 1.0)
            mp[x, y] = int(255 * max(0.0, d))
    q = fundo(lado)
    q.paste(simb, ((lado - simb.size[0]) // 2, (lado - simb.size[1]) // 2), mascara)
    return q

sx0, sx1 = colunas(*faixas[0])
sy0, sy1 = faixas[0]
for nome, tam, ocupa in (("marca.png", 512, 0.96), ("apple-touch-icon.png", 180, 0.9), ("favicon.png", 64, 1.0),
                         ("icon-512.png", 512, 0.78), ("icon-192.png", 192, 0.78)):   # PWA "maskable": área segura de 80%
    icone(tam, ocupa).save(os.path.join(PUBLIC, nome), optimize=True)

# logo completa (do símbolo ao "by ONE WAY") com fundo TRANSPARENTE: o fundo carvão da arte (degradê) é estimado pelo
# mínimo local (o desenho é mais claro que o fundo) e tirado de cada pixel; o laranja fica opaco. Assim a logo assenta em
# qualquer fundo escuro sem aparecer o retângulo do recorte.
from PIL import ImageFilter
x0 = min(colunas(*f)[0] for f in faixas); x1 = max(colunas(*f)[1] for f in faixas)
m = 24
caixa = (max(0, x0 - m), max(0, faixas[0][0] - m), min(W, x1 + m), min(H, faixas[-1][1] + m))
lum = im.convert("L")
pequeno = lum.resize((W // 8, H // 8), Image.BILINEAR).filter(ImageFilter.MinFilter(9)).filter(ImageFilter.GaussianBlur(4))
fundo_est = pequeno.resize((W, H), Image.BILINEAR).filter(ImageFilter.GaussianBlur(12))
rgba = Image.new("RGBA", (caixa[2] - caixa[0], caixa[3] - caixa[1]))
rp, fp, lp = rgba.load(), fundo_est.load(), lum.load()
for y in range(caixa[1], caixa[3]):
    for x in range(caixa[0], caixa[2]):
        r, g, b = px[x, y]
        bgl = fp[x, y]
        a = max(0.0, min(1.0, (lp[x, y] - bgl - 14) / 45))
        a = max(a, max(0.0, min(1.0, ((r - b) - 40) / 50)))   # laranja: opaco
        if a > 0:
            cor = tuple(max(0, min(255, int((c - bgl * (1 - a)) / a))) for c in (r, g, b))
            rp[x - caixa[0], y - caixa[1]] = (*cor, int(a * 255))
alvo = 520   # altura: nítido em telas retina até ~260 px de exibição
rgba.resize((int(rgba.size[0] * alvo / rgba.size[1]), alvo), Image.LANCZOS).save(os.path.join(PUBLIC, "logo.png"), optimize=True)
print("faixas:", faixas)
print("ok:", ", ".join(sorted(f for f in os.listdir(PUBLIC) if f.endswith(".png"))))
