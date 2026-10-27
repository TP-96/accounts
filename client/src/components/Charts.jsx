import { useEffect, useRef, useState } from 'react';
import { money } from '../lib/format.js';

/** Width of an element, kept up to date as the window resizes. */
function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Round an axis maximum up to a clean number (e.g. 1,370 -> 1,500). */
function niceMax(v) {
  if (v <= 0) return 100;
  const mag = 10 ** Math.floor(Math.log10(v));
  const n = v / mag;
  const step = n <= 1 ? 1 : n <= 1.5 ? 1.5 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 3 ? 3 : n <= 4 ? 4 : n <= 5 ? 5 : n <= 6 ? 6 : n <= 8 ? 8 : 10;
  return step * mag;
}

const compact = (cents) => {
  const d = cents / 100;
  if (d >= 1000) return `$${(d / 1000).toFixed(d >= 10000 ? 0 : 1).replace(/\.0$/, '')}K`;
  return `$${Math.round(d)}`;
};

/** Column with a 4px rounded top and a square base. */
function colPath(x, y, w, h, roundTop = true) {
  if (h <= 0) return '';
  const r = roundTop ? Math.min(4, h, w / 2) : 0;
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

const monthLabel = (ym, long = false) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-CA', long ? { month: 'long', year: 'numeric' } : { month: 'short' });
};

/**
 * Spending per month: each column is the house total, split into your share (bottom)
 * and everyone else's (top), separated by a 2px gap.
 */
export function MonthlyChart({ months, onPick }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const height = 240;
  const pad = { top: 12, right: 8, bottom: 28, left: 46 };
  const innerW = Math.max(0, width - pad.left - pad.right);
  const innerH = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(...months.map((m) => m.houseCents), 0));
  const band = months.length ? innerW / months.length : 0;
  const barW = Math.min(44, Math.max(6, band * 0.6));
  const y = (c) => pad.top + innerH - (c / max) * innerH;
  const ticks = [0, max / 2, max];
  const labelEvery = band < 34 ? Math.ceil(34 / band) : 1;

  return (
    <div className="chart" ref={ref} onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Spending per month, split into your share and everyone else's">
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid" x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} />
              <text className="tick" x={pad.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
                {compact(t)}
              </text>
            </g>
          ))}
          {months.map((m, i) => {
            const cx = pad.left + band * i + band / 2;
            const x = cx - barW / 2;
            const others = Math.max(0, m.houseCents - m.myShareCents);
            const hMine = (m.myShareCents / max) * innerH;
            const hOthers = (others / max) * innerH;
            const gap = hMine > 0 && hOthers > 0 ? 2 : 0;
            const baseY = pad.top + innerH;
            const active = hover === i;
            return (
              <g key={m.month} className={hover != null && !active ? 'dim' : ''}>
                <path className="seg-mine" d={colPath(x, baseY - hMine, barW, hMine, hOthers === 0)} />
                <path className="seg-others" d={colPath(x, baseY - hMine - gap - Math.max(0, hOthers - gap), barW, Math.max(0, hOthers - gap))} />
                {i % labelEvery === 0 && (
                  <text className="tick" x={cx} y={height - 8} textAnchor="middle">
                    {monthLabel(m.month)}
                  </text>
                )}
                <rect
                  className="hit"
                  x={pad.left + band * i}
                  y={pad.top}
                  width={band}
                  height={innerH}
                  onMouseEnter={() => setHover(i)}
                  onClick={() => (onPick ? onPick(m.month) : setHover(i))}
                  style={onPick ? { cursor: 'pointer' } : undefined}
                />
              </g>
            );
          })}
        </svg>
      )}
      {hover != null && months[hover] && (
        <div
          className="tooltip"
          style={{
            left: Math.min(Math.max(pad.left + band * hover + band / 2, 90), width - 90),
            top: Math.max(0, y(months[hover].houseCents) - 8),
          }}
        >
          <strong>{monthLabel(months[hover].month, true)}</strong>
          <span>
            <i className="key key-mine" /> Your share <b>{money(months[hover].myShareCents)}</b>
          </span>
          <span>
            <i className="key key-others" /> Everyone else <b>{money(months[hover].houseCents - months[hover].myShareCents)}</b>
          </span>
          <span className="tt-total">
            House total <b>{money(months[hover].houseCents)}</b>
          </span>
        </div>
      )}
    </div>
  );
}

/** Single-series horizontal bars with the value at the tip (used for categories). */
export function HBarChart({ rows }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="hbars">
      {rows.map((r) => (
        <div className="hbar" key={r.key} title={`${r.label}: ${money(r.value)}`}>
          <div className="hbar-label">
            <span>{r.label}</span>
            {r.sub && <small>{r.sub}</small>}
          </div>
          <div className="hbar-track">
            {/* leave 84px for the value so it never gets clipped at the tip */}
            <span className="hbar-fill" style={{ width: `max(4px, calc((100% - 84px) * ${(r.value / max).toFixed(4)}))` }} />
            <span className="hbar-value">{money(r.value)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export { monthLabel };
