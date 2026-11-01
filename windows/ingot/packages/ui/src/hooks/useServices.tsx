
import { createContext, useContext, type ReactNode } from "react";
import type { IServiceAccessor } from "@origin-ai/cf-services";

const ServiceContext = createContext<IServiceAccessor | null>(null);
const ComposerClientNamespaceContext = createContext("desktop");

export function useComposerClientNamespace(): string {
  return useContext(ComposerClientNamespaceContext);
}

export function ServiceProvider({
  services,
  children,
  composerClientNamespace,
}: {
  services: IServiceAccessor;
  children: ReactNode;
  composerClientNamespace?: string;
}) {
  const inheritedNamespace = useComposerClientNamespace();
  return (
    <ComposerClientNamespaceContext.Provider value={composerClientNamespace ?? inheritedNamespace}>
      <ServiceContext.Provider value={services}>{children}</ServiceContext.Provider>
    </ComposerClientNamespaceContext.Provider>
  );
}

export function useServices(): IServiceAccessor {
  const ctx = useContext(ServiceContext);
  if (!ctx) {
    throw new Error("useServices 必须在 ServiceProvider 内使用");
  }
  return ctx;
}

export function useOptionalServices(): IServiceAccessor | null {
  return useContext(ServiceContext);
}
