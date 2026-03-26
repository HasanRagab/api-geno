import { CodeBuilder } from "./codegen/builder";
import { generateClient } from "./generator/client";
import { generateConfig, generateConfigTypes } from "./generator/config";
import { generateErrors } from "./generator/errors";
import { generateTypes } from "./generator/types";
import type { OpenAPIModel } from "./models";
import { parseOpenAPI } from "./parser/openapi";
import type { GeneratorPlugin } from "./plugins/plugin";

function generateHttpAdapter(adapter: "axios" | "fetch" = "axios"): string {
	const b = new CodeBuilder();

	// ── shared imports ───────────────────────────────────────────
	b.import(["ok", "err", { name: "Result" }], "neverthrow");
	b.import(["OpenAPI", { name: "OpenAPIConfig" }], "./openapi.config");
	b.import(["HttpError", "AppError"], "./errors");

	if (adapter === "axios") {
		b.importDefault("axios", "axios");
	}

	b.blank();

	// ── HttpAdapter interface ────────────────────────────────────
	b.interface("HttpAdapter", {
		request: {
			type: "<T>(url: string, options: any) => Promise<Result<T, AppError>>",
		},
	});

	b.blank();

	// ── resolveValue helper ──────────────────────────────────────
	b.function(
		"resolveValue",
		{
			async: true,
			params: "value: T | (() => T | Promise<T>) | undefined",
			returns: "Promise<T | undefined>",
		},
		(f) => {
			f.if("value === undefined", (b) => b.return("undefined"));
			f.if("typeof value === 'function'", (b) => b.return("(value as any)()"));
			f.return("value");
		},
	);

	b.blank();

	// ── safeParseJson helper ─────────────────────────────────────
	b.function("safeParseJson", { params: "text: string" }, (f) => {
		f.tryCatch(
			(t) => t.return("JSON.parse(text)"),
			"error: any",
			(c) => c.return("undefined"),
		);
	});

	b.blank();

	// ── prepareRequest helper ────────────────────────────────────
	b.function(
		"prepareRequest",
		{ async: true, params: "url: string, options: any" },
		(f) => {
			f.const("token", "await resolveValue(OpenAPI.TOKEN)");
			f.const("username", "await resolveValue(OpenAPI.USERNAME)");
			f.const("password", "await resolveValue(OpenAPI.PASSWORD)");
			f.const("headers", "await resolveValue(OpenAPI.HEADERS)");
			f.blank();
			f.let(
				"finalUrl",
				"OpenAPI.BASE + (OpenAPI.ENCODE_PATH ? OpenAPI.ENCODE_PATH(url) : url)",
			);
			f.const(
				"finalHeaders",
				"{ ...options.headers } as Record<string, string>",
			);
			f.blank();

			f.if("headers && typeof headers === 'object'", (b) => {
				b.forOf("[key, value]", "Object.entries(headers as any)", (inner) => {
					inner.ifChain([
						{
							condition: "typeof value === 'function'",
							body: (b) => b.assign("finalHeaders[key]", "await value()"),
						},
						{
							condition: "typeof value === 'string'",
							body: (b) => b.assign("finalHeaders[key]", "value"),
						},
						{ body: (b) => b.assign("finalHeaders[key]", "String(value)") },
					]);
				});
			});

			f.blank();
			f.const("authScheme", "OpenAPI.AUTH_SCHEME");
			f.ifChain([
				{
					condition: "authScheme === 'bearer' && token",
					body: (b) =>
						b.assign("finalHeaders['Authorization']", "'Bearer ' + token"),
				},
				{
					condition: "authScheme === 'basic' && username && password",
					body: (b) => {
						b.const(
							"creds",
							"(typeof username === 'function' ? await username() : username)" +
							" + ':' + (typeof password === 'function' ? await password() : password)",
						);
						b.assign(
							"finalHeaders['Authorization']",
							"'Basic ' + Buffer.from(creds).toString('base64')",
						);
					},
				},
				{
					condition: "authScheme === 'apiKey'",
					body: (b) => {
						b.const("apiKeyVal", "await resolveValue(OpenAPI.API_KEY)");
						b.const("apiKeyName", "OpenAPI.API_KEY_NAME");
						b.const("apiKeyIn", "OpenAPI.API_KEY_IN || 'header'");
						b.if("apiKeyVal && apiKeyName", (inner) => {
							inner.ifChain([
								{
									condition: "apiKeyIn === 'header'",
									body: (b) =>
										b.assign("finalHeaders[apiKeyName]", "apiKeyVal as string"),
								},
								{
									body: (b) => {
										b.const("joinChar", "finalUrl.includes('?') ? '&' : '?'");
										b.assign(
											"finalUrl",
											"finalUrl + joinChar + encodeURIComponent(apiKeyName)" +
											" + '=' + encodeURIComponent(String(apiKeyVal))",
										);
									},
								},
							]);
						});
					},
				},
			]);

			f.blank();
			f.return("{ finalUrl, finalHeaders }");
		},
	);

	b.blank();

	// ── httpAdapter export ───────────────────────────────────────
	b.line(`export const httpAdapter: HttpAdapter = {`);
	b.indent();
	b.line("async request(url, options) {");
	b.indent();

	b.tryCatch(
		(tryBody) => {
			tryBody.const(
				"{ finalUrl, finalHeaders }",
				"await prepareRequest(url, options)",
			);
			tryBody.const(
				"isFormData",
				"typeof FormData !== 'undefined' && options.body instanceof FormData",
			);
			tryBody.const(
				"headers",
				`isFormData ? (() => { const h = { ...finalHeaders }; delete h['Content-Type']; return h; })() : finalHeaders`,
			);
			tryBody.blank();

			if (adapter === "fetch") {
				tryBody.const(
					"response",
					`await fetch(finalUrl, {
          method: options.method || 'GET',
          headers,
          body: options.body,
          credentials: OpenAPI.WITH_CREDENTIALS ? 'include' : 'same-origin',
        })`,
				);
				tryBody.const("text", "await response.text()");
				tryBody.const(
					"contentType",
					"(response.headers.get('content-type') || '').toLowerCase()",
				);
				tryBody.const(
					"body",
					"text ? (/(application\\/json|\\+json|\\/json)/i.test(contentType) ? safeParseJson(text) : text) : undefined",
				);
				tryBody.if("contentType && !/application\\/json|\\+json|\\/json|text\\//i.test(contentType)", (b) => {
					b.const("blob", "await response.blob()");
					b.return("ok(blob as any)");
				});
				tryBody.if("text && /application\\/json|\\+json|\\/json/i.test(contentType) && body === undefined", (b) =>
					b.return(
						"err(new HttpError(response.status, 'Failed to parse response JSON', null))",
					),
				);
				tryBody.if("!response.ok", (b) =>
					b.return(
						"err(new HttpError(response.status, response.statusText, body))",
					),
				);
				tryBody.return("ok(body as any)");
			} else {
				tryBody.const(
					"response",
					`await (OpenAPI.AXIOS_INSTANCE || axios)({
          url: finalUrl,
          method: options.method || "GET",
          headers,
          data: options.body,
          withCredentials: OpenAPI.WITH_CREDENTIALS,
          responseType: contentType && !/application\\/json|\\+json|\\/json|text\\//i.test(contentType) ? 'blob' : 'json',
        })`,
				);
				tryBody.return("ok(response.data as any)");
			}
		},
		"error: any",
		(catchBody) => {
			if (adapter === "fetch") {
				catchBody.return(
					"err(new HttpError(0, error.message || 'Network Error', null))",
				);
			} else {
				catchBody.const("status", "error.response?.status || 0");
				catchBody.const(
					"statusText",
					"error.response?.statusText || error.message",
				);
				catchBody.const("body", "error.response?.data");
				catchBody.return("err(new HttpError(status, statusText, body))");
			}
		},
	);

	b.dedent();
	b.line("}");
	b.dedent();
	b.line("};");

	return b.toString();
}

