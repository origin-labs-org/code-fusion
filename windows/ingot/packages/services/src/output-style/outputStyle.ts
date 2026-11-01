import type { OutputStyle, OutputStyleConfig } from "@origin-ai/cf-shared";
import { ServiceChannels } from "@origin-ai/cf-shared";
import { createServiceDescriptor } from "../descriptors.js";

export interface IOutputStyleService {
  
  listStyles(): Promise<{ styles: OutputStyle[] }>;

  
  addStyle(params: { config: OutputStyleConfig }): Promise<void>;

  
  updateStyle(params: { id: string; config: OutputStyleConfig }): Promise<void>;

  
  deleteStyle(params: { id: string }): Promise<void>;

  
  getUserStylesDirectory(): Promise<{ path: string }>;

  
  setActiveStyle(params: { styleId: string }): Promise<void>;

  
  getActiveStyle(): Promise<{ styleId: string | null }>;
}

export const IOutputStyleService = createServiceDescriptor<IOutputStyleService>(
  ServiceChannels.OutputStyle,
);
