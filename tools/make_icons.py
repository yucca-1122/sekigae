# せきがえのアイコン一式を、元の正方形の絵（黒板の緑に、白いチョークと、右へかすれて消える線）から作る
# 元の絵はチョークが左のふちに寄っているので、絵を縮めて真ん中に置き、まわりは黒板の緑でのばす。
# 緑には、ゆるい明るさの変化と細かいむらがあるので、1色で埋めずに作り直す（継ぎ目が出ないように）
#   - 明るさの変化 … チョークのない画素から 3次の曲面を当てはめて、外側にものばす
#   - 細かいむら … 元の絵のチョークのない所の「曲面との差」を借りる
# - apple-touch-icon.png（180）・icon-192.png・icon-512.png … 絵を ANY 倍
# - icon-maskable-512.png … Android の丸い切り抜き用。絵を MASKABLE 倍（左のチョークが欠けないように）
# - favicon-32.png … ブラウザのタブ
# - logo-64.png … アプリの中の見出しの印（本体に data: で埋め込む）
# 元の絵の付帯情報（文字の記録・作成の記録など）は書き出さない。最後に PNG の中身の塊を並べて確かめる
# 使い方: python tools/make_icons.py <元の絵のパス>   （sekigae フォルダで実行）
import os, sys, struct
sys.stdout.reconfigure(encoding='utf-8')
import numpy as np
from PIL import Image, ImageFilter

ANY, MASKABLE = 0.92, 0.76

here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = Image.open(sys.argv[1]).convert('RGB')
if src.width != src.height:
    raise SystemExit('正方形の絵にしてください')
a = np.asarray(src).astype(np.float32)
H, W, _ = a.shape
lum = a.mean(axis=2)
chalk = np.asarray(Image.fromarray(((lum > 70) * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(21))) > 0

# 背景の曲面（座標は元の絵の大きさを 1 とした値。外側にのばすときも同じ式を使う）
def terms(X, Y):
    return [np.ones_like(X), X, Y, X * X, Y * Y, X * Y, X ** 3, Y ** 3, X * X * Y, X * Y * Y]
yy, xx = np.mgrid[0:H, 0:W]
T = terms(xx / W - .5, yy / H - .5)
A = np.stack([t[~chalk][::7] for t in T], 1)
coef = [np.linalg.lstsq(A, a[..., c][~chalk][::7], rcond=None)[0] for c in range(3)]
fit = np.stack([sum(k * t for k, t in zip(coef[c], T)) for c in range(3)], -1)
resid = np.where(chalk[..., None], 0, a - fit)
# 絵の中心（チョークと線の外枠の真ん中）
ys, xs = np.where(lum > 120)
cx, cy = (xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2

def compose(scale, size):
    """絵を scale 倍にして真ん中に置いた size×size の画像（元の絵の画素の単位で組んでから縮める）"""
    S = int(round(W / scale))
    vy, vx = np.mgrid[0:S, 0:S]
    ox, oy = S / 2 - cx, S / 2 - cy                       # 元の絵を置く位置（絵の中心を真ん中に）
    X, Y = (vx - ox) / W - .5, (vy - oy) / H - .5
    bg = np.stack([sum(k * t for k, t in zip(coef[c], terms(X, Y))) for c in range(3)], -1)
    # 細かいむら（チョークのない所から、ずらして借りる。折り返しは鏡写しにして継ぎ目を出さない）
    my, mx = (vy + 131) % (2 * H), (vx + 377) % (2 * W)
    my, mx = np.where(my >= H, 2 * H - 1 - my, my), np.where(mx >= W, 2 * W - 1 - mx, mx)
    bg += resid[my, mx]
    out = bg.copy()
    sx, sy = (vx - ox).round().astype(int), (vy - oy).round().astype(int)
    inside = (sx >= 0) & (sx < W) & (sy >= 0) & (sy < H)
    # 元の絵は、ふちから 80px かけてなめらかに重ねる（チョークの所はそのまま）
    d = np.minimum.reduce([sx, W - 1 - sx, sy, H - 1 - sy]).astype(np.float32)
    alpha = np.clip(d / 80, 0, 1)
    csx, csy = np.clip(sx, 0, W - 1), np.clip(sy, 0, H - 1)
    alpha = np.where(chalk[csy, csx], 1, alpha) * inside
    out = bg * (1 - alpha[..., None]) + a[csy, csx] * alpha[..., None]
    im = Image.fromarray(out.clip(0, 255).astype(np.uint8))
    return im.resize((size, size), Image.LANCZOS)

out_dir = os.path.join(here, 'assets', 'icons')
os.makedirs(out_dir, exist_ok=True)

def save(im, name):
    p = os.path.join(out_dir, name)
    clean = Image.new('RGB', im.size)       # 付帯情報を持たない新しい画像に写す
    clean.paste(im)
    clean.save(p, optimize=True)
    return p

base = compose(ANY, 1024)
made = [save(base.resize((s, s), Image.LANCZOS), n) for n, s in
        [('apple-touch-icon.png', 180), ('icon-192.png', 192), ('icon-512.png', 512), ('favicon-32.png', 32), ('logo-64.png', 64)]]
made.append(save(compose(MASKABLE, 512), 'icon-maskable-512.png'))
med = tuple(int(v) for v in np.median(np.asarray(base).reshape(-1, 3)[::97], axis=0))
print('背景の緑（中央値）: #%02x%02x%02x' % med)

def chunk_types(p):
    with open(p, 'rb') as f:
        data = f.read()
    i, types = 8, []
    while i < len(data):
        n = struct.unpack('>I', data[i:i + 4])[0]
        types.append(data[i + 4:i + 8].decode('latin-1'))
        i += 12 + n
    return types

for p in made:
    extra = [c for c in chunk_types(p) if c not in ('IHDR', 'IDAT', 'IEND')]
    print(os.path.basename(p), Image.open(p).size, '%d KB' % max(1, os.path.getsize(p) // 1024),
          '付帯情報なし' if not extra else '付帯情報あり: ' + ','.join(extra))
