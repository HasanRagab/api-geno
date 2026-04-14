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

	if (schema.items) collectSchemaRefs(schema.items, refs);
	for (const compositeField of [schema.allOf, schema.oneOf, schema.anyOf]) {
		if (compositeField) {
			for (const item of compositeField) {
				collectSchemaRefs(item, refs);
			}
		}
	}

	if (schema.properties) {
		for (const prop of Object.values(schema.properties)) {
			collectSchemaRefs(prop, refs);
		}
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
	options: { noZod?: boolean; flat?: boolean } = {},
): Record<string, string> {
	const files: Record<string, string> = {};

	// create per-schema file with schema + type using CodeBuilder
	Object.entries(schemas).forEach(([name, schema]) => {
		const refs = Array.from(collectSchemaRefs(schema)).filter(
			(ref) => ref !== name,
		);
		const builder = new CodeBuilder();

		if (!options.noZod) {
			builder.import(["z"], "zod");
		}

		refs.forEach((ref) => {
			if (!options.noZod) {
				builder.line(`import { ${ref}Schema, ${ref} } from './${ref}';`);
			} else {
				builder.line(`import { ${ref} } from './${ref}';`);
			}
		});
		builder.blank();
		const docLines: string[] = [];
		if (schema.description) docLines.push(...schema.description.split("\n"));
		if (schema.deprecated) {
			if (docLines.length > 0) docLines.push("");
			docLines.push("@deprecated");
		}
		if (docLines.length > 0) builder.docComment(docLines);
		if (!options.noZod) {
			builder.line(buildZodSchema(name, schema));
			builder.line(`export type ${name} = z.infer<typeof ${name}Schema>;`);
		} else {
			// Basic type generation if no zod (fallback to simple interface-like type)
			builder.line(
				`export type ${name} = any; // TODO: implement full type gen without zod`,
			);
		}

		files[options.flat ? `${name}.ts` : `types/${name}.ts`] =
			builder.toString();
	});

	// root aggregator
	const rootBuilder = new CodeBuilder();
	for (const name of Object.keys(schemas)) {
		rootBuilder.line(
			`export * from '${options.flat ? `./${name}` : `./types/${name}`}';`,
		);
	}

	files["types.ts"] = rootBuilder.toString();

	return files;
}
