import fs from "fs";
import { OpenAPIModel, Endpoint, Parameter, Schema, Response } from "../models";

type RawObject = Record<string, unknown>;

type OpenAPIParameterIn = "query" | "path" | "header" | "cookie" | "body";

interface OpenAPIParameter {
  name: string;
  in: OpenAPIParameterIn;
  required?: boolean;
  schema?: unknown;
  type?: string;
  format?: string;
  items?: unknown;
  enum?: unknown[];
  default?: unknown;
  description?: string;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
}

interface OpenAPIContentSchema {
  schema?: unknown;
}

function isObject(value: unknown): value is RawObject {
  return value !== null && typeof value === "object";
}

function extractSchemaRef(schema: unknown): string | undefined {
  if (isObject(schema) && typeof schema.$ref === "string") {
    return schema.$ref.split("/").pop();
  }
  return undefined;
}

function normalizeSchema(schema: unknown): Schema {
  if (!isObject(schema)) {
    return { type: "object" };
  }

  if (typeof schema.$ref === "string") {
    const ref = schema.$ref;
    // Normalize Swagger 2.0 definitions to OpenAPI 3 component refs where possible
    const normalizedRef = ref.startsWith("#/definitions/")
      ? `#/components/schemas/${ref.slice("#/definitions/".length)}`
      : ref;

    return { $ref: normalizedRef as `#/components/schemas/${string}` };
  }

  const normalized: Schema = {
    type: typeof schema.type === "string" ? (schema.type as Schema["type"]) : "object",
  };

  if (isObject(schema.properties)) {
    normalized.properties = {};
    for (const [key, prop] of Object.entries(schema.properties)) {
      normalized.properties[key] = normalizeSchema(prop);
    }
  }

  if (schema.items !== undefined) {
    normalized.items = normalizeSchema(schema.items);
  }

  if (Array.isArray(schema.required)) {
    normalized.required = schema.required.filter((x) => typeof x === "string") as string[];
  }

  if (Array.isArray(schema.allOf)) {
    normalized.allOf = schema.allOf.map((sub) => normalizeSchema(sub));
  }

  if (Array.isArray(schema.oneOf)) {
    normalized.oneOf = schema.oneOf.map((sub) => normalizeSchema(sub));
  }

  if (Array.isArray(schema.anyOf)) {
    normalized.anyOf = schema.anyOf.map((sub) => normalizeSchema(sub));
  }

  if (typeof schema.nullable === "boolean") {
    normalized.nullable = schema.nullable;
  }

  if (typeof schema.minLength === "number") {
    normalized.minLength = schema.minLength;
  }

  if (typeof schema.maxLength === "number") {
    normalized.maxLength = schema.maxLength;
  }

  if (typeof schema.pattern === "string") {
    normalized.pattern = schema.pattern;
  }

  if (typeof schema.minimum === "number") {
    normalized.minimum = schema.minimum;
  }

  if (typeof schema.maximum === "number") {
    normalized.maximum = schema.maximum;
  }

  if (typeof schema.exclusiveMinimum === "number") {
    (normalized as Schema & { exclusiveMinimum?: number }).exclusiveMinimum = schema.exclusiveMinimum;
  }

  if (typeof schema.exclusiveMaximum === "number") {
    (normalized as Schema & { exclusiveMaximum?: number }).exclusiveMaximum = schema.exclusiveMaximum;
  }

  if (Array.isArray(schema.enum)) {
    normalized.enum = schema.enum as (string | number | boolean)[];
  }

  if (schema.default !== undefined) {
    normalized.default = schema.default;
  }

  if (typeof schema.description === "string") {
    normalized.description = schema.description;
  }

  return normalized;
}

function normalizeParamObject(p: OpenAPIParameter): Parameter {
  let schema: unknown = p.schema;

  if (schema === undefined || schema === null) {
    if (p.type) {
      schema = {
        type: p.type,
        format: p.format,
        items: p.items,
        enum: p.enum,
        default: p.default,
        description: p.description,
        minLength: p.minLength,
        maxLength: p.maxLength,
        pattern: p.pattern,
        minimum: p.minimum,
        maximum: p.maximum,
      };
    } else {
      schema = { type: "object" };
    }
  }

  return {
    name: p.name,
    in: p.in as Parameter["in"],
    required: p.required || false,
    schema: normalizeSchema(schema),
  };
}

