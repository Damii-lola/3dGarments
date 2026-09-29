"""Silhouette masks of the reference photos (figure on a flat #181818 background)."""
import numpy as np
from PIL import Image
from scipy import ndimage as nd

for v in ('front', 'back', 'side'):
    a = np.asarray(Image.open(f'{v}.png').convert('RGB')).astype(int)
    if v != 'front':
        a[1900:2000, 580:] = 24  # viewer UI icons
    m = np.abs(a - 24).max(2) > 9
    m = nd.binary_opening(m, iterations=2)
    lab, n = nd.label(m)
    m = lab == (np.argmax(nd.sum(m, lab, range(1, n + 1))) + 1)
    m = nd.binary_fill_holes(nd.binary_closing(m, iterations=2))
    ys, xs = np.nonzero(m)
    print(v, 'x', xs.min(), xs.max(), 'y', ys.min(), ys.max())
    Image.fromarray((m * 255).astype(np.uint8)).save(f'{v}_mask.png')
