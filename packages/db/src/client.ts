import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

const connectionString =
  process.env.DATABASE_URL ?? "postgres://galangdana:galangdana@localhost:55434/galangdana";

const queryClient = postgres(connectionString);

export const db = drizzle(queryClient, { schema });
export { schema };
export * from "./schema/index";
