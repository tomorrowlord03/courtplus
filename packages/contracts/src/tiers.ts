import type { Authority } from './index.js';

export type CaseTier = {
  level: 1 | 2 | 3;
  label: string;
  triggers: { rule: string; source: Authority }[];
};
