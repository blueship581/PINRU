export const SIDEBAR_WIDTH_STORAGE_KEY = 'pinru.layout.sidebar-width';
export const SIDEBAR_MIN_WIDTH_PX = 220;
export const SIDEBAR_MAX_WIDTH_PX = 520;

const PX_PER_EM = 16;
const PX_PER_REM = 16;
const DEFAULT_SIDEBAR_WIDTH_RATIO = 2 / 3;

export function computeSidebarBaseWidthPx(projectNameWidthEm: number, sidebarChromeWidthRem: number) {
  return Math.max(
    SIDEBAR_MIN_WIDTH_PX,
    Math.round(
      (projectNameWidthEm * PX_PER_EM + sidebarChromeWidthRem * PX_PER_REM) *
        DEFAULT_SIDEBAR_WIDTH_RATIO,
    ),
  );
}

export function clampSidebarWidth(
  width: number,
  minWidth: number,
  maxWidth = SIDEBAR_MAX_WIDTH_PX,
) {
  if (!Number.isFinite(width)) {
    return minWidth;
  }

  return Math.min(Math.max(width, minWidth), maxWidth);
}

export function parseStoredSidebarWidth(
  rawValue: string | null,
  minWidth: number,
  maxWidth = SIDEBAR_MAX_WIDTH_PX,
) {
  if (!rawValue) return null;

  const parsed = Number.parseFloat(rawValue);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return clampSidebarWidth(parsed, minWidth, maxWidth);
}
