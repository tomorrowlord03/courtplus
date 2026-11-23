import type { FastifyReply } from 'fastify';
import { z } from 'zod';

export class HttpError extends Error {
  constructor(readonly statusCode: number, readonly code: string) {
    super(code);
  }
}

export function requireValue<T>(value: T | undefined, code = 'NOT_FOUND'): T {
  if (value === undefined) throw new HttpError(404, code);
  return value;
}

export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new HttpError(400, 'INVALID_ARGUMENT');
  return result.data;
}

export function missingFeature(code: string): never {
  throw new HttpError(501, code);
}

const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function html(value: string): string {
  return value.replace(/[&<>"']/g, character => entities[character]);
}

export function page(reply: FastifyReply, title: string, content: string, script?: string) {
  return reply.type('text/html; charset=utf-8').send(
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + html(title) + ' | CourtPlus Cloud</title><link rel="stylesheet" href="/cloud.css">' +
    '</head><body><main><h1>' + html(title) + '</h1>' + content + '</main>' +
    (script ? '<script src="/cloud.js" defer data-page="' + script + '"></script>' : '') + '</body></html>',
  );
}
