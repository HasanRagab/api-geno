import type { Schema } from "../models";

export function getZodType(schema: Schema): string {
	if (schema.$ref) {
		const refName = schema.$ref.split("/").pop();
		if (!refName) return "z.unknown()";
		const refType = `z.lazy(() => ${refName}Schema)`;
		return schema.nullable ? `${refType}.nullable()` : refType;
	}

	if (schema.allOf && schema.allOf.length > 0) {
		const refs = schema.allOf.map((item) => getZodType(item));
		const intersection = refs.reduce(
			(acc, next) => `z.intersection(${acc}, ${next})`,
		);
		return schema.nullable ? `${intersection}.nullable()` : intersection;
	}

	if (schema.oneOf && schema.oneOf.length > 0) {
		const refs = schema.oneOf.map((item) => getZodType(item));
		if (schema.discriminator) {
			const union = `z.discriminatedUnion("${schema.discriminator.propertyName}", [${refs.join(", ")}])`;
			return schema.nullable ? `${union}.nullable()` : union;
		}
		const union = `z.union([${refs.join(", ")}])`;
		return schema.nullable ? `${union}.nullable()` : union;
	}

	if (schema.anyOf && schema.anyOf.length > 0) {
		const refs = schema.anyOf.map((item) => getZodType(item));
		if (schema.discriminator) {
			const union = `z.discriminatedUnion("${schema.discriminator.propertyName}", [${refs.join(", ")}])`;
			return schema.nullable ? `${union}.nullable()` : union;
		}
		const union = `z.union([${refs.join(", ")}])`;
		return schema.nullable ? `${union}.nullable()` : union;
	}

	if (!schema.type) return "z.unknown()";

	let zodType = "";

	switch (schema.type) {
		case "string":
			zodType = "z.string()";
			break;
		case "number":
			zodType = "z.number()";
			break;
		case "integer":
			zodType = "z.number().int()";
			break;
		case "boolean":
			zodType = "z.boolean()";
			break;
		case "array": {
			const itemType = schema.items ? getZodType(schema.items) : "z.unknown()";
			zodType = `z.array(${itemType})`;
			break;
		}
		case "object":
			if (schema.properties) {
				const props = Object.entries(schema.properties)
					.map(([key, val]) => {
						const type = getZodType(val);
						const required = schema.required?.includes(key) ?? false;
						return `  ${key}: ${required ? type : `${type}.optional()`}`;
					})
					.join(",\n");
				zodType = `z.object({\n${props}\n})`;
			} else {
				zodType = "z.record(z.unknown())";
			}
			break;
		default:
			zodType = "z.unknown()";
	}

	if (schema.type === "string") {
		const parts: string[] = ["z.string()"];
		if (schema.format === "date-time") parts[0] = "z.string().datetime()";
		if (schema.format === "email") parts[0] = "z.string().email()";
		if (schema.format === "uuid") parts[0] = "z.string().uuid()";
		if (schema.format === "url") parts[0] = "z.string().url()";
		if (schema.format === "ipv4") parts[0] = "z.string().ip({ version: 'v4' })";
		if (schema.format === "ipv6") parts[0] = "z.string().ip({ version: 'v6' })";

		if (schema.minLength) parts.push(`.min(${schema.minLength})`);
		if (schema.maxLength) parts.push(`.max(${schema.maxLength})`);
		if (schema.pattern) parts.push(`.regex(/${schema.pattern}/)`);
		if (schema.enum) {
			const enumValues = schema.enum.map((v: any) => `"${v}"`).join(", ");
			parts[0] = `z.enum([${enumValues}])`;
		}
		zodType = parts.join("");
	}

	if (schema.type === "number" || schema.type === "integer") {
		const parts = [zodType];
		if (schema.minimum !== undefined) {
			const op = (schema as any).exclusiveMinimum ? ".gt" : ".gte";
			parts.push(`${op}(${schema.minimum})`);
		}
		if (schema.maximum !== undefined) {
			const op = (schema as any).exclusiveMaximum ? ".lt" : ".lte";
			parts.push(`${op}(${schema.maximum})`);
		}
		if (schema.enum) {
			const literals = schema.enum.map((v: any) => `z.literal(${v})`).join(", ");
			parts[0] = `z.union([${literals}])`;
		}
		zodType = parts.join("");
	}

	if (
		schema.enum &&
		schema.type !== "string" &&
		schema.type !== "number" &&
		schema.type !== "integer"
	) {
		const enumValues = schema.enum.map((v: any) => `"${v}"`).join(", ");
		zodType = `z.enum([${enumValues}])`;
	}

	if (schema.default !== undefined) {
		const defaultValue =
			typeof schema.default === "string"
				? `"${schema.default}"`
				: schema.default;
		zodType += `.default(${defaultValue})`;
	}

	if (schema.description) {
		zodType += `.describe("${schema.description.replace(/"/g, '\\"')}")`;
	}

	if (schema.nullable) {
		zodType += ".nullable()";
	}

	return zodType;
}

export function buildZodSchema(name: string, schema: Schema): string {
	const zodType = getZodType(schema);
	const strictSuffix = name.includes("QueryParams") ? ".strict()" : "";
	return `export const ${name}Schema = ${zodType}${strictSuffix};`;
}

export function generateValidation(schemas: Record<string, Schema>): string {
	const validationSchemas = Object.entries(schemas)
		.map(([name, schema]) => buildZodSchema(name, schema))
		.join("\n\n");
	return validationSchemas;
}
