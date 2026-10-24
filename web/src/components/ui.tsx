import * as React from 'react';
import * as RDialog from '@radix-ui/react-dialog';
import * as RTooltip from '@radix-ui/react-tooltip';
import * as RSwitch from '@radix-ui/react-switch';
import * as RMenu from '@radix-ui/react-dropdown-menu';
import { Check, Copy, Loader2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { cn, copyText } from '@/lib/utils';
import { toast } from 'sonner';

// ---------------- Button ----------------

type Variant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger' | 'gold';
type Size = 'xs' | 'sm' | 'md' | 'lg';

const variants: Record<Variant, string> = {
  primary: 'bg-ink text-bg hover:bg-ink/88 shadow-[0_1px_0_rgb(255_255_255/0.12)_inset,0_1px_2px_rgb(0_0_0/0.18)] dark:bg-ink dark:text-bg',
  secondary: 'bg-card text-ink shadow-card hover:bg-panel',
  outline: 'border border-line text-ink hover:bg-card hover:border-line',
  ghost: 'text-ink-2 hover:bg-ink/[0.05] hover:text-ink dark:hover:bg-white/[0.06]',
  danger: 'bg-bad text-white hover:bg-bad/90',
  gold: 'bg-gold text-white hover:bg-gold/90 dark:text-[#1a1408] shadow-[0_1px_0_rgb(255_255_255/0.2)_inset]',
};
const sizes: Record<Size, string> = {
  xs: 'h-7 px-2.5 text-[12px] gap-1.5 rounded-md',
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-9 px-3.5 text-[13.5px] gap-2 rounded-lg',
  lg: 'h-11 px-5 text-[14.5px] gap-2 rounded-xl',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-[background,box-shadow,color,transform] duration-150 select-none active:translate-y-px disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-[1.1em] animate-spin" /> : icon}
      {children}
    </button>
  );
});

export const IconButton = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; size?: 'sm' | 'md' }>(function IconButton(
  { label, className, size = 'md', children, ...rest },
  ref,
) {
  return (
    <Tooltip content={label}>
      <button
        ref={ref}
        aria-label={label}
        className={cn(
          'inline-flex items-center justify-center rounded-lg text-muted transition-colors hover:bg-ink/[0.06] hover:text-ink dark:hover:bg-white/[0.07]',
          size === 'sm' ? 'size-7' : 'size-8',
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    </Tooltip>
  );
});

// ---------------- Tooltip ----------------

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return (
    <RTooltip.Provider delayDuration={250} skipDelayDuration={100}>
      {children}
    </RTooltip.Provider>
  );
}

export function Tooltip({ content, children, side = 'top' }: { content: React.ReactNode; children: React.ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  if (!content) return <>{children}</>;
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content
          side={side}
          sideOffset={6}
          className="z-[100] max-w-xs rounded-md bg-ink px-2 py-1 text-[12px] leading-snug font-medium text-bg shadow-lg data-[state=delayed-open]:animate-in"
        >
          {content}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

// ---------------- Inputs ----------------

export const inputCls =
  'w-full rounded-lg border border-line bg-card px-3 text-[13.5px] text-ink placeholder:text-faint shadow-[0_1px_1px_rgb(0_0_0/0.02)] transition-[border,box-shadow] outline-none focus:border-accent/60 focus:ring-[3px] focus:ring-accent/15';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(inputCls, 'h-9', className)} {...rest} />;
});

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(inputCls, 'min-h-[84px] py-2 leading-relaxed', className)} {...rest} />;
});

