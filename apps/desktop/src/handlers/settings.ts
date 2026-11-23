import { z } from 'zod';
import type { Store } from '../store';
import { defaultDailyCap } from './board';

function backendOrigin(value: string): string {
  if (!value.trim()) return '';
  const url = URL.parse(value.trim());
  const loopback = url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!url || (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:'))
    || url.username || url.password || url.pathname !== '/' || url.hash || url.search) {
    throw new Error('Enter an HTTPS backend origin, or a loopback HTTP origin for local testing.');
  }
  return url.origin;
}

const office = z.string().trim().min(3).max(120).regex(/^[\p{L}\p{M}\p{N} .(),&/-]+$/u);
export const settingsSchema = z.strictObject({
  backendUrl: z.string().max(2048).transform(backendOrigin),
  dailyCap: z.number().int().min(1).max(1000),
  issuer: office,
  prison: z.string().trim().max(160),
  district: z.string().trim().max(160),
});
export type DesktopSettings = z.output<typeof settingsSchema>;

export function readSettings(store: Store): DesktopSettings {
  return {
    backendUrl: store.readSetting('backendUrl') ?? '',
    dailyCap: Number(store.readSetting('dailyCap') ?? defaultDailyCap),
    issuer: store.readSetting('issuer') ?? 'CourtPlus Desktop',
    prison: store.readSetting('prison') ?? '',
    district: store.readSetting('district') ?? '',
  };
}

export function saveSettings(store: Store, input: unknown): DesktopSettings {
  const settings = settingsSchema.parse(input);
  store.writeSettings(Object.fromEntries(Object.entries(settings).map(([key, value]) => [key, String(value)])));
  return settings;
}
