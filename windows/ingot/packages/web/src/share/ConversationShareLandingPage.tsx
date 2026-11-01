
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react";
import { ArrowUpRightIcon, MoonIcon, SunIcon } from "lucide-react";
import { BIGMODEL_PROVIDER_ID, ZAI_PROVIDER_ID } from "@origin-ai/cf-shared";
import type { ConversationSharePreview } from "@origin-ai/cf-shared";
import { ConversationShareReadonlyTimeline } from "@origin-ai/cf-ui/conversation-share-readonly";
import { renderOAuthProviderIcon } from "@origin-ai/cf-ui/oauth-provider-icon";
import { applyTheme, resolveTheme, type Theme } from "@origin-ai/cf-ui/useTheme";
import "./conversationShareLandingPage.css";
import type { WebOAuthProviderId } from "../auth/browserOAuthCredentialRepo.js";
import {
  buildShareImportDeepLink,
  type ConversationSharePreviewClientError,
  type ConversationSharePreviewErrorKind,
} from "./conversationSharePreviewClient.js";
import { resolveShareHeaderView, type ShareHeaderView } from "./shareHeaderLayout.js";

const SHARE_LOGIN_PROVIDERS: readonly WebOAuthProviderId[] = [
  ZAI_PROVIDER_ID,
  BIGMODEL_PROVIDER_ID,
];

export type ConversationShareLandingLocale = "zh-CN" | "en-US";
export type ConversationShareLandingState =
  | { kind: "loading" }
  | { kind: "login_required" }
  | { kind: "ready"; preview: ConversationSharePreview }
  | {
      kind: "error";
      error: ConversationSharePreviewErrorKind;
      status?: number;
      code?: number;
      requestId?: string;
    };

function logPreviewLoadFailure(
  stage: "anonymous" | "authenticated",
  error: unknown,
  kind: ConversationSharePreviewErrorKind,
): void {
  const clientError = error as Partial<ConversationSharePreviewClientError> | null;
  console.warn("[conversation-share-web]", "preview_load_failed", {
    stage,
    kind,
    errorName: error instanceof Error ? error.name : typeof error,
    status: typeof clientError?.status === "number" ? clientError.status : undefined,
    code: typeof clientError?.code === "number" ? clientError.code : undefined,
  });
}

interface Copy {
  brand: string;
  loading: string;
  loadingDescription: string;
  loginTitle: string;
  loginDescription: string;
  login: string;
  
  loginWith: Record<WebOAuthProviderId, string>;
  loginRegion: Record<WebOAuthProviderId, string>;
  expiredTitle: string;
  expiredDescription: string;
  notFoundTitle: string;
  notFoundDescription: string;
  notFoundAccountHint: string;
  backToHome: string;
  rateLimitedTitle: string;
  rateLimitedDescription: string;
  serviceUnavailableTitle: string;
  serviceUnavailableDescription: string;
  featureDisabledTitle: string;
  featureDisabledDescription: string;
  errorDetails: string;
  requestId: string;
  errorCode: string;
  networkTitle: string;
  networkDescription: string;
  invalidTitle: string;
  invalidDescription: string;
  outdatedTitle: string;
  outdatedDescription: string;
  unavailableTitle: string;
  unavailableDescription: string;
  retry: string;
  continueInCf: string;
  switchToDarkTheme: string;
  switchToLightTheme: string;
  continueHelp: string;
  downloadCf: string;
  retryOpen: string;
  
  artifactCountOne: string;
  artifactCountOther: string;
}

const CF_DOWNLOAD_URL = "https://cf.z.ai";

