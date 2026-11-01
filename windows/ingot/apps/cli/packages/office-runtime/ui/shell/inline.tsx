import type { ReactNode, RefObject } from "react";
import type { DocKind, DocumentInfo } from "#office/contract.ts";
import type { Strings } from "#ui/i18n.ts";
import { Icon } from "#ui/icons.tsx";
import { baseName } from "#ui/rpc.ts";
import { ErrorState, Skeleton } from "#ui/shell/panes.tsx";
import type { Failure } from "#ui/shell/state.ts";

export function InlineShell({
  appRef,
  canvasRef,
  t,
  path,
  info,
  kind,
  showSkeleton,
  failure,
  nothing,
  onExpand,
  children,
}: {
  appRef: RefObject<HTMLDivElement | null>;
  canvasRef: RefObject<HTMLDivElement | null>;
  t: Strings;
  path: string | null;
  info: DocumentInfo | undefined;
  kind: DocKind | null;
  showSkeleton: boolean;
  failure: Failure | null;
  nothing: boolean;
  onExpand(): void;
  children: ReactNode;
}) {
  return (
    <div ref={appRef} className="app inline">
      <header className="docbar">
        <div className="doctitle static" title={path ?? undefined}>
          <span className="name">{path ? baseName(path) : t.title}</span>
          {info && t.meta[info.kind](info.units) ? (
            <span className="meta">{t.meta[info.kind](info.units)}</span>
          ) : null}
        </div>
        <span className="spacer" />
        <button type="button" className="btn sm" title={t.sidePanel} onClick={onExpand}>
          <Icon name="maximize-2" size={12} />
          {t.sidePanel}
        </button>
      </header>
      <div className="stage">
        <div ref={canvasRef} className="canvas">
          {children}
          {showSkeleton ? <Skeleton kind={kind} /> : null}
          {failure ? (
            <ErrorState
              t={t}
              title={failure.title}
              detail={failure.detail}
              onOpenAnother={onExpand}
            />
          ) : null}
          {nothing ? <div className="failed muted">{t.openTitle}</div> : null}
          <button
            type="button"
            className="glance-cover"
            aria-label={t.sidePanel}
            onClick={onExpand}
          />
        </div>
      </div>
    </div>
  );
}
