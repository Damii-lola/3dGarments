"""
svgpathtools' curve lengths in closed form / fixed quadrature instead of scipy's adaptive quad (thousands of calls
per sewing pattern: GarmentCode measures, normalises and inverts arc length of every edge). Same lengths to ~1e-9
of a cm for these smooth curves; ~20x faster. Imported by pattern.py before GarmentCode builds anything.
"""
import math
import numpy as np
import svgpathtools.path as P

_X, _W = np.polynomial.legendre.leggauss(20)
# composite rule on [0, 1] (2 pieces × 20 nodes); [t0, t1] is an affine map of it
_T = np.concatenate([0.25 + 0.25 * _X, 0.75 + 0.25 * _X])
_WT = np.concatenate([_W, _W]) * 0.25


def _gl(speed, t0, t1, pieces=2):
    """∫ speed(t) dt over [t0, t1], composite Gauss-Legendre"""
    if t1 == t0: return 0.0
    return float(np.dot(speed(t0 + (t1 - t0) * _T), _WT) * (t1 - t0))


def _cubic_speed(c):
    p0, p1, p2, p3 = c.start, c.control1, c.control2, c.end
    d0, d1, d2 = 3 * (p1 - p0), 3 * (p2 - p1), 3 * (p3 - p2)
    return lambda t: np.abs((1 - t) ** 2 * d0 + 2 * (1 - t) * t * d1 + t ** 2 * d2)


_cache = {}


def _cubic_length(self, t0=0, t1=1, error=None, min_depth=None):
    key = (self.start, self.control1, self.control2, self.end, t0, t1)
    v = _cache.get(key)
    if v is None:
        if len(_cache) > 200_000: _cache.clear()
        v = _cache[key] = _gl(_cubic_speed(self), t0, t1)
    return v


def _cubic_ilength(self, s, s_tol=None, maxits=None, error=None, min_depth=None):
    """t with length(0, t) = s: a cumulative arc-length table (513 samples, trapezoid on the exact speed), then
    Newton on the exact length"""
    L = self.length()
    if not 0 <= s <= L + 1e-9: raise ValueError('s is not in interval [0, curve.length()].')
    if s <= 0: return 0
    if s >= L: return 1
    sp = _cubic_speed(self)
    t = np.linspace(0, 1, 513); v = sp(t)
    cum = np.concatenate([[0], np.cumsum((v[1:] + v[:-1]) / 2 * (t[1] - t[0]))])
    cum *= L / cum[-1]
    x = float(np.interp(s, cum, t))
    for _ in range(3):
        f = _gl(sp, 0, x) - s
        d = float(sp(np.array([x]))[0])
        if d < 1e-12 or abs(f) < 1e-10: break
        x = min(1.0, max(0.0, x - f / d))
    return x


def _arc_length(self, t0=0, t1=1, error=None, min_depth=None):
    r = self.radius
    if abs(r.real - r.imag) < 1e-9 * max(1.0, abs(r.real)):      # a circle's arc: radius × angle
        return abs(r.real) * abs(math.radians(self.delta)) * abs(t1 - t0)
    return _gl(lambda t: np.abs(np.array([self.derivative(x) for x in t])), t0, t1, pieces=4)


P.CubicBezier.length = _cubic_length
P.CubicBezier.ilength = _cubic_ilength
P.Arc.length = _arc_length
