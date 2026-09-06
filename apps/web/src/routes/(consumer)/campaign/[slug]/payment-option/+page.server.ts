import { createServerApiClient } from "$lib/server-api-client";
import type { PageServerLoad } from "./$types";

/**
 * This step used to have no load at all: it offered both payment methods
 * unconditionally. Production had QRIS switched on in the UI while its
 * provider was unconfigured, so choosing it produced a 500 and the donor was
 * told "Gagal memproses donasi. Silakan coba lagi." -- advice that could
 * never work. The server is the only thing that knows what it can fulfil, so
 * it decides what is on the menu.
 */
export const load: PageServerLoad = async ({ cookies }) => {
  const client = createServerApiClient(cookies.get("session"));
  const { data } = await client["payment-methods"].get();
  // A failed lookup is not a reason to strand the donor. Bank transfer is the
  // method that works when nothing else is configured, so it is the floor.
  const methods = data?.methods?.length ? data.methods : ["bank_transfer_va"];
  return { methods: methods as Array<"bank_transfer_va" | "qris_redirect"> };
};
