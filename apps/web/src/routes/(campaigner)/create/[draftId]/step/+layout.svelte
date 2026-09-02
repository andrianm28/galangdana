<script lang="ts">
import { Card } from "@galangdana/ui";
import type { LayoutProps } from "./$types";
import { getStepOrder } from "./step-order";

const { data, children }: LayoutProps = $props();

const stepOrder = $derived(getStepOrder(data.draft.track));
const currentIndex = $derived(stepOrder.indexOf(data.draft.currentStep));
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
