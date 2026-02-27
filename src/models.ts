export interface Schema {
  type: string;
  properties?: Record<string, Schema>;
  items?: Schema;
  required?: string[];
  enum?: (string | number | boolean)[];
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  default?: any;
  description?: string;
}

export interface Parameter {
  name: string;
  in: "query" | "path" | "header" | "cookie";
  required: boolean;
  schema: Schema;
}

export interface Endpoint {
  path: string;
  method: "GET" | "POST" | "PUT" | "DELETE" | string;
  operationId: string;
  tags?: string[];
  parameters: Parameter[];
  requestBody?: Schema;
  requestBodyRef?: string; // Schema reference name for request body
  queryParamsRef?: string; // Schema reference name for query parameters
  contentType?: "application/json" | "multipart/form-data" | "application/x-www-form-urlencoded" | string;
  responses: Record<string, Schema>;
  responseRef?: string; // Schema reference name for success response
}

export interface OpenAPIModel {
  endpoints: Endpoint[];
  schemas: Record<string, Schema>;
}