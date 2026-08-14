import { describe, it, expect } from 'vitest';
import { shouldTriggerRebuild, isInFlight, sanitizeProfileMd, buildDistillationSystemPrompt, STALE_REBUILD_MS } from './styleProfile.ts';

describe('shouldTriggerRebuild', () => {
  it('fires when delta >= 10', () => {
    expect(shouldTriggerRebuild(10, 0)).toBe(true);
    expect(shouldTriggerRebuild(11, 0)).toBe(true);
    expect(shouldTriggerRebuild(15, 5)).toBe(true);
  });
  it('does not fire when delta < 10', () => {
    expect(shouldTriggerRebuild(9, 0)).toBe(false);
    expect(shouldTriggerRebuild(14, 5)).toBe(false);
    expect(shouldTriggerRebuild(0, 0)).toBe(false);
  });
  it('is delta-since-last-rebuild, not total', () => {
    // 25 total but only 5 since last rebuild at 20
    expect(shouldTriggerRebuild(25, 20)).toBe(false);
    expect(shouldTriggerRebuild(30, 20)).toBe(true);
  });
});

describe('isInFlight', () => {
  it('false when no profile', () => expect(isInFlight(null)).toBe(false));
  it('false when rebuilding false', () => expect(isInFlight({ rebuilding: false, rebuilding_started_at: new Date().toISOString() })).toBe(false));
  it('true when rebuilding true and recent', () => expect(isInFlight({ rebuilding: true, rebuilding_started_at: new Date().toISOString() })).toBe(true));
  it('false when stale', () => {
    const stale = new Date(Date.now() - STALE_REBUILD_MS - 1000).toISOString();
    expect(isInFlight({ rebuilding: true, rebuilding_started_at: stale })).toBe(false);
  });
});

describe('sanitizeProfileMd', () => {
  it('trims and normalizes bullets', () => {
    const raw = '- Short sentences.\n- Casual tone\n- Uses em dashes';
    expect(sanitizeProfileMd(raw)).toContain('- Short sentences.');
  });
  it('caps length', () => {
    expect(sanitizeProfileMd('a'.repeat(5000)).length).toBeLessThanOrEqual(2000);
  });
});

describe('buildDistillationSystemPrompt', () => {
  it('mentions style observations, not career facts', () => {
    const s = buildDistillationSystemPrompt();
    expect(s.toLowerCase()).toContain('how');
    expect(s.toLowerCase()).toContain('not');
  });
});
