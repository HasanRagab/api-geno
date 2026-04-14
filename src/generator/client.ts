import { CodeBuilder } from "../codegen/builder";
import type { Endpoint } from "../models";
import { safeMethodName } from "./utils";

function toMethodName(endpoint: Endpoint, usedNames: Set<string>) {
	return safeMethodName(endpoint, usedNames);
}

function getServiceName(tags?: string[]) {
	if (tags && tags.length > 0) {
		const tag = tags[0].replace(/[-_\s]+/g, " ");
		return (
			tag
				.split(" ")
				.filter(Boolean)
				.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
				.join("") + "Service"
		);
	}
	return "ApiService";
}

function schemaToTS(schema: any): string {
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
	const hasParams =
		pathParameters.length > 0 ||
		queryParameters.length > 0 ||
		!!ep.queryParamsRef;
	const queryKeys = queryParameters.map((p) => `'${p.name}'`);
	const pathTemplate = ep.path
		.replace(/\{([^}]+)\}/g, (_, name) => `params?.${name}`)
		.replace(/\u007f([^\u007f]+)\u007f/g, "${$1}");

	const paramsType = hasParams
		? (() => {
			let type = "Record<string, unknown>";
			if (pathParameters.length > 0) {
				const parts = pathParameters
					.map((p) => `${p.name}${p.required ? "" : "?"}: ${schemaToTS(p.schema)}`)
					.join("; ");
				type = `{ ${parts} }`;
			}
			if (ep.queryParamsRef) {
				type =
					type === "Record<string, unknown>"
						? ep.queryParamsRef
						: `${type} & ${ep.queryParamsRef}`;
			}
			return type;
		})()
		: "undefined";

	const bodyType = hasBody ? ep.requestBodyRef || "unknown" : "undefined";
	const needsHeaders = hasParams || hasBody;
	const needsCookies = needsHeaders;

	const optsParts: string[] = [];
	if (hasParams) optsParts.push(`params?: ${paramsType}`);
	if (hasBody) optsParts.push(`body?: ${bodyType}`);
	if (needsHeaders) optsParts.push("headers?: Record<string, string>");
	if (needsCookies) optsParts.push("cookies?: Record<string, string>");
	optsParts.push("validationMode?: 'strict' | 'warn' | 'none'");

	const paramsDecl =
		optsParts.length > 0 ? `opts: { ${optsParts.join("; ")} } = {}` : "";
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
		{ static: true, async: true, params: paramsDecl, returns: returnType },
		(m) => {
			const destructure: string[] = [];
			if (hasParams) destructure.push("params");
			if (hasBody) destructure.push("body");
			if (needsHeaders) destructure.push("headers");
			if (needsCookies) destructure.push("cookies");
			destructure.push("validationMode");

			if (destructure.length > 0) {
				m.line(`const { ${destructure.join(", ")} } = opts;`);
			}

			m.line(`return await request<${responseType}, ${paramsType}, ${bodyType}>(`);
			m.object({
				path: `\`${pathTemplate}\``,
				method: `'${lowerMethod}'`,
				params: hasParams ? "params" : undefined,
				paramsSchema: ep.queryParamsRef ? `${ep.queryParamsRef}Schema` : undefined,
				explicitQueryKeys:
					queryKeys.length > 0 ? `[${queryKeys.join(", ")}]` : undefined,
				body: hasBody && ep.requestBodyRef ? "body" : undefined,
				bodySchema:
					hasBody && ep.requestBodyRef ? `${ep.requestBodyRef}Schema` : undefined,
				headers: needsHeaders ? "headers" : undefined,
				cookies: needsCookies ? "cookies" : undefined,
				contentType: contentType !== "application/json" ? `'${contentType}'` : undefined,
				security: ep.security ? JSON.stringify(ep.security) : undefined,
				validationMode: "validationMode",
			});
			m.line(");");
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
	rootBuilder.import(["httpAdapter"], "./http-adapter");
	rootBuilder.import(["ok", "err", { name: "Result" }], "neverthrow");
	rootBuilder.import(
		[
			"AppError",
			"ValidationError",
			"HttpError",
			"AppErrorShape",
			"ValidationErrorShape",
			"HttpErrorShape",
			"formatError",
		],
		"./errors",
	);

	const typeImports = new Set<string>();
	const validatorImports = new Set<string>();

	endpoints.forEach((ep) => {
		if (ep.responseRef) typeImports.add(ep.responseRef);
		if (ep.requestBodyRef) {
			typeImports.add(ep.requestBodyRef);
			validatorImports.add(`${ep.requestBodyRef}Schema`);
		}
		if (ep.queryParamsRef) validatorImports.add(`${ep.queryParamsRef}Schema`);
	});

	if (typeImports.size || validatorImports.size) {
		const all = Array.from(new Set([...typeImports, ...validatorImports]));
		rootBuilder.import(all, options.flat ? "./types" : "./types");
	}

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

	// Root client is a facade with re-exports only; actual implementation goes to services/<Service>.ts
	const serviceNames = Array.from(services.keys()).sort();
	serviceNames.forEach((serviceName) => {
		rootBuilder.import(
			[serviceName],
			options.flat ? `./${serviceName}` : `./services/${serviceName}`,
		);
	});

	if (serviceNames.length > 0) {
		rootBuilder.blank().export(serviceNames);
	}

	const files: Record<string, string> = {};
	files["client.ts"] = rootBuilder.toString();

	services.forEach((eps, serviceName) => {
		const serviceBuilder = new CodeBuilder();
		serviceBuilder.import(
			["request"],
			options.flat ? "./request-helper" : "../request-helper",
		);
		serviceBuilder.import([{ name: "Result" }], "neverthrow");
		serviceBuilder.import([errorTypeName], options.flat ? "./errors" : "../errors");

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

		const serviceImports = new Map<string, Set<string>>();
		const addImport = (name: string) => {
			const fileName = name.endsWith("Schema")
				? name.replace(/Schema$/, "")
				: name;
			if (!serviceImports.has(fileName))
				serviceImports.set(fileName, new Set());
			serviceImports.get(fileName)!.add(name);
		};

		serviceTypeImports.forEach(addImport);
		serviceValidatorImports.forEach(addImport);

		Array.from(serviceImports.entries())
			.sort((a, b) => a[0].localeCompare(b[0]))
			.forEach(([fileName, names]) => {
				serviceBuilder.import(
					Array.from(names).sort(),
					options.flat ? `./${fileName}` : `../types/${fileName}`,
				);
			});

		serviceBuilder.classBlock(serviceName, (cls) => {
			const methodNames = new Set<string>();
			eps.forEach((ep) => buildMethod(cls, ep, errorTypeName, methodNames));
		});

		files[options.flat ? `${serviceName}.ts` : `services/${serviceName}.ts`] =
			serviceBuilder.toString();
	});

	return files;
}
