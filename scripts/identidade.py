# Gera as imagens da identidade FinFlow a partir da arte original (docs/identidade/finflow-original.jpg):
#   public/marca.png (símbolo, 512 px), public/logo.png (símbolo + FINFLOW, sem o slogan — na arte ele saiu cortado,
#   "INTEGRA"; o slogan certo, "Gestão Financeira Inteligente", vai em texto nas telas), icon-192/512 (PWA),
#   apple-touch-icon (180) e favicon (64).
#   python scripts/identidade.py   (precisa do Pillow: pip install pillow)
import os
from PIL import Image

RAIZ = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
ORIGEM = os.path.join(RAIZ, "docs", "identidade", "finflow-original.jpg")
PUBLIC = os.path.join(RAIZ, "public")

im = Image.open(ORIGEM).convert("RGB")
W, H = im.size
px = im.load()
branco = lambda p: sum(p) >= 700   # fundo da arte é branco (JPEG: quase branco)

def caixa(y0, y1):
    """menor retângulo com conteúdo entre as linhas y0 e y1"""
    xs, ys = [], []
    for y in range(y0, y1):
        for x in range(W):
            if not branco(px[x, y]):
                xs.append(x); ys.append(y)
    return min(xs), min(ys), max(xs) + 1, max(ys) + 1

# faixas da arte: símbolo, nome FINFLOW e slogan (separadas por linhas brancas)
linhas = [any(not branco(px[x, y]) for x in range(0, W, 2)) for y in range(H)]
faixas, ini = [], None
for y, tem in enumerate(linhas + [False]):
    if tem and ini is None: ini = y
    if not tem and ini is not None:
        if y - ini > 8: faixas.append((ini, y))
        ini = None
simbolo, nome = faixas[0], faixas[1]

def quadrado(img, lado, margem=0.08, fundo=(255, 255, 255)):
    """centraliza num quadrado branco com margem (ícones)"""
    w, h = img.size
    util = int(lado * (1 - 2 * margem))
    esc = util / max(w, h)
    r = img.resize((max(1, int(w * esc)), max(1, int(h * esc))), Image.LANCZOS)
    q = Image.new("RGB", (lado, lado), fundo)
    q.paste(r, ((lado - r.size[0]) // 2, (lado - r.size[1]) // 2))
    return q

marca = im.crop(caixa(*simbolo))
quadrado(marca, 512, 0.04).save(os.path.join(PUBLIC, "marca.png"), optimize=True)
quadrado(marca, 512, 0.14).save(os.path.join(PUBLIC, "icon-512.png"), optimize=True)   # área segura do ícone "maskable"
quadrado(marca, 192, 0.14).save(os.path.join(PUBLIC, "icon-192.png"), optimize=True)
quadrado(marca, 180, 0.10).save(os.path.join(PUBLIC, "apple-touch-icon.png"), optimize=True)
quadrado(marca, 64, 0.02).save(os.path.join(PUBLIC, "favicon.png"), optimize=True)

x0, y0, _, _ = caixa(*simbolo)
_, _, x1, y1 = caixa(*nome)
x0 = min(x0, caixa(*nome)[0])
m = 12
logo = im.crop((max(0, x0 - m), max(0, y0 - m), min(W, x1 + m), min(H, y1 + m)))
alvo = 360   # altura: nítido em telas retina até ~120 px de exibição
logo.resize((int(logo.size[0] * alvo / logo.size[1]), alvo), Image.LANCZOS).save(os.path.join(PUBLIC, "logo.png"), optimize=True)
print("faixas:", faixas)
print("ok:", ", ".join(sorted(f for f in os.listdir(PUBLIC) if f.endswith(".png"))))
