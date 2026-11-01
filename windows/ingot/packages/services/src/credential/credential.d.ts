export interface ICredentialService {
    load(key: string): Promise<string | null>;
    save(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
}
export declare const ICredentialService: import("../descriptors.js").ServiceDescriptor<ICredentialService>;
//# sourceMappingURL=credential.d.ts.map