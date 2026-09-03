<script lang="ts">
import { api } from "$lib/api-client";
import { Button, FormField, TextInput } from "@galangdana/ui";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();

let articles = $state(data.articles);
let slug = $state("");
let question = $state("");
let answer = $state("");
let error = $state<string | null>(null);
let submitting = $state(false);

async function createArticle() {
  error = null;
  submitting = true;
  const { data: created, error: apiError } = await api.admin["help-articles"].post({
    slug,
    question,
    answer,
  });
  submitting = false;
  if (apiError || !created) {
    error =
      apiError?.status === 409
        ? "Slug sudah digunakan, gunakan slug lain."
        : "Gagal menambahkan artikel.";
    return;
  }
  articles = [created as (typeof articles)[0], ...articles];
  slug = "";
  question = "";
  answer = "";
}

async function deleteArticle(id: string) {
  const { error: apiError } = await api.admin["help-articles"]({ id }).delete();
  if (apiError) {
    error = "Gagal menghapus artikel.";
    return;
  }
  articles = articles.filter((a) => a.id !== id);
}
</script>

<div class="max-w-2xl">
  <h2 class="mb-4 font-sans text-lg font-semibold text-neutral-900">Tambah Artikel</h2>

  {#if error}
    <p class="mb-4 font-sans text-sm text-red-600">{error}</p>
  {/if}

  <form
    class="mb-8 space-y-3"
    onsubmit={(e) => {
      e.preventDefault();
      createArticle();
    }}
  >
    <FormField label="Slug" id="slug">
      <TextInput id="slug" bind:value={slug} />
    </FormField>
    <FormField label="Pertanyaan" id="question">
      <TextInput id="question" bind:value={question} />
    </FormField>
    <FormField label="Jawaban" id="answer">
      <textarea
        id="answer"
        bind:value={answer}
        rows="4"
        class="w-full rounded-md border border-neutral-300 px-3 py-2 font-sans text-sm"
      ></textarea>
    </FormField>
    <Button type="submit" disabled={submitting}>Tambah Artikel</Button>
  </form>

  <h2 class="mb-4 font-sans text-lg font-semibold text-neutral-900">Artikel Saat Ini</h2>
  {#if articles.length === 0}
    <p class="font-sans text-neutral-600">Belum ada artikel.</p>
  {:else}
    <ul class="space-y-4">
      {#each articles as article (article.id)}
        <li class="border-b border-neutral-200 pb-4">
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="font-sans text-xs text-neutral-500">{article.slug}</p>
              <p class="font-sans font-medium text-neutral-900">{article.question}</p>
              <p class="font-sans text-sm text-neutral-600">{article.answer}</p>
            </div>
            <button
              type="button"
              class="shrink-0 font-sans text-sm text-red-600 hover:underline"
              onclick={() => deleteArticle(article.id)}
            >
              Hapus
            </button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>
