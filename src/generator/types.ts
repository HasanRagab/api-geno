import { CodeBuilder } from "../codegen/builder";
import type { Schema } from "../models";
import { buildZodSchema } from "./validation";

function collectSchemaRefs(
	schema: Schema,
	refs = new Set<string>(),
): Set<string> {
	if (!schema) return refs;

	if (schema.$ref) {
		const ref = schema.$ref.split("/").pop();
		if (ref) refs.add(ref);
		return refs;
	}

	const array = ["items", "allOf", "oneOf", "anyOf"];
	for (const key of array) {
		const value = (schema as any)[key];
		if (!value) continue;
		if (Array.isArray(value)) {
			value.forEach((item: Schema) => collectSchemaRefs(item, refs));
		} else {
			collectSchemaRefs(value, refs);
		}
	}

	if (schema.properties) {
		Object.values(schema.properties).forEach((prop) =>
			collectSchemaRefs(prop, refs),
		);
	}

	if (
		schema.additionalProperties &&
		typeof schema.additionalProperties === "object"
	) {
		collectSchemaRefs(schema.additionalProperties, refs);
	}

	return refs;
}

export function generateTypes(
	schemas: Record<string, Schema>,
): Record<string, string> {
	const files: Record<string, string> = {};

	// create per-schema file with schema + type using CodeBuilder
	Object.entries(schemas).forEach(([name, schema]) => {
		const refs = Array.from(collectSchemaRefs(schema)).filter(
			(ref) => ref !== name,
		);
		const builder = new CodeBuilder();

		builder.import(["z"], "zod");

		refs.forEach((ref) =>
			builder.line(`import { ${ref}Schema, ${ref} } from './${ref}';`),
		);
		builder.blank();
		const docLines: string[] = [];
		if (schema.description) docLines.push(...schema.description.split("\n"));
		if (schema.deprecated) {
			if (docLines.length > 0) docLines.push("");
			docLines.push("@deprecated");
		}
		if (docLines.length > 0) builder.docComment(docLines);
		builder.line(buildZodSchema(name, schema));
		builder.line(`export type ${name} = z.infer<typeof ${name}Schema>;`);

		files[`types/${name}.ts`] = builder.toString();
	});

	// root aggregator
	const rootBuilder = new CodeBuilder();
	Object.keys(schemas).forEach((name) =>
		rootBuilder.line(`export * from './types/${name}';`),
	);

	files["types.ts"] = rootBuilder.toString();

	return files;
}
