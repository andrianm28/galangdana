import { Meilisearch } from "meilisearch";

// Note the class name: `Meilisearch` (lowercase "s"), not `MeiliSearch` --
// verified against the actually-installed 0.60.0 client; older
// documentation/examples for this library use the capitalized form from
// a prior major version, which does not exist in this package's exports.
export function getMeilisearchClient(): Meilisearch {
  return new Meilisearch({
    host: process.env.MEILISEARCH_URL ?? "http://localhost:7700",
    apiKey: process.env.MEILISEARCH_API_KEY ?? "fundforindonesia-dev-master-key",
  });
}
