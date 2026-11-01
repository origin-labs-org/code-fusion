import {
  type CfProvider,
} from "@origin-ai/cf-shared";

const BOT_NATIVE_MODEL_PROVIDER_PREFIX = "native:";

export function resolveTaskModel(model: string | undefined): string | undefined {
  return model && model !== "default" ? model : undefined;
}

export function getNativeModelProviderId(cfProvider: CfProvider): string {
  return `${BOT_NATIVE_MODEL_PROVIDER_PREFIX}${cfProvider}`;
}
