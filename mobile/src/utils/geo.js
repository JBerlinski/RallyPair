// Pure geometry helpers. Points are [lat, lng] pairs, distances in metres,
// bearings in degrees clockwise from north.

const R = 6371000;
const RAD = Math.PI / 180;

export function haversine(a, b) {
  const f1 = a[0] * RAD;
  const f2 = b[0] * RAD;
  const df = (b[0] - a[0]) * RAD;
  const dl = (b[1] - a[1]) * RAD;
  const h = Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function bearing(a, b) {
  const dx = (b[1] - a[1]) * Math.cos(((a[0] + b[0]) / 2) * RAD);
  const dy = b[0] - a[0];
  return (Math.atan2(dx, dy) / RAD + 360) % 360;
}

// Signed smallest rotation from bearing a to bearing b, in (-180, 180]. Positive = clockwise.
export function angDiff(a, b) {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

// Cumulative distance along the polyline; cum[i] is the distance from the start to coords[i].
export function cumulative(coords) {
  const cum = new Array(coords.length);
  cum[0] = 0;
  for (let i = 1; i < coords.length; i++) cum[i] = cum[i - 1] + haversine(coords[i - 1], coords[i]);
  return cum;
}

// Index of the segment containing distance d (segment i spans cum[i]..cum[i+1]).
export function segmentAt(cum, d) {
  let lo = 0;
  let hi = cum.length - 2;
  if (hi < 0) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cum[mid] <= d) lo = mid; else hi = mid - 1;
  }
  return lo;
}

export function pointAt(coords, cum, d) {
  const total = cum[cum.length - 1];
  if (d <= 0) return coords[0];
  if (d >= total) return coords[coords.length - 1];
  const i = segmentAt(cum, d);
  const len = cum[i + 1] - cum[i];
  const t = len > 0 ? (d - cum[i]) / len : 0;
  const a = coords[i];
  const b = coords[i + 1];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

// Direction of travel at distance d, measured over a short chord so vertex noise is ignored.
export function bearingAt(coords, cum, d, span = 12) {
  const total = cum[cum.length - 1];
  const a = pointAt(coords, cum, Math.max(0, d - span / 2));
  const b = pointAt(coords, cum, Math.min(total, d + span / 2));
  return bearing(a, b);
}

// The part of the polyline between distances d0 and d1.
export function sliceRoute(coords, cum, d0, d1) {
  const total = cum[cum.length - 1];
  const from = Math.max(0, Math.min(d0, total));
  const to = Math.max(from, Math.min(d1, total));
  const out = [pointAt(coords, cum, from)];
  const i1 = segmentAt(cum, to);
  for (let i = segmentAt(cum, from) + 1; i <= i1; i++) out.push(coords[i]);
  out.push(pointAt(coords, cum, to));
  return out;
}

// Projects point p onto the route. Returns { d, off } — distance along the route and
// lateral offset. `hint` (previous d) keeps the match moving forward on routes that
// cross or double back on themselves.
export function snapToRoute(coords, cum, p, hint) {
  const n = coords.length;
  if (n < 2) return { d: 0, off: n ? haversine(coords[0], p) : Infinity };
  const kx = Math.cos(p[0] * RAD) * RAD * R;
  const ky = RAD * R;

  const search = (i0, i1) => {
    let best = { d: 0, off: Infinity };
    for (let i = i0; i < i1; i++) {
      const ax = (coords[i][1] - p[1]) * kx;
      const ay = (coords[i][0] - p[0]) * ky;
      const bx = (coords[i + 1][1] - p[1]) * kx;
      const by = (coords[i + 1][0] - p[0]) * ky;
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      let t = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const off = Math.hypot(ax + dx * t, ay + dy * t);
      if (off < best.off) best = { d: cum[i] + (cum[i + 1] - cum[i]) * t, off };
    }
    return best;
  };

  if (hint != null) {
    const i0 = segmentAt(cum, Math.max(0, hint - 80));
    const i1 = Math.min(n - 1, segmentAt(cum, hint + 600) + 1);
    const local = search(i0, i1);
    if (local.off <= 45) return local;
  }
  return search(0, n - 1);
}

export function fmtDistance(m) {
  if (m == null || !Number.isFinite(m)) return '';
  if (m >= 950) return `${(m / 1000).toFixed(m >= 9950 ? 0 : 1)} km`;
  return `${Math.max(0, Math.round(m / 10) * 10)} m`;
}
