import { FileTextIcon, GlobeIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { MessageFileLinkTarget } from "@/components/ai-elements/message.js";
import { useWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import {
  type AssistantPreviewCard,
  type AssistantPreviewCardFileStatService,
  type AssistantPreviewCardsAutoOpenRequest,
  getAssistantPreviewCardFilePath,
  shouldOpenAssistantHtmlInBrowser,
} from "@/lib/assistantPreviewCards.js";
import {
  getAssistantPreviewCardsValidationSignature,
  resolveAssistantPreviewCardsWithoutFileStat,
  resolveValidatedAssistantPreviewCards,
} from "@/lib/assistantPreviewCardValidation.js";
import type { CodeViewerSource } from "@/lib/codeViewer.js";
import { FileDisplayIcon, resolveFileDisplayDescriptor } from "@/lib/fileDisplay.js";
import { OpenSplitButton } from "@/OpenSplitButton.js";

export interface AssistantPreviewCardValidationResult {
  visibleCards: AssistantPreviewCard[];
  settled: boolean;
}

export function buildAssistantPreviewCardFileSource(
  card: Extract<AssistantPreviewCard, { type: "markdown" | "file" }>,
  scope: {
    workspacePath?: string;
    workspaceIdentity?: string;
    workspaceRemoteSessionId?: string;
  },
): CodeViewerSource {
  return {
    type: "file",
    title: card.title,
    path: card.path,
    ...(scope.workspacePath ? { workspacePath: scope.workspacePath } : {}),
    ...(scope.workspaceIdentity ? { workspaceIdentity: scope.workspaceIdentity } : {}),
    ...(scope.workspaceRemoteSessionId
      ? { workspaceRemoteSessionId: scope.workspaceRemoteSessionId }
      : {}),
  };
}

export function buildAssistantPreviewPptxAutoOpenRequest(
  visibleCards: readonly AssistantPreviewCard[],
  baseKey: string,
  scope: {
    workspacePath?: string;
    workspaceIdentity?: string;
    workspaceRemoteSessionId?: string;
  },
): AssistantPreviewCardsAutoOpenRequest | null {
  const pptxCards = visibleCards.filter(
    (card): card is Extract<AssistantPreviewCard, { type: "file" }> =>
      card.type === "file" && card.kind === "pptx",
  );
  if (pptxCards.length === 0) return null;

  return {
    key: JSON.stringify([baseKey, getAssistantPreviewCardsValidationSignature(pptxCards)]),
    sources: pptxCards.map((card) => buildAssistantPreviewCardFileSource(card, scope)),
  };
}

interface AssistantPreviewCardsProps {
  cards: AssistantPreviewCard[];
  workspacePath?: string;
  workspaceIdentity?: string;
  workspaceRemoteSessionId?: string;
  onOpenBrowserUrl?: (url: string) => void;
  onOpenFileLink?: (target: MessageFileLinkTarget) => void;
  onOpenCodeViewer?: (source: CodeViewerSource) => void;
  
  autoOpenPptxKey?: string;
  onAutoOpenPptx?: (request: AssistantPreviewCardsAutoOpenRequest) => void;
  compactForRemoteControl?: boolean;
}

export function shouldRenderAssistantPreviewCardAsFile(
  card: AssistantPreviewCard,
  scope: {
    workspaceIdentity?: string;
    workspaceRemoteSessionId?: string;
    compactForRemoteControl?: boolean;
  },
): boolean {
  const filePath = getAssistantPreviewCardFilePath(card);
  return (
    card.type !== "website" ||
    (card.url.startsWith("file://") &&
      filePath !== null &&
      !shouldOpenAssistantHtmlInBrowser({ path: filePath, ...scope }))
  );
}

export function useAssistantPreviewCardValidation(
  cards: AssistantPreviewCard[],
  scope: {
    workspacePath?: string;
    workspaceIdentity?: string;
    workspaceRemoteSessionId?: string;
  } = {},
): AssistantPreviewCardValidationResult {
  const { fileService } = useWorkspaceServices(
    scope.workspacePath,
    scope.workspaceRemoteSessionId,
    scope.workspaceIdentity,
  );
  const cardsSignature = useMemo(() => getAssistantPreviewCardsValidationSignature(cards), [cards]);
  const validationCardsRef = useRef({ cards, signature: cardsSignature });
  if (validationCardsRef.current.signature !== cardsSignature) {
    validationCardsRef.current = { cards, signature: cardsSignature };
  }
  const validationCards = validationCardsRef.current.cards;
  const statFreeVisibleCards = useMemo(
    () => resolveAssistantPreviewCardsWithoutFileStat(validationCards),
    [validationCards],
  );
  const [validationResult, setValidationResult] = useState<{
    fileService: AssistantPreviewCardFileStatService | null;
    signature: string;
    visibleCards: AssistantPreviewCard[];
  }>(() => ({
    fileService: null,
    signature: "",
    visibleCards: [],
  }));

  useEffect(() => {
    if (statFreeVisibleCards) {
      return;
    }

    let disposed = false;

    void resolveValidatedAssistantPreviewCards(validationCards, fileService).then(
      (visibleCards) => {
        if (disposed) return;
        setValidationResult({
          fileService,
          signature: cardsSignature,
          visibleCards,
        });
      },
      () => {
        if (disposed) return;
        setValidationResult({
          fileService,
          signature: cardsSignature,
          visibleCards: [],
        });
      },
    );

    return () => {
      disposed = true;
    };
  }, [cardsSignature, fileService, statFreeVisibleCards, validationCards]);

  if (statFreeVisibleCards) {
    return {
      visibleCards: statFreeVisibleCards,
      settled: true,
    };
  }

  const hasCurrentValidation =
    validationResult.fileService === fileService && validationResult.signature === cardsSignature;

  return {
    visibleCards: hasCurrentValidation ? validationResult.visibleCards : [],
    settled: hasCurrentValidation,
  };
}

export function AssistantPreviewCards({
  cards,
  workspacePath,
  workspaceIdentity,
  workspaceRemoteSessionId,
  onOpenBrowserUrl,
  onOpenFileLink,
  onOpenCodeViewer,
  autoOpenPptxKey,
  onAutoOpenPptx,
  compactForRemoteControl,
}: AssistantPreviewCardsProps) {
  const { intl } = useCfIntl();
  const { visibleCards, settled } = useAssistantPreviewCardValidation(cards, {
    workspacePath,
    workspaceIdentity,
    workspaceRemoteSessionId,
  });

  useEffect(() => {
    if (!settled || !autoOpenPptxKey || !onAutoOpenPptx) return;

    const request = buildAssistantPreviewPptxAutoOpenRequest(visibleCards, autoOpenPptxKey, {
      workspacePath,
      workspaceIdentity,
      workspaceRemoteSessionId,
    });
    if (!request) return;

    onAutoOpenPptx(request);
  }, [
    autoOpenPptxKey,
    onAutoOpenPptx,
    settled,
    visibleCards,
    workspaceIdentity,
    workspacePath,
    workspaceRemoteSessionId,
  ]);

  if (!settled || visibleCards.length === 0) {
    return null;
  }

  return (
    <div className="flex w-full flex-col gap-3">
      {visibleCards.map((card, index) => (
        <AssistantPreviewCardRow
          key={card.id}
          card={card}
          animationDelayMs={Math.min(index * 36, 240)}
          subtitle={intl.formatMessage({ id: card.subtitleId })}
          workspacePath={workspacePath}
          workspaceIdentity={workspaceIdentity}
          workspaceRemoteSessionId={workspaceRemoteSessionId}
          onOpenBrowserUrl={onOpenBrowserUrl}
          onOpenFileLink={onOpenFileLink}
          onOpenCodeViewer={onOpenCodeViewer}
          compactForRemoteControl={compactForRemoteControl}
        />
      ))}
    </div>
  );
}

function AssistantPreviewCardRow({
  card,
  animationDelayMs,
  subtitle,
  workspacePath,
  workspaceIdentity,
  workspaceRemoteSessionId,
  onOpenBrowserUrl,
  onOpenFileLink,
  onOpenCodeViewer,
  compactForRemoteControl,
}: {
  card: AssistantPreviewCard;
  animationDelayMs: number;
  subtitle: string;
  workspacePath?: string;
  workspaceIdentity?: string;
  workspaceRemoteSessionId?: string;
  onOpenBrowserUrl?: (url: string) => void;
  onOpenFileLink?: (target: MessageFileLinkTarget) => void;
  onOpenCodeViewer?: (source: CodeViewerSource) => void;
  compactForRemoteControl?: boolean;
}) {
  const filePath = getAssistantPreviewCardFilePath(card);
  const renderAsFile = shouldRenderAssistantPreviewCardAsFile(card, {
    workspaceIdentity,
    workspaceRemoteSessionId,
    compactForRemoteControl,
  });
  const descriptor = filePath ? resolveFileDisplayDescriptor(filePath) : null;
  const fileSource =
    renderAsFile && filePath
      ? {
          type: "file" as const,
          title: card.title,
          path: filePath,
          ...(workspacePath ? { workspacePath } : {}),
          ...(workspaceIdentity ? { workspaceIdentity } : {}),
          ...(workspaceRemoteSessionId ? { workspaceRemoteSessionId } : {}),
        }
      : null;
  return (
    <OpenSplitButton
      renderCard={(button) => (
        <div
          className="flex w-full items-center gap-3 rounded-xl border border-card-border bg-card p-3 pr-4 text-foreground"
          data-preview-card-title={card.title}
          data-cf-stream-animate="true"
          style={
            {
              "--cf-stream-animation-delay": `${animationDelayMs}ms`,
            } as CSSProperties
          }
        >
          <div className="flex size-11 shrink-0 items-center justify-center rounded-md bg-background text-foreground-subtle">
            {!renderAsFile && card.type === "website" ? (
              <GlobeIcon className="size-6" />
            ) : descriptor ? (
              <FileDisplayIcon src={descriptor.fileIconSrc} size={24} />
            ) : (
              <FileTextIcon className="size-6" />
            )}
          </div>
          <div className="min-w-0 flex flex-1 flex-col gap-1">
            <div className="truncate text-ui-base font-medium leading-5">{card.title}</div>
            <div className="truncate text-ui-base leading-5 text-foreground-subtlest">
              {subtitle}
            </div>
          </div>
          {button}
        </div>
      )}
      target={
        !renderAsFile && card.type === "website"
          ? {
              type: "website",
              url: card.url,
              workspacePath,
              localPath: card.url.startsWith("file:") ? card.filePath : undefined,
            }
          : {
              type: "file",
              path: filePath!,
              title: card.title,
              label: card.title,
              previewSource:
                card.type === "website"
                  ? fileSource!
                  : buildAssistantPreviewCardFileSource(card, {
                      workspacePath,
                      workspaceIdentity,
                      workspaceRemoteSessionId,
                    }),
            }
      }
      onOpenBrowserUrl={onOpenBrowserUrl}
      onOpenFileLink={onOpenFileLink}
      onOpenCodeViewer={onOpenCodeViewer}
    />
  );
}
