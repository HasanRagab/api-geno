export function generateErrors(style: 'class' | 'shape' | 'both' = 'both'): string {
  const formatParamType = style === 'shape' ? 'AppErrorShape | Error | any' : 'AppError | Error | any';

  const classes = style === 'shape' ? '' : `
export class AppError extends Error {
  type: ErrorType = 'app';
  constructor(message?: string) {
    super(message);
    this.name = 'AppError';
  }
  toJSON() {
    return { type: this.type, name: this.name, message: this.message };
  }
}

export class HttpError extends AppError {
  type: ErrorType = 'http';
  status: number;
  statusText?: string;
  body?: any;
  constructor(status: number, statusText?: string, body?: any) {
    super('HTTP ' + status + ': ' + (statusText || ''));
    this.name = 'HttpError';
    this.status = status;
    this.statusText = statusText;
    this.body = body;
  }
  toJSON() {
    return { type: this.type, name: this.name, message: this.message, status: this.status, statusText: this.statusText, body: this.body };
  }
}

export class ValidationError extends AppError {
  type: ErrorType = 'validation';
  issues: any;
  constructor(issues: any) {
    const formatIssue = function(i: any) {
      try {
        const path = i && i.path && i.path.length ? i.path.join('.') : '<root>';
        var details = i && i.message ? i.message : '';
        if (i && i.code === 'too_small' && i.minimum !== undefined) {
          details = 'expected >= ' + i.minimum + (i.inclusive === false ? ' (exclusive)' : '');
        } else if (i && i.code === 'too_big' && i.maximum !== undefined) {
          details = 'expected <= ' + i.maximum + (i.inclusive === false ? ' (exclusive)' : '');
        } else if (i && i.code === 'invalid_type') {
          details = 'expected type ' + (i.expected ?? 'unknown') + (i.received ? (', received ' + i.received) : '');
        } else if (!details) {
          details = JSON.stringify(i);
        }
        var received = (i && i.received !== undefined)
          ? (' (received: ' + JSON.stringify(i.received) + ')')
          : '';
        return path + ': ' + details + received;
      } catch (e) {
        return (i && i.message) ? i.message : String(i);
      }
    };
    var message: string;
    if (!issues) message = 'Validation error';
    else if (typeof issues === 'string') message = issues;
    else if (issues && issues.issues && Array.isArray(issues.issues))
      message = issues.issues.map(formatIssue).join('; ');
    else if (Array.isArray(issues))
      message = issues.map(formatIssue).join('; ');
    else if (issues && issues.message)
      message = issues.message;
    else if (issues && issues.errors && Array.isArray(issues.errors))
      message = issues.errors.map(formatIssue).join('; ');
    else {
      try { message = JSON.stringify(issues); }
      catch { message = String(issues); }
    }
    super(message);
    this.name = 'ValidationError';
    this.issues = issues;
  }
  toJSON() {
    return { type: this.type, name: this.name, message: this.message, issues: this.issues };
  }
}
`;

  const instanceofChecks = style === 'shape' ? '' : `
    if (err instanceof ValidationError) return err.message;
    if (err instanceof HttpError) return err.message;
    if (err instanceof AppError) return err.message || String(err);`;

  return `// Application error types for generated client

export type ErrorType = 'app' | 'http' | 'validation';

export interface AppErrorShape {
  type: ErrorType;
  name: string;
  message: string;
}

export interface HttpErrorShape extends AppErrorShape {
  status: number;
  statusText?: string;
  body?: any;
}

export interface ValidationErrorShape extends AppErrorShape {
  issues: any;
}
${classes}
export function formatError(err: ${formatParamType}): string {
  try {
    if (!err) return 'Unknown error';
    if (typeof err === 'object' && err && (err as any).type) {
      const t = (err as any).type;
      if (t === 'validation') return (err as any).message || String(err);
      if (t === 'http') return (err as any).message || String(err);
      if (t === 'app') return (err as any).message || String(err);
    }${instanceofChecks}
    if (err && err.message) return err.message;
    return String(err);
  } catch (e) {
    return String(err);
  }
}
`;
}
