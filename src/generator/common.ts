import { CodeBuilder } from "../codegen/builder";

export function generateCommonHelper(): string {
	const b = new CodeBuilder();
	b.line("import { Result, err, ok } from 'neverthrow';");
	b.line("import { z } from 'zod';");
	b.line("import { httpAdapter } from './http-adapter';");
	b.line(
		"import { ValidationError, HttpError, formatError, AppError } from './errors';",
	);
	b.blank();

	// --- buildUrl helper ---
	b.function(
		"buildUrl",
		{
			params:
				"path: string, pathParams: Record<string, any>, queryParams: Record<string, any>, explicitQueryKeys: string[]",
			returns: "string",
		},
		(f) => {
			f.docComment([
				"Replaces path parameters in the URL and builds query string.",
				"@param path - URL path with placeholders like {id} or :id",
				"@param pathParams - Object with path parameter values",
				"@param queryParams - Object with query parameter values",
				"@param explicitQueryKeys - Array of keys that must be treated as query params",
				"@returns Complete URL with replaced path and query string",
			]);
			f.blank();
			f.const("queryParamsObj", "new URLSearchParams()");
			f.const("explicitKeysSet", "new Set(explicitQueryKeys)");
			f.const("missingParams", "[] as string[]", "string[]");
			f.blank();
			f.comment("Replace path parameters in the URL");
			f.const("pathParamPattern", "/\\{([^}]+)\\}|:([a-zA-Z_][a-zA-Z0-9_]*)/g");
			f.const("placeholders", "new Set<string>()");
			f.blank();
			f.line("let match;");
			f.while("(match = pathParamPattern.exec(path)) !== null", (w) => {
				w.const("paramName", "match[1] || match[2]");
				w.line("placeholders.add(paramName);");
			});
			f.blank();
			f.line("let replacedPath = path;");
			f.forEach("placeholders", "paramName", (forEach) => {
				forEach.ifChain([
					{
						condition:
							"pathParams[paramName] === undefined || pathParams[paramName] === null",
						body: (b) => {
							b.line("missingParams.push(paramName);");
						},
					},
					{
						body: (b) => {
							b.const(
								"value",
								"encodeURIComponent(String(pathParams[paramName]))",
							);
							b.assign(
								"replacedPath",
								"replacedPath.replace(new RegExp(`\\\\{${paramName}\\\\}|:${paramName}`, 'g'), value)",
							);
						},
					},
				]);
			});
			f.blank();
			f.if("missingParams.length > 0", (b) => {
				b.throw(
					"new Error(`Missing required path parameters: ${missingParams.join(', ')}`)",
				);
			});
			f.blank();
			f.comment("Build query string");
			f.forEach("explicitQueryKeys", "key", (forEach) => {
				forEach.if(
					"queryParams[key] !== undefined && queryParams[key] !== null",
					(b) => {
						b.line("queryParamsObj.append(key, String(queryParams[key]));");
					},
				);
			});
			f.blank();
			f.forEach("Object.entries(queryParams)", "[key, value]", (forEach) => {
				forEach.if(
					"value !== undefined && value !== null && !explicitKeysSet.has(key)",
					(b) => {
						b.line("queryParamsObj.append(key, String(value));");
					},
				);
			});
			f.blank();
			f.const("queryString", "queryParamsObj.toString()");
			f.return("replacedPath + (queryString ? '?' + queryString : '')");
		},
	);
	b.blank();

	// --- validateData helper ---
	b.function(
		"validateData",
		{
			params:
				"schema: z.ZodType<any> | undefined, data: any, mode: 'strict' | 'warn' | 'none' = 'strict'",
			returns: "Result<void, AppError>",
		},
		(f) => {
			f.if(
				"!schema || data === undefined || data === null || mode === 'none'",
				(b) => b.return("ok(undefined)"),
			);
			f.tryCatch(
				(t) => {
					t.line("schema.parse(data);");
					t.return("ok(undefined)");
				},
				"error",
				(c) => {
					c.if("mode === 'warn'", (inner) => {
						inner.line(
							"console.warn('Validation warning:', formatError(error));",
						);
						inner.return("ok(undefined)");
					});
					c.return("err(new ValidationError(formatError(error)) as any)");
				},
			);
		},
	);
	b.blank();

	// --- serializeBody helper ---
	b.function(
		"serializeBody",
		{ params: "body: any, contentType: string", returns: "any" },
		(f) => {
			f.if("body === undefined || body === null", (b) => b.return("undefined"));
			f.const("lowerContentType", "contentType.toLowerCase()");
			f.if("lowerContentType.includes('application/json')", (b) =>
				b.return("JSON.stringify(body)"),
			);
			f.if(
				"lowerContentType.includes('application/x-www-form-urlencoded')",
				(b) => b.return("new URLSearchParams(body).toString()"),
			);
			f.if("lowerContentType.includes('multipart/form-data')", (b) => {
				b.if("body instanceof FormData", (inner) => inner.return("body"));
				b.const("formData", "new FormData()");
				b.line(
					"Object.entries(body as Record<string, any>).forEach(([key, value]) => {",
				);
				b.indent();
				b.ifChain([
					{
						condition: "value instanceof FileList",
						body: (b) =>
							b.line(
								"for (let i = 0; i < value.length; i++) formData.append(key, value[i])",
							),
					},
					{
						condition: "Array.isArray(value)",
						body: (b) => b.line("value.forEach(v => formData.append(key, v))"),
					},
					{
						condition: "value !== undefined",
						body: (b) => b.line("formData.append(key, value)"),
					},
				]);
				b.dedent();
				b.line("});");
				b.return("formData");
			});
			f.return("body");
		},
	);
	b.blank();

	// --- getHeaders helper ---
	b.function(
		"getHeaders",
		{
			params:
				"headers: Record<string, string>, cookies: Record<string, string>, contentType: string",
			returns: "Record<string, string>",
		},
		(f) => {
			f.const("mergedHeaders", "{ ...headers }");
			f.if(
				"contentType && !contentType.toLowerCase().includes('multipart/form-data')",
				(b) => {
					b.assign("mergedHeaders['Content-Type']", "contentType");
				},
			);
			f.if("cookies && Object.keys(cookies).length > 0", (b) => {
				b.assign(
					"mergedHeaders['Cookie']",
					"Object.entries(cookies).map(([k, v]) => k + '=' + v).join('; ')",
				);
			});
			f.return("mergedHeaders");
		},
	);
	b.blank();

	b.line("export async function request<T, P = undefined, B = any>(options: {");
	b.indent();
	b.line("path: string;");
	b.line("method: string;");
	b.line("params?: P;");
	b.line("pathParams?: Record<string, any>;");
	b.line("queryParams?: Record<string, any>;");
	b.line("paramsSchema?: z.ZodType<P>;");
	b.line("bodySchema?: z.ZodType<B>;");
	b.line("explicitQueryKeys?: string[];");
	b.line("body?: B;");
	b.line("headers?: Record<string, string>;");
	b.line("cookies?: Record<string, string>;");
	b.line("contentType?: string;");
	b.line("security?: Record<string, string[]>[];");
	b.line("validationMode?: 'strict' | 'warn' | 'none';");
	b.dedent();
	b.line("}): Promise<Result<T, AppError>> {");

	b.indent();
	b.line("const {");
	b.indent();
	b.line("path,");
	b.line("method,");
	b.line("params,");
	b.line("pathParams: userPathParams,");
	b.line("queryParams: userQueryParams,");
	b.line("paramsSchema,");
	b.line("bodySchema,");
	b.line("explicitQueryKeys = [],");
	b.line("body,");
	b.line("headers = {},");
	b.line("cookies = {},");
	b.line("contentType = 'application/json',");
	b.line("security = [],");
	b.line("validationMode = 'strict'");
	b.dedent();
	b.line("} = options;");
	b.blank();

	b.line(
		"// Support both old (params) and new (pathParams + queryParams) signatures",
	);
	b.const(
		"finalPathParams",
		"userPathParams || (params as Record<string, any>) || {}",
	);
	b.const("finalQueryParams", "userQueryParams || {}");
	b.blank();

	b.const("paramsValidation", "await validateData(paramsSchema, params)");
	b.if("paramsValidation.isErr()", (b) =>
		b.return("err(paramsValidation.error)"),
	);
	b.blank();

	b.const("bodyValidation", "await validateData(bodySchema, body)");
	b.if("bodyValidation.isErr()", (b) => b.return("err(bodyValidation.error)"));
	b.blank();

	b.line("// Build URL with separate path and query params");
	b.line("let url: string;");
	b.line("try {");
	b.indent();
	b.assign(
		"url",
		"buildUrl(path, finalPathParams, finalQueryParams, explicitQueryKeys)",
	);
	b.dedent();
	b.line("} catch (error: any) {");
	b.indent();
	b.return("err(new ValidationError(error.message) as any)");
	b.dedent();
	b.line("}");
	b.blank();

	b.const("serializedBody", "serializeBody(body, contentType)");
	b.const(
		"finalHeaders",
		"getHeaders(headers || {}, cookies || {}, contentType)",
	);
	b.blank();

	b.line("return await httpAdapter.request<T>(url, {");
	b.indent();
	b.line("method,");
	b.line("headers: finalHeaders,");
	b.line("body: serializedBody,");
	b.line("security");
	b.dedent();
	b.line("});");
	b.dedent();
	b.line("}");

	return b.toString();
}
