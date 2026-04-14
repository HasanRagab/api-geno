import fs from "fs";
import type {
	Endpoint,
	OpenAPIModel,
	Parameter,
	Response,
	Schema,
} from "../models";
import {
	createQuerySchemaReference,
	extractSchemaRef,
	isObject,
	normalizeParamObject,
	normalizeSchema,
	selectRequestContentType,
	toParameterList,
} from "./utils";

type RawObject = Record<string, unknown>;

interface OpenAPIContentSchema {
	schema?: unknown;
}

function parseV3(spec: unknown): OpenAPIModel {
	if (!isObject(spec)) return { endpoints: [], schemas: {} };

	let base = "http://localhost:4000";
	if (Array.isArray(spec.servers) && spec.servers.length > 0) {
		const server = spec.servers[0];
		if (isObject(server) && typeof server.url === "string") {
			base = server.url;
		}
	}

	const endpoints: Endpoint[] = [];
	const paths = isObject(spec.paths) ? spec.paths : {};

	for (const [path, methodsRaw] of Object.entries(paths)) {
		const methods = isObject(methodsRaw) ? methodsRaw : {};

		for (const [method, detailsRaw] of Object.entries(methods)) {
			const d = isObject(detailsRaw) ? detailsRaw : {};
			const parameters: Parameter[] = toParameterList(d.parameters).map(
				normalizeParamObject,
			);

			const requestBodyContent =
				isObject(d.requestBody) && isObject(d.requestBody.content)
					? (d.requestBody.content as Record<string, OpenAPIContentSchema>)
					: {};
			const contentType = selectRequestContentType(requestBodyContent);

			const requestBody = contentType
				? normalizeSchema(requestBodyContent[contentType]?.schema)
				: undefined;
			const requestBodyRef = contentType
				? extractSchemaRef(requestBodyContent[contentType]?.schema)
				: undefined;

			const successResponse =
				isObject(d.responses) &&
					(isObject(d.responses["201"]) || isObject(d.responses["200"]))
					? d.responses["201"] || d.responses["200"]
					: undefined;

			const content = isObject(successResponse) && isObject((successResponse as RawObject).content)
				? (successResponse as RawObject).content as Record<string, OpenAPIContentSchema>
				: undefined;

			const responseSchema = content
				? content["application/json"]?.schema || Object.values(content)[0]?.schema
				: undefined;

			const responseRef = extractSchemaRef(responseSchema);
			const queryParams = parameters.filter((p) => p.in === "query");
			const queryParamsRef =
				queryParams.length > 0
					? `${String(d.operationId || `${method}_${path.replace(/\W/g, "_")}`)}QueryParams`
					: undefined;

			endpoints.push({
				path,
				method: method.toUpperCase() as Endpoint["method"],
				operationId: String(
					d.operationId || `${method}_${path.replace(/\W/g, "_")}`,
				),
				tags: Array.isArray(d.tags)
					? (d.tags.filter((tag) => typeof tag === "string") as string[])
					: [],
				summary: typeof d.summary === "string" ? d.summary : undefined,
				description: typeof d.description === "string" ? d.description : undefined,
				deprecated: d.deprecated === true,
				parameters,
				requestBody,
				requestBodyRef,
				queryParamsRef,
				contentType: contentType || "application/json",
				responses: isObject(d.responses)
					? (d.responses as Record<string, Response>)
					: {},
				responseRef,
				security: Array.isArray(d.security) ? (d.security as Record<string, string[]>[]) : undefined,
			});
		}
	}

	const schemaSource =
		isObject(spec.components) && isObject(spec.components.schemas)
			? spec.components.schemas
			: {};
	const normalizedSchemas: Record<string, Schema> = {};

	for (const [name, schema] of Object.entries(schemaSource)) {
		normalizedSchemas[name] = normalizeSchema(schema);
	}

	createQuerySchemaReference(endpoints, normalizedSchemas);

	return {
		endpoints,
		schemas: normalizedSchemas,
		base,
		components: {
			schemas: normalizedSchemas,
			securitySchemes: isObject(spec.components) && isObject(spec.components.securitySchemes) ? (spec.components.securitySchemes as any) : undefined,
		},
		security: Array.isArray(spec.security) ? (spec.security as any) : undefined,
	};
}

