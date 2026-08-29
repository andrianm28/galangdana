import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { db } from "../client";

describe("db client", () => {
  test("connects to postgres and can run a trivial query", async () => {
    const result = await db.execute(sql`select 1 as one`);
    expect(result[0]).toEqual({ one: 1 });
  });
});
