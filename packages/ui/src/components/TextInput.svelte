<script lang="ts">
interface Props {
  id: string;
  type?: "text" | "email" | "tel" | "password";
  value: string;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  oninput?: (value: string) => void;
}

let {
  id,
  type = "text",
  value = $bindable(),
  placeholder,
  disabled = false,
  invalid = false,
  oninput,
}: Props = $props();

function handleInput(event: Event & { currentTarget: HTMLInputElement }) {
  value = event.currentTarget.value;
  oninput?.(value);
}
</script>

<input
  {id}
  {type}
  {value}
  {placeholder}
  {disabled}
  aria-invalid={invalid}
  oninput={handleInput}
  class="w-full rounded-sm border px-3 py-2 font-sans text-base text-neutral-900
    placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-primary/40
    disabled:bg-neutral-100 disabled:text-neutral-400 disabled:cursor-not-allowed
    {invalid ? 'border-error' : 'border-neutral-200'}"
/>
