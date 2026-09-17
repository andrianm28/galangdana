<script lang="ts">
import SeoHead from "$lib/SeoHead.svelte";
import {
  ActionTile,
  CampaignCard,
  CampaignListCard,
  CardCarousel,
  CategoryChip,
  HeroCarousel,
  SectionHeader,
} from "@fundforindonesia/ui";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();

// Three fixed slides, each pointing at a real FundForIndonesia page.
//
// kibi-clone's hero rotates promotional banners, and Kitabisa's own hero is an
// app-download funnel ("Asisten Kebaikan di Aplikasi Kitabisa" -> "Download
// Sekarang"). FFI has no app, so cloning that shape literally would put a
// prominent CTA in front of something that does not exist. These carry the same
// structure and behaviour with destinations that are actually there.
//
// Jejak Dana leads deliberately: it is the one thing this platform has that the
// competitor does not, so it is what the first slide should be about.
const HERO_SLIDES = [
  {
    image: "/hero/jejak-dana.jpg",
    headline: "Setiap pencairan ada buktinya",
    cta: { label: "Lihat jejak dana", href: "/jejak-dana" },
  },
  {
    image: "/hero/galang-dana.jpg",
    headline: "Mulai galang dana untuk yang membutuhkan",
    cta: { label: "Galang dana", href: "/create/info" },
  },
  {
    image: "/hero/csr.jpg",
    headline: "Salurkan program CSR perusahaan Anda",
    cta: { label: "Kolaborasi CSR", href: "/csr" },
  },
];
</script>


