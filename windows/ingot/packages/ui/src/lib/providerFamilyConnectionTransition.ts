import type { ISettingService } from "@origin-ai/cf-services";
import type {
  AppSettings,
  ProviderFamilyDomain,
  ProviderFamilyConnectionSelection,
} from "@origin-ai/cf-shared";

export async function persistProviderFamilyConnection<T>({
  family,
  selection,
  read,
  update,
  synchronize,
}: {
  family: ProviderFamilyDomain;
  selection: ProviderFamilyConnectionSelection;
  read: () => Promise<Partial<AppSettings>>;
  update: ISettingService["update"];
  synchronize: (restoring?: boolean) => Promise<T>;
}): Promise<T> {
  const before = { ...(await read()) };
  const updatedAt = Math.max(Date.now(), (before.providerFamilyDomainUpdatedAt ?? 0) + 1);
  await update(
    {
      providerFamilyDomain: family,
      providerFamilyDomainUpdatedAt: updatedAt,
      providerFamilyDomainMigrated: true,
      providerFamilyConnectionSelections: {
        ...before.providerFamilyConnectionSelections,
        [family]: selection,
      },
    },
    {
      providerFamilyDomain: before.providerFamilyDomain,
      providerFamilyConnectionSelections: before.providerFamilyConnectionSelections,
      providerFamilyDomainUpdatedAt: before.providerFamilyDomainUpdatedAt ?? 0,
    },
  );
  try {
    return await synchronize();
  } catch (cause) {
    try {
      const latest = await read();
      if (
        latest.providerFamilyDomain === family &&
        latest.providerFamilyDomainUpdatedAt === updatedAt &&
        JSON.stringify(latest.providerFamilyConnectionSelections?.[family]) ===
          JSON.stringify(selection)
      ) {
        await update(
          {
            providerFamilyDomain: before.providerFamilyDomain,
            providerFamilyDomainUpdatedAt: Date.now(),
            providerFamilyConnectionSelections: {
              ...latest.providerFamilyConnectionSelections,
              [family]: before.providerFamilyConnectionSelections?.[family],
            },
          },
          {
            providerFamilyDomain: latest.providerFamilyDomain,
            providerFamilyConnectionSelections: latest.providerFamilyConnectionSelections,
            providerFamilyDomainUpdatedAt: latest.providerFamilyDomainUpdatedAt ?? 0,
          },
        );
        await synchronize(true);
      }
    } catch (rollbackError) {
      if (
        rollbackError instanceof Error &&
        rollbackError.message === "Account connection settings changed"
      )
        throw cause;
      throw new AggregateError(
        [cause, rollbackError],
        "Connection synchronization and restoration failed",
      );
    }
    throw cause;
  }
}
