import { useEffect, useState } from 'react';

export type ThemePref = 'light' | 'dark' | 'system';

const listeners = new Set<() => void>();

export function getThemePref(): ThemePref {
  try {
    return (localStorage.getItem('talaria-theme') as ThemePref) || 'system';
  } catch {
    return 'system';
  }
}

function resolve(pref: ThemePref): 'light' | 'dark' {
  if (pref === 'system') return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return pref;
}

export function setThemePref(pref: ThemePref) {
  try {
    localStorage.setItem('talaria-theme', pref);
  } catch {}
  document.documentElement.classList.toggle('dark', resolve(pref) === 'dark');
  listeners.forEach(l => l());
}

export function useTheme(): 'light' | 'dark' {
  const [t, setT] = useState(() => resolve(getThemePref()));
  useEffect(() => {
    const update = () => {
      const r = resolve(getThemePref());
      document.documentElement.classList.toggle('dark', r === 'dark');
      setT(r);
    };
    listeners.add(update);
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', update);
    return () => {
      listeners.delete(update);
      mq.removeEventListener('change', update);
    };
  }, []);
  return t;
}
