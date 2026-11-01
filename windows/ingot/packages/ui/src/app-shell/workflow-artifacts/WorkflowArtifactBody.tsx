import { lazy, Suspense, useMemo } from "react";
import type { FileBinaryPreview } from "@origin-ai/cf-shared";
import { CodeBlock } from "@/components/ai-elements/code-block.js";
import { MessageResponse } from "@/components/ai-elements/message.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import {
  buildPresetLabels,
  isArtifactPresetKind,
} from "@/app-shell/workflow-artifacts/artifactPresentation.js";
import { ArtifactPresetBody } from "@/app-shell/workflow-artifacts/ArtifactPresetBody.js";
import {
  ArtifactMetadataCard,
  ArtifactNotice,
  WorkflowArtifactHtmlCard,
} from "@/app-shell/workflow-artifacts/WorkflowArtifactCards.js";
import type { ArtifactItem } from "@/app-shell/workflow-artifacts/presets/index.js";
import type { WorkflowRunArtifactView } from "@/hooks/useWorkflowRunArtifacts.js";
import { encodeBytesToBase64 } from "@/hooks/useWorkflowRunArtifactBytes.js";
import { usePdfViewerLabels, usePptxViewerLabels } from "@/hooks/usePreviewViewerLabels.js";
import type { Theme } from "@/useTheme.js";

const PdfPreviewContent = lazy(() =>
  import("@/previewPanePdfContent.js").then((module) => ({ default: module.PdfPreviewContent })),
);
const PptxPreviewContent = lazy(() =>
  import("@/previewPanePptxContent.js").then((module) => ({ default: module.PptxPreviewContent })),
);
const PreviewPaneOfficeContent = lazy(() =>
  import("@/previewPaneOfficeContent.js").then((module) => ({
    default: module.PreviewPaneOfficeContent,
  })),
);

const PPTX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function textLanguageFor(contentType: string): string | undefined {
  if (contentType === "application/json") return "json";
  if (contentType === "text/csv") return "csv";
  if (contentType === "text/plain") return "text";
  if (contentType.startsWith("text/")) return "text";
  return undefined;
}

interface WorkflowArtifactBodyProps {
  artifact: WorkflowRunArtifactView;
  
  version: number;
  bytes: Uint8Array<ArrayBuffer> | null;
  blob: Blob | null;
  objectUrl: string | null;
  
  loading: boolean;
  error: string | null;
  
  items: readonly ArtifactItem[];
  theme: Theme;
  resolvedTheme: "light" | "dark";
  
  onOpenBrowserUrl?: (url: string) => void;
  
  localSourcePath?: string;
  
  onReveal?: () => void;
  
  isLatestVersion: boolean;
  
  metadataLoading: boolean;
}

export function WorkflowArtifactBody(props: WorkflowArtifactBodyProps) {
  const { intl } = useCfIntl();
  const { artifact } = props;

  if (isArtifactPresetKind(artifact.kind)) {
    const labels = buildPresetLabels((descriptor, values) =>
      intl.formatMessage(descriptor, values),
    );
    return (
      <div className="h-full min-h-0 overflow-auto p-4" data-artifact-body="preset">
        <ArtifactPresetBody
          artifact={artifact}
          items={props.items}
          labels={labels}
          invalidLabel={intl.formatMessage({
            id: "chat.toolCall.workflow.run.artifacts.presetInvalid",
          })}
          {...(props.metadataLoading
            ? {}
            : {
                missingLabel: intl.formatMessage({
                  id: "chat.toolCall.workflow.run.artifacts.unavailable",
                }),
              })}
        />
      </div>
    );
  }

  if (props.error !== null) {
    return (
      <ArtifactNotice
        testId="workflow-artifact-error"
        tone="error"
        text={intl.formatMessage({ id: "chat.toolCall.workflow.run.artifacts.loadError" })}
        detail={props.error}
      />
    );
  }
  if (props.loading || props.bytes === null) {
    return (
      <ArtifactNotice
        testId="workflow-artifact-loading"
        text={intl.formatMessage({ id: "chat.toolCall.workflow.run.artifacts.loading" })}
      />
    );
  }

  return <WorkflowArtifactContent {...props} bytes={props.bytes} />;
}