<div class="flex flex-col gap-6">
  <SeoHead
    title="FundForIndonesia"
    description="Galang dan salurkan donasi, dengan jejak dana yang bisa diperiksa."
  />
  <!--
    Edge-to-edge below sm, matching the carousel and chip row: a hero inset by
    the layout's own padding reads as a card, not as a banner. Cancelled at sm,
    where the container stops being the full viewport width.
  -->
  <div class="-mx-4 sm:mx-0">
    <HeroCarousel slides={HERO_SLIDES} label="Sorotan FundForIndonesia" />
  </div>

  <div>
    <h1 class="font-sans text-2xl font-bold text-neutral-900">Galang kebaikan bersama</h1>
    <p class="mt-1 font-sans text-neutral-600">
      Bantu sesama melalui donasi yang tepat sasaran dan transparan.
    </p>
  </div>

  <div class="grid grid-cols-4 gap-2">
    <ActionTile href="/explore" label="Donasi" icon={donasiIcon} />
    <ActionTile href="/create/info" label="Galang Dana" icon={galangDanaIcon} />
    <ActionTile href="/jejak-dana" label="Jejak Dana" icon={jejakDanaIcon} />
    <ActionTile href="/csr" label="Kolaborasi CSR" icon={kolaborasiCsrIcon} />
  </div>

  <!--
    Motif amplop. The product owner asked for imagery that is deliberately NOT
    Kitabisa's ("Gambar2 nya jgn sama mgkn bs dibuat model Icon nya amplop"),
    and amplop is the Indonesian gesture of giving -- it carries no reference to
    Kitabisa's illustrated-character language while still being warmer than a
    plain line icon.

    Flat, two-tone, rounded. Amplop binds three of the four into one family.
    Each icon has exactly ONE warm-accent element -- the heart, the arrow, the
    check, the small amplop -- so there is a single focal point at 56px rather
    than four colours competing.

    Colours come from theme tokens via utility classes, not hardcoded hex, so
    the set follows the palette instead of drifting from it. currentColor is not
    usable here: these are two-tone, and inherit only carries one colour.
  -->
  {#snippet donasiIcon()}
    <!-- amplop with a heart rising out of it -->
    <svg viewBox="0 0 48 48" fill="none" class="size-8">
      <rect x="6" y="18" width="36" height="24" rx="5" class="fill-primary-light" />
      <path
        d="M6 23.5 22.1 33.4a3.6 3.6 0 0 0 3.8 0L42 23.5"
        class="stroke-primary"
        stroke-width="2.6"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <rect
        x="6"
        y="18"
        width="36"
        height="24"
        rx="5"
        class="stroke-primary"
        stroke-width="2.6"
      />
      <path
        d="M24 5.8c2.4-2.6 6.4-2.6 8.5.2 2 2.7 1.4 6.2-1.2 8.5L24 21l-7.3-6.5c-2.6-2.3-3.2-5.8-1.2-8.5 2.1-2.8 6.1-2.8 8.5-.2Z"
        class="fill-accent"
      />
    </svg>
  {/snippet}

  {#snippet galangDanaIcon()}
    <!-- amplop with an upward arrow: raising, not giving -->
    <svg viewBox="0 0 48 48" fill="none" class="size-8">
      <rect
        x="6"
        y="20"
        width="36"
        height="22"
        rx="5"
        class="fill-primary-light stroke-primary"
        stroke-width="2.6"
      />
      <path
        d="M6 24.5 22.1 34a3.6 3.6 0 0 0 3.8 0L42 24.5"
        class="stroke-primary"
        stroke-width="2.6"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path d="M24 17V5" class="stroke-accent" stroke-width="3.2" stroke-linecap="round" />
      <path
        d="m18.4 10.4 5.6-5.6 5.6 5.6"
        class="stroke-accent"
        stroke-width="3.2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  {/snippet}

  {#snippet jejakDanaIcon()}
    <!-- kuitansi with a check: a claim that has a record behind it -->
    <svg viewBox="0 0 48 48" fill="none" class="size-8">
      <path
        d="M10 7h20l8 8v22a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4V11a4 4 0 0 1 4-4Z"
        class="fill-primary-light stroke-primary"
        stroke-width="2.6"
        stroke-linejoin="round"
      />
      <path
        d="M29 7v7a3 3 0 0 0 3 3h6"
        class="stroke-primary"
        stroke-width="2.6"
        stroke-linejoin="round"
      />
      <path
        d="m17 29 4.5 4.5L31 24"
        class="stroke-accent"
        stroke-width="3.2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <circle cx="17" cy="20" r="1.6" class="fill-primary" />
      <circle cx="23" cy="20" r="1.6" class="fill-primary" />
      <circle cx="29" cy="20" r="1.6" class="fill-primary" />
    </svg>
  {/snippet}

  {#snippet kolaborasiCsrIcon()}
    <!--
      Briefcase with a small amplop, not the building this started as: at 56px a
      narrow building read as a door or a book. A briefcase says "corporate"
      instantly and survives being shrunk, and the amplop keeps it in the family.
    -->
    <svg viewBox="0 0 48 48" fill="none" class="size-8">
      <path d="M18 12V9a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v3" class="stroke-primary" stroke-width="2.6" stroke-linecap="round" />
      <rect
        x="5"
        y="12"
        width="38"
        height="26"
        rx="4"
        class="fill-primary-light stroke-primary"
        stroke-width="2.6"
      />
      <path d="M5 22h38" class="stroke-primary" stroke-width="2.4" />
      <rect x="26" y="26" width="17" height="13" rx="3" class="fill-white stroke-accent" stroke-width="2.6" />
      <path
        d="m26 28.7 7.4 4.7a2 2 0 0 0 2.2 0L43 28.7"
        class="stroke-accent"
        stroke-width="2.6"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  {/snippet}

  {#if data.categories.length > 0}
    <!--
      Bleeds to the viewport edge below md, the same way the urgent carousel
      does: the layout's main is px-4 sm:px-6, and a scrolling row that stops
      at that padding reads as clipped rather than as scrollable. The negative
      margin is cancelled at md, where the row wraps inside the container
      instead of scrolling and would otherwise overhang it.
    -->
    <div
      class="-mx-4 flex gap-2 overflow-x-auto px-4 sm:-mx-6 sm:px-6 md:mx-0 md:flex-wrap md:px-0"
    >
      {#each data.categories as category (category.slug)}
        <CategoryChip href="/explore/{category.slug}" label={category.title} />
      {/each}
    </div>
  {/if}

  <div>
    <SectionHeader title="Penggalangan Dana Mendesak" badge="DARURAT" href="/explore?sort=urgent" />
    {#if data.urgentCampaigns.length > 0}
      <div class="-mx-4 mt-4 px-4 sm:-mx-6 sm:px-6">
        <CardCarousel label="Penggalangan Dana Mendesak">
          {#each data.urgentCampaigns as campaign (campaign.slug)}
            <div class="w-64 shrink-0">
              <CampaignCard {campaign} />
            </div>
          {/each}
        </CardCarousel>
      </div>
    {:else}
      <p class="mt-4 font-sans text-neutral-600">Belum ada campaign mendesak saat ini.</p>
    {/if}
  </div>

  <div>
    <SectionHeader title="Terbaru" href="/explore" />
    {#if data.latestCampaigns.length > 0}
      <div class="mt-4 flex flex-col gap-4 md:hidden">
        {#each data.latestCampaigns as campaign (campaign.slug)}
          <CampaignListCard {campaign} />
        {/each}
      </div>
      <div class="mt-4 hidden gap-4 md:grid md:grid-cols-2 lg:grid-cols-3">
        {#each data.latestCampaigns as campaign (campaign.slug)}
          <CampaignCard {campaign} />
        {/each}
      </div>
    {:else}
      <p class="mt-4 font-sans text-neutral-600">Belum ada campaign yang bisa ditampilkan saat ini.</p>
    {/if}
  </div>

  <!--
    "Program Donasi Berkelanjutan", ported from kibi-clone's OngoingPrograms.

    A horizontal rail rather than the grid used for "Terbaru": these are
    open-ended programmes, not a browsable catalogue, and a rail says "a few
    ongoing things" where a grid says "here is everything". Same shape the
    source uses.

    Program campaigns have no goal and no deadline, so CampaignCard's program
    branch renders "Donasi tersedia" instead of a progress bar -- which is the
    honest presentation and the reason both branches exist.
  -->
  {#if data.programCampaigns.length > 0}
    <div>
      <SectionHeader title="Program Donasi Berkelanjutan" href="/explore" />
      <div class="-mx-4 mt-4 px-4 sm:-mx-6 sm:px-6">
        <CardCarousel label="Program donasi berkelanjutan">
          {#each data.programCampaigns as campaign (campaign.slug)}
            <div class="w-64 shrink-0">
              <CampaignCard {campaign} />
            </div>
          {/each}
        </CardCarousel>
      </div>
    </div>
  {/if}
</div>
