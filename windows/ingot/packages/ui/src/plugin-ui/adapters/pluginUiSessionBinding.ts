import type {
  PluginUiSessionScope,
  PluginUiSessionActions,
  PluginUiSessionCommandPort,
} from "@/plugin-ui/contract.js";
import { buildPluginUiImageFileName } from "../domain/pluginUiImageBlocks.js";

export function createPluginUiSessionActions(
  _scope: PluginUiSessionScope,
  port: PluginUiSessionCommandPort,
): PluginUiSessionActions {
  return {
    async sendFollowUp({ prompt, source, images }) {
      const attachments = [];
      for (const [index, image] of (images ?? []).entries()) {
        attachments.push(
          await port.uploadAttachment({
            fileName: buildPluginUiImageFileName(
              source.kind === "pluginUi" ? source.pluginId : "gen-ui",
              index,
              image.mimeType,
            ),
            mime: image.mimeType,
            dataBase64: image.dataBase64,
          }),
        );
      }
      const result = await port.sendText(prompt, {
        source,
        ...(attachments.length > 0 ? { attachments } : {}),
      });
      if (result === "blocked" || result === "confirmationRequired")
        throw new Error("Session is not ready to accept input");
    },
  };
}
