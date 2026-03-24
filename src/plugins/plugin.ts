import { OpenAPIModel, Endpoint, Schema } from "../models"

export interface GeneratorPlugin {
  name: string;
  beforeGenerate?: (api: OpenAPIModel) => void;
  afterGenerate?: (files: Record<string, string>) => void;
  transformEndpoint?: (endpoint: Endpoint) => Endpoint;
  transformSchema?: (name: string, schema: Schema) => Schema;
}