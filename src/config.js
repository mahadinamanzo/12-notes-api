import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z
    .url()
    .refine((value) => value.startsWith("postgres://") || value.startsWith("postgresql://"), {
      message: "must be a PostgreSQL connection URL",
    }),
  JWT_SECRET: z.string().min(32, "must be at least 32 characters"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  const issues = result.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid environment configuration: ${issues}`);
}

export const { DATABASE_URL, JWT_SECRET, PORT } = result.data;