function parseV2(spec: unknown): OpenAPIModel {
	if (!isObject(spec)) return { endpoints: [], schemas: {} };

	let base = "http://localhost:4000";
	if (typeof spec.host === "string") {
		const scheme =
			Array.isArray(spec.schemes) && typeof spec.schemes[0] === "string"
				? spec.schemes[0]
				: "http";
		const basePath = typeof spec.basePath === "string" ? spec.basePath : "";
		base = `${scheme}://${spec.host}${basePath}`;
	}

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
			const parameters: Parameter[] = mergedParams
				.filter((p) => p.in !== "body")
				.map(normalizeParamObject);

			const requestBody = bodyParam
				? normalizeSchema(bodyParam.schema)
				: undefined;
			const requestBodyRef = bodyParam
				? extractSchemaRef(bodyParam.schema)
				: undefined;

			const consumes = Array.isArray(d.consumes)
				? d.consumes
				: Array.isArray(spec.consumes)
					? (spec.consumes as string[])
					: ["application/json"];
			const contentType =
				typeof consumes[0] === "string" ? consumes[0] : "application/json";

			const successResponse =
				isObject(d.responses) &&
					(isObject(d.responses["201"]) || isObject(d.responses["200"]))
					? d.responses["201"] || d.responses["200"]
					: undefined;

			const responseSchema = isObject(successResponse)
				? (successResponse as RawObject).schema
				: undefined;
			const responseRef = extractSchemaRef(responseSchema);

			const queryParams = parameters.filter((p) => p.in === "query");
			const queryParamsRef =
				queryParams.length > 0
					? `${String(d.operationId || `${method}_${path.replace(/\W/g, "_")}`)}QueryParams`
					: undefined;

			endpoints.push({
				path,
				method: method.toUpperCase() as Endpoint["method"],
				operationId: String(
					d.operationId || `${method}_${path.replace(/\W/g, "_")}`,
				),
				tags: Array.isArray(d.tags)
					? (d.tags.filter((tag) => typeof tag === "string") as string[])
					: [],
				summary: typeof d.summary === "string" ? d.summary : undefined,
				description: typeof d.description === "string" ? d.description : undefined,
				deprecated: d.deprecated === true,
				parameters,
				requestBody,
				requestBodyRef,
				queryParamsRef,
				contentType,
				responses: isObject(d.responses)
					? (d.responses as Record<string, Response>)
					: {},
				responseRef,
				security: Array.isArray(d.security) ? (d.security as Record<string, string[]>[]) : undefined,
			});
		}
	}

	const definitions = isObject(spec.definitions) ? spec.definitions : {};
	const normalizedSchemas: Record<string, Schema> = {};

	for (const [name, schema] of Object.entries(definitions)) {
		normalizedSchemas[name] = normalizeSchema(schema);
	}

	createQuerySchemaReference(endpoints, normalizedSchemas);

	return {
		endpoints,
		schemas: normalizedSchemas,
		base,
		components: {
			schemas: normalizedSchemas,
			securitySchemes: isObject(spec.securityDefinitions) ? (spec.securityDefinitions as any) : undefined,
		},
		security: Array.isArray(spec.security) ? (spec.security as any) : undefined,
	};
}

export function parseOpenAPI(filePath: string): OpenAPIModel {
	const raw = fs.readFileSync(filePath, "utf-8");
	const spec = JSON.parse(raw);

	const version =
		isObject(spec) && typeof spec.openapi === "string"
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

	throw new Error(
		`Unsupported OpenAPI/Swagger version: ${version}. Supported: 2.0, 3.x`,
	);
}
