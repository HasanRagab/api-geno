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

export function generateClient(endpoints: Endpoint[], options: { errorStyle?: 'class' | 'shape' | 'both' } = {}): string {
  const errorStyle = options.errorStyle || 'both';
  const errorTypeName = errorStyle === 'shape' ? 'AppErrorShape' : 'AppError';

  const lines: string[] = [];
  lines.push("import { httpAdapter } from './http-adapter';");
  lines.push("import { ok, err, Result } from 'neverthrow';");
  lines.push("import { AppError, ValidationError, HttpError, AppErrorShape, ValidationErrorShape, HttpErrorShape, formatError } from './errors';");

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
    lines.push(`import { ${all.join(', ')} } from './types';`);
  }

  const services = new Map<string, Endpoint[]>();
  endpoints.forEach((ep) => {
    const name = getServiceName(ep.tags);
    if (!services.has(name)) services.set(name, []);
    services.get(name)?.push(ep);
  });

  services.forEach((eps, serviceName) => {
    lines.push(`export class ${serviceName} {`);

    eps.forEach((ep) => {
      const methodName = toMethodName(ep);
      const responseType = ep.responseRef || 'any';
      const method = ep.method;
      const rawPath = ep.path;
      const contentType = ep.contentType || 'application/json';
      const queryParams = (ep.parameters || []).filter((p) => p.in === 'query');
      const hasBody = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

      lines.push(`  static async ${methodName}(opts?: { params?: Record<string, unknown>; body?: unknown; headers?: Record<string, string>; cookies?: Record<string, string>; }): Promise<Result<${responseType}, ${errorTypeName}>> {`);
      lines.push(`    const { params = {}, body, headers = {}, cookies = {} } = opts || {};`);

      const path = rawPath.replace(/\{([^}]+)\}/g, (_, name) => `params.${name}`).replace(/\u007f([^\u007f]+)\u007f/g, '${$1}');
      if (queryParams.length > 0) {
        const keys = queryParams.map((p) => `'${p.name}'`).join(', ');
        lines.push(`    const queryParamsObj = new URLSearchParams();`);
        lines.push(`    const paramsRecord = params as Record<string, unknown>;`);
        lines.push(`    [${keys}].forEach((key) => { if (paramsRecord[key] !== undefined) queryParamsObj.append(key, String(paramsRecord[key])); });`);
        lines.push(`    const queryString = queryParamsObj.toString();`);
        lines.push(`    const url = "${path}" + (queryString ? "?" + queryString : "");`);
      } else {
        lines.push(`    const url = "${path}";`);
      }

      if (ep.queryParamsRef) {
        lines.push(`    try { ${ep.queryParamsRef}Schema.parse(params); } catch (error: unknown) { return err(new ValidationError(formatError(error))); }`);
      }
      if (ep.requestBodyRef) {
        lines.push(`    if (body) { try { ${ep.requestBodyRef}Schema.parse(body); } catch (error: unknown) { return err(new ValidationError(formatError(error))); } }`);
      }

      if (hasBody) {
        if (contentType === 'multipart/form-data') {
          lines.push(`    const requestBody = body as any;`);
        } else if (contentType === 'application/x-www-form-urlencoded') {
          lines.push(`    const requestBody = body ? new URLSearchParams(body as Record<string, string>).toString() : undefined;`);
        } else {
          lines.push(`    const requestBody = body ? JSON.stringify(body) : undefined;`);
        }
      } else {
        lines.push(`    const requestBody = undefined;`);
      }

      lines.push(`    const mergedHeaders: Record<string, string> = { 'Content-Type': '${contentType}', ...headers };`);
      lines.push("    if (cookies && Object.keys(cookies).length > 0) { mergedHeaders['Cookie'] = Object.entries(cookies).map(([k, v]) => k + '=' + v).join('; '); }");
      lines.push(`    return await httpAdapter.request<${responseType}>(url, { method: '${method}', headers: mergedHeaders, body: requestBody });`);
      lines.push(`  }`);
    });

    lines.push('}');
  });

  return lines.join('\n');
}
