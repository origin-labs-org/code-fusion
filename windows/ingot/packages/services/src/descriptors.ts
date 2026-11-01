

export interface ServiceDescriptor<T> {
  readonly channelName: string;
  
  readonly _brand?: T;
}

export function createServiceDescriptor<T>(channelName: string): ServiceDescriptor<T> {
  return { channelName };
}
