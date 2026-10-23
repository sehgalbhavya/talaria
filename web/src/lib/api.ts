import { toast } from 'sonner';

async function request<T>(method: string, path: string, body?: unknown, opts: { quiet?: boolean } = {}): Promise<T> {
  const isForm = body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body && !isForm ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? (isForm ? (body as FormData) : JSON.stringify(body)) : undefined,
    });
  } catch {
    const msg = "Can't reach the Talaria server. Is it still running?";
    if (!opts.quiet) toast.error(msg);
    throw new Error(msg);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as any)?.error || `Request failed (${res.status})`;
    if (!opts.quiet) toast.error(msg);
    throw new Error(msg);
  }
  return data as T;
}

export const api = {
  get: <T,>(p: string, o?: { quiet?: boolean }) => request<T>('GET', p, undefined, o),
  post: <T,>(p: string, b?: unknown, o?: { quiet?: boolean }) => request<T>('POST', p, b ?? {}, o),
  put: <T,>(p: string, b?: unknown, o?: { quiet?: boolean }) => request<T>('PUT', p, b ?? {}, o),
  patch: <T,>(p: string, b?: unknown, o?: { quiet?: boolean }) => request<T>('PATCH', p, b ?? {}, o),
  del: <T,>(p: string, o?: { quiet?: boolean }) => request<T>('DELETE', p, undefined, o),
};
