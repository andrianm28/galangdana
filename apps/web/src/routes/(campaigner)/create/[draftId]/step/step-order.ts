type Track = "medical" | "non_medical";

const SHARED_PREFIX = ["tujuan", "judul", "target-donasi", "cerita", "ajakan"] as const;
const SHARED_SUFFIX = ["dokumen", "otp", "rangkuman"] as const;

export function getStepOrder(track: Track): string[] {
  const trackSpecific = track === "medical" ? ["pasien"] : ["penerima"];
  const prefix = track === "medical" ? SHARED_PREFIX : ["data-diri", ...SHARED_PREFIX];
  return [...prefix, ...trackSpecific, ...SHARED_SUFFIX];
}

export function nextStep(track: Track, currentStep: string): string | null {
  const order = getStepOrder(track);
  const index = order.indexOf(currentStep);
  if (index === -1 || index === order.length - 1) return null;
  return order[index + 1] ?? null;
}

export function previousStep(track: Track, currentStep: string): string | null {
  const order = getStepOrder(track);
  const index = order.indexOf(currentStep);
  if (index <= 0) return null;
  return order[index - 1] ?? null;
}
