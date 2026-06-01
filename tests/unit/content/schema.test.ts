import { describe, it, expect } from 'vitest';
import { roomSchema } from '@/content/schema';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

const ROOMS_DIR = resolve(process.cwd(), 'src/content/rooms');

describe('rooms schema', () => {
  it('all real room entries parse successfully and slug matches filename', () => {
    const files = readdirSync(ROOMS_DIR).filter(f => f.endsWith('.yml'));
    expect(files.length).toBe(3);
    for (const f of files) {
      const data = parse(readFileSync(resolve(ROOMS_DIR, f), 'utf8'));
      const parsed = roomSchema.parse(data);
      expect(f).toBe(`${parsed.slug}.yml`);
    }
  });

  it('rejects a malformed fixture', () => {
    const bad = parse(readFileSync(resolve(process.cwd(), 'tests/fixtures/bad-room.yml'), 'utf8'));
    expect(() => roomSchema.parse(bad)).toThrow();
  });
});
