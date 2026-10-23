import * as React from 'react';
import { motion } from 'motion/react';
import { cn, hashHue, scoreTone } from '@/lib/utils';

/** Talaria mark: three swept feathers — Hermes's winged sandal. */
export function Logo({ className, animated }: { className?: string; animated?: boolean }) {
  const feathers = [
    'M5 22.5c4.6.2 9.4-1.2 13.6-4.6 2.6-2.2 4.6-4.9 6.1-8-1.7 5.4-4.8 9.7-9.1 12.5-3.2 2.1-6.8 2.8-10.6 2.3z',
    'M6.8 18.6c3.5-.3 7-1.9 9.8-4.4 1.8-1.5 3.2-3.4 4.3-5.5-1.2 3.7-3.4 6.7-6.3 8.6-2.3 1.5-4.9 2.2-7.8 2.1z',
    'M8.9 14.9c2.4-.5 4.7-1.7 6.6-3.5 1.1-1 2-2.2 2.6-3.5-.7 2.5-2.1 4.6-4 5.9-1.5 1.1-3.3 1.5-5.2 1.1z',
  ];
  const fills = ['var(--gold)', 'color-mix(in oklab, var(--gold) 65%, white)', 'color-mix(in oklab, var(--gold) 35%, white)'];
  return (
    <svg viewBox="0 0 30 30" className={cn('size-7', className)} aria-hidden>
      {feathers.map((d, i) =>
        animated ? (
          <motion.path key={i} d={d} fill={fills[i]} initial={{ opacity: 0, x: -6, y: 4 }} animate={{ opacity: 1, x: 0, y: 0 }} transition={{ delay: 0.15 + i * 0.12, type: 'spring', bounce: 0.35, duration: 0.8 }} />
        ) : (
          <path key={i} d={d} fill={fills[i]} />
        ),
      )}
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="grid size-8 place-items-center rounded-[10px] bg-[#17161c] shadow-[0_1px_0_rgb(255_255_255/0.1)_inset] dark:ring-1 dark:ring-white/10">
        <Logo className="size-6" />
      </div>
      <span className="font-display text-[18px] leading-none tracking-[-0.01em] text-ink">Talaria</span>
    </div>
  );
}

const failed = new Set<string>();

export function CompanyLogo({ company, logo, domain, size = 36, className }: { company: string; logo?: string; domain?: string; size?: number; className?: string }) {
  const src = logo || (domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128` : undefined);
  const [ok, setOk] = React.useState(Boolean(src) && !failed.has(src!));
  const hue = hashHue(company || '?');
  const initials =
    (company || '?')
      .replace(/\(.*?\)/g, '')
      .split(/[\s&.,-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(w => w[0])
      .join('')
      .toUpperCase() || '?';
  const radius = Math.round(size * 0.28);
  return (
    <div
      className={cn('relative shrink-0 overflow-hidden', className)}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: ok ? 'var(--card)' : `oklch(0.93 0.045 ${hue})`,
        boxShadow: '0 0 0 1px color-mix(in oklab, var(--ink) 8%, transparent)',
      }}
    >
      {!ok && (
        <span className="absolute inset-0 grid place-items-center font-semibold tracking-tight" style={{ color: `oklch(0.42 0.1 ${hue})`, fontSize: size * 0.36 }}>
          {initials}
        </span>
      )}
      {src && ok && (
        <img
          src={src}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="absolute inset-0 size-full object-contain p-[12%]"
          onLoad={e => {
            const img = e.currentTarget;
            if (img.naturalWidth < 24) {
              failed.add(src);
              setOk(false);
            }
          }}
          onError={() => {
            failed.add(src);
            setOk(false);
          }}
        />
      )}
    </div>
  );
}

export function ScoreRing({ score, size = 40, stroke = 3.5, className, label = true }: { score?: number; size?: number; stroke?: number; className?: string; label?: boolean }) {
  const tone = scoreTone(score);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  return (
    <div className={cn('relative shrink-0', className)} style={{ width: size, height: size }} title={score == null ? 'Not scored yet' : `${tone.label} · ${score}/100`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line-2)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={tone.fg}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - pct) }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      {label && (
        <span className="absolute inset-0 grid place-items-center font-semibold tabular-nums" style={{ color: score == null ? 'var(--faint)' : 'var(--ink)', fontSize: size * 0.32 }}>
          {score == null ? '–' : score}
        </span>
      )}
    </div>
  );
}

export function StatusDot({ color, pulse, className }: { color: string; pulse?: boolean; className?: string }) {
  return (
    <span className={cn('relative inline-flex size-2', className)}>
      {pulse && <span className="absolute inset-0 animate-ping rounded-full opacity-60" style={{ background: color }} />}
      <span className="relative inline-flex size-2 rounded-full" style={{ background: color }} />
    </span>
  );
}
