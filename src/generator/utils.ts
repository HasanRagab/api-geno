import type { Endpoint, OpenAPIModel, Schema } from "../models";

export function schemaToTSType(schema: Schema | undefined): string {
	if (!schema) return "unknown";
	if (schema.$ref) return schema.$ref.split("/").pop() || "unknown";

	if (schema.allOf?.length) {
		return schema.allOf.map(schemaToTSType).join(" & ") || "unknown";
	}
	if (schema.oneOf?.length) {
		return `(${schema.oneOf.map(schemaToTSType).join(" | ")})`;
	}
	if (schema.anyOf?.length) {
		return `(${schema.anyOf.map(schemaToTSType).join(" | ")})`;
	}

	if (schema.enum) {
		return schema.enum.map((v) => JSON.stringify(v)).join(" | ");
	}

	switch (schema.type) {
		case "string":
			return "string";
		case "number":
		case "integer":
			return "number";
		case "boolean":
			return "boolean";
		case "array": {
			const item = schemaToTSType(schema.items);
			return `${item}[]`;
		}
		case "object": {
			if (!schema.properties) return "Record<string, unknown>";
			const props = Object.entries(schema.properties)
				.map(([k, v]) => {
					const optional = !(schema.required ?? []).includes(k) ? "?" : "";
					return `${k}${optional}: ${schemaToTSType(v)}`;
				})
				.join("; ");
			return `{ ${props} }`;
		}
		default:
			return "unknown";
	}
}

export function sanitizeIdentifier(value: string): string {
	const cleaned = value
		.trim()
		.replace(/[^a-zA-Z0-9_$]/g, " ")
		.split(/\s+/)
		.filter(Boolean)
		.map((token, idx) => {
			if (idx === 0) {
				return token.charAt(0).toLowerCase() + token.slice(1);
			}
			return token.charAt(0).toUpperCase() + token.slice(1);
		})
		.join("");

	if (!cleaned) return "unnamed";
	if (/^[0-9]/.test(cleaned)) {
		return `_${cleaned}`;
	}
	return cleaned;
}

export function getOperationIdOrFallback(endpoint: Endpoint): string {
	if (
		endpoint.operationId &&
		typeof endpoint.operationId === "string" &&
		endpoint.operationId.trim() !== ""
	) {
		return endpoint.operationId;
	}

	const safePath = endpoint.path
		.replace(/[{}]/g, "")
		.replace(/[^a-zA-Z0-9]/g, "_")
		.replace(/_+/g, "_")
		.replace(/^_+|_+$/g, "");
	return `${endpoint.method.toLowerCase()}_${safePath || "root"}`;
}

export function generateCoverageReport(
	api: OpenAPIModel,
	files: Record<string, string>,
): string {
	const totalEndpoints = api.endpoints.length;
	const totalSchemas = Object.keys(api.schemas).length;
	const generatedTypes = Object.keys(files).filter((f) =>
		f.startsWith("types/"),
	).length;
	const generatedServices = Object.keys(files).filter((f) =>
		f.startsWith("services/"),
	).length;

	const report = [
		"# API Generation Coverage Report",
		"",
		"## Summary",
		`- Total Endpoints: ${totalEndpoints}`,
		`- Total Schemas: ${totalSchemas}`,
		`- Generated Types: ${generatedTypes}`,
		`- Generated Services: ${generatedServices}`,
		"",
		"## Details",
		`- Coverage: ${((generatedTypes / totalSchemas) * 100).toFixed(2)}% of schemas generated.`,
		"",
		"---",
		`Report generated on ${new Date().toISOString()}`,
	];

	return report.join("\n");
}

export function safeMethodName(endpoint: Endpoint, usedNames: Set<string>) {
	let baseName = getOperationIdOrFallback(endpoint);
	baseName = sanitizeIdentifier(baseName);

	let name = baseName;
	let counter = 1;
	while (usedNames.has(name)) {
		name = `${baseName}${counter++}`;
	}
	usedNames.add(name);
	return name;
}
