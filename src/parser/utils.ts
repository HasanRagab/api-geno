import {
	type Endpoint,
	OpenAPIModel,
	type Parameter,
	Response,
	type Schema,
} from "../models";

export type RawObject = Record<string, unknown>;

export function isObject(value: unknown): value is RawObject {
	return value !== null && typeof value === "object";
}

export function extractSchemaRef(schema: unknown): string | undefined {
	if (isObject(schema) && typeof schema.$ref === "string") {
		return schema.$ref.split("/").pop();
	}
	return undefined;
}

export function normalizeSchema(schema: unknown): Schema {
	if (!isObject(schema)) {
		return { type: "object" };
	}

	if (typeof schema.$ref === "string") {
		const ref = schema.$ref;
		const normalizedRef = ref.startsWith("#/definitions/")
			? `#/components/schemas/${ref.slice("#/definitions/".length)}`
			: ref;

		return { $ref: normalizedRef as `#/components/schemas/${string}` };
	}

	const normalized: Schema = {
		type:
			typeof schema.type === "string"
				? (schema.type as Schema["type"])
				: "object",
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
		normalized.required = schema.required.filter(
			(x) => typeof x === "string",
		) as string[];
	}

	const arrayFields: Array<keyof Schema> = ["allOf", "oneOf", "anyOf"];
	for (const field of arrayFields) {
		if (Array.isArray((schema as any)[field])) {
			(normalized as any)[field] = (schema as any)[field].map((sub: unknown) =>
				normalizeSchema(sub),
			);
		}
	}

	const booleanNumberStringFields = [
		"nullable",
		"minLength",
		"maxLength",
		"pattern",
		"minimum",
		"maximum",
		"exclusiveMinimum",
		"exclusiveMaximum",
	] as const;

	for (const field of booleanNumberStringFields) {
		if ((schema as any)[field] !== undefined) {
			(normalized as any)[field] = (schema as any)[field];
		}
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

interface OpenAPIParameter {
	name: string;
	in: "query" | "path" | "header" | "cookie" | "body";
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

export function normalizeParamObject(p: OpenAPIParameter): Parameter {
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

export function toParameterList(value: unknown): OpenAPIParameter[] {
	if (!Array.isArray(value)) return [];

	return value
		.filter(isObject)
		.map((raw) => ({
			name: String(raw.name),
			in: String(raw.in) as OpenAPIParameter["in"],
			required: typeof raw.required === "boolean" ? raw.required : undefined,
			schema: raw.schema,
			type: typeof raw.type === "string" ? raw.type : undefined,
			format: typeof raw.format === "string" ? raw.format : undefined,
			items: raw.items,
			enum: Array.isArray(raw.enum) ? raw.enum : undefined,
			default: raw.default,
			description:
				typeof raw.description === "string" ? raw.description : undefined,
			minLength: typeof raw.minLength === "number" ? raw.minLength : undefined,
			maxLength: typeof raw.maxLength === "number" ? raw.maxLength : undefined,
			pattern: typeof raw.pattern === "string" ? raw.pattern : undefined,
			minimum: typeof raw.minimum === "number" ? raw.minimum : undefined,
			maximum: typeof raw.maximum === "number" ? raw.maximum : undefined,
		}))
		.filter(
			(param) =>
				param.name &&
				["query", "path", "header", "cookie", "body"].includes(param.in),
		);
}

export function createQuerySchemaReference(
	endpoints: Endpoint[],
	schemas: Record<string, Schema>,
): void {
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

		schemas[ep.queryParamsRef] = {
			type: "object",
			properties: queryParamProperties,
			required: required.length > 0 ? required : undefined,
		};
	});
}

export function selectRequestContentType(
	content: Record<string, { schema?: unknown }> | undefined,
): string | undefined {
	if (!content) return undefined;
	const candidate = Object.keys(content).find((ct) =>
		[
			"application/json",
			"application/x-www-form-urlencoded",
			"multipart/form-data",
		].includes(ct),
	);
	return candidate || Object.keys(content)[0];
}