function toParameterList(value: unknown): OpenAPIParameter[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter(isObject)
    .map((raw) => ({
      name: String(raw.name),
      in: String(raw.in) as OpenAPIParameterIn,
      required: typeof raw.required === "boolean" ? raw.required : undefined,
      schema: raw.schema,
      type: typeof raw.type === "string" ? raw.type : undefined,
      format: typeof raw.format === "string" ? raw.format : undefined,
      items: raw.items,
      enum: Array.isArray(raw.enum) ? raw.enum : undefined,
      default: raw.default,
      description: typeof raw.description === "string" ? raw.description : undefined,
      minLength: typeof raw.minLength === "number" ? raw.minLength : undefined,
      maxLength: typeof raw.maxLength === "number" ? raw.maxLength : undefined,
      pattern: typeof raw.pattern === "string" ? raw.pattern : undefined,
      minimum: typeof raw.minimum === "number" ? raw.minimum : undefined,
      maximum: typeof raw.maximum === "number" ? raw.maximum : undefined,
    }))
    .filter((param) => param.name && param.in);
}

function parseV3(spec: unknown): OpenAPIModel {
  if (!isObject(spec)) return { endpoints: [], schemas: {} };

  const endpoints: Endpoint[] = [];
  const paths = isObject(spec.paths) ? spec.paths : {};

  for (const [path, methodsRaw] of Object.entries(paths)) {
    const methods = isObject(methodsRaw) ? methodsRaw : {};

    for (const [method, detailsRaw] of Object.entries(methods)) {
      const d = isObject(detailsRaw) ? detailsRaw : {};
      const parameters: Parameter[] = toParameterList(d.parameters).map(normalizeParamObject);

      const requestBodyContent = isObject(d.requestBody) && isObject(d.requestBody.content) ? d.requestBody.content as Record<string, OpenAPIContentSchema> : {};
      const contentTypes = Object.keys(requestBodyContent);
      const preferredOrder = ["application/json", "application/x-www-form-urlencoded", "multipart/form-data"];
      const contentType = preferredOrder.find((ct) => contentTypes.includes(ct)) || contentTypes[0];

      const requestBody = contentType ? normalizeSchema(requestBodyContent[contentType]?.schema) : undefined;
      const requestBodyRef = contentType ? extractSchemaRef(requestBodyContent[contentType]?.schema) : undefined;

      const successResponse = (isObject(d.responses) && (isObject(d.responses["201"]) || isObject(d.responses["200"])))
        ? (d.responses["201"] || d.responses["200"])
        : undefined;

      const responseSchema = isObject(successResponse) && isObject((successResponse as RawObject).content)
        ? ((successResponse as RawObject).content as Record<string, OpenAPIContentSchema>)["application/json"]?.schema
        : undefined;

      const responseRef = extractSchemaRef(responseSchema);
      const queryParams = parameters.filter((p) => p.in === "query");
      const queryParamsRef = queryParams.length > 0 ? `${String(d.operationId || `${method}_${path.replace(/\W/g, "_")}`)}QueryParams` : undefined;

      endpoints.push({
        path,
        method: method.toUpperCase() as Endpoint["method"],
        operationId: String(d.operationId || `${method}_${path.replace(/\W/g, "_")}`),
        tags: Array.isArray(d.tags) ? d.tags.filter((tag) => typeof tag === "string") as string[] : [],
        parameters,
        requestBody,
        requestBodyRef,
        queryParamsRef,
        contentType: contentType || "application/json",
        responses: isObject(d.responses) ? d.responses as Record<string, Response> : {},
        responseRef,
      });
    }
  }

  const schemaSource = isObject(spec.components) && isObject(spec.components.schemas) ? spec.components.schemas : {};
  const normalizedSchemas: Record<string, Schema> = {};

  for (const [name, schema] of Object.entries(schemaSource)) {
    normalizedSchemas[name] = normalizeSchema(schema);
  }

  endpoints.forEach((ep) => {
    if (!ep.queryParamsRef) return;

    const queryParams = ep.parameters?.filter((p) => p.in === "query") || [];
    if (queryParams.length === 0) return;

    const queryParamProperties: Record<string, Schema> = {};
    const required: string[] = [];

    queryParams.forEach((param) => {
      queryParamProperties[param.name] = param.schema;
      if (param.required) required.push(param.name);
    });

    normalizedSchemas[ep.queryParamsRef] = {
      type: "object",
      properties: queryParamProperties,
      required: required.length > 0 ? required : undefined,
    };
  });

  return { endpoints, schemas: normalizedSchemas };
}

