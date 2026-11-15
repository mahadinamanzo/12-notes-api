import { Router } from "express";
import { z } from "zod";
import { sql } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../lib/validate.js";

const router = Router();
const emptyToUndefined = z
  .string()
  .trim()
  .transform((value) => value || undefined)
  .optional();
const listQuerySchema = z.object({
  q: emptyToUndefined,
  tag: emptyToUndefined,
  pinned: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const idParamsSchema = z.object({ id: z.uuid() });
const tagsSchema = z.array(z.string().trim().min(1)).max(30);
const createNoteSchema = z.object({
  title: z.string().trim().min(1),
  body: z.string(),
  tags: tagsSchema.default([]),
  pinned: z.boolean().default(false),
});
const updateNoteSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    body: z.string().optional(),
    tags: tagsSchema.optional(),
    pinned: z.boolean().optional(),
  })
  .refine((note) => Object.keys(note).length > 0, "At least one field is required");

router.use(requireAuth);

function andConditions(conditions) {
  return conditions.slice(1).reduce(
    (combined, condition) => sql`${combined} AND ${condition}`,
    conditions[0],
  );
}

function notFound(res) {
  return res.status(404).json({
    error: { message: "Note not found" },
  });
}

router.get("/", validate(listQuerySchema, "query"), async (req, res) => {
  const { q, tag, pinned, page, limit } = res.locals.validated.query;
  const offset = (page - 1) * limit;
  const conditions = [sql`user_id = ${req.user.id}`];

  if (q) {
    const search = `%${q}%`;
    conditions.push(sql`(title ILIKE ${search} OR body ILIKE ${search})`);
  }
  if (tag) {
    conditions.push(sql`${tag} = ANY(tags)`);
  }
  if (pinned !== undefined) {
    conditions.push(sql`pinned = ${pinned}`);
  }

  const where = andConditions(conditions);
  const [notes, [{ total }]] = await Promise.all([
    sql`
      SELECT id, user_id, title, body, tags, pinned, created_at, updated_at
      FROM notes
      WHERE ${where}
      ORDER BY pinned DESC, updated_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `,
    sql`
      SELECT COUNT(*)::int AS total
      FROM notes
      WHERE ${where}
    `,
  ]);

  return res.json({
    notes,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

router.get("/:id", validate(idParamsSchema, "params"), async (req, res) => {
  const { id } = res.locals.validated.params;
  const [note] = await sql`
    SELECT id, user_id, title, body, tags, pinned, created_at, updated_at
    FROM notes
    WHERE id = ${id} AND user_id = ${req.user.id}
    LIMIT 1
  `;

  if (!note) {
    return notFound(res);
  }

  return res.json({ note });
});

router.post("/", validate(createNoteSchema), async (req, res) => {
  const { title, body, tags, pinned } = req.body;
  const [note] = await sql`
    INSERT INTO notes (user_id, title, body, tags, pinned)
    VALUES (${req.user.id}, ${title}, ${body}, ${tags}, ${pinned})
    RETURNING id, user_id, title, body, tags, pinned, created_at, updated_at
  `;

  return res.status(201).json({ note });
});

router.patch(
  "/:id",
  validate(idParamsSchema, "params"),
  validate(updateNoteSchema),
  async (req, res) => {
    const { id } = res.locals.validated.params;
    const { title, body, tags, pinned } = req.body;
    const [note] = await sql`
      UPDATE notes
      SET title = CASE WHEN ${title !== undefined} THEN ${title ?? null} ELSE title END,
          body = CASE WHEN ${body !== undefined} THEN ${body ?? null} ELSE body END,
          tags = CASE WHEN ${tags !== undefined} THEN ${tags ?? null} ELSE tags END,
          pinned = CASE WHEN ${pinned !== undefined} THEN ${pinned ?? null} ELSE pinned END,
          updated_at = NOW()
      WHERE id = ${id} AND user_id = ${req.user.id}
      RETURNING id, user_id, title, body, tags, pinned, created_at, updated_at
    `;

    if (!note) {
      return notFound(res);
    }

    return res.json({ note });
  },
);

router.delete("/:id", validate(idParamsSchema, "params"), async (req, res) => {
  const { id } = res.locals.validated.params;
  const [note] = await sql`
    DELETE FROM notes
    WHERE id = ${id} AND user_id = ${req.user.id}
    RETURNING id
  `;

  if (!note) {
    return notFound(res);
  }

  return res.status(204).end();
});

export default router;
