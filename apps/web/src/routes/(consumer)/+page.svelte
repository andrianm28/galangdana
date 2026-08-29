<script lang="ts">
import { Badge, Card } from "@galangdana/ui";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();

const isHealthy = $derived(data.apiStatus === "ok");
</script>

<div class="flex flex-col gap-4">
  <h1 class="font-sans text-2xl font-bold text-neutral-900">Welcome to GalangDana</h1>
  <p class="font-sans text-neutral-600">
    A platform for giving that puts trust and transparency first.
  </p>
  <Card>
    <div class="flex items-center justify-between">
      <span class="font-sans text-sm text-neutral-600">API status</span>
      <Badge variant={isHealthy ? "success" : "error"}>{data.apiStatus}</Badge>
    </div>
  </Card>
</div>