const COPY: Record<ConversationShareLandingLocale, Copy> = {
  "zh-CN": {
    brand: "CodeFusion Session Sharing",
    loading: "In progress加载分享inner容",
    loadingDescription: "请稍候，我们In progress验证分享链接。",
    loginTitle: "登录后View分享",
    loginDescription: "请登录后确认你Yes否有PermissionsView这个分享。",
    login: "登录",
    loginWith: {
      zai: "Connect Z.ai Continue使用",
      bigmodel: "Connect BigModel Continue使用",
    },
    loginRegion: { zai: "全球", bigmodel: "Medium国" },
    expiredTitle: "分享已Expired",
    expiredDescription: "这个分享链接已经Expired，请让分享者重New生成链接。",
    notFoundTitle: "找不到分享inner容",
    notFoundDescription: "链接可能无效、分享已被移除，orCurrent登录账Number无法访Question。",
    notFoundAccountHint:
      "Z.ai 与 BigModel 的账NumberData不互通。请CheckYes否选Wrong了登录平台or使用了Other账Number。",
    backToHome: "回到首页",
    rateLimitedTitle: "访Question过于频繁",
    rateLimitedDescription: "请LaterRetry。",
    serviceUnavailableTitle: "分享Service暂时异常",
    serviceUnavailableDescription: "请LaterRetry；若仍Failed，请提供Error details。",
    featureDisabledTitle: "分享Service暂未开放",
    featureDisabledDescription: "请Later再试。",
    errorDetails: "错误详情",
    requestId: "Service端Request ID",
    errorCode: "Error码",
    networkTitle: "暂时无法加载分享",
    networkDescription: "请CheckNetwork后Retry。",
    invalidTitle: "无法Read分享inner容",
    invalidDescription: "分享ServiceBack了无法识别的Data，请提供Error details。",
    outdatedTitle: "Update required CodeFusion",
    outdatedDescription: "这个分享由更NewVersion的 CodeFusion 创建，请Upgrade后再View。",
    unavailableTitle: "分享不可访Question",
    unavailableDescription: "Current账Number没有Permissions，or者分享inner容已不存在。",
    retry: "重试",
    continueInCf: "去 CodeFusion Continue",
    switchToDarkTheme: "切换到Dark theme",
    switchToLightTheme: "切换到Light theme",
    continueHelp: "如果没有AutoOpen CodeFusion，请先下载Customer端，or再次尝试打开。",
    downloadCf: "下载 CodeFusion",
    artifactCountOne: "{count} 个Result物",
    artifactCountOther: "{count} 个Result物",
    retryOpen: "再次打开",
  },
  "en-US": {
    brand: "CodeFusion Conversation Share",
    loading: "Loading shared conversation",
    loadingDescription: "Please wait while we verify this share link.",
    loginTitle: "Sign in to view this share",
    loginDescription: "Sign in to check whether you can view this shared conversation.",
    login: "Sign in",
    loginWith: {
      zai: "Connect to Z.ai",
      bigmodel: "Connect to BigModel",
    },
    loginRegion: { zai: "Global", bigmodel: "CN" },
    expiredTitle: "Share expired",
    expiredDescription: "This share link has expired. Ask the author to create a new one.",
    notFoundTitle: "Share not found",
    notFoundDescription:
      "The link may be invalid, the share may have been removed, or your current account may not have access.",
    notFoundAccountHint:
      "Z.ai and BigModel do not share account data. Check whether you selected the wrong sign-in platform or used a different account.",
    backToHome: "Back to home",
    rateLimitedTitle: "Too many requests",
    rateLimitedDescription: "Try again later.",
    serviceUnavailableTitle: "Sharing service unavailable",
    serviceUnavailableDescription: "Try again later. If this persists, provide the error details.",
    featureDisabledTitle: "Sharing is currently unavailable",
    featureDisabledDescription: "Try again later.",
    errorDetails: "Error details",
    requestId: "Server request ID",
    errorCode: "Error code",
    networkTitle: "Unable to load share",
    networkDescription: "Check your network connection and try again.",
    invalidTitle: "Unable to read shared content",
    invalidDescription:
      "The sharing service returned unrecognized data. Provide the error details.",
    outdatedTitle: "Update CodeFusion to continue",
    outdatedDescription:
      "This share was created by a newer version of CodeFusion. Please update to view it.",
    unavailableTitle: "Share unavailable",
    unavailableDescription:
      "This account is not allowed to view the share, or it no longer exists.",
    retry: "Try again",
    continueInCf: "Continue in CodeFusion",
    switchToDarkTheme: "Switch to dark theme",
    switchToLightTheme: "Switch to light theme",
    continueHelp: "If CodeFusion did not open, download the app or try opening it again.",
    downloadCf: "Download CodeFusion",
    artifactCountOne: "{count} artifact",
    artifactCountOther: "{count} artifacts",
    retryOpen: "Try again",
  },
};

