import type { ModelSelectionView, ProviderSettingsView } from "@origin-ai/cf-services";
import {
  resolveModelProviderFamilySpecByProviderId,
  type ProviderFamilyDomain,
  type ProviderFamilyConnectionSelection,
  type CfProvider,
} from "@origin-ai/cf-shared";
import type { ModelSelectGroup, ModelSelectGroupItem } from "@/ModelConfigSelect.js";
import {
  buildRegistryModelSelectGroups,
  type ModelProviderGroupLabelOptions,
} from "@/lib/modelSelectionGroups.js";
import { formatTeamPlanDisplayName } from "@/lib/teamPlanDisplayName.js";
export interface ComposerConnection {
  key: string;
  label: string;
  providerId: string;
  family: ProviderFamilyDomain;
  selection?: ProviderFamilyConnectionSelection;
  items: ModelSelectGroupItem[];
  disabled?: boolean;
}
export interface ComposerPlanGroup extends ModelSelectGroup {
  connection?: ComposerConnection;
}
interface TeamProduct {
  family?: ProviderFamilyDomain;
  productId: string;
  subscribed?: boolean | null;
  organizationId?: string | null;
  organizationName?: string | null;
  projectId?: string | null;
  apiKeyStatus?: string | null;
  teamProjects?: Array<{
    organizationId?: string | null;
    organizationName?: string | null;
    projectId?: string | null;
    apiKeyStatus?: string | null;
  }> | null;
}
export function composerConnectionKey(
  family: ProviderFamilyDomain,
  selection: ProviderFamilyConnectionSelection,
) {
  return JSON.stringify(
    selection.kind === "team-coding-plan"
      ? [family, selection.kind, selection.productId, selection.organizationId, selection.projectId]
      : [family, selection.kind],
  );
}
export function chooseConnectionModel(items: readonly ModelSelectGroupItem[], model?: string) {
  return items.find((item) => item.name === model) ?? items[0];
}

export function buildComposerPlanGroups(
  groups: readonly ModelSelectGroup[],
  products: readonly TeamProduct[],
  settingsView?: ProviderSettingsView | null,
  agentProvider: CfProvider = "glm",
  labels: ModelProviderGroupLabelOptions = {},
  selections?: Partial<Record<ProviderFamilyDomain, ProviderFamilyConnectionSelection>>,
): ComposerPlanGroup[] {
  const isAvailable = (providerId: string) =>
    settingsView?.providers.find((provider) => provider.providerId === providerId)?.accountState
      ?.availability !== "unavailable";
  const isTeamProvider = (providerId: string) =>
    providerId === resolveModelProviderFamilySpecByProviderId(providerId)?.teamCodingPlanProviderId;
  const includeProvider = (providerId: string) =>
    isTeamProvider(providerId) || isAvailable(providerId);
  const missing =
    settingsView?.providers
      .filter(
        (p) =>
          !groups.some((g) => g.key === `registry-provider:${p.providerId}`) &&
          p.enabled &&
          includeProvider(p.providerId) &&
          p.effectiveConfig.access?.type === "zhipu-account" &&
          (p.effectiveConfig.access.mode === "team-coding-plan" ||
            (p.effectiveConfig.access.mode === "individual-coding-plan" &&
              p.accountState?.availability === "available" &&
              p.accountState.entitled)),
      )
      .map((p) => ({ providerId: p.providerId, config: p.effectiveConfig, models: [] })) ?? [];
  const candidates = [
    ...groups.filter((group) => includeProvider(group.key.replace(/^registry-provider:/, ""))),
    ...buildRegistryModelSelectGroups(
      agentProvider,
      {
        revision: 0,
        providers: missing,
      } as ModelSelectionView,
      labels,
    ),
  ];
  const plans: ComposerPlanGroup[] = [];
  const others: ComposerPlanGroup[] = [];
  for (const group of candidates) {
    const providerId = group.key.replace(/^registry-provider:/, "");
    const spec = resolveModelProviderFamilySpecByProviderId(providerId);
    if (!spec || providerId === spec.startPlanProviderId) {
      others.push(group);
      continue;
    }
    if (providerId === spec.individualCodingPlanProviderId) {
      const selection = { kind: "individual-coding-plan" as const };
      plans.push({
        ...group,
        connection: {
          key: group.key,
          label: group.labelBadge ?? "",
          providerId,
          family: spec.id,
          selection,
          items: group.items,
        },
      });
      continue;
    }
    if (providerId !== spec.teamCodingPlanProviderId) {
      others.push(group);
      continue;
    }
    const seen = new Set<string>();
    for (const product of products) {
      if (
        (product.family ?? "bigmodel") !== spec.id ||
        product.subscribed !== true ||
        !product.productId.trim()
      )
        continue;
      for (const project of product.teamProjects?.length ? product.teamProjects : [product]) {
        const organizationId = project.organizationId?.trim();
        const projectId = project.projectId?.trim();
        const label = formatTeamPlanDisplayName({
          organizationName: project.organizationName ?? product.organizationName,
        });
        if (
          !organizationId ||
          !projectId ||
          !label ||
          (project.apiKeyStatus ?? product.apiKeyStatus) === "unavailable"
        )
          continue;
        const selection = {
          kind: "team-coding-plan" as const,
          productId: product.productId,
          organizationId,
          projectId,
        };
        const key = composerConnectionKey(spec.id, selection);
        const selected = selections?.[spec.id];
        if (
          !isAvailable(providerId) &&
          selected?.kind === "team-coding-plan" &&
          key === composerConnectionKey(spec.id, selected)
        )
          continue;
        if (seen.has(key)) continue;
        seen.add(key);
        plans.push({
          ...group,
          key,
          labelBadge: label,
          connection: {
            key,
            label,
            providerId,
            family: spec.id,
            selection,
            items: group.items,
          },
        });
      }
    }
    if (
      !seen.size &&
      isAvailable(providerId) &&
      group.items.length &&
      !products.some((product) => (product.family ?? "bigmodel") === spec.id)
    )
      plans.push(group);
  }
  return [
    ...plans.sort(
      (a, b) =>
        a.label.localeCompare(b.label) ||
        Number(a.connection?.selection?.kind === "team-coding-plan") -
          Number(b.connection?.selection?.kind === "team-coding-plan"),
    ),
    ...others,
  ];
}
