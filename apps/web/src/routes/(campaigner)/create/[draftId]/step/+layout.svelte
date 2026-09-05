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
    <div class="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
      <div
        class="h-full rounded-full bg-primary transition-all"
        style="width: {((currentIndex + 1) / stepOrder.length) * 100}%"
      ></div>
    </div>
    <p class="mt-2 font-sans text-xs text-neutral-600">
      Langkah {currentIndex + 1} dari {stepOrder.length}
    </p>
  </div>

  <Card>
    {@render children()}
  </Card>
</div>
