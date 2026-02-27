import { Project, QuoteKind, IndentationText } from 'ts-morph';

export function generateErrors(): string {
  const project = new Project({
    manipulationSettings: {
      quoteKind: QuoteKind.Single,
      indentationText: IndentationText.TwoSpaces,
    },
  });

  const file = project.createSourceFile('errors.ts', '', { overwrite: true });

  file.addStatements("// Application error types for generated client");

  file.addTypeAlias({
    name: 'ErrorType',
    isExported: true,
    type: "'app' | 'http' | 'validation'",
  });

  // exported shapes/interfaces for typed consumption in generated clients
  file.addInterface({
    name: 'AppErrorShape',
    isExported: true,
    properties: [
      { name: 'type', type: 'ErrorType' },
      { name: 'name', type: 'string' },
      { name: 'message', type: 'string' },
    ],
  });

  file.addInterface({
    name: 'HttpErrorShape',
    isExported: true,
    extends: ['AppErrorShape'],
    properties: [
      { name: 'status', type: 'number' },
      { name: 'statusText', type: 'string', hasQuestionToken: true },
      { name: 'body', type: 'any', hasQuestionToken: true },
    ],
  });

  file.addInterface({
    name: 'ValidationErrorShape',
    isExported: true,
    extends: ['AppErrorShape'],
    properties: [
      { name: 'issues', type: 'any' },
    ],
  });

  const appError = file.addClass({ name: 'AppError', isExported: true, extends: 'Error' });

  appError.addProperty({ name: 'type', type: 'ErrorType', initializer: "'app'" });

  appError.addConstructor({
    parameters: [{ name: 'message', type: 'string', hasQuestionToken: true }],
    statements: "super(message);\nthis.name = 'AppError';",
  });

  appError.addMethod({
    name: 'toJSON',
    statements: "return { type: this.type, name: this.name, message: this.message };",
  });

  const httpError = file.addClass({ name: 'HttpError', isExported: true, extends: 'AppError' });

  httpError.addProperty({ name: 'type', type: 'ErrorType', initializer: "'http'" });
  httpError.addProperty({ name: 'status', type: 'number' });
  httpError.addProperty({ name: 'statusText', type: 'string', hasQuestionToken: true });
  httpError.addProperty({ name: 'body', type: 'any', hasQuestionToken: true });

  httpError.addConstructor({
    parameters: [
      { name: 'status', type: 'number' },
      { name: 'statusText', type: 'string', hasQuestionToken: true },
      { name: 'body', type: 'any', hasQuestionToken: true },
    ],
    statements:
      "super('HTTP ' + status + ': ' + (statusText || ''));\nthis.name = 'HttpError';\nthis.status = status;\nthis.statusText = statusText;\nthis.body = body;",
  });

  httpError.addMethod({
    name: 'toJSON',
    statements:
      "return { type: this.type, name: this.name, message: this.message, status: this.status, statusText: this.statusText, body: this.body };",
  });

  const validationError = file.addClass({ name: 'ValidationError', isExported: true, extends: 'AppError' });

  validationError.addProperty({ name: 'type', type: 'ErrorType', initializer: "'validation'" });
  validationError.addProperty({ name: 'issues', type: 'any' });

  validationError.addConstructor({
    parameters: [{ name: 'issues', type: 'any' }],
    statements: `
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
    `,
  });

  validationError.addMethod({
    name: 'toJSON',
    statements: `
      return {
        type: this.type,
        name: this.name,
        message: this.message,
        issues: this.issues
      };
    `,
  });

  // add formatError helper
  file.addFunction({
    name: 'formatError',
    isExported: true,
    parameters: [{ name: 'err', type: 'AppError | Error | any' }],
    returnType: 'string',
    statements: `
      try {
        if (!err) return 'Unknown error';
        if (err instanceof ValidationError) return err.message;
        if (err instanceof HttpError) return err.message;
        if (err instanceof AppError) return err.message || String(err);
        if (err.message) return err.message;
        return String(err);
      } catch (e) {
        return String(err);
      }
    `,
  });

  return file.getFullText();
}
