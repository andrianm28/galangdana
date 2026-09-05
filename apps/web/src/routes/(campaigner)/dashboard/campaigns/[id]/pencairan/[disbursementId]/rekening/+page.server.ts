import { createServerApiClient } from "$lib/server-api-client";
import type { Treaty } from "@elysiajs/eden";
import type { BankAccountListResponse } from "@fundforindonesia/contracts";
import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ cookies, url }) => {
  const sessionToken = cookies.get("session");
  if (!sessionToken) {
    redirect(303, `/login?redirectTo=${encodeURIComponent(url.pathname)}`);
  }
  const client = createServerApiClient(sessionToken);
  // biome-ignore lint/suspicious/noExplicitAny: Eden bracket-notation cast for a kebab-case segment
  const { data, error: apiError } = (await (client as any)[
    "bank-accounts"
  ].get()) as Treaty.TreatyResponse<{
    200: BankAccountListResponse;
    401: { error: string };
  }>;
  if (apiError?.status === 401 || !data) {
    redirect(303, `/login?redirectTo=${encodeURIComponent(url.pathname)}`);
  }
  return { bankAccounts: data.bankAccounts };
};
