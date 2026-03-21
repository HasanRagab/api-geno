import { Schema } from '../models';
import { generateValidation } from './validation';

export function generateTypes(schemas: Record<string, Schema>): string {
  const lines: string[] = [];

  lines.push("import { z } from 'zod';");

  // Type aliases inferred from the validation schemas
  Object.keys(schemas).forEach((name) => {
    lines.push(`export type ${name} = z.infer<typeof ${name}Schema>;`);
  });

  lines.push('');
  lines.push('// ========== Zod Validators ==========');
  lines.push(generateValidation(schemas));

  return lines.join('\n');
}
