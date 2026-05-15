import { CodeBuilder } from "../codegen/builder";

export function generateHttpAdapter(
	adapter: "axios" | "fetch" = "axios",
): string {
	const b = new CodeBuilder();

	// ── shared imports ───────────────────────────────────────────
	b.import(["err", "ok", "Result"], "neverthrow");
	b.import([{ name: "OpenAPIConfig", isType: true }], "./openapi.config");
	b.import(["HttpError"], "./errors");
	b.import([{ name: "AppError", isType: true }], "./errors");

	if (adapter === "axios") {
		b.importDefault("axios", "axios");
	}

	b.blank();

	// ── HttpAdapter interface ────────────────────────────────────
	b.interface("HttpAdapter", {
		request: {
			type: "<T>(url: string, options: RequestOptions, config: OpenAPIConfig) => Promise<Result<T, AppError>>",
		},
	});

	b.blank();

	// ── RequestOptions type ──────────────────────────────────────
	b.line("type RequestOptions = {");
	b.indent();
	b.line("method?: string;");
	b.line("headers?: Record<string, string>;");
	b.line("body?: unknown;");
	b.dedent();
	b.line("};");

	b.blank();

	// ── resolveValue helper ──────────────────────────────────────
	b.function(
		"resolveValue",
		{
			async: true,
			generics: "<T>",
			params: "value: T | (() => T | Promise<T>) | undefined",
			returns: "Promise<T | undefined>",
		},
		(f) => {
			f.if("value === undefined", (b) => b.return("undefined"));
			f.if("typeof value === 'function'", (b) => {
				b.return("(value as () => T | Promise<T>)()");
			});
			f.return("value as T");
		},
	);

	b.blank();

	// ── safeParseJson helper ─────────────────────────────────────
	if (adapter === "fetch") {
		b.function("safeParseJson", { params: "text: string" }, (f) => {
			f.tryCatch(
				(t) => t.return("JSON.parse(text)"),
				"_error: unknown",
				(c) => c.return("undefined"),
			);
		});

		b.blank();
	}

	// ── prepareRequest helper ────────────────────────────────────
	b.function(
		"prepareRequest",
		{
			async: true,
			params: "url: string, options: RequestOptions, config: OpenAPIConfig",
		},
		(f) => {
			f.const("token", "await resolveValue(config.TOKEN)");
			f.const("username", "await resolveValue(config.USERNAME)");
			f.const("password", "await resolveValue(config.PASSWORD)");
			f.const("headers", "await resolveValue(config.HEADERS)");
			f.blank();
			f.let(
				"finalUrl",
				"config.BASE + (config.ENCODE_PATH ? config.ENCODE_PATH(url) : url)",
			);
			f.const(
				"finalHeaders",
				"{ ...options.headers } as Record<string, string>",
			);
			f.blank();

			f.if("headers && typeof headers === 'object'", (b) => {
				b.forOf("[key, value]", "Object.entries(headers)", (inner) => {
					inner.ifChain([
						{
							condition: "typeof value === 'function'",
							body: (b) =>
								b.assign(
									"finalHeaders[key]",
									"await (value as () => Promise<string>)()",
								),
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
			f.const("authScheme", "config.AUTH_SCHEME");
			f.ifChain([
				{
					condition: "authScheme === 'bearer' && token",
					body: (b) =>
						b.assign("finalHeaders.Authorization", "`Bearer ${token}`"),
				},
				{
					condition: "authScheme === 'basic' && username && password",
					body: (b) => {
						b.const("creds", "`${username}:${password}`");
						b.assign(
							"finalHeaders.Authorization",
							"`Basic ${Buffer.from(creds).toString('base64')}`",
						);
					},
				},
				{
					condition: "authScheme === 'apiKey'",
					body: (b) => {
						b.const("apiKeyVal", "await resolveValue(config.API_KEY)");
						b.const("apiKeyName", "config.API_KEY_NAME");
						b.const("apiKeyIn", "config.API_KEY_IN || 'header'");
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
	b.line("export const httpAdapter: HttpAdapter = {");
	b.indent();
	b.method(
		"request",
		{
			async: true,
			params: "url: string, options: RequestOptions, config: OpenAPIConfig",
		},
		(m) => {
			m.tryCatch(
				(tryBody) => {
					tryBody.const(
						"{ finalUrl, finalHeaders }",
						"await prepareRequest(url, options, config)",
					);
					tryBody.const(
						"isFormData",
						"typeof FormData !== 'undefined' && options.body instanceof FormData",
					);
					tryBody.const(
						"headers",
						"isFormData ? (() => { const h = { ...finalHeaders }; delete h['Content-Type']; return h; })() : finalHeaders",
					);
					tryBody.blank();

					if (adapter === "fetch") {
						tryBody.line("const response = await fetch(finalUrl,");
						tryBody.indent();
						tryBody.object({
							method: "options.method || 'GET'",
							headers: "headers",
							body: "options.body as BodyInit | undefined",
							credentials:
								"config.WITH_CREDENTIALS ? 'include' : 'same-origin'",
						});
						tryBody.dedent();
						tryBody.line(");");

						tryBody.const("text", "await response.text()");
						tryBody.const(
							"contentType",
							"(response.headers.get('content-type') || '').toLowerCase()",
						);
						tryBody.const(
							"body",
							"text ? (/(application\\/json|\\+json|\\/json)/i.test(contentType) ? safeParseJson(text) : text) : undefined",
						);
						tryBody.if(
							"contentType && !/application\\/json|\\+json|\\/json|text\\//i.test(contentType)",
							(b) => {
								b.const("blob", "await response.blob()");
								b.return("ok(blob)");
							},
						);
						tryBody.if(
							"text && /application\\/json|\\+json|\\/json/i.test(contentType) && body === undefined",
							(b) =>
								b.return(
									"err(new HttpError(response.status, 'Failed to parse response JSON', null))",
								),
						);
						tryBody.if("!response.ok", (b) =>
							b.return(
								"err(new HttpError(response.status, response.statusText, body))",
							),
						);
						tryBody.return("ok(body)");
					} else {
						tryBody.const("contentType", "headers['Content-Type']");
						tryBody.line(
							"const axiosClient = (config.AXIOS_INSTANCE ?? axios) as typeof axios;",
						);
						tryBody.line("const response = await axiosClient(");
						tryBody.indent();
						tryBody.object({
							url: "finalUrl",
							method: 'options.method || "GET"',
							headers: "headers",
							data: "options.body",
							withCredentials: "config.WITH_CREDENTIALS",
							responseType:
								"contentType && !/application\\/json|\\+json|\\/json|text\\//i.test(contentType) ? 'blob' : 'json'",
						});
						tryBody.dedent();
						tryBody.line(");");
						tryBody.return("ok(response.data)");
					}
				},
				"error: unknown",
				(catchBody) => {
					if (adapter === "fetch") {
						catchBody.const(
							"message",
							"error instanceof Error ? error.message : 'Network Error'",
						);
						catchBody.return("err(new HttpError(0, message, null))");
					} else {
						catchBody.const(
							"axiosError",
							"error as { response?: { status?: number; statusText?: string; data?: unknown } & { message?: string } }",
						);
						catchBody.const("status", "axiosError.response?.status || 0");
						catchBody.const(
							"statusText",
							"axiosError.response?.statusText || (error instanceof Error ? error.message : 'Unknown error')",
						);
						catchBody.const("body", "axiosError.response?.data");
						catchBody.return("err(new HttpError(status, statusText, body))");
					}
				},
			);
		},
	);
	b.dedent();
	b.line("};");

	return b.toString();
}
