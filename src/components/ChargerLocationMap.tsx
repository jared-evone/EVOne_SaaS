import { useEffect, useRef, useState } from 'react';
import { C } from '../theme';
import { googleMapsDirections } from '../lib/navLinks';
import evoneLogo    from '../assets/evone-logo.png';
import eveLogo      from '../assets/eve-logo.png';
import goparkinLogo from '../assets/goparkin-logo.png';
import spLogo       from '../assets/sp-logo.png';

export type ChargerMapBrand    = 'evone' | 'eve' | null;
export type ChargerMapPlatform = 'goparkin' | 'sp' | null;

export interface ChargerMapLocation {
  id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  brand: ChargerMapBrand;
  csms_platform: ChargerMapPlatform;
}

// Pin colour priority: EVE CPO wins over platform, then SP, then default.
// EVE → red, SP (non-EVE) → blue, everything else → brand green.
const EVE_RED  = '#D14343';
const SP_BLUE  = '#1B8FD4';
function pinColorFor(loc: ChargerMapLocation): string {
  if (loc.brand === 'eve') return EVE_RED;
  if (loc.csms_platform === 'sp') return SP_BLUE;
  return C.green;
}

function pinSvg(color: string): string {
  return `
    <svg width="28" height="34" viewBox="0 0 28 34" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 2px 4px rgba(0,0,0,.28));">
      <path d="M14 0c-7.18 0-13 5.59-13 12.48 0 9.36 13 21.52 13 21.52s13-12.16 13-21.52C27 5.59 21.18 0 14 0z" fill="${color}"/>
      <circle cx="14" cy="12.5" r="4.5" fill="#fff"/>
    </svg>
  `;
}

const BRAND_LOGO_SRC: Record<'evone' | 'eve', string> = {
  evone: evoneLogo,
  eve:   eveLogo,
};
const PLATFORM_LOGO_SRC: Record<'goparkin' | 'sp', string> = {
  goparkin: goparkinLogo,
  sp:       spLogo,
};
// EVE logo is taller/squarer than EVOne — mirror the per-brand sizing the
// LocationCard uses (CPOChargers ChargerCard renders evone @ 18, eve @ 26).
const BRAND_LOGO_H: Record<'evone' | 'eve', number> = { evone: 16, eve: 22 };
const PLATFORM_LOGO_H = 22;

function popupHtml(l: ChargerMapLocation): string {
  const brandImg = l.brand
    ? `<img src="${BRAND_LOGO_SRC[l.brand]}" alt="${l.brand === 'eve' ? 'EVE' : 'EVOne'}" style="height:${BRAND_LOGO_H[l.brand]}px;width:auto;display:block" />`
    : '';
  const platformImg = l.csms_platform
    ? `<img src="${PLATFORM_LOGO_SRC[l.csms_platform]}" alt="${l.csms_platform === 'sp' ? 'SP' : 'GoParkin'}" style="height:${PLATFORM_LOGO_H}px;width:auto;display:block" />`
    : '';
  const logos = (brandImg || platformImg)
    ? `<div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0;margin-left:12px">${brandImg}${platformImg}</div>`
    : '';
  return `
    <div style="display:flex;align-items:flex-start;gap:8px;min-width:200px">
      <div style="flex:1;min-width:0">
        <div style="font-family:Figtree;font-weight:700;color:#1a1a1a;font-size:13px;line-height:1.3">${escapeHtml(l.name)}</div>
        ${l.address ? `<div style="font-family:Figtree;font-size:11px;color:#5B6B7A;margin-top:4px;line-height:1.45">${escapeHtml(l.address)}</div>` : ''}
        <a href="${googleMapsDirections({ address: l.address, lat: l.latitude, lng: l.longitude })}" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:4px;margin-top:8px;font-family:Figtree;font-size:11px;font-weight:700;color:${C.green};text-decoration:none">Directions &#8599;</a>
      </div>
      ${logos}
    </div>
  `;
}

interface Props {
  locations: ChargerMapLocation[];
  height?: number;
}

// Singapore-wide default view.
const SG_CENTER: [number, number] = [1.3521, 103.8198];
const SG_DEFAULT_ZOOM = 11;

// We load Leaflet from a CDN at runtime, so its types aren't installed —
// the surface we touch (map / tileLayer / marker / divIcon / fitBounds /
// setView / remove) is small enough to live behind `any` instead of pulling
// in @types/leaflet just to satisfy three lines of code.
type LeafletNS = any;

declare global {
  interface Window {
    L?: LeafletNS;
  }
}

