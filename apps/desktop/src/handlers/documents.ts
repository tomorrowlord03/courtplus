import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

const statsSchema = z.object({
  figures: z.array(z.object({
    id: z.string(), label: z.string(), value: z.number(), unit: z.string(), date: z.string(),
    geography: z.string(), source: z.string(), url: z.url(), note: z.string(), verified: z.boolean(),
  }).passthrough()),
});

export function loadFigures(directory: string) {
  return ['india.json', 'chhattisgarh.json'].flatMap(name => {
    const json: unknown = JSON.parse(readFileSync(join(directory, name), 'utf8'));
    return statsSchema.parse(json).figures.map(figure => ({
      ...figure,
      label: [figure.geography, figure.label, figure.verified ? '' : 'Unverified'].filter(Boolean).join(' · '),
    }));
  });
}
