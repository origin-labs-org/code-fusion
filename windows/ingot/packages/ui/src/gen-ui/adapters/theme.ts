import { readPluginUiStyleVariables } from "@/plugin-ui/hostPrimitives.js";
import { GEN_UI_STYLE_CONTEXT_KEY, genUiStyleVariablesSchema } from "@origin-ai/cf-shared/gen-ui";
import { McpUiHostStylesSchema } from "@modelcontextprotocol/ext-apps";

export function readGenUiStyleContext() {
  const variables = readPluginUiStyleVariables();
  const root = getComputedStyle(document.documentElement);
  const size = Number.parseFloat(root.getPropertyValue("--ui-font-size")) || 14;
  const tokens = [
    "primary",
    "primary-foreground",
    "secondary",
    "foreground-subtlest",
    "card",
    "card-border",
    "input",
    "input-focused",
    "input-border",
    "input-border-hover",
    "input-border-focused",
    "hover",
    "selected",
    "border",
    "border-hover",
  ];
  const controls = Object.fromEntries(
    tokens.flatMap((token) => {
      const value = root.getPropertyValue(`--color-${token}`).trim();
      return value ? [[`--gen-ui-${token}`, value]] : [];
    }),
  );
  return {
    [GEN_UI_STYLE_CONTEXT_KEY]: genUiStyleVariablesSchema.parse(controls),
    styles: {
      variables: McpUiHostStylesSchema.shape.variables.unwrap().parse({
        ...variables,
        "--font-text-md-size": `${size}px`,
        "--font-text-sm-size": `${size - 2}px`,
        "--font-heading-xs-size": `${size}px`,
        "--font-heading-sm-size": `${size + 2}px`,
        "--font-heading-md-size": `${size + 4}px`,
      }),
    },
  };
}