function localeOf(locale?: ConversationShareLandingLocale): ConversationShareLandingLocale {
  if (locale) return locale;
  return /^zh(?:-|$)/iu.test(globalThis.navigator?.language ?? "") ? "zh-CN" : "en-US";
}

function formatDate(timestamp: number, locale: ConversationShareLandingLocale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(timestamp),
  );
}

const SHARE_CONTENT_RAIL_CLASS =
  "@container/conversation mx-auto w-full max-w-4xl px-4 sm:px-8 xl:max-w-6xl";
const SHARE_CONTINUE_LINK_CLASS =
  "inline-flex max-w-full items-center gap-2 rounded-xl bg-primary px-4 py-2 text-ui-base font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/80 focus-visible:ring-2 focus-visible:ring-input-border-focused sm:gap-3 sm:px-5 sm:py-2.5";
const SHARE_CONTINUE_MEASURE_CLASS =
  "inline-flex max-w-none items-center gap-2 rounded-xl bg-primary px-4 py-2 text-ui-base font-medium text-primary-foreground sm:gap-3 sm:px-5 sm:py-2.5";
const SHARE_CONTINUE_COMPACT_CLASS =
  "inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm transition-colors hover:bg-primary/80 focus-visible:ring-2 focus-visible:ring-input-border-focused";
const SHARE_THEME_TOGGLE_CLASS =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-md text-foreground transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-input-border-focused";

function ShareThemeToggle({
  theme,
  copy,
  onThemeChange,
}: {
  theme: Theme;
  copy: Pick<Copy, "switchToDarkTheme" | "switchToLightTheme">;
  onThemeChange?: (theme: Theme) => void;
}) {
  const resolvedTheme = resolveTheme(theme);
  const nextTheme = resolvedTheme === "dark" ? "cf-light" : "cf-dark";
  const label = resolvedTheme === "dark" ? copy.switchToLightTheme : copy.switchToDarkTheme;
  const Icon = resolvedTheme === "dark" ? SunIcon : MoonIcon;

  return (
    <button
      type="button"
      data-share-theme-toggle="true"
      className={SHARE_THEME_TOGGLE_CLASS}
      aria-label={label}
      title={label}
      onClick={() => onThemeChange?.(nextTheme)}
    >
      <Icon className="size-4" aria-hidden="true" />
    </button>
  );
}

function ShareContentRail({
  children,
  className = "",
  body = false,
}: {
  children: React.ReactNode;
  className?: string;
  body?: boolean;
}) {
  return (
    <div
      data-share-content-rail="true"
      data-share-body-rail={body ? "true" : undefined}
      className={`${SHARE_CONTENT_RAIL_CLASS} ${className}`}
    >
      {children}
    </div>
  );
}

function ShareContentInset({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      data-share-content-inset="true"
      className={`w-full px-4 @md/conversation:px-6 ${className}`}
    >
      {children}
    </div>
  );
}

