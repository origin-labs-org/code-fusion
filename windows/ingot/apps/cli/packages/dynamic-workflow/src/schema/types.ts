

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonSchemaType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "null"
  | "array"
  | "object";

export interface JsonSchema {
  type?: JsonSchemaType | JsonSchemaType[];
  const?: JsonValue;
  enum?: JsonValue[];
  anyOf?: JsonSchema[];
  // object
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  // array / tuple
  items?: JsonSchema;
  prefixItems?: JsonSchema[];
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  description?: string;
  default?: JsonValue;
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
}

export interface Violation {
  
  path: string;
  
  expected: string;
  
  got: string;
}

export const SCHEMA_DIAGNOSTIC_CODE = 9002;

export const MAX_UNION_MEMBERS = 100;
