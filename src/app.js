import cors from "cors";
import express from "express";
import helmet from "helmet";
import healthRouter from "./routes/health.js";

const app = express();
const allowedOrigins = new Set(["http://localhost:5173", "http://localhost:3000"]);

app.use(helmet());
app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on("finish", () => {
    console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - startedAt}ms`);
  });
  next();
});
app.use(
  cors({
    origin(origin, callback) {
      callback(null, origin === undefined || allowedOrigins.has(origin));
    },
  }),
);
app.use(express.json({ limit: "100kb" }));

app.use("/api/health", healthRouter);

app.use((req, res) => {
  res.status(404).json({
    error: { message: "Route not found" },
  });
});

app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 500
    ? error.status
    : 500;
  const isProduction = process.env.NODE_ENV === "production";

  if (status >= 500) {
    console.error(error);
  }

  const message =
    status === 400 && error.type === "entity.parse.failed"
      ? "Invalid JSON payload"
      : isProduction && status >= 500
        ? "Internal server error"
        : status >= 500
          ? error.message
          : "Request failed";

  return res.status(status).json({
    error: { message },
  });
});

export default app;