export function Field({ label, hint, children, className }: { label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  // Not a wrapping <label>: a label forwards clicks to its first labelable descendant,
  // which for chip inputs is a pill's remove button. Associate by id instead.
  const autoId = React.useId();
  let id: string | undefined;
  let control = children;
  if (React.isValidElement<{ id?: string }>(children) && (children.type === Input || children.type === Textarea || children.type === 'input' || children.type === 'textarea' || children.type === 'select')) {
    id = children.props.id ?? autoId;
    control = children.props.id ? children : React.cloneElement(children, { id });
  }
  return (
    <div className={cn('block', className)}>
      <label htmlFor={id} className="mb-1.5 block text-[12.5px] font-medium text-ink-2">{label}</label>
      {control}
      {hint && <span className="mt-1.5 block text-[12px] text-muted">{hint}</span>}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <RSwitch.Root
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
      aria-label={label}
      className="relative inline-flex h-[22px] w-[38px] shrink-0 cursor-pointer items-center rounded-full bg-line transition-colors data-[state=checked]:bg-accent disabled:opacity-50"
    >
      <RSwitch.Thumb className="block size-[18px] translate-x-[2px] rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.25)] transition-transform duration-200 data-[state=checked]:translate-x-[18px]" />
    </RSwitch.Root>
  );
}

export function Segmented<T extends string>({ value, onChange, options, size = 'md', className }: { value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode }[]; size?: 'sm' | 'md'; className?: string }) {
  const id = React.useId();
  return (
    <div className={cn('inline-flex rounded-lg bg-ink/[0.05] p-0.5 dark:bg-white/[0.06]', className)}>
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'relative rounded-md font-medium whitespace-nowrap transition-colors',
            size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-8 px-3 text-[13px]',
            value === o.value ? 'text-ink' : 'text-muted hover:text-ink-2',
          )}
        >
          {value === o.value && <motion.span layoutId={`seg-${id}`} className="absolute inset-0 rounded-md bg-card shadow-card" transition={{ type: 'spring', bounce: 0.15, duration: 0.35 }} />}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function ChipInput({ value, onChange, placeholder, suggestions = [] }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; suggestions?: string[] }) {
  const [draft, setDraft] = React.useState('');
  const add = (raw: string) => {
    const items = raw
      .split(/[,\n]/)
      .map(s => s.trim())
      .filter(Boolean)
      .filter(s => !value.some(v => v.toLowerCase() === s.toLowerCase()));
    if (items.length) onChange([...value, ...items]);
    setDraft('');
  };
  const sugg = suggestions.filter(s => !value.some(v => v.toLowerCase() === s.toLowerCase())).slice(0, 8);
  return (
    <div>
      <div className={cn(inputCls, 'flex min-h-9 flex-wrap items-center gap-1.5 px-1.5 py-1.5 focus-within:border-accent/60 focus-within:ring-[3px] focus-within:ring-accent/15')}>
        {value.map(v => (
          <span key={v} className="inline-flex h-6 items-center gap-1 rounded-md bg-ink/[0.06] pr-1 pl-2 text-[12.5px] font-medium text-ink-2 dark:bg-white/[0.08]">
            {v}
            <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter(x => x !== v))} className="rounded p-0.5 text-faint hover:bg-ink/10 hover:text-ink">
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if ((e.key === 'Enter' || e.key === ',') && draft.trim()) {
              e.preventDefault();
              add(draft);
            } else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={() => draft.trim() && add(draft)}
          placeholder={value.length ? '' : placeholder}
          className="h-6 min-w-[120px] flex-1 bg-transparent px-1.5 text-[13.5px] outline-none placeholder:text-faint"
        />
      </div>
      {sugg.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {sugg.map(s => (
            <button key={s} type="button" onClick={() => onChange([...value, s])} className="h-6 rounded-md border border-dashed border-line px-2 text-[12px] text-muted transition-colors hover:border-accent/50 hover:text-accent">
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------- Display ----------------

export function Badge({ children, tone = 'neutral', className, dot }: { children: React.ReactNode; tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'bad' | 'gold' | 'info'; className?: string; dot?: boolean }) {
  const tones = {
    neutral: 'bg-ink/[0.05] text-ink-2 dark:bg-white/[0.07]',
    accent: 'bg-accent-soft text-accent',
    ok: 'bg-ok-soft text-ok',
    warn: 'bg-warn-soft text-warn',
    bad: 'bg-bad-soft text-bad',
    gold: 'bg-gold-soft text-gold',
    info: 'bg-info-soft text-info',
  };
  return (
    <span className={cn('inline-flex h-[22px] items-center gap-1 rounded-md px-1.5 text-[11.5px] font-medium whitespace-nowrap', tones[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-card px-1 font-sans text-[11px] font-medium text-muted shadow-[0_1px_0_var(--line)]">{children}</kbd>;
}

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-2xl bg-card shadow-card', className)} {...rest}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, action, className }: { children: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('mb-3 flex items-center justify-between gap-3', className)}>
      <h3 className="text-[12px] font-semibold tracking-[0.08em] text-muted uppercase">{children}</h3>
      {action}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-4 animate-spin text-muted', className)} />;
}

export function CopyButton({ text, label = 'Copy', className, size = 'xs' }: { text: string; label?: string; className?: string; size?: Size }) {
  const [done, setDone] = React.useState(false);
  return (
    <Button
      size={size}
      variant="outline"
      className={className}
      icon={done ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
      onClick={async e => {
        e.stopPropagation();
        if (await copyText(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } else toast.error('Copy failed');
      }}
    >
      {done ? 'Copied' : label}
    </Button>
  );
}

export function EmptyState({ icon, title, children, action, className }: { icon?: React.ReactNode; title: React.ReactNode; children?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-10 text-center', className)}>
      {icon && <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-card text-muted shadow-card">{icon}</div>}
      <div className="font-display text-[18px] leading-tight text-ink">{title}</div>
      {children && <div className="mt-2 max-w-sm text-[13.5px] leading-relaxed text-muted">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// ---------------- Dialog & Sheet ----------------

export function Dialog({ open, onOpenChange, children, className, title, description }: { open: boolean; onOpenChange: (v: boolean) => void; children: React.ReactNode; className?: string; title?: React.ReactNode; description?: React.ReactNode }) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <RDialog.Portal forceMount>
            <RDialog.Overlay asChild>
              <motion.div className="fixed inset-0 z-50 bg-[#0b0b10]/40 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} />
            </RDialog.Overlay>
            <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4">
              <RDialog.Content asChild aria-describedby={undefined}>
                <motion.div
                  className={cn('relative w-full max-w-lg rounded-2xl bg-raised p-6 shadow-pop outline-none', className)}
                  initial={{ opacity: 0, y: 12, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.98 }}
                  transition={{ type: 'spring', bounce: 0.12, duration: 0.35 }}
                >
                  {title ? <RDialog.Title className="pr-8 font-display text-[20px] leading-tight text-ink">{title}</RDialog.Title> : <RDialog.Title className="sr-only">Dialog</RDialog.Title>}
                  {description && <RDialog.Description className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{description}</RDialog.Description>}
                  <RDialog.Close asChild>
                    <button aria-label="Close" className="absolute top-4 right-4 rounded-lg p-1.5 text-faint transition-colors hover:bg-ink/5 hover:text-ink">
                      <X className="size-4" />
                    </button>
                  </RDialog.Close>
                  {children}
                </motion.div>
              </RDialog.Content>
            </div>
          </RDialog.Portal>
        )}
      </AnimatePresence>
    </RDialog.Root>
  );
}

export function Sheet({ open, onOpenChange, children, className, label }: { open: boolean; onOpenChange: (v: boolean) => void; children: React.ReactNode; className?: string; label: string }) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <RDialog.Portal forceMount>
            <RDialog.Overlay asChild>
              <motion.div className="fixed inset-0 z-40 bg-[#0b0b10]/25 dark:bg-black/50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} />
            </RDialog.Overlay>
            <RDialog.Content asChild aria-describedby={undefined}>
              <motion.div
                className={cn('fixed top-2 right-2 bottom-2 z-40 flex w-[min(780px,calc(100vw-16px))] flex-col overflow-hidden rounded-2xl bg-bg shadow-pop outline-none', className)}
                initial={{ x: 40, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: 40, opacity: 0 }}
                transition={{ type: 'spring', bounce: 0.08, duration: 0.42 }}
              >
                <RDialog.Title className="sr-only">{label}</RDialog.Title>
                {children}
              </motion.div>
            </RDialog.Content>
          </RDialog.Portal>
        )}
      </AnimatePresence>
    </RDialog.Root>
  );
}

// ---------------- Menu ----------------

export const Menu = RMenu.Root;
export const MenuTrigger = RMenu.Trigger;

export function MenuContent({ children, align = 'end' }: { children: React.ReactNode; align?: 'start' | 'end' | 'center' }) {
  return (
    <RMenu.Portal>
      <RMenu.Content align={align} sideOffset={6} className="z-[60] min-w-[200px] rounded-xl bg-raised p-1 shadow-pop">
        {children}
      </RMenu.Content>
    </RMenu.Portal>
  );
}

export function MenuItem({ children, onSelect, icon, danger, disabled }: { children: React.ReactNode; onSelect?: () => void; icon?: React.ReactNode; danger?: boolean; disabled?: boolean }) {
  return (
    <RMenu.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        'flex h-8 cursor-default items-center gap-2.5 rounded-lg px-2.5 text-[13px] outline-none select-none data-[disabled]:opacity-40 data-[highlighted]:bg-ink/[0.05] dark:data-[highlighted]:bg-white/[0.07]',
        danger ? 'text-bad' : 'text-ink-2 data-[highlighted]:text-ink',
      )}
    >
      {icon && <span className="text-muted [&>svg]:size-4">{icon}</span>}
      {children}
    </RMenu.Item>
  );
}

export const MenuSeparator = () => <RMenu.Separator className="mx-1 my-1 h-px bg-line" />;
