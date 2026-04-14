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
				"path: string, params: Record<string, any>, explicitQueryKeys: string[]",
			returns: "string",
		},
		(f) => {
			f.line("const queryParamsObj = new URLSearchParams();");
			f.line("const explicitKeysSet = new Set(explicitQueryKeys);");
			f.blank();
			f.line("explicitQueryKeys.forEach((key) => {");
			f.indent();
			f.line("if (params[key] !== undefined) {");
			f.indent();
			f.line("queryParamsObj.append(key, String(params[key]));");
			f.dedent();
			f.line("}");
			f.dedent();
			f.line("});");
			f.blank();
			f.line("Object.entries(params).forEach(([key, value]) => {");
			f.indent();
			f.line("if (value !== undefined && !explicitKeysSet.has(key)) {");
			f.indent();
			f.line("queryParamsObj.append(key, String(value));");
			f.dedent();
			f.line("}");
			f.dedent();
			f.line("});");
			f.blank();
			f.line("const queryString = queryParamsObj.toString();");
			f.return("path + (queryString ? '?' + queryString : '')");
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

	b.const("paramsValidation", "await validateData(paramsSchema, params)");
	b.if("paramsValidation.isErr()", (b) =>
		b.return("err(paramsValidation.error)"),
	);
	b.blank();

	b.const("bodyValidation", "await validateData(bodySchema, body)");
	b.if("bodyValidation.isErr()", (b) => b.return("err(bodyValidation.error)"));
	b.blank();

	b.const(
		"url",
		"buildUrl(path, (params || {}) as Record<string, any>, explicitQueryKeys)",
	);
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
