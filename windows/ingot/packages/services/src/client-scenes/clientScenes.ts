import { ServiceChannels } from "@origin-ai/cf-shared";
import { createServiceDescriptor } from "../descriptors.js";

export interface ClientSceneResponseBody<T> {
  code: number;
  msg: string;
  data: T;
}

export interface ClientSceneConfig {
  namespace: string;
  scene: string;
  options: Record<string, ClientSceneOption>;
  created_at?: number;
  updated_at?: number;
}

export interface ClientSceneOption {
  id: string;
  type: string;
  
  contents: Record<string, string>;
  
  prompts?: Record<string, string>;
  
  items?: ClientSceneItem[];
  
  refer?: string;
  
  cascades?: Record<string, ClientSceneItem[]>;
  
  templates?: Record<string, string>;
}

export interface ClientSceneItem {
  id: string;
  type: string;
  
  contents: Record<string, string>;
  
  descs?: Record<string, string>;
  
  labels: Record<string, string>;
  
  on_finish?: string | null;
  
  img?: string | null;
  
  imgs?: {
    cn?: string;
    en?: string;
  };
  share_urls?: Record<string, string>;
  defaults?: Record<string, string[]>;
}

export type ClientScenesResponse = ClientSceneResponseBody<ClientSceneConfig[]>;

export interface IClientScenesService {
  list(): Promise<ClientScenesResponse>;
}

export const IClientScenesService = createServiceDescriptor<IClientScenesService>(
  ServiceChannels.ClientScenes,
);
