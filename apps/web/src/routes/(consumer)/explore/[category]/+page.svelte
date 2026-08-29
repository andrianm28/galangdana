<script lang="ts">
import { CampaignCard } from "@galangdana/ui";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();

const CAMPAIGNER_TYPE_LABELS = {
  individual: "Publik",
  yayasan: "Yayasan",
  platform: "Program Mitra",
} as const;

// Each toggle link must preserve the OTHER active filter -- a bare
// `href="?sort=urgent"` would silently drop an active `type=` filter
// (and vice versa) since it replaces the whole query string, not just
// one param.
function filterHref(overrides: { sort?: string; type?: string | null }): string {
  const params = new URLSearchParams();
  params.set("sort", overrides.sort ?? data.sort);
  const type = overrides.type !== undefined ? overrides.type : data.campaignerType;
  if (type) params.set("type", type);
  return `?${params.toString()}`;
}
</script>

<div class="flex flex-col gap-4">
  <div class="flex items-center justify-between">
    <h1 class="font-sans text-xl font-bold capitalize text-neutral-900">
      {data.category.replaceAll("-", " ")}
    </h1>
    <div class="flex gap-2 font-sans text-sm">
      <a
        href={filterHref({ sort: "newest" })}
        class={data.sort === "newest" ? "font-semibold text-primary" : "text-neutral-600"}
      >
        Terbaru
      </a>
      <a
        href={filterHref({ sort: "urgent" })}
        class={data.sort === "urgent" ? "font-semibold text-primary" : "text-neutral-600"}
      >
        Paling Mendesak
      </a>
    </div>
  </div>

  <div class="flex gap-2 font-sans text-sm">
    <a
      href={filterHref({ type: null })}
      class={data.campaignerType === null ? "font-semibold text-primary" : "text-neutral-600"}
    >
      Semua
    </a>
    {#each Object.entries(CAMPAIGNER_TYPE_LABELS) as [type, label] (type)}
      <a
        href={filterHref({ type })}
        class={data.campaignerType === type ? "font-semibold text-primary" : "text-neutral-600"}
      >
        {label}
      </a>
    {/each}
  </div>

  <p class="font-sans text-sm text-neutral-600">{data.totalCount} campaign ditemukan</p>

  {#if data.campaigns.length > 0}
    <div class="grid grid-cols-1 gap-4">
      {#each data.campaigns as campaign (campaign.slug)}
        <CampaignCard {campaign} />
      {/each}
    </div>
  {:else}
    <p class="font-sans text-neutral-600">Belum ada campaign di kategori ini.</p>
  {/if}
</div>
