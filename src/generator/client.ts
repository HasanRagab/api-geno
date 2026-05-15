import { CodeBuilder, type ImportName } from "../codegen/builder";
import type { Endpoint } from "../models";
import type { EndpointStats } from "../reporter";
import { safeMethodName, schemaToTSType } from "./utils";

function getServiceName(tags?: string[]) {
	if (tags && tags.length > 0) {
		const tag = tags[0].replace(/[/\\]+/g, " ").replace(/[-_\s]+/g, " ");
		return `${tag
			.split(" ")
			.filter(Boolean)
			.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
			.join("")}Service`;
	}
	return "ApiService";
}

function buildMethod(
	builder: CodeBuilder,
	ep: Endpoint,
	errorTypeName: string,
	usedNames: Set<string>,
	strictMode: boolean = true,
	warnings: string[] = [],
): string {
	const methodName = safeMethodName(ep, usedNames);
	const method = ep.method.toUpperCase();
	const lowerMethod = method.toLowerCase();
	const responseType =
		strictMode && !ep.responseRef
			? (() => {
					warnings.push("no responseRef");
					return "unknown";
				})()
			: ep.responseRef || "unknown";
	const isMutation = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
	const hasBody = isMutation && !!ep.requestBodyRef;

	if (isMutation && !ep.requestBodyRef) {
		warnings.push("no body schema");
	}
	const contentType = ep.contentType || "application/json";

	const pathParameters = ep.parameters?.filter((p) => p.in === "path") ?? [];
	const queryParameters = ep.parameters?.filter((p) => p.in === "query") ?? [];
	const hasPathParams = pathParameters.length > 0;
	const hasQueryParams = queryParameters.length > 0 || !!ep.queryParamsRef;
	const pathTemplate = ep.path;

	const paramsType = (() => {
		if (hasPathParams && hasQueryParams) {
			const pathType = `{ ${pathParameters
				.map(
					(p) =>
						`${p.name}${p.required ? "" : "?"}: ${schemaToTSType(p.schema)}`,
				)
				.join("; ")} }`;
			const queryType = ep.queryParamsRef || "Record<string, unknown>";
			return `${pathType} & ${queryType}`;
		}
		if (hasPathParams) {
			return `{ ${pathParameters
				.map(
					(p) =>
						`${p.name}${p.required ? "" : "?"}: ${schemaToTSType(p.schema)}`,
				)
				.join("; ")} }`;
		}
		if (hasQueryParams) {
			return ep.queryParamsRef || "Record<string, unknown>";
		}
		return undefined;
	})();

	const bodyType = hasBody ? ep.requestBodyRef || "unknown" : undefined;
	const hasRequiredParams =
		paramsType && pathParameters.some((p) => p.required);
	const optsParts: string[] = [];
	if (paramsType)
		optsParts.push(`params${hasRequiredParams ? "" : "?"}: ${paramsType}`);
	if (bodyType) optsParts.push(`body?: ${bodyType}`);
	optsParts.push("headers?: Record<string, string>");
	optsParts.push("cookies?: Record<string, string>");

	const optsDecl = `opts?: { ${optsParts.join("; ")} }`;
	const returnType = `Promise<Result<${responseType}, ${errorTypeName}>>`;
	const docLines: string[] = [];
	if (ep.summary) docLines.push(ep.summary);
	if (ep.description) {
		if (docLines.length > 0) docLines.push("");
		docLines.push(...ep.description.split("\n"));
	}
	if (ep.deprecated) {
		if (docLines.length > 0) docLines.push("");
		docLines.push("@deprecated");
	}
	if (docLines.length > 0) builder.docComment(docLines);

	builder.method(
		methodName,
		{ async: true, params: optsDecl, returns: returnType },
		(m) => {
			const pathParamNames = pathParameters.map((p) => p.name);
			const usedVars = [];
			if (hasPathParams) usedVars.push("pathParams");
			if (hasQueryParams) usedVars.push("queryParams");
			if (bodyType) usedVars.push("body");

			if (usedVars.length > 0) {
				m.const(
					`{ ${usedVars.join(", ")} }`,
					`await this.createMethod({ path: \`${pathTemplate}\`, method: '${lowerMethod}'${pathParamNames.length > 0 ? `, pathParamNames: [${pathParamNames.map((n) => `'${n}'`).join(", ")}]` : ""} }, opts)`,
				);
			} else {
				m.line(
					`await this.createMethod({ path: \`${pathTemplate}\`, method: '${lowerMethod}'${pathParamNames.length > 0 ? `, pathParamNames: [${pathParamNames.map((n) => `'${n}'`).join(", ")}]` : ""} }, opts)`,
				);
			}
			m.blank();
			m.line(`return this.request<${responseType}>({`);
			m.indent();
			m.line(`path: \`${pathTemplate}\`,`);
			m.line(`method: '${lowerMethod}',`);
			if (hasPathParams) m.line("pathParams,");
			if (hasQueryParams) m.line("queryParams,");
			if (bodyType) {
				m.line(`bodySchema: ${ep.requestBodyRef}Schema,`);
				m.line("body,");
			}
			if (ep.queryParamsRef) {
				m.line(`paramsSchema: ${ep.queryParamsRef}Schema,`);
			}
			m.line(
				"...(opts?.headers && Object.keys(opts.headers).length > 0 ? { headers: opts.headers } : {}),",
			);
			m.line(
				"...(opts?.cookies && Object.keys(opts.cookies).length > 0 ? { cookies: opts.cookies } : {}),",
			);
			if (contentType !== "application/json") {
				m.line(`contentType: '${contentType}',`);
			}
			m.dedent();
			m.line("});");
		},
	);
	return methodName;
}

