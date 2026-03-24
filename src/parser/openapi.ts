import fs from "fs";
import { OpenAPIModel, Endpoint, Parameter, Schema, Response } from "../models";
import { isObject, extractSchemaRef, normalizeSchema, normalizeParamObject, toParameterList, createQuerySchemaReference, selectRequestContentType } from "./utils";

type RawObject = Record<string, unknown>;

interface OpenAPIContentSchema {
  schema?: unknown;
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
      const contentType = selectRequestContentType(requestBodyContent);

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

  createQuerySchemaReference(endpoints, normalizedSchemas)

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

  createQuerySchemaReference(endpoints, normalizedSchemas)

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
