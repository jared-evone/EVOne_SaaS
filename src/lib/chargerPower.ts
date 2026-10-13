export type ChargerCurrent = 'AC' | 'DC';
export interface ChargerPower { kw: number; current: ChargerCurrent }

// Size isn't its own field on a charger — it's read from the Brand & Model
// label ("Schneider 22kW AC", "Hiconics 120 kW DC"). The largest kW figure wins,
// since a 120 kW dual-gun unit's label may also mention 2 × 60 kW. AC/DC comes
// from the label when it says so; otherwise anything above 22 kW is DC.
export function parseChargerPower(label: string | null | undefined): ChargerPower | null {
  if (!label) return null;
  const kws = [...label.matchAll(/(\d+(?:[.,]\d+)?)\s*-?\s*kw/gi)]
    .map((m) => Number(m[1].replace(',', '.')))
    .filter((n) => n > 0 && n < 1000);
  if (kws.length === 0) return null;
  const kw = Math.max(...kws);
  const current: ChargerCurrent = /\bDC\b/i.test(label) ? 'DC' : /\bAC\b/i.test(label) ? 'AC' : kw > 22 ? 'DC' : 'AC';
  return { kw, current };
}

export const fmtKw = (kw: number) => `${Number.isInteger(kw) ? kw : kw.toFixed(1)} kW`;