export function generateClient(
	endpoints: Endpoint[],
	options: {
		errorStyle?: "class" | "shape" | "both";
		splitServices?: boolean;
		flat?: boolean;
		strictMode?: boolean;
	} = {},
): { files: Record<string, string>; endpointStats: EndpointStats[] } {
	const errorStyle = options.errorStyle || "both";
	const errorTypeName = errorStyle === "shape" ? "AppErrorShape" : "AppError";
	const splitServices = options.splitServices !== false;
	const strictMode = options.strictMode !== false;
	const allEndpointStats: EndpointStats[] = [];

	const rootBuilder = new CodeBuilder();
	rootBuilder.importType([{ name: "OpenAPIConfig" }], "./openapi.config");

	const services = new Map<string, Endpoint[]>();
	if (splitServices) {
		endpoints.forEach((ep) => {
			const name = getServiceName(ep.tags);
			if (!services.has(name)) services.set(name, []);
			services.get(name)?.push(ep);
		});
	} else {
		services.set("ApiService", endpoints);
	}

	// Generate ApiClient container
	const serviceNames = Array.from(services.keys()).sort();

	// Import all services
	serviceNames.forEach((serviceName) => {
		rootBuilder.import(
			[serviceName],
			options.flat ? `./${serviceName}` : `./services/${serviceName}`,
		);
	});

	rootBuilder.blank().classBlock("ApiClient", (cls) => {
		// Declare service properties without initialization
		serviceNames.forEach((serviceName) => {
			const propName =
				serviceName.charAt(0).toLowerCase() + serviceName.slice(1);
			cls.line(`public readonly ${propName}: ${serviceName};`);
		});
		cls.blank();
		// Initialize all services in constructor
		cls.method(
			"constructor",
			{ params: "protected readonly config: OpenAPIConfig" },
			(m) => {
				serviceNames.forEach((serviceName) => {
					const propName =
						serviceName.charAt(0).toLowerCase() + serviceName.slice(1);
					m.assign(`this.${propName}`, `new ${serviceName}(config)`);
				});
			},
		);
		cls.blank();
		// Update config at runtime
		cls.method(
			"updateConfig",
			{ params: "partial: Partial<OpenAPIConfig>" },
			(m) => {
				m.line("Object.assign(this.config, partial);");
			},
		);
	});

	// Export services
	rootBuilder.blank().export(serviceNames);

	const files: Record<string, string> = {};
	files["client.ts"] = rootBuilder.toString();

	// Generate service files
	services.forEach((eps, serviceName) => {
		const serviceBuilder = new CodeBuilder();
		// Import order: external, internal core, errors, types
		serviceBuilder.import(
			[
				{ name: "AppError", isType: true },
				{ name: "HttpError", isType: true },
				{ name: "ValidationError", isType: true },
				"formatError",
			],
			options.flat ? "./errors" : "../errors",
		);
		serviceBuilder.import(
			["BaseService"],
			options.flat ? "./request-helper" : "../request-helper",
		);
		serviceBuilder.import(
			[{ name: "Result", isType: true }, "err", "ok"],
			"neverthrow",
		);

		const serviceTypeImports = new Set<string>();
		const serviceValidatorImports = new Set<string>();

		eps.forEach((ep) => {
			if (ep.responseRef) serviceTypeImports.add(ep.responseRef);
			if (ep.requestBodyRef) {
				serviceTypeImports.add(ep.requestBodyRef);
				serviceValidatorImports.add(`${ep.requestBodyRef}Schema`);
			}
			if (ep.queryParamsRef) {
				serviceTypeImports.add(ep.queryParamsRef);
				serviceValidatorImports.add(`${ep.queryParamsRef}Schema`);
			}
		});

		const allImports: ImportName[] = [
			...Array.from(serviceTypeImports)
				.sort()
				.map((name) => ({ name, isType: true })),
			...Array.from(serviceValidatorImports).sort(),
		];

		if (allImports.length > 0) {
			serviceBuilder.import(allImports, options.flat ? "./types" : "../types");
		}

		serviceBuilder.classBlock(
			serviceName,
			(cls) => {
				cls.blank();
				const methodNames = new Set<string>();
				for (const ep of eps) {
					const epWarnings: string[] = [];
					const methodName = buildMethod(
						cls,
						ep,
						errorTypeName,
						methodNames,
						strictMode,
						epWarnings,
					);
					allEndpointStats.push({
						method: ep.method,
						path: ep.path,
						methodName,
						service: serviceName,
						responseType: ep.responseRef || "unknown",
						warnings: epWarnings,
						deprecated: ep.deprecated,
					});
				}
			},
			{ extends: "BaseService" },
		);

		files[options.flat ? `${serviceName}.ts` : `services/${serviceName}.ts`] =
			serviceBuilder.toString();
	});

	return { files, endpointStats: allEndpointStats };
}
