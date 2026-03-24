import { CodeBuilder } from "../codegen/builder";

export function generateErrors(
  style: "class" | "shape" | "both" = "both",
): string {
  const b = new CodeBuilder();
  const includeClasses = style !== "shape";
  const formatParamType =
    style === "shape"
      ? "AppErrorShape | Error | any"
      : "AppError | Error | any";

  // ─── Types and Shapes ─────────────────────────────
  b.section("Error Types and Shapes")
    .typeAlias("ErrorType", `'app' | 'http' | 'validation'`)
    .interface("AppErrorShape", {
      type: { type: "ErrorType" },
      name: { type: "string" },
      message: { type: "string" },
    })
    .interface("HttpErrorShape", {
      type: { type: "ErrorType" },
      name: { type: "string" },
      message: { type: "string" },
      status: { type: "number" },
      statusText: { type: "string", optional: true },
      body: { type: "any", optional: true },
    })
    .interface("ValidationErrorShape", {
      type: { type: "ErrorType" },
      name: { type: "string" },
      message: { type: "string" },
      issues: { type: "any" },
    });

  // ─── Classes ─────────────────────────────
  if (includeClasses) {
    b.section("Error Classes")
      .classBlock(
        "AppError",
        (c) => {
          c.field("type", "ErrorType", { value: "'app'" });
          c.constructorBlock("message?: string", (ctor) => {
            ctor
              .line("super(message);")
              .line(`this.name = 'AppError';`)
              .line("Object.setPrototypeOf(this, AppError.prototype);");
          });
          c.method("toJSON", { returns: "any" }, (m) => {
            m.return(
              "{ type: this.type, name: this.name, message: this.message }",
            );
          });
        },
        { extends: "Error" },
      )

      .classBlock(
        "HttpError",
        (c) => {
          c.field("type", "ErrorType", { value: "'http'" });
          c.field("status", "number");
          c.field("statusText", "string", { optional: true });
          c.field("body", "any", { optional: true });
          c.constructorBlock(
            "status: number, statusText?: string, body?: any",
            (ctor) => {
              ctor
                .line("super('HTTP ' + status + ': ' + (statusText || ''));")
                .line("this.name = 'HttpError';")
                .assign("this.status", "status")
                .assign("this.statusText", "statusText")
                .assign("this.body", "body")
                .line("Object.setPrototypeOf(this, HttpError.prototype);");
            },
          );
          c.method("toJSON", { returns: "any" }, (m) => {
            m.return(
              "{ type: this.type, name: this.name, message: this.message, status: this.status, statusText: this.statusText, body: this.body }",
            );
          });
        },
        { extends: "Error" },
      )

      .classBlock(
        "ValidationError",
        (c) => {
          c.field("type", "ErrorType", { value: "'validation'" });
          c.field("issues", "any");
          c.constructorBlock("issues: any", (ctor) => {
            // formatIssue function
            ctor.function(
              "formatIssue",
              { params: "i: any", returns: "string" },
              (f) => {
                f.tryCatch(
                  (t) => {
                    t.const(
                      "path",
                      'i?.path?.length ? i.path.join(".") : "<root>"',
                    );
                    t.let("details", 'i?.message || ""');

                    t.if(
                      'i?.code === "too_small" && i.minimum !== undefined',
                      (b) =>
                        b.assign(
                          "details",
                          '`expected >= ${i.minimum}${i.inclusive === false ? " (exclusive)" : ""}`',
                        ),
                    );
                    t.if(
                      'i?.code === "too_big" && i.maximum !== undefined',
                      (b) =>
                        b.assign(
                          "details",
                          '`expected <= ${i.maximum}${i.inclusive === false ? " (exclusive)" : ""}`',
                        ),
                    );
                    t.if('i?.code === "invalid_type"', (b) =>
                      b.assign(
                        "details",
                        '`expected type ${i.expected ?? "unknown"}${i.received ? ", received " + i.received : ""}`',
                      ),
                    );
                    t.if("!details", (b) =>
                      b.assign("details", "JSON.stringify(i)"),
                    );

                    t.const(
                      "received",
                      '(i?.received !== undefined) ? (" (received: " + JSON.stringify(i.received) + ")") : ""',
                    );
                    t.return('path + ": " + details + received');
                  },
                  "e",
                  (c) => c.return("i?.message || String(i)"),
                );
              },
            );

            ctor.let("message", '""');
            ctor.if("!issues", (b) =>
              b.assign("message", `'Validation error'`),
            );
            ctor.if('typeof issues === "string"', (b) =>
              b.assign("message", "issues"),
            );
            ctor.if("issues?.issues && Array.isArray(issues.issues)", (b) =>
              b.assign("message", 'issues.issues.map(formatIssue).join("; ")'),
            );
            ctor.if("Array.isArray(issues)", (b) =>
              b.assign("message", 'issues.map(formatIssue).join("; ")'),
            );
            ctor.if("issues?.message", (b) =>
              b.assign("message", "issues.message"),
            );
            ctor.if("issues?.errors && Array.isArray(issues.errors)", (b) =>
              b.assign("message", 'issues.errors.map(formatIssue).join("; ")'),
            );
            ctor.tryCatch(
              (t) =>
                t.if("!message", (b) =>
                  b.assign("message", "JSON.stringify(issues)"),
                ),
              "e",
              (c) => c.assign("message", "String(issues)"),
            );

            ctor.line("super(message);");
            ctor.line(`this.name = 'ValidationError';`);
            ctor.assign("this.issues", "issues");
            ctor.line(
              "Object.setPrototypeOf(this, ValidationError.prototype);",
            );
          });

          c.method("toJSON", { returns: "any" }, (m) => {
            m.return(
              "{ type: this.type, name: this.name, message: this.message, issues: this.issues }",
            );
          });
        },
        { extends: "Error" },
      );
  }

  // ─── formatError function ─────────────────────────────
  b.function(
    "formatError",
    { export: true, params: `err: ${formatParamType}`, returns: "string" },
    (f) => {
      f.tryCatch(
        (t) => {
          t.if("!err", (b) => b.return(`'Unknown error'`));
          if (style !== "shape") {
            t.raw(`
if (err instanceof ValidationError) return err.message;
if (err instanceof HttpError) return err.message;
if (err instanceof AppError) return err.message || String(err);`);
          }
          t.if("err && err.message", (b) => b.return("err.message"));
          t.return("String(err)");
        },
        "e",
        (c) => c.return("String(err)"),
      );
    },
  );

  return b.toString();
}
