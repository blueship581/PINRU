import { describe, expect, it } from 'vitest';
import {
  clampSidebarWidth,
  computeSidebarBaseWidthPx,
  parseStoredSidebarWidth,
  SIDEBAR_MAX_WIDTH_PX,
  SIDEBAR_MIN_WIDTH_PX,
} from './layoutSizing';

describe('layoutSizing', () => {
  it('computes a content-aware sidebar base width with a hard minimum', () => {
    expect(computeSidebarBaseWidthPx(4, 6)).toBe(SIDEBAR_MIN_WIDTH_PX);
    expect(computeSidebarBaseWidthPx(12, 9)).toBe(224);
  });

  it('clamps dragged widths into the allowed range', () => {
    expect(clampSidebarWidth(180, 240)).toBe(240);
    expect(clampSidebarWidth(360, 240)).toBe(360);
    expect(clampSidebarWidth(600, 240)).toBe(SIDEBAR_MAX_WIDTH_PX);
  });

  it('parses persisted widths and ignores invalid values', () => {
    expect(parseStoredSidebarWidth('388', 240)).toBe(388);
    expect(parseStoredSidebarWidth('120', 240)).toBe(240);
    expect(parseStoredSidebarWidth('abc', 240)).toBeNull();
    expect(parseStoredSidebarWidth(null, 240)).toBeNull();
  });
});