export function generateFromOpenAPI(
	filePath: string,
	plugins: GeneratorPlugin[] = [],
	options: {
		errorStyle?: "class" | "shape" | "both";
		httpAdapter?: "axios" | "fetch";
	} = {},
): Record<string, string> {
	const api: OpenAPIModel = parseOpenAPI(filePath);

	plugins.forEach((p) => p.beforeGenerate?.(api));
	plugins.forEach((p) => {
		if (p.transformEndpoint)
			api.endpoints = api.endpoints.map((endpoint) =>
				p.transformEndpoint!(endpoint),
			);
		if (p.transformSchema)
			api.schemas = Object.fromEntries(
				Object.entries(api.schemas).map(([name, schema]) => [
					name,
					p.transformSchema!(name, schema),
				]),
			);
	});

	const typesFiles = generateTypes(api.schemas);
	const clientFiles = generateClient(api.endpoints, {
		errorStyle: options.errorStyle,
	});
	const errorsCode = generateErrors(options.errorStyle || "both");

	const configBuilder = new CodeBuilder();
	configBuilder.raw(generateConfigTypes());
	configBuilder.blank();
	configBuilder.blank();
	configBuilder.raw(generateConfig(api.base));

	// Build http-adapter.ts with CodeBuilder (calls generateHttpAdapter above)
	const adapterCode = generateHttpAdapter(options.httpAdapter ?? "axios");

	const files: Record<string, string> = {
		...typesFiles,
		...clientFiles,
		"http-adapter.ts": adapterCode,
		"errors.ts": errorsCode,
		"openapi.config.ts": configBuilder.toString(),
	};

	plugins.forEach((p) => p.afterGenerate?.(files, api));
	return files;
}
