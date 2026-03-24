import { parseOpenAPI } from "./parser/openapi";
import { generateTypes } from "./generator/types";
import { generateClient } from "./generator/client";
import { generateConfig, generateConfigTypes } from "./generator/config";
import { generateErrors } from "./generator/errors";
import { OpenAPIModel } from "./models";
import { GeneratorPlugin } from "./plugins/plugin";

function generateHttpAdapter(adapter: "axios" | "fetch" = "axios"): string {
  const commonHeader = `import { ok, err, Result } from "neverthrow";
import { OpenAPI, type OpenAPIConfig } from "./openapi.config"
import { HttpError, AppError } from "./errors"

export interface HttpAdapter {
  request: <T>(url: string, options: any) => Promise<Result<T, AppError>>;
}

// Helper to resolve values (handle Resolver functions)
async function resolveValue<T>(value: T | (() => T | Promise<T>) | undefined): Promise<T | undefined> {
  if (value === undefined) return undefined;
  if (typeof value === 'function') return (value as any)();
  return value;
}

// Shared request pre-processing
async function prepareRequest(url: string, options: any) {
  const token = await resolveValue(OpenAPI.TOKEN);
  const username = await resolveValue(OpenAPI.USERNAME);
  const password = await resolveValue(OpenAPI.PASSWORD);
  const headers = await resolveValue(OpenAPI.HEADERS);

  let finalUrl = OpenAPI.BASE + (OpenAPI.ENCODE_PATH ? OpenAPI.ENCODE_PATH(url) : url);
  const finalHeaders: Record<string, string> = { ...options.headers };

  if (headers && typeof headers === 'object') {
    for (const [key, value] of Object.entries(headers as any)) {
       if (typeof value === "function") {
        finalHeaders[key] = await value();
      } else if (typeof value === "string") {
        finalHeaders[key] = value;
      } else {
        // optional: handle non-string values
        finalHeaders[key] = String(value);
      }
    }
  }

  const authScheme = OpenAPI.AUTH_SCHEME;
  if (authScheme === 'bearer' && token) {
    finalHeaders['Authorization'] = 'Bearer ' + token;
  } else if (authScheme === 'basic' && username && password) {
    const creds = (typeof username === 'function' ? await username() : username) + ':' + (typeof password === 'function' ? await password() : password);
    finalHeaders['Authorization'] = 'Basic ' + Buffer.from(creds).toString('base64');
  } else if (authScheme === 'apiKey') {
    const apiKeyVal = await resolveValue(OpenAPI.API_KEY);
    const apiKeyName = OpenAPI.API_KEY_NAME;
    const apiKeyIn = OpenAPI.API_KEY_IN || 'header';
    if (apiKeyVal && apiKeyName) {
      if (apiKeyIn === 'header') {
        finalHeaders[apiKeyName] = apiKeyVal as string;
      } else {
        const joinChar = finalUrl.includes('?') ? '&' : '?';
        finalUrl = finalUrl + joinChar + encodeURIComponent(apiKeyName) + '=' + encodeURIComponent(String(apiKeyVal));
      }
    }
  }

  return { finalUrl, finalHeaders };
}

`;

  if (adapter === "fetch") {
    return `${commonHeader}
export const httpAdapter: HttpAdapter = {
  async request(url, options) {
    try {
      const { finalUrl, finalHeaders } = await prepareRequest(url, options);
      const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
      const headers = isFormData ? (() => { const h = { ...finalHeaders }; delete h['Content-Type']; return h; })() : finalHeaders;
      const response = await fetch(finalUrl, {
        method: options.method || 'GET',
        headers,
        body: options.body,
        credentials: OpenAPI.WITH_CREDENTIALS ? 'include' : 'same-origin',
      });

      const text = await response.text();
      const body = text ? JSON.parse(text) : undefined;

      if (!response.ok) {
        return err(new HttpError(response.status, response.statusText, body));
      }

      return ok(body as any);
    } catch (error: any) {
      return err(new HttpError(0, error.message || 'Network Error', null));
    }
  }
};
`;
  }

  return `${commonHeader}import axios from "axios";

export const httpAdapter: HttpAdapter = {
  async request(url, options) {
    try {
      const { finalUrl, finalHeaders } = await prepareRequest(url, options);
      const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
      const headers = isFormData ? (() => { const h = { ...finalHeaders }; delete h['Content-Type']; return h; })() : finalHeaders;
      const response = await axios({
        url: finalUrl,
        method: options.method || "GET",
        headers,
        data: options.body,
        withCredentials: OpenAPI.WITH_CREDENTIALS,
      });

      return ok(response.data as any);
    } catch (error: any) {
      const status = error.response?.status || 0;
      const statusText = error.response?.statusText || error.message;
      const body = error.response?.data;
      return err(new HttpError(status, statusText, body));
    }
  }
};
`;
}

export function generateFromOpenAPI(
  filePath: string,
  plugins: GeneratorPlugin[] = [],
  options: {
    errorStyle?: "class" | "shape" | "both";
    httpAdapter?: "axios" | "fetch";
  } = {},
): Record<string, string> {
  const api: OpenAPIModel = parseOpenAPI(filePath);

  plugins.forEach((p) => p.beforeGenerate?.(api));

  plugins.forEach((p) => {
    if (p.transformEndpoint) {
      api.endpoints = api.endpoints.map((endpoint) =>
        p.transformEndpoint!(endpoint),
      );
    }
    if (p.transformSchema) {
      api.schemas = Object.fromEntries(
        Object.entries(api.schemas).map(([name, schema]) => [
          name,
          p.transformSchema!(name, schema),
        ]),
      );
    }
  });

  const typesFiles = generateTypes(api.schemas);
  const clientFiles = generateClient(api.endpoints, {
    errorStyle: options.errorStyle,
  });
  const errorsCode = generateErrors(options.errorStyle || "both");
  const configTypesCode = generateConfigTypes();
  const configCode = generateConfig();

  const files: Record<string, string> = {
    ...typesFiles,
    ...clientFiles,
    "http-adapter.ts": generateHttpAdapter(options.httpAdapter ?? "axios"),
    "errors.ts": errorsCode,
    "openapi.config.ts": configTypesCode + "\n\n" + configCode,
  };

  plugins.forEach((p) => p.afterGenerate?.(files));

  return files;
}
