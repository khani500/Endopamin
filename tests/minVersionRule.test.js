import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  evaluateMinVersion,
  isValidMinVersionConfig,
  resolveStoreUrl,
} from '../api/_minVersionRule.js';

// Shared with the Mobile repo (tests/fixtures/minVersionCases.json, byte-identical).
const table = JSON.parse(
  readFileSync(new URL('./fixtures/minVersionCases.json', import.meta.url), 'utf8'),
);

describe('minVersionRule shared case table', () => {
  it.each(table.cases.map((c) => [c.name, c]))('%s', (_name, c) => {
    const config = table.configs[c.config];
    expect(config, `unknown config ${c.config}`).toBeDefined();
    expect(evaluateMinVersion(config, c.client)).toEqual({
      decision: c.decision,
      reason: c.reason,
    });
  });

  it.each(Object.entries(table.configs))('named config %s is valid', (_name, config) => {
    expect(isValidMinVersionConfig(config)).toBe(true);
  });

  it.each(table.malformedConfigs.map((c) => [c.name, c.config]))(
    'malformed config (%s) never blocks',
    (_name, config) => {
      expect(isValidMinVersionConfig(config)).toBe(false);
      for (const client of table.malformedConfigClients) {
        expect(evaluateMinVersion(config, client)).toEqual({
          decision: 'allow',
          reason: 'config-malformed',
        });
      }
    },
  );

  it.each(table.storeUrlCases.map((c) => [c.name, c]))('store url: %s', (_name, c) => {
    expect(resolveStoreUrl(c.config, c.platform)).toBe(c.expected);
  });
});
