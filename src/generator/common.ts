import { CodeBuilder } from "../codegen/builder";

export function generateCommonHelper(): string {
	const b = new CodeBuilder();
	b.line("import { Result, err, ok } from 'neverthrow';");
	b.line("import { z } from 'zod';");
	b.line("import { httpAdapter } from './http-adapter';");
	b.line("import { OpenAPIConfig } from './openapi.config';");
	b.line(
		"import { ValidationError, HttpError, formatError, AppError } from './errors';",
	);
	b.blank();

	// --- buildUrl helper ---
	b.function(
		"buildUrl",
		{
			params: "path: string, pathParams?: Record<string, unknown>",
			returns: "string",
		},
		(f) => {
			f.docComment([
				"Replace path parameters in URL.",
				"@param path - URL path with {id} placeholders",
				"@param pathParams - Object with path parameter values",
				"@returns URL with replaced path parameters",
			]);
			f.blank();
			f.if("!pathParams", (b) => b.return("path"));
			f.blank();
			f.return(
				"path.replace(/\\{([^}]+)\\}/g, (_, key) => encodeURIComponent(String(pathParams[key])))",
			);
		},
	);
	b.blank();

	// --- validateData helper ---
	b.function(
		"validateData",
		{
			params:
				"schema: z.ZodType<unknown> | undefined, data: unknown, mode: 'strict' | 'warn' | 'none' = 'strict'",
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
		{ params: "body: unknown, contentType: string", returns: "any" },
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
					"Object.entries(body as Record<string, unknown>).forEach(([key, value]) => {",
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

	b.line("export type RequestOpts = {");
	b.indent();
	b.line("path: string;");
	b.line("method: string;");
	b.line("pathParams?: Record<string, unknown>;");
	b.line("queryParams?: Record<string, unknown>;");
	b.line("paramsSchema?: z.ZodType<unknown>;");
	b.line("bodySchema?: z.ZodType<unknown>;");
	b.line("body?: unknown;");
	b.line("headers?: Record<string, string>;");
	b.line("cookies?: Record<string, string>;");
	b.line("contentType?: string;");
	b.line("validationMode?: 'strict' | 'warn' | 'none';");
	b.dedent();
	b.line("};");
	b.blank();

	b.line("export async function request<T>(");
	b.indent();
	b.line("options: RequestOpts,");
	b.line("config: OpenAPIConfig");
	b.dedent();
	b.line("): Promise<Result<T, AppError>> {");

	b.indent();
	b.line("const {");
	b.indent();
	b.line("path,");
	b.line("method,");
	b.line("pathParams = {},");
	b.line("queryParams = {},");
	b.line("paramsSchema,");
	b.line("bodySchema,");
	b.line("body,");
	b.line("headers = {},");
	b.line("cookies = {},");
	b.line("contentType = 'application/json',");
	b.line("validationMode = 'strict'");
	b.dedent();
	b.line("} = options;");
	b.blank();

	b.const("paramsValidation", "await validateData(paramsSchema, pathParams)");
	b.if("paramsValidation.isErr()", (b) =>
		b.return("err(paramsValidation.error)"),
	);
	b.blank();

	b.const("bodyValidation", "await validateData(bodySchema, body)");
	b.if("bodyValidation.isErr()", (b) => b.return("err(bodyValidation.error)"));
	b.blank();

	b.line("// Build URL with path params only");
	b.line("let url: string;");
	b.line("try {");
	b.indent();
	b.assign("url", "buildUrl(path, pathParams)");
	b.dedent();
	b.line("} catch (error: unknown) {");
	b.indent();
	b.return("err(new ValidationError(error.message) as any)");
	b.dedent();
	b.line("}");
	b.blank();

	b.line("// Append query params to URL");
	b.const("queryStr", "new URLSearchParams(queryParams).toString()");
	b.if("queryStr", (b) => b.assign("url", "url + '?' + queryStr"));
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
	b.dedent();
	b.line("}, config);");
	b.dedent();
	b.line("}");
	b.blank();

	// --- BaseService class ---
	b.line("export class BaseService {");
	b.indent();
	b.line("constructor(protected readonly config: OpenAPIConfig) {}");
	b.blank();
	b.line("protected async request<T>(options: RequestOpts) {");
	b.indent();
	b.return("request<T>(options, this.config)");
	b.dedent();
	b.line("}");
	b.blank();
	b.line("protected mergeRequestOpts(");
	b.indent();
	b.line("base: Partial<RequestOpts>,");
	b.line(
		"opts?: { headers?: Record<string, string>; cookies?: Record<string, string> },",
	);
	b.dedent();
	b.line("): RequestOpts {");
	b.indent();
	b.const("{ headers, cookies }", "opts || {}");
	b.return(
		"{ ...(base as any), ...(headers && Object.keys(headers).length > 0 ? { headers } : {}), ...(cookies && Object.keys(cookies).length > 0 ? { cookies } : {}) }",
	);
	b.dedent();
	b.line("}");
	b.dedent();
	b.line("}");

	return b.toString();
}
