export interface ServiceDescriptor<T> {
    readonly channelName: string;
    readonly _brand?: T;
}
export declare function createServiceDescriptor<T>(channelName: string): ServiceDescriptor<T>;
//# sourceMappingURL=descriptors.d.ts.map