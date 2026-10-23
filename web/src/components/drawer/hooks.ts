import { useEffect, useState } from 'react';

export function useElapsed(sinceIso?: string, active = true) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  if (!sinceIso) return 0;
  return Math.max(0, Math.round((now - Date.parse(sinceIso)) / 1000));
}

export function useDebouncedSave<T>(value: T, save: (v: T) => void, delay = 700) {
  useEffect(() => {
    const t = setTimeout(() => save(value), delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
}