function parseV2(spec: unknown): OpenAPIModel {
  if (!isObject(spec)) return { endpoints: [], schemas: {} };

  const endpoints: Endpoint[] = [];
  const paths = isObject(spec.paths) ? spec.paths : {};

  for (const [path, methodsRaw] of Object.entries(paths)) {
    const methods = isObject(methodsRaw) ? methodsRaw : {};
    const pathParams = toParameterList(methods.parameters);

    for (const [method, detailsRaw] of Object.entries(methods)) {
      if (method === "parameters") continue;

      const d = isObject(detailsRaw) ? detailsRaw : {};
      const operationParams = toParameterList(d.parameters);
      const mergedParams = [...pathParams, ...operationParams];

      const bodyParam = mergedParams.find((p) => p.in === "body");
      const parameters: Parameter[] = mergedParams.filter((p) => p.in !== "body").map(normalizeParamObject);

      const requestBody = bodyParam ? normalizeSchema(bodyParam.schema) : undefined;
      const requestBodyRef = bodyParam ? extractSchemaRef(bodyParam.schema) : undefined;

      const consumes = Array.isArray(d.consumes) ? d.consumes : Array.isArray(spec.consumes) ? spec.consumes as string[] : ["application/json"];
      const contentType = typeof consumes[0] === "string" ? consumes[0] : "application/json";

      const successResponse = (isObject(d.responses) && (isObject(d.responses["201"]) || isObject(d.responses["200"])))
        ? (d.responses["201"] || d.responses["200"])
        : undefined;

      const responseSchema = isObject(successResponse) ? (successResponse as RawObject).schema : undefined;
      const responseRef = extractSchemaRef(responseSchema);

      const queryParams = parameters.filter((p) => p.in === "query");
      const queryParamsRef = queryParams.length > 0 ? `${String(d.operationId || `${method}_${path.replace(/\W/g, "_")}`)}QueryParams` : undefined;

      endpoints.push({
        path,
        method: method.toUpperCase() as Endpoint["method"],
        operationId: String(d.operationId || `${method}_${path.replace(/\W/g, "_")}`),
        tags: Array.isArray(d.tags) ? d.tags.filter((tag) => typeof tag === "string") as string[] : [],
        parameters,
        requestBody,
        requestBodyRef,
        queryParamsRef,
        contentType,
        responses: isObject(d.responses) ? d.responses as Record<string, Response> : {},
        responseRef,
      });
    }
  }

  const definitions = isObject(spec.definitions) ? spec.definitions : {};
  const normalizedSchemas: Record<string, Schema> = {};

  for (const [name, schema] of Object.entries(definitions)) {
    normalizedSchemas[name] = normalizeSchema(schema);
  }

  endpoints.forEach((ep) => {
    if (!ep.queryParamsRef) return;

    const queryParams = ep.parameters?.filter((p) => p.in === "query") || [];
    if (queryParams.length === 0) return;

    const queryParamProperties: Record<string, Schema> = {};
    const required: string[] = [];

    queryParams.forEach((param) => {
      queryParamProperties[param.name] = param.schema;
      if (param.required) required.push(param.name);
    });

    normalizedSchemas[ep.queryParamsRef] = {
      type: "object",
      properties: queryParamProperties,
      required: required.length > 0 ? required : undefined,
    };
  });

  return { endpoints, schemas: normalizedSchemas };
}

export function parseOpenAPI(filePath: string): OpenAPIModel {
  const raw = fs.readFileSync(filePath, "utf-8");
  const spec = JSON.parse(raw);

  const version = isObject(spec) && typeof spec.openapi === "string"
    ? spec.openapi
    : isObject(spec) && typeof spec.swagger === "string"
      ? spec.swagger
      : "";

  if (version.startsWith("3.")) {
    return parseV3(spec);
  }

  if (version.startsWith("2.")) {
    return parseV2(spec);
  }

  throw new Error(`Unsupported OpenAPI/Swagger version: ${version}. Supported: 2.0, 3.x`);
}
