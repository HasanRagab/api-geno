import { Project, QuoteKind, IndentationText } from 'ts-morph';
import { Schema } from '../models';
import { generateValidation } from './validation';

export function generateTypes(schemas: Record<string, Schema>): string {
  const project = new Project({
    manipulationSettings: { quoteKind: QuoteKind.Single, indentationText: IndentationText.TwoSpaces },
  });

  const file = project.createSourceFile('types.ts', '', { overwrite: true });

  file.addImportDeclaration({ moduleSpecifier: 'zod', namedImports: [{ name: 'z' }] });

  file.addStatements('\n// ========== Zod Validators ==========');
  
  const validationSource = generateValidation(schemas);
  file.addStatements(validationSource);

  Object.keys(schemas).forEach((name) => {
    file.addTypeAlias({
      name,
      isExported: true,
      type: `z.infer<typeof ${name}Schema>`,
    });
  });

  return file.getFullText();
}
