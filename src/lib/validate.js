export function validate(schema, source = "body") {
  return function validateRequest(req, res, next) {
    const input = source === "body" ? req.body : req[source];
    const result = schema.safeParse(input);

    if (!result.success) {
      return res.status(422).json({
        error: {
          message: "Validation failed",
          details: result.error.flatten().fieldErrors,
        },
      });
    }

    if (source === "body") {
      req.body = result.data;
    } else {
      res.locals.validated = res.locals.validated ?? {};
      res.locals.validated[source] = result.data;
    }

    return next();
  };
}