let popupStylesInjected = false;
function injectPopupStyles() {
  if (popupStylesInjected) return;
  popupStylesInjected = true;
  const s = document.createElement('style');
  s.textContent = `
    .leaflet-popup-content-wrapper {
      border-radius: 12px;
      box-shadow: 0 6px 24px rgba(0,0,0,.14);
      font-family: 'Figtree', sans-serif;
      padding: 4px 6px;
    }
    .leaflet-popup-content { margin: 10px 14px; line-height: 1.4; }
    .leaflet-popup-tip { box-shadow: 0 4px 14px rgba(0,0,0,.10); }
    .leaflet-container a.leaflet-popup-close-button { color: ${C.slate}; padding: 6px 8px 0 0; }
  `;
  document.head.appendChild(s);
}

let leafletLoader: Promise<LeafletNS> | null = null;

function loadLeaflet(): Promise<LeafletNS> {
  if (window.L) return Promise.resolve(window.L);
  if (leafletLoader) return leafletLoader;
  leafletLoader = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    css.crossOrigin = '';
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    s.crossOrigin = '';
    s.onload = () => window.L ? resolve(window.L) : reject(new Error('Leaflet did not attach to window'));
    s.onerror = () => reject(new Error('Failed to load Leaflet from CDN'));
    document.head.appendChild(s);
  });
  return leafletLoader;
}

export function ChargerLocationMap({ locations, height = 320 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const state: { map: any } = { map: null };

    loadLeaflet().then((L) => {
      if (cancelled || !ref.current) return;
      injectPopupStyles();
      const map = L.map(ref.current, {
        scrollWheelZoom: false,
        attributionControl: true,
      }).setView(SG_CENTER, SG_DEFAULT_ZOOM);
      state.map = map;

      L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '© OpenStreetMap contributors © CARTO',
        subdomains: 'abcd',
        maxZoom: 19,
      }).addTo(map);

      // One divIcon per distinct colour so multiple markers can share the
      // same icon instance (Leaflet caches the rendered HTML per icon).
      const iconByColor = new Map<string, ReturnType<LeafletNS['divIcon']>>();
      const iconFor = (color: string) => {
        let icon = iconByColor.get(color);
        if (!icon) {
          icon = L.divIcon({
            html: pinSvg(color),
            className: '',
            iconSize: [28, 34],
            iconAnchor: [14, 34],
            popupAnchor: [0, -30],
          });
          iconByColor.set(color, icon);
        }
        return icon;
      };

      const latLngs: [number, number][] = [];
      locations.forEach((l) => {
        const ll: [number, number] = [l.latitude, l.longitude];
        latLngs.push(ll);
        L.marker(ll, { icon: iconFor(pinColorFor(l)) }).addTo(map).bindPopup(popupHtml(l), { minWidth: 240 });
      });
      if (latLngs.length > 1) {
        map.fitBounds(latLngs, { padding: [30, 30], maxZoom: 14 });
      } else if (latLngs.length === 1) {
        map.setView(latLngs[0], 14);
      }
    }).catch((e) => {
      if (!cancelled) setError(e?.message ?? 'Map failed to load');
    });

    return () => {
      cancelled = true;
      if (state.map) {
        state.map.remove();
        state.map = null;
      }
    };
  }, [locations]);

  if (error) {
    return (
      <div style={{ background: C.seasalt, borderRadius: 12, padding: 20, fontSize: 12, color: C.slate, textAlign: 'center', border: '1px solid #EBEBEB' }}>
        Map unavailable — {error}.
      </div>
    );
  }

  // Show legend rows only for the categories that actually appear on this map.
  const hasEve  = locations.some((l) => l.brand === 'eve');
  const hasSp   = locations.some((l) => l.brand !== 'eve' && l.csms_platform === 'sp');
  const hasDefault = locations.some((l) => l.brand !== 'eve' && l.csms_platform !== 'sp');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div
        ref={ref}
        style={{ height, width: '100%', borderRadius: 12, overflow: 'hidden', border: '1px solid #EBEBEB' }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: '#1a1a1a' }}>
        {hasDefault && <LegendRow color={C.green} label="EVOne x GoParkin"      detail="Price will be the agreed tariff below" />}
        {hasEve     && <LegendRow color={EVE_RED} label="EVOne x EVE (GoParkin)" detail="Charging at these locations will be priced at $0.75/kWh (pre GST)" />}
        {hasSp      && <LegendRow color={SP_BLUE} label="EVOne x SP Mobility"   detail="Price will be the agreed tariff below" />}
      </div>
    </div>
  );
}

function LegendRow({ color, label, detail }: { color: string; label: string; detail: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, lineHeight: 1.5 }}>
      <span style={{ width: 10, height: 10, borderRadius: 99, background: color, boxShadow: '0 1px 2px rgba(0,0,0,.18)', alignSelf: 'center', flexShrink: 0 }} />
      <span style={{ fontWeight: 700, color: '#1a1a1a' }}>{label}</span>
      <span style={{ color: C.slate }}>— {detail}</span>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
