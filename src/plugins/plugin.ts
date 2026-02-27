import { OpenAPIModel } from "../models"

export interface GeneratorPlugin {
  name: string;
  beforeGenerate?: (api: OpenAPIModel) => void;
  afterGenerate?: (files: Record<string, string>) => void;
}