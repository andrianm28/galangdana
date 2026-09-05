import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

const connectionString =
  process.env.DATABASE_URL ??
  "postgres://fundforindonesia:fundforindonesia@localhost:55434/fundforindonesia";

const queryClient = postgres(connectionString);

export const db = drizzle(queryClient, { schema });
export { schema };
export * from "./schema/index";
