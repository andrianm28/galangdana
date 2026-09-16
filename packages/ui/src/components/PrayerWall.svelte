<!--
  Feed of prayers with an "amiin" acknowledgement on each.

  Ported from kibi-clone's PrayerWall.tsx, which has two variants:

    homepage        prayers from across every campaign, each linking back to
                    the campaign it was written for
    campaign-detail prayers for one campaign, with no campaign links

  Same split here, driven by whether an item carries campaign fields rather
  than by a `variant` prop. A prop would let the two disagree -- variant
  "campaign-detail" with campaign-bearing items, or the reverse -- and there is
  nothing sensible to render in that case. The data already says which it is.

  The amiin tap is optimistic with revert on failure, matching the source: the
  count moves immediately, and if the request fails it moves back. That is the
  right trade for a warmth signal, where waiting on a round trip makes the tap
  feel broken and a wrong count for 200ms costs nothing.

  Deliberately NOT included from the source: its SSE live-update stream. That
  needs a server push channel (Redis pub/sub here) and a route holding an open
  text/event-stream response -- real infrastructure, not a component concern,
  and shipping a component that silently never receives events would be worse
  than not claiming the feature. Noted rather than quietly dropped.
-->
<script lang="ts">
export interface PrayerWallItem {
  id: string;
  displayName: string;
  message: string;
  amiinCount: number;
  createdAt: string;
  /** Present on the homepage feed, absent on a campaign's own wall. */
  campaignSlug?: string;
  campaignTitle?: string;
}

interface Props {
  prayers: PrayerWallItem[];
  /**
   * Sends the amiin. Resolves with the server's authoritative count, or
   * rejects -- in which case the optimistic bump is reverted.
   *
   * Injected rather than called directly so packages/ui keeps no knowledge of
   * the API client: this package has no SvelteKit and no Eden dependency, the
   * same constraint that keeps ConsumerShell taking `pathname` as a prop.
   */
  onAmiin?: (id: string) => Promise<number>;
  emptyMessage?: string;
}

const {
  prayers,
  onAmiin,
  emptyMessage = "Belum ada doa. Jadilah yang pertama menuliskannya.",
}: Props = $props();

// Overrides keyed by prayer id, not a copy of the whole list: the list is a
// prop and may be replaced by a fresh load at any time, and a local copy would
// silently discard that. This way new server data wins and only the ids the
// visitor actually tapped carry a local value.
const counts = $state<Record<string, number>>({});
// Ids currently in flight, so a double-tap cannot stack two increments on one
// optimistic bump and then revert only one of them.
const pending = $state<Record<string, boolean>>({});

function countFor(prayer: PrayerWallItem): number {
  return counts[prayer.id] ?? prayer.amiinCount;
}

async function amiin(prayer: PrayerWallItem) {
  if (!onAmiin || pending[prayer.id]) return;

  const before = countFor(prayer);
  counts[prayer.id] = before + 1;
  pending[prayer.id] = true;

  try {
    const authoritative = await onAmiin(prayer.id);
    // Trust the server's number rather than keeping the guess: another
    // visitor may have tapped between render and now, and the optimistic
    // value would then be stale in a way that never self-corrects.
    counts[prayer.id] = authoritative;
  } catch {
    counts[prayer.id] = before;
  } finally {
    pending[prayer.id] = false;
  }
}
</script>

{#if prayers.length === 0}
  <p class="font-sans text-neutral-600">{emptyMessage}</p>
{:else}
  <ul class="flex flex-col gap-3">
    {#each prayers as prayer (prayer.id)}
      <li class="rounded-md border border-neutral-200 bg-white p-4">
        <div class="flex items-baseline justify-between gap-3">
          <p class="font-sans text-sm font-semibold text-neutral-900">{prayer.displayName}</p>
          <time
            datetime={prayer.createdAt}
            class="shrink-0 font-sans text-xs text-neutral-500"
          >
            {new Date(prayer.createdAt).toLocaleDateString("id-ID", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </time>
        </div>

        <p class="mt-1 font-sans text-sm text-neutral-800">{prayer.message}</p>

        {#if prayer.campaignSlug && prayer.campaignTitle}
          <a
            href="/campaign/{prayer.campaignSlug}"
            class="mt-2 inline-block font-sans text-xs text-primary transition-colors duration-150 hover:text-primary-dark hover:underline"
          >
            {prayer.campaignTitle}
          </a>
        {/if}

        {#if onAmiin}
          <button
            type="button"
            onclick={() => amiin(prayer)}
            disabled={pending[prayer.id]}
            aria-label="Aamiin untuk doa dari {prayer.displayName}"
            class="mt-3 inline-flex items-center gap-1.5 rounded-full border border-neutral-200 px-3 py-1 font-sans text-xs font-medium text-neutral-800 transition-colors duration-150 hover:bg-neutral-100 disabled:opacity-60"
          >
            Aamiin
            <span data-testid="amiin-count" class="font-mono">{countFor(prayer)}</span>
          </button>
        {:else}
          <p class="mt-3 font-sans text-xs text-neutral-600">
            Aamiin <span data-testid="amiin-count" class="font-mono">{countFor(prayer)}</span>
          </p>
        {/if}
      </li>
    {/each}
  </ul>
{/if}
