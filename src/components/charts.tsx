import { useLayoutEffect, useRef, useState } from 'react';
import { C } from '../theme';

export interface LineChartTooltip { title: string; value: string; value2?: string }

// ── Sparkline ─────────────────────────────────────────────────────
export function Sparkline({
  data,
  color = C.green,
  height = 40,
}: { data: number[]; color?: string; height?: number }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 120;
  const h = height;
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 4) - 2;
      return `${x},${y}`;
    })
    .join(' ');
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

// ── Mini bar chart ────────────────────────────────────────────────
export function MiniBar({ data, color = C.green }: { data: number[]; color?: string }) {
  const max = Math.max(...data);
  return (
    <svg width="120" height="40" style={{ display: 'block' }}>
      {data.map((v, i) => {
        const bh = (v / max) * 36;
        return (
          <rect
            key={i}
            x={i * 14}
            y={40 - bh}
            width="10"
            height={bh}
            rx="2"
            fill={color}
            opacity={0.7 + 0.3 * (i / data.length)}
          />
        );
      })}
    </svg>
  );
}

// ── Donut chart ───────────────────────────────────────────────────
export interface DonutSegment {
  value: number;
  color: string;
}
export function Donut({ segments }: { segments: DonutSegment[] }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  let cumulative = 0;
  const r = 38;
  const cx = 45;
  const cy = 45;
  const strokeW = 12;
  const circumference = 2 * Math.PI * r;
  return (
    <svg width="90" height="90">
      {segments.map((seg, i) => {
        const pct = seg.value / total;
        const rotation = -90 + cumulative * 360;
        cumulative += pct;
        return (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={seg.color}
            strokeWidth={strokeW}
            strokeDasharray={`${circumference * pct} ${circumference * (1 - pct)}`}
            strokeDashoffset={0}
            transform={`rotate(${rotation} ${cx} ${cy})`}
            style={{ transition: 'stroke-dasharray .4s' }}
          />
        );
      })}
      <text
        x={cx}
        y={cy + 6}
        textAnchor="middle"
        fontSize="13"
        fontWeight="700"
        fontFamily="Figtree"
        fill={C.green}
      >
        {total}
      </text>
    </svg>
  );
}

// ── Line chart ────────────────────────────────────────────────────
export function LineChart({
  data,
  labels,
  color = C.green,
  height = 160,
  formatY,
  tooltips,
  data2,
  color2 = C.opal,
  formatY2,
}: { data: number[]; labels: string[]; color?: string; height?: number; formatY?: (v: number) => string; tooltips?: (LineChartTooltip | undefined)[];
  // Optional second series drawn against a RIGHT y-axis (e.g. energy kWh over sessions).
  data2?: number[]; color2?: string; formatY2?: (v: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  // Measure the container so the SVG renders 1:1 (viewBox width == pixel width).
  // A fixed viewBox stretched via preserveAspectRatio="none" warps dots/strokes
  // on wide cards; matching the width keeps circles round and strokes even.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState(520);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setMeasured(el.clientWidth || 520);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const hasSecond = !!data2 && data2.length === data.length;
  const rawMax = Math.max(...data) * 1.1;
  const max = rawMax > 0 ? rawMax : 1;
  // Give the secondary series extra headroom so its peak only reaches ~55% of the height
  // and it sits clearly BELOW the primary line (both share a 0 baseline). The right-axis
  // labels use this same max, so they stay correct — a point at height f reads max2·f.
  const rawMax2 = hasSecond ? Math.max(...data2!) / 0.55 : 0;
  const max2 = rawMax2 > 0 ? rawMax2 : 1;
  const W = Math.max(320, measured);
  const H = height;
  const LM = 48;                    // left-axis margin
  const RM = hasSecond ? 46 : 12;   // right-axis margin (room for the second axis labels)
  const denom = data.length > 1 ? data.length - 1 : 1;
  // With many points (e.g. daily series) per-point dots collapse into a blob — show line only.
  const showDots = data.length <= 60;
  const xAt = (i: number) => LM + (i / denom) * (W - LM - RM);
  const yAt = (v: number, m: number) => H - 24 - (v / m) * (H - 48);
  const pts = data.map((v, i) => ({ x: xAt(i), y: yAt(v, max), v }));
  const pts2 = hasSecond ? data2!.map((v, i) => ({ x: xAt(i), y: yAt(v, max2), v })) : [];
  const poly = pts.map((p) => `${p.x},${p.y}`).join(' ');
  const poly2 = pts2.map((p) => `${p.x},${p.y}`).join(' ');
  const area =
    `M ${pts[0].x},${H - 24} ` +
    pts.map((p) => `L ${p.x},${p.y}`).join(' ') +
    ` L ${pts[pts.length - 1].x},${H - 24} Z`;
  const gridLines = [0.25, 0.5, 0.75, 1].map((f) => H - 24 - f * (H - 48));
  const hovered = hover != null ? tooltips?.[hover] : undefined;
  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
      {gridLines.map((gy, i) => (
        <line key={i} x1={LM} x2={W - RM} y1={gy} y2={gy} stroke="#E4F3E3" strokeWidth="1" />
      ))}
      <defs>
        <linearGradient id="areafill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.13" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#areafill)" />
      {hasSecond && (
        <polyline points={poly2} fill="none" stroke={color2} strokeWidth="2.5" strokeLinejoin="round" />
      )}
      <polyline points={poly} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" />
      {showDots && hasSecond && pts2.map((p, i) => (
        <circle key={`d2-${i}`} cx={p.x} cy={p.y} r="3.5" fill="white" stroke={color2} strokeWidth="2" />
      ))}
      {showDots && pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="4" fill="white" stroke={color} strokeWidth="2" />
      ))}
      {labels.map((l, i) => {
        if (!l) return null;
        return (
          <text key={i} x={xAt(i)} y={H - 6} textAnchor="middle" fontSize="10" fontFamily="Figtree" fill={C.slate}>
            {l}
          </text>
        );
      })}
      {[0.25, 0.5, 0.75, 1].map((f, i) => (
        <text key={i} x={LM - 6} y={H - 24 - f * (H - 48) + 4} textAnchor="end" fontSize="10" fontFamily="Figtree" fill={C.slate}>
          {formatY ? formatY(max * f) : `${Math.round((max * f) / 1000)}k`}
        </text>
      ))}
      {hasSecond && [0.25, 0.5, 0.75, 1].map((f, i) => (
        <text key={`r-${i}`} x={W - RM + 6} y={H - 24 - f * (H - 48) + 4} textAnchor="start" fontSize="10" fontFamily="Figtree" fill={color2}>
          {formatY2 ? formatY2(max2 * f) : `${Math.round((max2 * f) / 1000)}k`}
        </text>
      ))}
      {/* Highlighted markers for the hovered point (both series) */}
      {hover != null && hasSecond && pts2[hover] && (
        <circle cx={pts2[hover].x} cy={pts2[hover].y} r="5" fill={color2} stroke="white" strokeWidth="2.5" />
      )}
      {hover != null && pts[hover] && (
        <circle cx={pts[hover].x} cy={pts[hover].y} r="5.5" fill={color} stroke="white" strokeWidth="2.5" />
      )}
      {/* Transparent per-point hover zones. Rendered last so they sit on top; full
          chart width so hovering anywhere near a point surfaces it (works even when
          visible dots are hidden). */}
      {tooltips && pts.map((p, i) => {
        if (!tooltips[i]) return null;
        const x0 = i === 0 ? 0 : (pts[i - 1].x + p.x) / 2;
        const x1 = i === pts.length - 1 ? W : (p.x + pts[i + 1].x) / 2;
        return (
          <rect key={`hit-${i}`} x={x0} y={0} width={Math.max(0, x1 - x0)} height={H} fill="transparent"
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover((h) => (h === i ? null : h))} />
        );
      })}
    </svg>
    {hovered && hover != null && (
      <div style={{
        position: 'absolute',
        left: `${(pts[hover].x / W) * 100}%`,
        top: pts[hover].y,
        transform: 'translate(-50%, calc(-100% - 14px))',
        pointerEvents: 'none',
        zIndex: 30,
        background: C.white,
        border: '1px solid #EBEBEB',
        borderRadius: 12,
        padding: '10px 16px',
        boxShadow: '0 10px 28px rgba(0,0,0,.14)',
        whiteSpace: 'nowrap',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.slate, marginBottom: 4 }}>{hovered.title}</div>
        <div style={{ fontSize: 17, fontWeight: 700, color, letterSpacing: '-0.02em', lineHeight: 1 }}>{hovered.value}</div>
        {hovered.value2 && (
          <div style={{ fontSize: 14, fontWeight: 700, color: color2, marginTop: 4, lineHeight: 1 }}>{hovered.value2}</div>
        )}
      </div>
    )}
    </div>
  );
}

