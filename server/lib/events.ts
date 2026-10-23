import type { Response } from 'express';
import type { ServerEvent } from '../../shared/types.ts';

const clients = new Set<Response>();

export function addClient(res: Response) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  res.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
}

export function emit(event: ServerEvent) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) res.write(payload);
}

export function toast(level: 'info' | 'success' | 'error', text: string) {
  emit({ type: 'toast', level, text });
}
