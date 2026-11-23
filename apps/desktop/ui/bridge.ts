import type { CourtPlusApi } from '@courtplus/contracts';
import type { DesktopSettings } from '../src/handlers/settings';

export type { DesktopSettings };
export interface CloudStatus { role?: string; expires?: number; error: string }

interface ShellBridge {
  verifier: boolean;
  boardQueue(asOf: string): Promise<{ dailyCap: number; daysToClear: number; remaining: number }>;
  settings(): Promise<DesktopSettings & { cloud: CloudStatus }>;
  saveSettings(settings: DesktopSettings): Promise<DesktopSettings>;
  login(username: string, password: string): Promise<CloudStatus>;
  signOut(): Promise<void>;
  sync(): Promise<void>;
  exportSigner(): Promise<string>;
  trustSigner(): Promise<string>;
  exportHandoff(lang: 'en' | 'hi'): Promise<{ file: string; head: string } | undefined>;
  checkAnchor(anchor: string): Promise<{ chain: 'intact' | 'mismatch'; entries: number }>;
  onBoardChanged(callback: () => void): () => void;
}

declare global {
  interface Window { courtplusDesktop: ShellBridge; courtplus?: CourtPlusApi }
}

export const shell = window.courtplusDesktop;
export const api: CourtPlusApi = window.courtplus!;
