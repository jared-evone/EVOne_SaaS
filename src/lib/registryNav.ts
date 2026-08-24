// Cross-screen deep link into the Charger Registry. The app has no router —
// screens are a useState in App.tsx — so the To Do page stashes its target
// here, switches the screen, and ScreenProjects consumes it on mount.

export interface RegistryTarget {
  projectId: string;
  siteId?: string;
  chargerId?: string;
  chargerTab?: 'details' | 'maintenance' | 'warranty' | 'breakdown';
}

let pending: RegistryTarget | null = null;

export function setRegistryTarget(t: RegistryTarget) { pending = t; }
export function takeRegistryTarget(): RegistryTarget | null {
  const t = pending;
  pending = null;
  return t;
}
