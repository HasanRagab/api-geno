import { Endpoint } from '../models';

function toMethodName(endpoint: Endpoint) {
  const operationId = endpoint.operationId;
  if (!operationId) return `${endpoint.method.toLowerCase()}_${endpoint.path.replace(/\W/g, '_')}`;
  const actionMatch = operationId.match(/(Create|Update|Delete|FindAll|FindOne|FindById|List|Get|Post|Put|Patch|Remove|Upsert|Search)$/i);
  if (actionMatch) {
    const action = actionMatch[1];
    return action.charAt(0).toLowerCase() + action.slice(1);
  }
  return operationId.charAt(0).toLowerCase() + operationId.slice(1);
}

function getServiceName(tags?: string[]) {
  if (tags && tags.length > 0) {
    const tag = tags[0].replace(/[-_\s]+/g, ' ');
    return (
      tag
        .split(' ')
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join('') + 'Service'
    );
  }
  return 'ApiService';
}

function schemaToTS(schema: any): string {
  if (!schema) return 'unknown';
  if (schema.$ref) return schema.$ref.split('/').pop() || 'unknown';
  if (schema.type === 'string') return 'string';
  if (schema.type === 'number' || schema.type === 'integer') return 'number';
  if (schema.type === 'boolean') return 'boolean';
  if (schema.type === 'array') {
    const itemType = schemaToTS(schema.items || {});
    return `${itemType}[]`;
  }
  if (schema.type === 'object') return 'Record<string, unknown>';
  return 'unknown';
}

