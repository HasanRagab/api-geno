import { Project, QuoteKind, IndentationText } from 'ts-morph';
import { Schema } from '../models';
import { generateValidation } from './validation';

export function generateTypes(schemas: Record<string, Schema>): string {
  const project = new Project({
    manipulationSettings: { quoteKind: QuoteKind.Single, indentationText: IndentationText.TwoSpaces },
  });

  const file = project.createSourceFile('types.ts', '', { overwrite: true });

  file.addImportDeclaration({ moduleSpecifier: 'zod', namedImports: [{ name: 'z' }] });

  // Add type aliases
  Object.entries(schemas).forEach(([name, schema]) => {
    const parseSchema = (s: Schema | undefined): string => {
      if (!s) return 'any';
      switch (s.type) {
        case 'string':
        case 'number':
        case 'boolean':
          return s.type;
        case 'array':
          return `${parseSchema(s.items)}[]`;
        case 'object':
          if (!s.properties) return 'Record<string, any>';
          const props = Object.entries(s.properties)
            .map(([k, v]) => {
              const optional = s.required?.includes(k) ? '' : '?';
              return `  ${k}${optional}: ${parseSchema(v)};`;
            })
            .join('\n');
          return `{\n${props}\n}`;
        default:
          return 'any';
      }
    };

    file.addTypeAlias({ name, isExported: true, type: parseSchema(schema) });
  });

  // Add Zod validators section
  file.addStatements('\n// ========== Zod Validators ==========');

  const validationSource = generateValidation(schemas);
  file.addStatements(validationSource);

  return file.getFullText();
}
