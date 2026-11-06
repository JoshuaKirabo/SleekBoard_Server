import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseUrl } from "../../src/config/DatabaseUrl.js";

// A database on this Mac needs nothing more. Anywhere else, the connection has to be encrypted, or the server won't
// start talking to it.

const safe = (text) => new DatabaseUrl(text).requireSafe();

test("a database on this Mac is fine without encryption", () =>
  {
    for(const host of ["localhost", "127.0.0.1", "[::1]"])
      assert.doesNotThrow(() => safe(`postgresql://sleekboard_app@${host}:5432/sleekboard`));
  });

test("a database somewhere else without encryption is refused", () =>
  {
    assert.throws(() => safe("postgresql://app:pw@db.example.com:5432/sleekboard"), /isn't on this Mac/);
    assert.throws(() => safe("postgresql://app:pw@10.0.0.5/sleekboard?sslmode=disable"), /sslmode=require/);
    assert.throws(() => safe("postgresql://app:pw@10.0.0.5/sleekboard?ssl=0"), /sslmode=require/);
  });

test("encryption that never checks the server's certificate is refused", () =>
  {
    assert.throws(() => safe("postgresql://app:pw@db.example.com/sleekboard?ssl=no-verify"), /sslmode=require/);
  });

test("sslmode require, verify-ca and verify-full, or ssl=true, count as encrypted", () =>
  {
    for(const mode of ["require", "verify-ca", "verify-full"])
      assert.doesNotThrow(() => safe(`postgresql://app:pw@db.example.com/sleekboard?sslmode=${mode}`));
    assert.doesNotThrow(() => safe("postgresql://app:pw@db.example.com/sleekboard?ssl=true"));
  });

test("Cloud SQL's socket on Cloud Run counts as encrypted", () =>
  {
    assert.doesNotThrow(() => safe("postgresql://app:pw@localhost/sleekboard?host=/cloudsql/sleekboard:us-central1:db"));
    assert.doesNotThrow(() => safe("postgresql://app:pw@/sleekboard?host=/cloudsql/sleekboard:us-central1:db"));
  });

test("a host= in the query is the one that counts", () =>
  {
    assert.throws(() => safe("postgresql://app:pw@localhost/sleekboard?host=db.example.com"), /db\.example\.com/);
  });

test("the error names the host but never the password", () =>
  {
    assert.throws(() => safe("postgresql://app:hunter2@db.example.com/sleekboard"), (error) => !error.message.includes("hunter2"));
  });

test("a missing DATABASE_URL says so", () =>
  {
    assert.throws(() => new DatabaseUrl(undefined), /DATABASE_URL is missing/);
  });