function buildMethodCode(ep: Endpoint, errorTypeName: string): string[] {
  const methodName = toMethodName(ep);
  const method = ep.method.toUpperCase();
  const lowerMethod = method.toLowerCase();
  const responseType = ep.responseRef || 'any';
  const hasBody = ['POST', 'PUT', 'PATCH'].includes(method) && !!ep.requestBodyRef;
  const contentType = ep.contentType || 'application/json';

  const pathParameters = ep.parameters?.filter((p) => p.in === 'path') ?? [];
  const queryParameters = ep.parameters?.filter((p) => p.in === 'query') ?? [];
  const hasParams = pathParameters.length > 0 || queryParameters.length > 0 || !!ep.queryParamsRef;
  const queryKeys = queryParameters.map((p) => `'${p.name}'`);
  const pathTemplate = ep.path.replace(/\{([^}]+)\}/g, (_, name) => `\u007fparams.${name}\u007f`).replace(/\u007f([^\u007f]+)\u007f/g, '${$1}');

  let paramsType = 'Record<string, unknown>';

  if (pathParameters.length > 0) {
    const parts = pathParameters
      .map((p) => `${p.name}${p.required ? '' : '?'}: ${schemaToTS(p.schema)}`)
      .join('; ');
    paramsType = `{ ${parts} }`;
  }

  if (ep.queryParamsRef) {
    if (paramsType === 'Record<string, unknown>') {
      paramsType = ep.queryParamsRef;
    } else {
      paramsType = `${paramsType} & ${ep.queryParamsRef}`;
    }
  }

  const bodyType = ep.requestBodyRef ? ep.requestBodyRef : 'unknown';

  const needsHeaders = hasParams || hasBody;
  const needsCookies = needsHeaders;

  const optsParts: string[] = [];
  if (hasParams) optsParts.push(`params?: ${paramsType}`);
  if (hasBody) optsParts.push(`body?: ${bodyType}`);
  if (needsHeaders) optsParts.push('headers?: Record<string, string>');
  if (needsCookies) optsParts.push('cookies?: Record<string, string>');

  const hasOpts = optsParts.length > 0;

  const lines: string[] = [];
  if (hasOpts) {
    lines.push(`  static async ${methodName}(opts?: { ${optsParts.join('; ')} }): Promise<Result<${responseType}, ${errorTypeName}>> {`);
    const destructureParts: string[] = [];
    if (hasParams) destructureParts.push('params = {}');
    if (hasBody) destructureParts.push('body');
    if (needsHeaders) destructureParts.push('headers = {}');
    if (needsCookies) destructureParts.push('cookies = {}');
    lines.push(`    const { ${destructureParts.join(', ')} } = opts || {};`);
  } else {
    lines.push(`  static async ${methodName}(): Promise<Result<${responseType}, ${errorTypeName}>> {`);
    lines.push('    const headers: Record<string, string> = {};');
    lines.push('    const cookies: Record<string, string> = {};');
  }

  if (queryKeys.length > 0) {
    lines.push('    const queryParamsObj = new URLSearchParams();');
    lines.push('    const paramsRecord = params as Record<string, unknown>;');
    lines.push(`    [${queryKeys.join(', ')}].forEach((key) => { if (paramsRecord[key] !== undefined) queryParamsObj.append(key, String(paramsRecord[key])); });`);
    lines.push('    const queryString = queryParamsObj.toString();');
    lines.push(`    const url = "${pathTemplate}" + (queryString ? "?" + queryString : "");`);
  } else {
    lines.push(`    const url = "${pathTemplate}";`);
  }

  if (ep.queryParamsRef) {
    lines.push(`    try { ${ep.queryParamsRef}Schema.parse(params); } catch (error: unknown) { return err(new ValidationError(formatError(error))); }`);
  }

  if (ep.requestBodyRef) {
    lines.push(`    if (body) { try { ${ep.requestBodyRef}Schema.parse(body); } catch (error: unknown) { return err(new ValidationError(formatError(error))); } }`);
  }

  if (hasBody) {
    if (contentType === 'multipart/form-data') {
      lines.push('    const requestBody = body as any;');
    } else if (contentType === 'application/x-www-form-urlencoded') {
      lines.push('    const requestBody = body ? new URLSearchParams(body as Record<string, string>).toString() : undefined;');
    } else {
      lines.push('    const requestBody = body ? JSON.stringify(body) : undefined;');
    }
  } else {
    lines.push('    const requestBody = undefined;');
  }

  lines.push(`    const mergedHeaders: Record<string, string> = { 'Content-Type': '${contentType}', ...headers };`);
  lines.push("    if (cookies && Object.keys(cookies).length > 0) { mergedHeaders['Cookie'] = Object.entries(cookies).map(([k, v]) => k + '=' + v).join('; '); }");
  lines.push(`    return await httpAdapter.request<${responseType}>(url, { method: '${lowerMethod}', headers: mergedHeaders, body: requestBody });`);
  lines.push('  }');
  return lines;
}