function WorkflowArtifactContent({
  artifact,
  bytes,
  blob,
  objectUrl,
  theme,
  resolvedTheme,
  onOpenBrowserUrl,
  onReveal,
  localSourcePath,
  isLatestVersion,
}: WorkflowArtifactBodyProps & { bytes: Uint8Array<ArrayBuffer> }) {
  const { intl } = useCfIntl();
  const pdfLabels = usePdfViewerLabels();
  const pptxLabels = usePptxViewerLabels();
  const contentType = artifact.contentType ?? "application/octet-stream";

  const text = useMemo(() => {
    if (
      contentType !== "text/markdown" &&
      contentType !== "text/html" &&
      textLanguageFor(contentType) === undefined
    ) {
      return undefined;
    }
    return new TextDecoder().decode(bytes);
  }, [bytes, contentType]);

  const officePreview = useMemo<FileBinaryPreview | null>(() => {
    if (contentType !== DOCX_CONTENT_TYPE && contentType !== XLSX_CONTENT_TYPE) return null;
    return {
      path: artifact.sourcePath ?? artifact.id,
      dataBase64: encodeBytesToBase64(bytes),
      totalBytes: bytes.length,
    };
  }, [artifact.id, artifact.sourcePath, bytes, contentType]);

  const pptxBuffer = useMemo(
    () =>
      contentType === PPTX_CONTENT_TYPE
        ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
        : null,
    [bytes, contentType],
  );

  if (contentType === "text/markdown") {
    return (
      <div className="h-full min-h-0 overflow-y-auto px-4 py-4" data-artifact-body="markdown">
        <MessageResponse
          className="mx-auto w-full min-w-0 max-w-4xl break-words text-foreground"
          theme={theme}
        >
          {text ?? ""}
        </MessageResponse>
      </div>
    );
  }

  if (contentType === "application/pdf") {
    return (
      <div className="h-full min-h-0" data-artifact-body="pdf">
        <Suspense fallback={<ArtifactNotice text={pdfLabels.loading} />}>
          {}
          <PdfPreviewContent labels={pdfLabels} source={blob ?? new Blob([bytes])} />
        </Suspense>
      </div>
    );
  }

  if (contentType.startsWith("image/")) {
    return (
      <div
        className="flex h-full min-h-0 items-center justify-center overflow-auto bg-background-alt p-4"
        data-artifact-body="image"
      >
        {objectUrl === null ? (
          <ArtifactNotice
            text={intl.formatMessage({ id: "chat.toolCall.workflow.run.artifacts.loadError" })}
            tone="error"
          />
        ) : (
          <img
            alt={artifact.title ?? artifact.id}
            className="max-h-full max-w-full object-contain"
            data-testid="workflow-artifact-image"
            src={objectUrl}
          />
        )}
      </div>
    );
  }

  if (contentType === PPTX_CONTENT_TYPE && pptxBuffer !== null) {
    return (
      <div className="h-full min-h-0" data-artifact-body="pptx">
        <Suspense fallback={<ArtifactNotice text={pptxLabels.loading} />}>
          <PptxPreviewContent
            data={pptxBuffer}
            fileName={artifact.sourcePath ?? artifact.id}
            labels={pptxLabels}
            {...(onOpenBrowserUrl === undefined ? {} : { onOpenBrowserUrl })}
          />
        </Suspense>
      </div>
    );
  }

  if (officePreview !== null) {
    return (
      <div className="h-full min-h-0" data-artifact-body="office">
        <Suspense fallback={<ArtifactNotice text={pdfLabels.loading} />}>
          <PreviewPaneOfficeContent
            error={null}
            kind={contentType === XLSX_CONTENT_TYPE ? "excel" : "docx"}
            loading={false}
            preview={officePreview}
            resolvedTheme={resolvedTheme}
            sourcePath={artifact.sourcePath ?? artifact.id}
            {...(onOpenBrowserUrl === undefined ? {} : { onOpenBrowserUrl })}
          />
        </Suspense>
      </div>
    );
  }

  if (contentType === "text/html") {
    return (
      <WorkflowArtifactHtmlCard
        artifact={artifact}
        bytes={bytes.length}
        isLatestVersion={isLatestVersion}
        {...(localSourcePath === undefined ? {} : { localSourcePath })}
        {...(onOpenBrowserUrl === undefined ? {} : { onOpenBrowserUrl })}
        {...(onReveal === undefined ? {} : { onReveal })}
      />
    );
  }

  const language = textLanguageFor(contentType);
  if (language !== undefined && text !== undefined) {
    return (
      <div className="h-full min-h-0 overflow-auto" data-artifact-body="text">
        <CodeBlock appTheme={theme} code={text} language={language} showLineNumbers />
      </div>
    );
  }

  return (
    <ArtifactMetadataCard
      artifact={artifact}
      bytes={bytes.length}
      note={intl.formatMessage({ id: "chat.toolCall.workflow.run.artifacts.unsupported" })}
      testId="workflow-artifact-unsupported"
      {...(onReveal === undefined
        ? {}
        : {
            action: {
              label: intl.formatMessage({ id: "chat.toolCall.workflow.run.artifacts.reveal" }),
              onActivate: onReveal,
              testId: "workflow-artifact-unsupported-reveal",
            },
          })}
    />
  );
}
