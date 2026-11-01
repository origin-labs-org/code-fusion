import { useEffect, useState, useRef, useEffectEvent } from "react";
import type { IServiceAccessor } from "@origin-ai/cf-services";
import type { FileEntry } from "@origin-ai/cf-shared";
import { FolderIcon, FolderSymlinkIcon, LoaderIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { cn } from "@/components/lib/utils.js";

export function createDirectoryBrowserReadParams(
  path: string,
  showHiddenDirectories: boolean,
): { path: string; includeHidden?: boolean } {
  return showHiddenDirectories ? { path, includeHidden: true } : { path };
}

export function filterDirectoryBrowserEntries(entries: FileEntry[]): FileEntry[] {
  return entries.filter((e) => e.type === "directory");
}

export function getDirectoryBrowserEntryIconKind(
  entry: Pick<FileEntry, "isSymbolicLink" | "type">,
): "folder" | "folder-symlink" {
  return entry.type === "directory" && entry.isSymbolicLink === true ? "folder-symlink" : "folder";
}

export function createDirectoryBrowserRequestGuard(): {
  begin: () => number;
  isCurrent: (requestId: number) => boolean;
} {
  let latestRequestId = 0;

  return {
    begin: () => {
      latestRequestId += 1;
      return latestRequestId;
    },
    isCurrent: (requestId: number) => requestId === latestRequestId,
  };
}

export function DirectoryBrowser({
  services,
  onSelect,
  onCancel,
  onPathChange,
  initialPath,
  onNavigationStateChange,
  navigationRevision = 0,
  embedded = false,
  showSelectionActions = false,
  selectLabel,
  selecting,
  formatError,
}: {
  services: {
    fileService: Pick<IServiceAccessor["fileService"], "readdir">;
    systemService: { info(): Promise<{ homedir: string }> };
  };
  onSelect: (path: string) => void;
  onCancel: () => void;
  onPathChange?: (path: string) => void;
  initialPath?: string;
  onNavigationStateChange?: (ready: boolean) => void;
  navigationRevision?: number;
  embedded?: boolean;
  showSelectionActions?: boolean;
  selectLabel?: string;
  selecting?: boolean;
  formatError?: (error: unknown) => string;
}) {
  const [currentPath, setCurrentPath] = useState("");
  const [inputPath, setInputPath] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showHiddenDirectories, setShowHiddenDirectories] = useState(false);
  const requestedPathRef = useRef("");
  const appliedNavigationRevisionRef = useRef(navigationRevision);
  const listRef = useRef<HTMLDivElement>(null);
  const showHiddenDirectoriesRef = useRef(false);
  const requestGuardRef = useRef(createDirectoryBrowserRequestGuard());
  const { intl } = useCfIntl();

  useEffect(() => {
    let disposed = false;
    const homeRequestId = requestGuardRef.current.begin();
    if (initialPath) {
      void navigateTo(initialPath);
    } else {
      void services.systemService
        .info()
        .then((info) => {
          if (!disposed && requestGuardRef.current.isCurrent(homeRequestId))
            void navigateTo(info.homedir);
        })
        .catch((err) => {
          if (disposed || !requestGuardRef.current.isCurrent(homeRequestId)) return;
          logger.error("[DirectoryBrowser] Failed to get system information:", err);
          setError(
            formatError?.(err) ?? intl.formatMessage({ id: "directoryBrowser.errorSystem" }),
          );
          setLoading(false);
        });
    }
    return () => {
      disposed = true;
      requestGuardRef.current.begin();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const navigateTo = async (
    path: string,
    nextShowHiddenDirectories = showHiddenDirectoriesRef.current,
  ) => {
    requestedPathRef.current = path;
    const requestId = requestGuardRef.current.begin();
    onNavigationStateChange?.(false);
    setLoading(true);
    setError("");
    try {
      const result = await services.fileService.readdir(
        createDirectoryBrowserReadParams(path, nextShowHiddenDirectories),
      );
      if (!requestGuardRef.current.isCurrent(requestId)) {
        return;
      }
      const dirs = filterDirectoryBrowserEntries(result);
      setEntries(dirs);
      setCurrentPath(path);
      setInputPath(path);
      onPathChange?.(path);
      onNavigationStateChange?.(true);
      listRef.current?.scrollTo(0, 0);
    } catch (err) {
      if (!requestGuardRef.current.isCurrent(requestId)) {
        return;
      }
      logger.error("[DirectoryBrowser] readdir 失败:", err);
      setError(
        formatError?.(err) ?? intl.formatMessage({ id: "directoryBrowser.errorUnavailable" }),
      );
    } finally {
      if (requestGuardRef.current.isCurrent(requestId)) {
        setLoading(false);
      }
    }
  };

  const navigateFromParent = useEffectEvent((path: string) => {
    void navigateTo(path);
  });
  useEffect(() => {
    if (
      initialPath &&
      (initialPath !== requestedPathRef.current ||
        navigationRevision !== appliedNavigationRevisionRef.current)
    ) {
      appliedNavigationRevisionRef.current = navigationRevision;
      navigateFromParent(initialPath);
    }
  }, [initialPath, navigationRevision]);

  const handleGoUp = () => {
    const parent = currentPath.replace(/\/[^/]+\/?$/, "") || "/";
    navigateTo(parent);
  };

  const handleInputSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputPath.trim();
    if (trimmed) navigateTo(trimmed);
  };

  const handleToggleHiddenDirectories = () => {
    const nextShowHiddenDirectories = !showHiddenDirectoriesRef.current;
    showHiddenDirectoriesRef.current = nextShowHiddenDirectories;
    setShowHiddenDirectories(nextShowHiddenDirectories);

    if (currentPath) {
      void navigateTo(currentPath, nextShowHiddenDirectories);
    }
  };

  const handleSelectCurrentPath = () => {
    const selectedPath = currentPath.trim();
    if (!selectedPath || loading || selecting) {
      return;
    }

    onSelect(selectedPath);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onCancel();
  };

  const browserContent = (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-3",
        embedded && "rounded-md border border-border bg-surface p-3",
      )}
    >
      <div>
        {!embedded ? (
          <div className="mb-1 block text-ui-base text-foreground-subtle">
            {intl.formatMessage({ id: "directoryBrowser.title" })}
          </div>
        ) : null}

        {}
        <form onSubmit={handleInputSubmit} className="flex flex-col gap-2 sm:flex-row">
          <Input
            type="text"
            aria-label={intl.formatMessage({
              id: "directoryBrowser.pathPlaceholder",
            })}
            size="lg"
            value={inputPath}
            onChange={(e) => setInputPath(e.target.value)}
            placeholder={intl.formatMessage({
              id: "directoryBrowser.pathPlaceholder",
            })}
            className="h-9 min-w-0 flex-1 font-mono placeholder:font-sans text-ui-base max-md:text-mobile-input-safe"
            autoFocus
          />
          <div className="flex gap-2 sm:shrink-0">
            <Button
              type="submit"
              variant="secondary"
              size="lg"
              className="h-9 min-w-0 flex-1 px-4 text-ui-base sm:flex-none"
            >
              {intl.formatMessage({ id: "directoryBrowser.go" })}
            </Button>
            <Button
              type="button"
              variant={showHiddenDirectories ? "secondary" : "ghost"}
              size="lg"
              aria-pressed={showHiddenDirectories}
              className="h-9 min-w-0 flex-1 px-3 text-ui-base sm:flex-none"
              onClick={handleToggleHiddenDirectories}
            >
              {intl.formatMessage({
                id: showHiddenDirectories
                  ? "directoryBrowser.hideHidden"
                  : "directoryBrowser.showHidden",
              })}
            </Button>
          </div>
        </form>
      </div>

      {}
      {error ? <div className="text-ui-base text-destructive">{error}</div> : null}

      {}
      <div
        ref={listRef}
        className={cn(
          "flex-1 flex flex-col overflow-y-auto",
          embedded
            ? "min-h-24 max-h-64 rounded-md bg-background"
            : "rounded-lg border border-border bg-background",
        )}
      >
        {}
        {currentPath && currentPath !== "/" ? (
          <button
            onClick={handleGoUp}
            className="flex h-10 w-full shrink-0 cursor-pointer items-center gap-2 px-3 text-left text-ui-base transition hover:bg-hover/50"
          >
            <FolderIcon className="size-4 shrink-0 text-foreground-subtle" />
            <span className="text-foreground">..</span>
          </button>
        ) : null}

        {loading ? (
          <div className="p-4 text-center text-ui-base text-foreground-subtle">
            {intl.formatMessage({ id: "common.loading" })}
          </div>
        ) : entries.length === 0 ? (
          <div className="p-4 text-center text-ui-base text-foreground-subtle">
            {intl.formatMessage({ id: "directoryBrowser.noSubdirs" })}
          </div>
        ) : (
          entries.map((entry) => {
            const EntryIcon =
              getDirectoryBrowserEntryIconKind(entry) === "folder-symlink"
                ? FolderSymlinkIcon
                : FolderIcon;

            return (
              <button
                key={entry.path}
                onClick={() => navigateTo(entry.path)}
                className="flex w-full shrink-0 cursor-pointer items-center gap-2 px-3 py-2 text-left text-ui-base transition hover:bg-hover/50"
              >
                <EntryIcon className="size-4 shrink-0 text-foreground-subtle" />
                <span className="truncate">{entry.name}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );

  const selectionActions = (
    <>
      {" "}
      {}
      <div className="mt-3 flex shrink-0 justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          size="lg"
          className="h-10 min-w-0 px-5 text-ui-base"
          onClick={onCancel}
        >
          {intl.formatMessage({ id: "common.cancel" })}
        </Button>
        <Button
          type="button"
          size="lg"
          className={cn(
            "h-10 min-w-0 px-5 text-ui-base",
            selecting !== undefined && "grid",
            selecting && "disabled:opacity-100",
          )}
          disabled={!currentPath.trim() || loading || Boolean(error) || selecting}
          aria-busy={selecting}
          data-testid="directory-browser-confirm"
          onClick={handleSelectCurrentPath}
        >
          {}
          <span
            className={cn("col-start-1 row-start-1", selecting && "invisible")}
            aria-hidden={selecting || undefined}
          >
            {selectLabel ?? intl.formatMessage({ id: "directoryBrowser.selectDir" })}
          </span>
          {selecting !== undefined ? (
            <span
              className={cn(
                "col-start-1 row-start-1 inline-flex items-center justify-center gap-2",
                !selecting && "invisible",
              )}
              role={selecting ? "status" : undefined}
              aria-hidden={!selecting}
            >
              <LoaderIcon
                aria-hidden="true"
                className="size-4 animate-spin motion-reduce:animate-none"
              />
              {intl.formatMessage({ id: "directoryBrowser.opening" })}
            </span>
          ) : null}
        </Button>
      </div>
    </>
  );
  if (embedded)
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {browserContent}
        {showSelectionActions ? selectionActions : null}
      </div>
    );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
      onKeyDown={handleKeyDown}
    >
      <div className="flex h-[min(36rem,calc(100vh-4rem))] w-[min(44rem,calc(100vw-2rem))] flex-col rounded-xl border border-border bg-popover p-4 shadow-xl">
        {browserContent}
        {selectionActions}
      </div>
    </div>
  );
}
