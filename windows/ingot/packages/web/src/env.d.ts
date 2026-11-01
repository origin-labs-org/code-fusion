declare module "*.css";
declare module "@origin-ai/cf-ui/styles.css";

interface ImportMetaEnv {
  readonly BASE_URL: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly VITE_DEV_ORIGIN?: string;
  readonly VITE_CONVERSATION_SHARE_PREVIEW_MOCK?: string;
  readonly VITE_WEB_REMOTE_ALLOW_DEV_RETURN_TO?: string;
  readonly VITE_WEB_REMOTE_CONTROL_ROUTE_PATH?: string;
  readonly VITE_CF_BASE_URL?: string;
  readonly VITE_CF_ENDPOINT_ORIGIN?: string;
  readonly VITE_CF_WEB_REMOTE_CONTROL_RELAY_WS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
