import fs from "fs";
import { OpenAPIModel, Endpoint, Parameter, Schema } from "../models";

function extractSchemaRef(schema: any): string | undefined {
  if (schema?.$ref) {
    // Extract schema name from "#/components/schemas/CreateCourseDto"
    return schema.$ref.split("/").pop();
  }
  return undefined;
}

function normalizeSchema(schema: any): Schema {
  if (!schema) {
    return { type: "object" };
  }

  if (schema.$ref) {
    return { $ref: schema.$ref };
  }

  const normalized: Schema = {
    type: schema.type || "object",
  };

  // Copy array properties
  if (schema.properties) {
    normalized.properties = {};
    for (const [key, prop] of Object.entries(schema.properties)) {
      normalized.properties[key] = normalizeSchema(prop);
    }
  }

  if (schema.items) {
    normalized.items = normalizeSchema(schema.items);
  }

  if (schema.required) {
    normalized.required = schema.required;
  }

  if (schema.allOf) {
    normalized.allOf = schema.allOf.map((sub: any) => normalizeSchema(sub));
  }

  if (schema.oneOf) {
    normalized.oneOf = schema.oneOf.map((sub: any) => normalizeSchema(sub));
  }

  if (schema.anyOf) {
    normalized.anyOf = schema.anyOf.map((sub: any) => normalizeSchema(sub));
  }

  if (schema.nullable !== undefined) {
    normalized.nullable = schema.nullable;
  }

  // String constraints
  if (schema.minLength !== undefined) {
    normalized.minLength = schema.minLength;
  }
  if (schema.maxLength !== undefined) {
    normalized.maxLength = schema.maxLength;
  }
  if (schema.pattern !== undefined) {
    normalized.pattern = schema.pattern;
  }

  // Number constraints
  if (schema.minimum !== undefined) {
    normalized.minimum = schema.minimum;
  }
  if (schema.maximum !== undefined) {
    normalized.maximum = schema.maximum;
  }
  if (schema.exclusiveMinimum !== undefined) {
    (normalized as any).exclusiveMinimum = schema.exclusiveMinimum;
  }
  if (schema.exclusiveMaximum !== undefined) {
    (normalized as any).exclusiveMaximum = schema.exclusiveMaximum;
  }

  // Enum values
  if (schema.enum) {
    normalized.enum = schema.enum;
  }

  // Default value
  if (schema.default !== undefined) {
    normalized.default = schema.default;
  }

  // Description
  if (schema.description) {
    normalized.description = schema.description;
  }

  return normalized;
}

export function parseOpenAPI(filePath: string): OpenAPIModel {
  const raw = fs.readFileSync(filePath, "utf-8");
  const spec = JSON.parse(raw);

  const endpoints: Endpoint[] = [];

  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, details] of Object.entries(methods as any)) {
      const d = details as any;
      const parameters: Parameter[] = (d.parameters || []).map((p: any) => ({
        name: p.name,
        in: p.in,
        required: p.required || false,
        schema: normalizeSchema(p.schema),
      }));

      // Extract request body and content type
      let requestBody;
      let contentType;
      const requestBodyContent = d.requestBody?.content || {};
      const contentTypes = Object.keys(requestBodyContent);
      
      // Prefer order: JSON > form-urlencoded > form-data > other
      const preferredOrder = [
        "application/json",
        "application/x-www-form-urlencoded",
        "multipart/form-data"
      ];
      
      contentType = preferredOrder.find(ct => contentTypes.includes(ct)) || contentTypes[0];
      if (contentType) {
        requestBody = normalizeSchema(requestBodyContent[contentType].schema);
      }

      const requestBodyRef = extractSchemaRef(requestBodyContent[contentType || "application/json"]?.schema);

      // Find the success response (200 or 201)
      const successResponse = d.responses?.["201"] || d.responses?.["200"];
      const responseSchema = successResponse?.content?.["application/json"]?.schema;
      const responseRef = extractSchemaRef(responseSchema);

      // Extract query parameters and create a schema for them
      const queryParams = parameters.filter((p: any) => p.in === "query");
      let queryParamsRef: string | undefined;
      
      if (queryParams.length > 0) {
        // Create a reference name for query params schema
        queryParamsRef = `${d.operationId || `${method}_${path.replace(/\W/g, "_")}`}QueryParams`;
      }

      endpoints.push({
        path,
        method: method.toUpperCase() as Endpoint['method'],
        operationId: d.operationId || `${method}_${path.replace(/\W/g, "_")}`,
        tags: d.tags || [],
        parameters,
        requestBody,
        requestBodyRef,
        queryParamsRef,
        contentType: contentType || "application/json",
        responses: d.responses || {},
        responseRef,
      });
    }
  }

  const schemas = spec.components?.schemas || {};
  const normalizedSchemas: Record<string, Schema> = {};
  
  for (const [name, schema] of Object.entries(schemas)) {
    normalizedSchemas[name] = normalizeSchema(schema);
  }

  // Generate schemas for query parameters
  endpoints.forEach(ep => {
    if (ep.queryParamsRef) {
      const queryParams = ep.parameters?.filter((p: any) => p.in === "query") || [];
      if (queryParams.length > 0) {
        const queryParamProperties: Record<string, Schema> = {};
        const required: string[] = [];
        
        queryParams.forEach((param: any) => {
          queryParamProperties[param.name] = param.schema;
          if (param.required) {
            required.push(param.name);
          }
        });
        
        normalizedSchemas[ep.queryParamsRef] = {
          type: "object",
          properties: queryParamProperties,
          required: required.length > 0 ? required : undefined,
        };
      }
    }
  });

  return { endpoints, schemas: normalizedSchemas };
}