export function ConversationShareLandingPage({
  shareCode,
  preview,
  locale,
  theme,
  onThemeChange,
}: {
  shareCode: string;
  preview: ConversationSharePreview;
  locale?: ConversationShareLandingLocale;
  theme?: Theme;
  onThemeChange?: (theme: Theme) => void;
}) {
  const resolvedLocale = localeOf(locale);
  const copy = COPY[resolvedLocale];
  const activeTheme = theme ?? "cf-light";
  const shareTitle = preview.share.title;
  useEffect(() => {
    document.title = `${shareTitle} · ${copy.brand}`;
  }, [copy.brand, shareTitle]);
  const [showContinueHelp, setShowContinueHelp] = useState(false);
  const importLink =
    preview.share.access_mode === "public_importable" || preview.share.access_mode === "private"
      ? buildShareImportDeepLink(shareCode)
      : null;
  const artifactCount = preview.rows.filter((row) => row.kind === "artifact").length;
  const artifactCountLabel = (
    artifactCount === 1 ? copy.artifactCountOne : copy.artifactCountOther
  ).replace("{count}", String(artifactCount));
  const artifactUrls = new Map(
    preview.artifacts.map((artifact) => [artifact.artifact_id, artifact.url]),
  );
  const artifactNames = new Map(
    preview.artifacts.map((artifact) => [artifact.artifact_id, artifact.display_name]),
  );
  const headerRowRef = useRef<HTMLDivElement>(null);
  const headerShellRef = useRef<HTMLDivElement>(null);
  const brandRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleMeasureRef = useRef<HTMLSpanElement>(null);
  const continueMeasureRef = useRef<HTMLSpanElement>(null);
  const compactContinueMeasureRef = useRef<HTMLSpanElement>(null);
  const [headerMeasured, setHeaderMeasured] = useState(false);
  const [headerView, setHeaderView] = useState<ShareHeaderView>({
    progress: 0,
    brandLeft: 0,
    titleLeft: 0,
    titleWidth: 0,
    continueRight: 0,
    titleTruncated: false,
    continueVisible: Boolean(importLink),
    continueCompact: false,
  });

  useLayoutEffect(() => {
    const row = headerRowRef.current;
    if (!row) return;
    const updateLayout = () => {
      const rowRect = row.getBoundingClientRect();
      const shellRect = headerShellRef.current?.getBoundingClientRect();
      if (!shellRect) return;
      const nextView = resolveShareHeaderView({
        shellWidth: shellRect.width,
        railContentLeft: rowRect.left - shellRect.left,
        railContentRight: shellRect.right - rowRect.right,
        brandWidth: brandRef.current?.getBoundingClientRect().width ?? 50,
        titleContentWidth: titleMeasureRef.current?.getBoundingClientRect().width ?? 0,
        continueWidth: continueMeasureRef.current?.getBoundingClientRect().width ?? 0,
        compactContinueWidth: compactContinueMeasureRef.current?.getBoundingClientRect().width ?? 0,
        hasContinueAction: Boolean(importLink),
      });
      setHeaderMeasured(true);
      setHeaderView((current) =>
        current.progress === nextView.progress &&
        current.brandLeft === nextView.brandLeft &&
        current.titleLeft === nextView.titleLeft &&
        current.titleWidth === nextView.titleWidth &&
        current.continueRight === nextView.continueRight &&
        current.titleTruncated === nextView.titleTruncated &&
        current.continueVisible === nextView.continueVisible &&
        current.continueCompact === nextView.continueCompact
          ? current
          : nextView,
      );
    };
    updateLayout();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateLayout);
    observer.observe(row);
    if (headerShellRef.current) observer.observe(headerShellRef.current);
    if (brandRef.current) observer.observe(brandRef.current);
    if (titleRef.current) observer.observe(titleRef.current);
    if (titleMeasureRef.current) observer.observe(titleMeasureRef.current);
    if (continueMeasureRef.current) observer.observe(continueMeasureRef.current);
    if (compactContinueMeasureRef.current) observer.observe(compactContinueMeasureRef.current);
    return () => observer.disconnect();
  }, [resolvedLocale, importLink]);

  const headerGeometryStyle = {
    "--share-brand-left": `${headerView.brandLeft}px`,
    "--share-title-left": `${headerView.titleLeft}px`,
    "--share-title-width": `${headerView.titleWidth}px`,
    "--share-continue-right": `${headerView.continueRight}px`,
  } as CSSProperties;

  const handleContinue = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      setShowContinueHelp(false);
      window.location.href = importLink!;
      window.setTimeout(() => {
        if (document.visibilityState === "visible") {
          setShowContinueHelp(true);
        }
      }, 1500);
    },
    [importLink],
  );

  return (
    <main
      className="h-full min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain bg-background text-foreground [scrollbar-gutter:stable]"
      data-markdown-table-layout-root="true"
      data-share-scroll-viewport="true"
    >
      <header
        data-share-header="true"
        className="sticky top-0 z-20 border-b border-border bg-background backdrop-blur"
      >
        <div
          ref={headerShellRef}
          data-share-header-shell="true"
          data-share-header-layout="continuous"
          data-share-header-ready={headerMeasured ? "true" : "false"}
          className="w-full"
          style={headerGeometryStyle}
        >
          <ShareContentRail className="flex h-16 items-center">
            <ShareContentInset>
              <div
                ref={headerRowRef}
                data-share-header-row="true"
                className="h-full w-full min-w-0"
              >
                <div
                  ref={brandRef}
                  data-share-brand="true"
                  className="shrink-0 text-ui-lg font-semibold text-foreground"
                  aria-label="CodeFusion"
                >
                  CodeFusion
                </div>
                <h1
                  ref={titleRef}
                  data-share-title="true"
                  data-share-title-truncated={headerView.titleTruncated ? "true" : "false"}
                  className="truncate text-left text-ui-lg font-medium"
                  title={preview.share.title}
                >
                  {preview.share.title}
                </h1>
                <span
                  ref={titleMeasureRef}
                  data-share-title-measure="true"
                  className="text-ui-lg font-medium"
                  aria-hidden="true"
                >
                  {preview.share.title}
                </span>
                <div
                  data-share-continue-slot="true"
                  data-share-continue-visible={
                    importLink && headerView.continueVisible ? "true" : "false"
                  }
                >
                  <div className="flex items-center gap-2">
                    <ShareThemeToggle
                      theme={activeTheme}
                      copy={copy}
                      onThemeChange={onThemeChange}
                    />
                    {importLink && headerView.continueVisible ? (
                      <a
                        data-share-continue-link="true"
                        data-share-continue-compact={headerView.continueCompact ? "true" : "false"}
                        className={
                          headerView.continueCompact
                            ? SHARE_CONTINUE_COMPACT_CLASS
                            : SHARE_CONTINUE_LINK_CLASS
                        }
                        href={importLink}
                        aria-label={copy.continueInCf}
                        title={copy.continueInCf}
                        onClick={handleContinue}
                      >
                        <span className={headerView.continueCompact ? "sr-only" : "truncate"}>
                          {copy.continueInCf}
                        </span>
                        <ArrowUpRightIcon
                          className={
                            headerView.continueCompact
                              ? "size-4 shrink-0"
                              : "size-4 shrink-0 sm:size-5"
                          }
                          aria-hidden="true"
                        />
                      </a>
                    ) : null}
                  </div>
                  <span
                    ref={continueMeasureRef}
                    data-share-continue-measure="true"
                    className="inline-flex items-center gap-2"
                    aria-hidden="true"
                    tabIndex={-1}
                  >
                    <span className={SHARE_THEME_TOGGLE_CLASS}>
                      <MoonIcon className="size-4" aria-hidden="true" />
                    </span>
                    {importLink ? (
                      <span className={SHARE_CONTINUE_MEASURE_CLASS}>
                        <span>{copy.continueInCf}</span>
                        <ArrowUpRightIcon
                          className="size-4 shrink-0 sm:size-5"
                          aria-hidden="true"
                        />
                      </span>
                    ) : null}
                  </span>
                  <span
                    ref={compactContinueMeasureRef}
                    data-share-continue-compact-measure="true"
                    className="inline-flex items-center gap-2"
                    aria-hidden="true"
                    tabIndex={-1}
                  >
                    <span className={SHARE_THEME_TOGGLE_CLASS}>
                      <MoonIcon className="size-4" aria-hidden="true" />
                    </span>
                    {importLink ? (
                      <span className={SHARE_CONTINUE_COMPACT_CLASS}>
                        <ArrowUpRightIcon className="size-4" aria-hidden="true" />
                      </span>
                    ) : null}
                  </span>
                </div>
              </div>
            </ShareContentInset>
          </ShareContentRail>
        </div>
      </header>

      <ShareContentRail body className="py-6 sm:py-10">
        <ShareContentInset>
          <div
            data-share-metadata="true"
            className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-ui-sm text-foreground-subtle"
          >
            <span>{formatDate(preview.share.created_at, resolvedLocale)}</span>
            {artifactCount ? (
              <span aria-label={artifactCountLabel}>· {artifactCountLabel}</span>
            ) : null}
          </div>
        </ShareContentInset>
        {importLink && showContinueHelp ? (
          <ShareContentInset>
            <div
              className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-ui-sm text-foreground-subtle"
              role="status"
            >
              <span>{copy.continueHelp}</span>
              <a
                className="text-brand underline underline-offset-2"
                href={importLink}
                onClick={handleContinue}
              >
                {copy.retryOpen}
              </a>
              <a className="text-brand underline underline-offset-2" href={CF_DOWNLOAD_URL}>
                {copy.downloadCf}
              </a>
            </div>
          </ShareContentInset>
        ) : null}
        <ConversationShareReadonlyTimeline
          rows={preview.rows}
          contentBlocks={preview.content_blocks}
          unsupportedRowCount={preview.unsupportedRowCount}
          locale={resolvedLocale}
          theme={theme}
          artifactUrls={artifactUrls}
          artifactNames={artifactNames}
        />
        {importLink ? (
          <ShareContentInset>
            <div
              data-share-continue-footer="true"
              className="flex justify-center pb-2 pt-8 sm:pt-10"
            >
              <a
                data-share-continue-link="true"
                className={SHARE_CONTINUE_LINK_CLASS}
                href={importLink}
                onClick={handleContinue}
              >
                <span className="truncate">{copy.continueInCf}</span>
                <ArrowUpRightIcon className="size-4 shrink-0 sm:size-5" aria-hidden="true" />
              </a>
            </div>
          </ShareContentInset>
        ) : null}
      </ShareContentRail>
    </main>
  );
}

