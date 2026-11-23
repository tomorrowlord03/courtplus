import type { CourtPlusApi } from '@courtplus/contracts' with { 'resolution-mode': 'import' };
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { createHandlers } from './handlers';
import { argumentSchemas, validateArguments } from './validation';

type AppMethods = Awaited<ReturnType<typeof createHandlers>>['handlers'];
type Trust = (event: IpcMainInvokeEvent, method: string) => boolean;
type Methods = { [K in keyof CourtPlusApi]: (...args: Parameters<CourtPlusApi[K]>) => ReturnType<CourtPlusApi[K]> };
const schemas: { [K in keyof CourtPlusApi]: import('zod').ZodType<Parameters<CourtPlusApi[K]>> } = argumentSchemas;

export function registerHandlers(handlers: AppMethods, isTrusted: Trust): void {
  const methods: Methods = handlers;
  function register<K extends keyof CourtPlusApi>(method: K) {
    ipcMain.handle('courtplus:' + method, async (event, ...args: unknown[]) => {
      if (!isTrusted(event, method)) throw new Error('FORBIDDEN');
      return methods[method](...validateArguments(schemas[method], args));
    });
  }
  for (const method of Object.keys(schemas) as (keyof CourtPlusApi)[]) register(method);
}