// ── Grouped bar chart ─────────────────────────────────────────────
export function BarChart({
  data,
  labels,
  colors = [C.green, C.opal],
  height = 160,
}: {
  data: number[][];
  labels: string[];
  colors?: string[];
  height?: number;
}) {
  // Measure the container so the SVG renders 1:1 (viewBox width == pixel width).
  // A fixed viewBox stretched via preserveAspectRatio="none" balloons the bars
  // horizontally on wide cards; matching the width keeps bar widths constant.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState(520);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setMeasured(el.clientWidth || 520);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const allVals = data.flat();
  const max = Math.max(...allVals) * 1.1 || 1;
  const W = Math.max(320, measured);
  const H = height;
  const barW = 16;
  const gap = 4;
  const groupW = data[0].length * (barW + gap);
  const groupGap = (W - 60 - groupW * labels.length) / (labels.length + 1);
  return (
    <div ref={wrapRef} style={{ width: '100%' }}>
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
      {[0.25, 0.5, 0.75, 1].map((f, i) => {
        const gy = H - 24 - f * (H - 48);
        return <line key={i} x1="48" x2={W - 12} y1={gy} y2={gy} stroke="#E4F3E3" strokeWidth="1" />;
      })}
      {labels.map((l, gi) => {
        const gx = 48 + groupGap + gi * (groupW + groupGap);
        return (
          <g key={gi}>
            {data[gi].map((v, bi) => {
              const bh = (v / max) * (H - 48);
              const bx = gx + bi * (barW + gap);
              const by = H - 24 - bh;
              return (
                <rect
                  key={bi}
                  x={bx}
                  y={by}
                  width={barW}
                  height={bh}
                  rx="3"
                  fill={colors[bi % colors.length]}
                />
              );
            })}
            <text
              x={gx + groupW / 2 - barW / 2}
              y={H - 6}
              textAnchor="middle"
              fontSize="10"
              fontFamily="Figtree"
              fill={C.slate}
            >
              {l}
            </text>
          </g>
        );
      })}
      {[0.25, 0.5, 0.75, 1].map((f, i) => (
        <text
          key={i}
          x="42"
          y={H - 24 - f * (H - 48) + 4}
          textAnchor="end"
          fontSize="10"
          fontFamily="Figtree"
          fill={C.slate}
        >
          {Math.round(max * f)}
        </text>
      ))}
    </svg>
    </div>
  );
}