export function generateClient(endpoints: Endpoint[], options: { errorStyle?: 'class' | 'shape' | 'both' } = {}): Record<string, string> {
  const errorStyle = options.errorStyle || 'both';
  const errorTypeName = errorStyle === 'shape' ? 'AppErrorShape' : 'AppError';

  const rootLines: string[] = [];
  rootLines.push("import { httpAdapter } from './http-adapter';");
  rootLines.push("import { ok, err, Result } from 'neverthrow';");
  rootLines.push("import { AppError, ValidationError, HttpError, AppErrorShape, ValidationErrorShape, HttpErrorShape, formatError } from './errors';");

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
    rootLines.push(`import { ${all.join(', ')} } from './types';`);
  }

  const services = new Map<string, Endpoint[]>();
  endpoints.forEach((ep) => {
    const name = getServiceName(ep.tags);
    if (!services.has(name)) services.set(name, []);
    services.get(name)?.push(ep);
  });

  // Root client is a facade with re-exports only; actual implementation goes to services/<Service>.ts
  const serviceNames = Array.from(services.keys()).sort();
  serviceNames.forEach((serviceName) => {
    rootLines.push(`import { ${serviceName} } from './services/${serviceName}';`);
  });
  if (serviceNames.length > 0) {
    rootLines.push('', `export { ${serviceNames.join(', ')} };`);
  }

  const files: Record<string, string> = {};
  files['client.ts'] = rootLines.join('\n');

  services.forEach((eps, serviceName) => {
    const serviceLines: string[] = [];
    serviceLines.push("import { httpAdapter } from '../http-adapter';");
    serviceLines.push("import { ok, err, Result } from 'neverthrow';");
    serviceLines.push("import { AppError, ValidationError, HttpError, AppErrorShape, ValidationErrorShape, HttpErrorShape, formatError } from '../errors';");

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

    // Import only needed types/schema from per-file type outputs
    const serviceImports = new Map<string, Set<string>>();

    const addImport = (name: string) => {
      const fileName = name.endsWith('Schema') ? name.replace(/Schema$/, '') : name;
      if (!serviceImports.has(fileName)) {
        serviceImports.set(fileName, new Set());
      }
      serviceImports.get(fileName)!.add(name);
    };

    serviceTypeImports.forEach((importName) => addImport(importName));
    serviceValidatorImports.forEach((importName) => addImport(importName));

    for (const [fileName, names] of Array.from(serviceImports.entries()).sort()) {
      serviceLines.push(`import { ${Array.from(names).sort().join(', ')} } from '../types/${fileName}';`);
    }

    serviceLines.push(`export class ${serviceName} {`);
    eps.forEach((ep) => serviceLines.push(...buildMethodCode(ep, errorTypeName)));
    serviceLines.push('}');

    files[`services/${serviceName}.ts`] = serviceLines.join('\n');
  });

  return files;

//       const path = rawPath.replace(/\{([^}]+)\}/g, (_, name) => `params.${name}`).replace(/\u007f([^\u007f]+)\u007f/g, '${$1}');
//       if (queryParams.length > 0) {
//         const keys = queryParams.map((p) => `'${p.name}'`).join(', ');
//         lines.push(`    const queryParamsObj = new URLSearchParams();`);
//         lines.push(`    const paramsRecord = params as Record<string, unknown>;`);
//         lines.push(`    [${keys}].forEach((key) => { if (paramsRecord[key] !== undefined) queryParamsObj.append(key, String(paramsRecord[key])); });`);
//         lines.push(`    const queryString = queryParamsObj.toString();`);
//         lines.push(`    const url = "${path}" + (queryString ? "?" + queryString : "");`);
//       } else {
//         lines.push(`    const url = "${path}";`);
//       }

//       if (ep.queryParamsRef) {
//         lines.push(`    try { ${ep.queryParamsRef}Schema.parse(params); } catch (error: unknown) { return err(new ValidationError(formatError(error))); }`);
//       }
//       if (ep.requestBodyRef) {
//         lines.push(`    if (body) { try { ${ep.requestBodyRef}Schema.parse(body); } catch (error: unknown) { return err(new ValidationError(formatError(error))); } }`);
//       }

//       if (hasBody) {
//         if (contentType === 'multipart/form-data') {
//           lines.push(`    const requestBody = body as any;`);
//         } else if (contentType === 'application/x-www-form-urlencoded') {
//           lines.push(`    const requestBody = body ? new URLSearchParams(body as Record<string, string>).toString() : undefined;`);
//         } else {
//           lines.push(`    const requestBody = body ? JSON.stringify(body) : undefined;`);
//         }
//       } else {
//         lines.push(`    const requestBody = undefined;`);
//       }

//       lines.push(`    const mergedHeaders: Record<string, string> = { 'Content-Type': '${contentType}', ...headers };`);
//       lines.push("    if (cookies && Object.keys(cookies).length > 0) { mergedHeaders['Cookie'] = Object.entries(cookies).map(([k, v]) => k + '=' + v).join('; '); }");
//       lines.push(`    return await httpAdapter.request<${responseType}>(url, { method: '${method}', headers: mergedHeaders, body: requestBody });`);
//       lines.push(`  }`);
//     });

//     lines.push('}');
//   });

//   return lines.join('\n');
}
