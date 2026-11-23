import type { DesktopWorkspaceApi } from '@courtplus/contracts' with { 'resolution-mode': 'import' };
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { createHandlers } from './handlers';
import { argumentSchemas, validateArguments } from './validation';

type AppMethods = Awaited<ReturnType<typeof createHandlers>>['handlers'];
type Trust = (event: IpcMainInvokeEvent, method: string) => boolean;
type Methods = { [K in keyof DesktopWorkspaceApi]: (...args: Parameters<DesktopWorkspaceApi[K]>) => ReturnType<DesktopWorkspaceApi[K]> };
const schemas: { [K in keyof DesktopWorkspaceApi]: import('zod').ZodType<Parameters<DesktopWorkspaceApi[K]>> } = argumentSchemas;

export function registerHandlers(handlers: AppMethods, isTrusted: Trust): void {
  const methods: Methods = handlers;
  function register<K extends keyof DesktopWorkspaceApi>(method: K) {
    ipcMain.handle('courtplus:' + method, async (event, ...args: unknown[]) => {
      if (!isTrusted(event, method)) throw new Error('FORBIDDEN');
      return methods[method](...validateArguments(schemas[method], args));
    });
  }
  for (const method of Object.keys(schemas) as (keyof DesktopWorkspaceApi)[]) register(method);
}