export function ConversationShareLandingStatus({
  state,
  locale,
  onLogin,
  onRetry,
}: {
  state: Exclude<ConversationShareLandingState, { kind: "ready" }>;
  locale?: ConversationShareLandingLocale;
  onLogin?: (provider: WebOAuthProviderId) => void;
  onRetry?: () => void;
}) {
  const copy = COPY[localeOf(locale)];
  const content =
    state.kind === "loading"
      ? { title: copy.loading, description: copy.loadingDescription }
      : state.kind === "login_required"
        ? { title: copy.loginTitle, description: copy.loginDescription }
        : state.error === "rate_limited"
          ? { title: copy.rateLimitedTitle, description: copy.rateLimitedDescription }
          : state.error === "feature_disabled"
            ? { title: copy.featureDisabledTitle, description: copy.featureDisabledDescription }
            : state.error === "service_unavailable" || state.error === "unknown"
              ? {
                  title: copy.serviceUnavailableTitle,
                  description: copy.serviceUnavailableDescription,
                }
              : state.error === "expired"
                ? { title: copy.expiredTitle, description: copy.expiredDescription }
                : state.error === "not_found"
                  ? { title: copy.notFoundTitle, description: copy.notFoundDescription }
                  : state.error === "unsupported_schema_version"
                    ? { title: copy.outdatedTitle, description: copy.outdatedDescription }
                    : state.error === "invalid_contract"
                      ? { title: copy.invalidTitle, description: copy.invalidDescription }
                      : state.error === "authentication_required"
                        ? { title: copy.loginTitle, description: copy.loginDescription }
                        : { title: copy.networkTitle, description: copy.networkDescription };
  const showLogin =
    state.kind === "login_required" ||
    (state.kind === "error" && state.error === "authentication_required");
  const isNotFound = state.kind === "error" && state.error === "not_found";
  
  const canRetry =
    Boolean(onRetry) &&
    state.kind !== "loading" &&
    !showLogin &&
    !(
      state.kind === "error" &&
      (state.error === "expired" ||
        state.error === "unsupported_schema_version" ||
        state.error === "feature_disabled" ||
        state.error === "not_found" ||
        state.error === "invalid_contract")
    );
  return (
    <main className="flex h-full min-h-0 items-center justify-center overflow-y-auto bg-background px-4 py-8 text-foreground">
      <section className="w-full max-w-md rounded-lg border border-card-border bg-card p-6 shadow-sm">
        <div className="mb-4 text-ui-sm font-medium text-brand">{copy.brand}</div>
        <h1 className="text-ui-xl font-semibold">{content.title}</h1>
        <p className="mt-3 text-ui-base leading-6 text-foreground-subtle">{content.description}</p>
        {state.kind === "error" &&
        (state.status !== undefined || state.code !== undefined || state.requestId) ? (
          <details className="mt-4 text-ui-xs text-foreground-subtle">
            <summary className="cursor-pointer">{copy.errorDetails}</summary>
            {[
              ["HTTP", state.status],
              [copy.errorCode, state.code],
              [copy.requestId, state.requestId],
            ].map(([label, value]) =>
              value === undefined ? null : (
                <p key={label} className="mt-1 break-all select-text">
                  {label}: {value}
                </p>
              ),
            )}
          </details>
        ) : null}
        {}
        {isNotFound ? (
          <p className="mt-4 text-ui-base leading-6 text-foreground-subtle">
            {copy.notFoundAccountHint}
          </p>
        ) : null}
        {}
        {showLogin && onLogin ? (
          <div className="mt-5 space-y-2">
            {SHARE_LOGIN_PROVIDERS.map((provider) => (
              <button
                key={provider}
                type="button"
                data-share-login-provider={provider}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-ui-base text-primary-foreground"
                onClick={() => onLogin(provider)}
              >
                {renderOAuthProviderIcon(provider, "size-4")}
                <span className="min-w-0 truncate">{copy.loginWith[provider]}</span>
                <span className="ml-1 inline-flex h-5 shrink-0 items-center rounded-full border border-primary-foreground/30 px-2 text-ui-xs font-medium leading-none text-primary-foreground/60">
                  {copy.loginRegion[provider]}
                </span>
              </button>
            ))}
          </div>
        ) : null}
        {canRetry || isNotFound ? (
          <div className="mt-5 flex flex-wrap gap-2">
            {canRetry ? (
              <button
                type="button"
                className="rounded-md border border-border px-4 py-2 text-ui-base text-foreground"
                onClick={onRetry}
              >
                {copy.retry}
              </button>
            ) : null}
            {isNotFound ? (
              <a
                className="rounded-md bg-primary px-4 py-2 text-ui-base text-primary-foreground"
                href={CF_DOWNLOAD_URL}
              >
                {copy.backToHome}
              </a>
            ) : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}

export function ConversationShareLandingLoader({
  shareCode,
  client,
  getAccessToken,
  onLogin,
  onLogout,
  locale,
  theme,
}: {
  shareCode: string;
  client: {
    getPreview: (shareCode: string, accessToken?: string) => Promise<ConversationSharePreview>;
  };
  getAccessToken?: () => string | null;
  onLogin?: (provider: WebOAuthProviderId) => void;
  onLogout?: () => void;
  locale?: ConversationShareLandingLocale;
  theme?: Theme;
}) {
  const [state, setState] = useState<ConversationShareLandingState>({ kind: "loading" });
  const [activeTheme, setActiveTheme] = useState<Theme>(theme ?? "cf-light");
  const handleThemeChange = useCallback((nextTheme: Theme) => {
    localStorage.setItem("cf-theme", nextTheme);
    setActiveTheme(nextTheme);
    applyTheme(nextTheme);
  }, []);
  useEffect(() => {
    if (activeTheme !== "system") return;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemThemeChange = () => applyTheme("system");
    mediaQuery.addEventListener("change", handleSystemThemeChange);
    return () => mediaQuery.removeEventListener("change", handleSystemThemeChange);
  }, [activeTheme]);
  const load = useCallback(async () => {
    setState({ kind: "loading" });
    const initialToken = getAccessToken?.() ?? null;
    try {
      const preview = await client.getPreview(shareCode, initialToken ?? undefined);
      setState({ kind: "ready", preview });
    } catch (error) {
      const kind =
        error && typeof error === "object" && "kind" in error
          ? (error as ConversationSharePreviewClientError).kind
          : "network";
      const failure = error as Partial<ConversationSharePreviewClientError> | null;
      const diagnostics = {
        status: failure?.status,
        code: failure?.code,
        requestId: failure?.requestId,
      };
      logPreviewLoadFailure(initialToken ? "authenticated" : "anonymous", error, kind);
      if (kind === "authentication_required" || kind === "not_found") {
        if (initialToken) {
          setState({ kind: "error", error: kind, ...diagnostics });
          if (kind === "authentication_required") onLogout?.();
          return;
        }
        setState({ kind: "login_required" });
        return;
      }
      setState({ kind: "error", error: kind, ...diagnostics });
    }
  }, [client, getAccessToken, onLogout, shareCode]);
  useEffect(() => {
    void load();
  }, [load]);
  if (state.kind === "ready")
    return (
      <ConversationShareLandingPage
        shareCode={shareCode}
        preview={state.preview}
        locale={locale}
        theme={activeTheme}
        onThemeChange={handleThemeChange}
      />
    );
  return (
    <ConversationShareLandingStatus
      state={state}
      locale={locale}
      onLogin={onLogin}
      onRetry={() => void load()}
    />
  );
}
