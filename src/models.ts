export interface Schema {
	type?: "object" | "number" | "string" | "boolean" | "array" | "integer";
	format?: "date-time" | "uri" | "email" | "uuid" | "binary" | "int64" | string;

	properties?: Record<string, Schema>;
	required?: string[];
	additionalProperties?: boolean | Schema;

	items?: Schema;
	minItems?: number;
	maxItems?: number;

	$ref?: `#/components/schemas/${string}`;
	allOf?: Schema[];
	oneOf?: Schema[];
	anyOf?: Schema[];

	enum?: (string | number | boolean)[];
	minLength?: number;
	maxLength?: number;
	pattern?: string;
	minimum?: number;
	maximum?: number;

	default?: any;
	example?: any;
	description?: string;
	title?: string;
	nullable?: boolean;
}

export interface Parameter {
	name: string;
	in: "query" | "path" | "header" | "cookie";
	required?: boolean;
	schema: Schema;
}

export interface Response {
	description?: string;
	content?: Record<string, { schema: Schema }>;
}

export interface Endpoint {
	path: string;
	method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "OPTIONS" | "HEAD";
	operationId: string;

	tags?: string[];
	parameters?: Parameter[];

	requestBody?: Schema;
	requestBodyRef?: string;
	queryParamsRef?: string;
	responseRef?: string;
	contentType?: string;

	responses: Record<string, Response>;
}

export interface OpenAPIModel {
	endpoints: Endpoint[];
	schemas: Record<string, Schema>;
	components?: {
		schemas: Record<string, Schema>;
	};
}
