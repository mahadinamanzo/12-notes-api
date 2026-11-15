import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import jwt from "jsonwebtoken";
import request from "supertest";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required; use a separate Neon test branch.");
}
if (process.env.DATABASE_URL && testDatabaseUrl === process.env.DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL must not be the same as DATABASE_URL.");
}

process.env.DATABASE_URL = testDatabaseUrl;
process.env.JWT_SECRET = randomBytes(32).toString("base64url");

const { default: app } = await import("../src/app.js");
const { sql } = await import("../src/db.js");

describe("authentication and notes ownership", () => {
  const createdUserIds = [];
  let ownerEmail;
  let ownerPassword;
  let ownerRegistration;
  let ownerLogin;
  let otherLogin;
  let ownerNote;

  before(async () => {
    const suffix = randomUUID();
    ownerEmail = `Owner-${suffix}@Example.test`;
    ownerPassword = `OwnerPassword-${suffix}1`;
    const otherEmail = `Other-${suffix}@Example.test`;
    const otherPassword = `OtherPassword-${suffix}2`;

    ownerRegistration = await request(app).post("/api/auth/register").send({
      name: "Test Owner",
      email: ownerEmail,
      password: ownerPassword,
    });
    assert.equal(ownerRegistration.status, 201);
    createdUserIds.push(ownerRegistration.body.user.id);

    const otherRegistration = await request(app).post("/api/auth/register").send({
      name: "Test Other",
      email: otherEmail,
      password: otherPassword,
    });
    assert.equal(otherRegistration.status, 201);
    createdUserIds.push(otherRegistration.body.user.id);

    ownerLogin = await request(app).post("/api/auth/login").send({
      email: ownerEmail,
      password: ownerPassword,
    });
    assert.equal(ownerLogin.status, 200);

    otherLogin = await request(app).post("/api/auth/login").send({
      email: otherEmail,
      password: otherPassword,
    });
    assert.equal(otherLogin.status, 200);

    const noteResponse = await request(app)
      .post("/api/notes")
      .set("Authorization", `Bearer ${ownerLogin.body.token}`)
      .send({ title: "Owner-only note", body: "Private test content." });
    assert.equal(noteResponse.status, 201);
    ownerNote = noteResponse.body.note;
  });

  after(async () => {
    for (const userId of createdUserIds) {
      await sql`DELETE FROM users WHERE id = ${userId}`;
    }
  });

  it("registers and logs in without returning password hashes", async () => {
    assert.equal(ownerRegistration.body.user.email, ownerEmail.toLowerCase());
    assert.equal(Object.hasOwn(ownerRegistration.body.user, "password_hash"), false);
    assert.equal(typeof ownerRegistration.body.token, "string");
    assert.equal(ownerLogin.body.user.id, ownerRegistration.body.user.id);
    assert.equal(Object.hasOwn(ownerLogin.body.user, "password_hash"), false);
    assert.equal(typeof ownerLogin.body.token, "string");

    const invalidLogin = await request(app).post("/api/auth/login").send({
      email: ownerEmail,
      password: "IncorrectPassword123",
    });
    assert.equal(invalidLogin.status, 401);
    assert.equal(invalidLogin.body.error.message, "Invalid email or password");
  });

  it("requires a valid bearer token", async () => {
    const missing = await request(app).get("/api/notes");
    assert.equal(missing.status, 401);
    assert.match(missing.headers["www-authenticate"], /^Bearer/);

    const garbled = await request(app)
      .get("/api/notes")
      .set("Authorization", "Bearer not.a.valid.token");
    assert.equal(garbled.status, 401);
    assert.match(garbled.headers["www-authenticate"], /^Bearer/);

    const expiredToken = jwt.sign(
      { sub: ownerRegistration.body.user.id, exp: Math.floor(Date.now() / 1000) - 1 },
      process.env.JWT_SECRET,
      { algorithm: "HS256" },
    );
    const expired = await request(app)
      .get("/api/notes")
      .set("Authorization", `Bearer ${expiredToken}`);
    assert.equal(expired.status, 401);
  });

  it("validates note IDs and request bodies", async () => {
    const token = ownerLogin.body.token;
    const invalidId = await request(app)
      .get("/api/notes/not-a-uuid")
      .set("Authorization", `Bearer ${token}`);
    assert.equal(invalidId.status, 422);

    const invalidBody = await request(app)
      .post("/api/notes")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "", body: 42 });
    assert.equal(invalidBody.status, 422);

    const emptyPatch = await request(app)
      .patch(`/api/notes/${ownerNote.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    assert.equal(emptyPatch.status, 422);
  });

  it("does not allow another user to read, update, or delete a note", async () => {
    const token = otherLogin.body.token;
    const ownerRead = await request(app)
      .get(`/api/notes/${ownerNote.id}`)
      .set("Authorization", `Bearer ${ownerLogin.body.token}`);
    assert.equal(ownerRead.status, 200);

    const list = await request(app)
      .get("/api/notes")
      .set("Authorization", `Bearer ${token}`);
    assert.equal(list.status, 200);
    assert.equal(list.body.notes.some((note) => note.id === ownerNote.id), false);

    const read = await request(app)
      .get(`/api/notes/${ownerNote.id}`)
      .set("Authorization", `Bearer ${token}`);
    assert.equal(read.status, 404);

    const update = await request(app)
      .patch(`/api/notes/${ownerNote.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Unauthorized update" });
    assert.equal(update.status, 404);

    const remove = await request(app)
      .delete(`/api/notes/${ownerNote.id}`)
      .set("Authorization", `Bearer ${token}`);
    assert.equal(remove.status, 404);
  });
});
