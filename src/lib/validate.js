export function validate(schema) {
  return function validateRequest(req, res, next) {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      return res.status(422).json({
        error: {
          message: "Validation failed",
          details: result.error.flatten().fieldErrors,
        },
      });
    }

    req.body = result.data;
    return next();
  };
}
