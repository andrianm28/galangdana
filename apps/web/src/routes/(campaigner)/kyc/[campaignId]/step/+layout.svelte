<script lang="ts">
import { page } from "$app/state";
import { Card } from "@fundforindonesia/ui";
import type { LayoutProps } from "./$types";
import { getKycStepOrder } from "./kyc-step-order";

const { data, children }: LayoutProps = $props();

const stepOrder = getKycStepOrder();
const currentIndex = $derived(stepOrder.indexOf(page.url.pathname.split("/").pop() ?? ""));
</script>

<div class="mx-auto max-w-md px-4 py-6">
  <div class="mb-6">
    <div class="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
      <div
        class="h-full rounded-full bg-primary transition-all"
        style="width: {((currentIndex + 1) / stepOrder.length) * 100}%"
      ></div>
    </div>
    <p class="mt-2 font-sans text-xs text-neutral-600">
      Verifikasi identitas {data.kyc.campaignTitle} — langkah {currentIndex + 1} dari {stepOrder.length}
    </p>
  </div>

  <Card>
    {@render children()}
  </Card>
</div>
