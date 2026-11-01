export interface ShareHeaderMeasurements {
  
  shellWidth: number;
  
  railContentLeft: number;
  railContentRight: number;
  brandWidth: number;
  titleContentWidth: number;
  
  continueWidth: number;
  
  compactContinueWidth?: number;
  
  hasContinueAction?: boolean;
  gap?: number;
  
  edgePadding?: number;
  
  minClearance?: number;
  
  minTitleWidth?: number;
}

export interface ShareHeaderView {
  
  progress: number;
  brandLeft: number;
  titleLeft: number;
  titleWidth: number;
  continueRight: number;
  titleTruncated: boolean;
  continueVisible: boolean;
  continueCompact: boolean;
}

const DEFAULT_GAP = 16;
const DEFAULT_EDGE_PADDING = 24;
const DEFAULT_MIN_CLEARANCE = 16;
const DEFAULT_MIN_TITLE_WIDTH = 80;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lerp(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

export function resolveShareHeaderView({
  shellWidth,
  railContentLeft,
  railContentRight,
  brandWidth,
  titleContentWidth,
  continueWidth,
  compactContinueWidth = continueWidth,
  hasContinueAction = continueWidth > 0,
  gap = DEFAULT_GAP,
  edgePadding = DEFAULT_EDGE_PADDING,
  minClearance = DEFAULT_MIN_CLEARANCE,
  minTitleWidth = DEFAULT_MIN_TITLE_WIDTH,
}: ShareHeaderMeasurements): ShareHeaderView {
  const normalizedShellWidth = Math.max(0, shellWidth);
  const normalizedRailLeft = Math.max(0, railContentLeft);
  const normalizedRailRight = Math.max(0, railContentRight);
  const normalizedBrandWidth = Math.max(0, brandWidth);
  const normalizedTitleContentWidth = Math.max(0, titleContentWidth);
  const normalizedContinueWidth = Math.max(0, continueWidth);
  const normalizedCompactContinueWidth = Math.min(
    normalizedContinueWidth,
    Math.max(0, compactContinueWidth),
  );
  const normalizedGap = Math.max(0, gap);
  const normalizedEdgePadding = Math.max(0, edgePadding);
  const normalizedMinClearance = Math.max(0, minClearance);
  const normalizedMinTitleWidth = Math.max(0, minTitleWidth);
  const brandRequiredGutter = normalizedBrandWidth + normalizedEdgePadding + normalizedMinClearance;
  const brandProgress = clamp(normalizedRailLeft / brandRequiredGutter, 0, 1);
  const narrowBrandLeft = normalizedRailLeft;
  const narrowTitleLeft = normalizedRailLeft + normalizedBrandWidth + normalizedGap;
  const wideBrandLeft = normalizedEdgePadding;
  const wideTitleLeft = normalizedRailLeft;
  const wideTitleRight = normalizedShellWidth - normalizedRailRight;
  const wideContinueRight = normalizedEdgePadding;
  const brandLeft = lerp(narrowBrandLeft, wideBrandLeft, brandProgress);
  const titleLeft = Math.max(
    brandLeft + normalizedBrandWidth + normalizedGap,
    lerp(narrowTitleLeft, wideTitleLeft, brandProgress),
  );

  const resolveTrailingGeometry = (trailingWidth: number) => {
    const continueRequiredGutter = trailingWidth + normalizedEdgePadding + normalizedMinClearance;
    const continueProgress =
      trailingWidth === 0 ? 1 : clamp(normalizedRailRight / continueRequiredGutter, 0, 1);
    const continueRight = lerp(normalizedRailRight, wideContinueRight, continueProgress);
    const narrowTitleRight =
      normalizedShellWidth - normalizedRailRight - trailingWidth - normalizedGap;
    const titleRight = Math.min(
      lerp(narrowTitleRight, wideTitleRight, continueProgress),
      normalizedShellWidth - continueRight - trailingWidth - normalizedGap,
    );
    return {
      continueProgress,
      continueRight,
      titleWidth: Math.max(0, titleRight - titleLeft),
    };
  };

  const fullGeometry = resolveTrailingGeometry(normalizedContinueWidth);
  const continueCompact =
    hasContinueAction &&
    normalizedCompactContinueWidth < normalizedContinueWidth &&
    fullGeometry.titleWidth < normalizedMinTitleWidth;
  const geometry = continueCompact
    ? resolveTrailingGeometry(normalizedCompactContinueWidth)
    : fullGeometry;

  return {
    progress: Math.min(brandProgress, geometry.continueProgress),
    brandLeft,
    titleLeft,
    titleWidth: geometry.titleWidth,
    continueRight: geometry.continueRight,
    titleTruncated: normalizedTitleContentWidth > geometry.titleWidth,
    continueVisible: hasContinueAction,
    continueCompact,
  };
}
