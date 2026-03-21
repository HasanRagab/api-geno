import { Project, QuoteKind, IndentationText } from 'ts-morph';
import { Endpoint } from '../models';
 
// (file header previously contained Markdown fences; removed)

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
    let tag = tags[0];
    tag = tag.replace(/[-_\s]+/g, ' ');
    const pascal = tag.split(' ').filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('');
    return pascal + 'Service';
  }
  return 'ApiService';
}

export function generateClient(endpoints: Endpoint[], options: { errorStyle?: 'class' | 'shape' | 'both' } = {}): string {
  const errorStyle = options.errorStyle || 'both';
  const errorTypeName = errorStyle === 'shape' ? 'AppErrorShape' : 'AppError';
  const project = new Project({ manipulationSettings: { quoteKind: QuoteKind.Single, indentationText: IndentationText.TwoSpaces } });
  const file = project.createSourceFile('client.ts', '', { overwrite: true });

  // core imports
  file.addImportDeclaration({ moduleSpecifier: './http-adapter', namedImports: [{ name: 'httpAdapter' }] });
  file.addImportDeclaration({ moduleSpecifier: 'neverthrow', namedImports: [{ name: 'ok' }, { name: 'err' }, { name: 'Result' }] });
  file.addImportDeclaration({ moduleSpecifier: './errors', namedImports: [{ name: 'AppError' }, { name: 'ValidationError' }, { name: 'HttpError' }, { name: 'AppErrorShape' }, { name: 'ValidationErrorShape' }, { name: 'HttpErrorShape' }, { name: 'formatError' }] });

  // collect type/validator imports
  const typeImports = new Set<string>();
  const validatorImports = new Set<string>();
  endpoints.forEach(ep => {
    if (ep.responseRef) typeImports.add(ep.responseRef);
    if (ep.requestBodyRef) { typeImports.add(ep.requestBodyRef); validatorImports.add(`${ep.requestBodyRef}Schema`); }
    if (ep.queryParamsRef) validatorImports.add(`${ep.queryParamsRef}Schema`);
  });
  if (typeImports.size) file.addImportDeclaration({ moduleSpecifier: './types', namedImports: Array.from(typeImports).map(n => ({ name: n })) });
  if (validatorImports.size) file.addImportDeclaration({ moduleSpecifier: './types', namedImports: Array.from(validatorImports).map(n => ({ name: n })) });

  // group endpoints by service
  const services = new Map<string, Endpoint[]>();
  endpoints.forEach(ep => {
    const name = getServiceName(ep.tags);
    const list = services.get(name) || [];
    list.push(ep);
    services.set(name, list);
  });

  // create classes
  services.forEach((eps, serviceName) => {
    const cls = file.addClass({ name: serviceName, isExported: true });
    eps.forEach(ep => {
      const methodName = toMethodName(ep);
      const responseType = ep.responseRef || 'any';
      const contentType = ep.contentType || 'application/json';

      // path templating
      let path = ep.path;
      (ep.parameters || []).filter(p => p.in === 'path').forEach(p => {
        const ref = p.name.includes('-') ? `params["${p.name}"]` : `params.${p.name}`;
        path = path.replace(`{${p.name}}`, `\${${ref}}`);
      });

      const queryParams = (ep.parameters || []).filter(p => p.in === 'query');
      const hasBody = ['POST','PUT','PATCH','DELETE'].includes(ep.method);

      // build statements
      let stmts = '';
      stmts += `const { params = {}, body, headers, cookies } = opts || {};\n`;

      if (queryParams.length) {
        const keys = queryParams.map(p => `"${p.name}"`).join(', ');
        stmts += `const queryParams = new URLSearchParams();\nconst paramsRecord = (params || {}) as Record<string, unknown>;\n[${keys}].forEach(key => { if (paramsRecord[key] !== undefined) { queryParams.append(key, String(paramsRecord[key])); } });\nconst queryString = queryParams.toString();\nconst url = \`${path}\${queryString ? "?" + queryString : ""}\`;\n`;
      } else {
        stmts += `const url = \`${path}\`;\n`;
      }

      if (ep.queryParamsRef) stmts += `if (params) { try { const validated = ${ep.queryParamsRef}Schema.parse(params); Object.assign(params, validated); } catch (error: unknown) { return err(new ValidationError(formatError(error))); } }\n`;
      if (ep.requestBodyRef) stmts += `if (body) { try { const validated = ${ep.requestBodyRef}Schema.parse(body); Object.assign(body, validated); } catch (error: unknown) { return err(new ValidationError(formatError(error))); } }\n`;

      if (hasBody) {
        if (contentType === 'multipart/form-data') {
          stmts += `let requestBody: unknown = undefined; if (body) { requestBody = new FormData(); Object.entries(body as Record<string, unknown>).forEach(([key, value]) => { if (value !== null && value !== undefined) { if (value instanceof File || value instanceof Blob) { requestBody = requestBody as FormData; (requestBody as FormData).append(key, value); } else { requestBody = requestBody as FormData; (requestBody as FormData).append(key, String(value)); } } }); }\n`;
        } else if (contentType === 'application/x-www-form-urlencoded') {
          stmts += `let requestBody: unknown = undefined; if (body) { const paramsUrl = new URLSearchParams(); Object.entries(body as Record<string, unknown>).forEach(([key, value]) => { if (value !== null && value !== undefined) paramsUrl.append(key, String(value)); }); requestBody = paramsUrl.toString(); }\n`;
        } else {
          stmts += `const requestBody = body ? JSON.stringify(body) : undefined;\n`;
        }
      } else {
        stmts += `const requestBody = undefined;\n`;
      }

      if (contentType === 'multipart/form-data') stmts += `const mergedHeaders: Record<string, string> = { ...headers };\n`;
      else stmts += `const mergedHeaders: Record<string, string> = { \n  \"Content-Type\": \"${contentType}\",\n  ...headers,\n};\n`;

      stmts += `if (cookies && Object.keys(cookies).length > 0) { const cookieString = Object.entries(cookies).map(([k, v]) => k + '=' + v).join('; '); mergedHeaders['Cookie'] = cookieString; }\n`;

      stmts += `return await httpAdapter.request<${responseType}>(url, { method: "${ep.method}", headers: mergedHeaders, body: requestBody });`;

      // build a tighter opts type
      const paramsType = ep.queryParamsRef
        ? `{ [K in keyof ${ep.queryParamsRef}]?: ${ep.queryParamsRef}[K] }`
        : ((ep.parameters || []).length ? '{ [key: string]: unknown }' : 'undefined');
      const bodyType = ep.requestBodyRef ? ep.requestBodyRef : (hasBody ? 'unknown' : 'undefined');
      const parts: string[] = [];
      if (paramsType && paramsType !== 'undefined') parts.push(`params?: ${paramsType}`);
      if (bodyType && bodyType !== 'undefined') parts.push(`body?: ${bodyType}`);
        parts.push('headers?: Record<string, string>');
        parts.push('cookies?: Record<string, string>');
      const optsType = `{ ${parts.join(', ')} }`;

      cls.addMethod({
        name: methodName,
        isStatic: true,
        isAsync: true,
        parameters: [{ name: 'opts', type: optsType, hasQuestionToken: true }],
        returnType: `Promise<import('neverthrow').Result<${responseType}, ${errorTypeName}>>`,
        statements: stmts,
      });
    });
  });

  return file.getFullText();
}
