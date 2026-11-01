export interface OutputStyle {
    id: string;
    name: string;
    description: string;
    content: string;
    isBuiltIn: boolean;
    enabled: boolean;
    filePath?: string;
}

export interface OutputStyleConfig {
    name: string;
    description: string;
    content: string;
    enabled?: boolean;
}

export type OutputStyleGenerationStatus = 'idle' | 'generating' | 'completed' | 'error';
