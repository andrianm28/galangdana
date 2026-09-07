<script lang="ts">
import { page } from "$app/state";
import { Card } from "@fundforindonesia/ui";
import type { LayoutProps } from "./$types";
import { getStepOrder } from "./step-order";

const { data, children }: LayoutProps = $props();

const stepOrder = $derived(getStepOrder(data.draft.track));
// Derived from the URL's own path segment, not `data.draft.currentStep` --
// `currentStep` names the step the last PATCH was FOR (the step just left),
// not the one being viewed, and a fresh draft's `currentStep` defaults to
// "info" (not even a member of stepOrder). Reading the URL sidesteps both
// that off-by-one/undefined-index problem and the layout load's own
// staleness (see +layout.server.ts), since the path always reflects
// whichever step page actually just rendered.
const currentIndex = $derived(stepOrder.indexOf(page.url.pathname.split("/").pop() ?? ""));
</script>

<div class="mx-auto max-w-md px-4 py-6">
  <div class="mb-6">
    <div class="flex gap-1">
      {#each stepOrder as step, i (step)}
        <div
          class="h-1.5 flex-1 rounded-full {i <= currentIndex ? 'bg-primary' : 'bg-neutral-100'}"
        ></div>
      {/each}
    </div>
    <p class="mt-2 font-mono text-xs text-neutral-600">
      Langkah {String(currentIndex + 1).padStart(2, "0")} / {String(stepOrder.length).padStart(2, "0")}
    </p>
  </div>

  <Card>
    {@render children()}
  </Card>
</div>
