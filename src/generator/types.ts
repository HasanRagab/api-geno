import { Schema } from '../models';
import { buildZodSchema } from './validation';

function collectSchemaRefs(schema: Schema, refs = new Set<string>()): Set<string> {
  if (!schema) return refs;

  if (schema.$ref) {
    const ref = schema.$ref.split('/').pop();
    if (ref) refs.add(ref);
    return refs;
  }

  const array = ['items', 'allOf', 'oneOf', 'anyOf'];
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
    Object.values(schema.properties).forEach((prop) => collectSchemaRefs(prop, refs));
  }

  if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
    collectSchemaRefs(schema.additionalProperties, refs);
  }

  return refs;
}

export function generateTypes(schemas: Record<string, Schema>): Record<string, string> {
  const files: Record<string, string> = {};

  // create per-schema file with schema + type
  Object.entries(schemas).forEach(([name, schema]) => {
    const refs = Array.from(collectSchemaRefs(schema)).filter((ref) => ref !== name);
    const imports = refs
      .map((ref) => `import { ${ref}Schema, ${ref} } from './${ref}';`)
      .join('\n');

    const lines: string[] = ["import { z } from 'zod';"];

    if (imports) lines.push(imports);

    lines.push('');
    lines.push(buildZodSchema(name, schema));
    lines.push(`export type ${name} = z.infer<typeof ${name}Schema>;`);

    files[`types/${name}.ts`] = lines.join('\n');
  });

  // root aggregator
  const rootLines = Object.keys(schemas)
    .map((name) => `export * from './types/${name}';`)
    .join('\n');

  files['types.ts'] = rootLines;

  return files;
}
