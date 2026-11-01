import {
  HostResponseTypes,
  resolveWorkspaceTelemetryDetail,
  type AutomationSessionCreateTelemetry,
} from "@origin-ai/cf-shared";

export function reportHostSessionCreate(
  port: { postMessage(message: unknown): void } | null | undefined,
  input: {
    sessionId: string;
    messageId: string;
    source: AutomationSessionCreateTelemetry["eventExtraDetail"]["create_source"];
    workspaceIdentity?: string;
  },
): void {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions();
    const event: AutomationSessionCreateTelemetry = {
      elementName: "session_create",
      eventRegion: "app",
      eventType: "result",
      talkId: input.sessionId,
      messageId: input.messageId,
      context: {
        clientTimezone: locale.timeZone,
        clientLanguage: locale.locale,
        screenResolution: "",
      },
      eventExtraDetail: {
        create_source: input.source,
        client_kind: "desktop",
        ...resolveWorkspaceTelemetryDetail(input),
      },
    };
    port?.postMessage({ type: HostResponseTypes.SessionCreateTelemetry, event });
  } catch {
  }
}
