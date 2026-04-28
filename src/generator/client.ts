import { CodeBuilder } from "../codegen/builder";
import type { Endpoint, Schema } from "../models";
import { safeMethodName } from "./utils";

function toMethodName(endpoint: Endpoint, usedNames: Set<string>) {
	return safeMethodName(endpoint, usedNames);
}

function getServiceName(tags?: string[]) {
	if (tags && tags.length > 0) {
		const tag = tags[0].replace(/[-_\s]+/g, " ");
		return `${tag
			.split(" ")
			.filter(Boolean)
			.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
			.join("")}Service`;
	}
	return "ApiService";
}

function schemaToTS(schema: Schema | undefined): string {
	if (!schema) return "unknown";
	if (schema.$ref) return schema.$ref.split("/").pop() || "unknown";
	if (schema.type === "string") return "string";
	if (schema.type === "number" || schema.type === "integer") return "number";
	if (schema.type === "boolean") return "boolean";
	if (schema.type === "array") {
		const itemType = schemaToTS(schema.items || {});
		return `${itemType}[]`;
	}
	if (schema.type === "object") return "Record<string, unknown>";
	return "unknown";
}

function buildMethod(
	builder: CodeBuilder,
	ep: Endpoint,
	errorTypeName: string,
	usedNames: Set<string>,
) {
	const methodName = toMethodName(ep, usedNames);
	const method = ep.method.toUpperCase();
	const lowerMethod = method.toLowerCase();
	const responseType = ep.responseRef || "any";
	const hasBody =
		["POST", "PUT", "PATCH", "DELETE"].includes(method) && !!ep.requestBodyRef;
	const contentType = ep.contentType || "application/json";

	const pathParameters = ep.parameters?.filter((p) => p.in === "path") ?? [];
	const queryParameters = ep.parameters?.filter((p) => p.in === "query") ?? [];
	const hasPathParams = pathParameters.length > 0;
	const hasQueryParams = queryParameters.length > 0 || !!ep.queryParamsRef;
	const pathTemplate = ep.path.replace(/([^]+)/g, "{$1}");

	const paramsType = (() => {
		if (hasPathParams && hasQueryParams) {
			const pathType = `{ ${pathParameters
				.map(
					(p) => `${p.name}${p.required ? "" : "?"}: ${schemaToTS(p.schema)}`,
				)
				.join("; ")} }`;
			const queryType = ep.queryParamsRef || "Record<string, unknown>";
			return `${pathType} & ${queryType}`;
		}
		if (hasPathParams) {
			return `{ ${pathParameters
				.map(
					(p) => `${p.name}${p.required ? "" : "?"}: ${schemaToTS(p.schema)}`,
				)
				.join("; ")} }`;
		}
		if (hasQueryParams) {
			return ep.queryParamsRef || "Record<string, unknown>";
		}
		return undefined;
	})();

	const bodyType = hasBody ? ep.requestBodyRef || "unknown" : undefined;
	const optsParts: string[] = [];
	if (paramsType) optsParts.push(`params?: ${paramsType}`);
	if (bodyType) optsParts.push(`body?: ${bodyType}`);
	optsParts.push("headers?: Record<string, string>");
	optsParts.push("cookies?: Record<string, string>");

	const optsDecl =
		optsParts.length > 0 ? `opts?: { ${optsParts.join("; ")} }` : "";
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
			const destructure: string[] = [];
			if (paramsType) destructure.push("params");
			if (bodyType) destructure.push("body");
			destructure.push("headers = {}", "cookies = {}");

			m.line(`const { ${destructure.join(", ")} } = opts || {};`);
			m.blank();

			// Separate path and query params if both exist
			if (hasPathParams && hasQueryParams) {
				const pathParamNames = pathParameters.map((p) => p.name);
				const pathParamAssignments = pathParamNames
					.map((name) => `${name}: (params as any).${name}`)
					.join(", ");
				const pathParamRemovals = pathParamNames
					.map((name) => `${name}: undefined`)
					.join(", ");
				m.line(`const pathParams = params ? { ${pathParamAssignments} } : {};`);
				m.line(
					`const queryParams = params ? { ...params as any, ${pathParamRemovals} } : {};`,
				);
			} else if (hasPathParams) {
				m.line(`const pathParams = (params || {}) as Record<string, any>;`);
				m.line(`const queryParams = {};`);
			} else if (hasQueryParams) {
				m.line(`const pathParams = {};`);
				m.line(`const queryParams = (params || {}) as Record<string, any>;`);
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
			m.line("headers,");
			m.line("cookies,");
			if (contentType !== "application/json") {
				m.line(`contentType: '${contentType}',`);
			}
			m.dedent();
			m.line("});");
		},
	);
}

export function generateClient(
	endpoints: Endpoint[],
	options: {
		errorStyle?: "class" | "shape" | "both";
		splitServices?: boolean;
		flat?: boolean;
	} = {},
): Record<string, string> {
	const errorStyle = options.errorStyle || "both";
	const errorTypeName = errorStyle === "shape" ? "AppErrorShape" : "AppError";
	const splitServices = options.splitServices !== false;

	const rootBuilder = new CodeBuilder();
	rootBuilder.import(["OpenAPIConfig"], "./openapi.config");

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
		serviceBuilder.import(
			["BaseService", "request"],
			options.flat ? "./request-helper" : "../request-helper",
		);
		serviceBuilder.import(
			["OpenAPIConfig"],
			options.flat ? "./openapi.config" : "../openapi.config",
		);
		serviceBuilder.import([{ name: "Result" }], "neverthrow");
		serviceBuilder.import(
			[errorTypeName],
			options.flat ? "./errors" : "../errors",
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

		const allImports = Array.from(
			new Set([...serviceTypeImports, ...serviceValidatorImports]),
		);
		if (allImports.length > 0) {
			serviceBuilder.import(
				allImports.sort(),
				options.flat ? "./types" : "../types",
			);
		}

		serviceBuilder.classBlock(`${serviceName} extends BaseService`, (cls) => {
			cls.method("constructor", { params: "config: OpenAPIConfig" }, (m) => {
				m.line("super(config);");
			});
			cls.blank();
			const methodNames = new Set<string>();
			for (const ep of eps) {
				buildMethod(cls, ep, errorTypeName, methodNames);
			}
		});

		files[options.flat ? `${serviceName}.ts` : `services/${serviceName}.ts`] =
			serviceBuilder.toString();
	});

	return files;
}
