// Deep-links to hand a destination off to the technician's Google Maps app for
// turn-by-turn navigation. We don't run our own routing/map API — Google Maps covers
// both Singapore and Malaysia and is what drivers already use. A unit/shoplot can't be
// pinned (no GPS coordinate exists for a unit), so it's appended as text for context and
// shown separately in the UI; coordinates are used when available for a precise building pin.

interface NavTarget {
  address?: string | null;
  unit?: string | null;
  lat?: number | null;
  lng?: number | null;
}

// Build a Google Maps directions URL (from the user's current location to the destination).
// Opens the Google Maps app on Android/iOS and the web app on desktop.
export function googleMapsDirections({ address, unit, lat, lng }: NavTarget): string {
  const base = 'https://www.google.com/maps/dir/?api=1&destination=';
  if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
    return base + encodeURIComponent(`${lat},${lng}`);
  }
  const addr = (address ?? '').trim();
  const u = (unit ?? '').trim();
  const dest = u && !addr.includes(u) ? `${addr}${addr ? ', ' : ''}${u}` : addr;
  return base + encodeURIComponent(dest);
}

// True when there's enough to navigate to (coords or a non-trivial address).
export function hasNavTarget({ address, lat, lng }: NavTarget): boolean {
  if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) return true;
  return (address ?? '').trim().length > 2;
}
