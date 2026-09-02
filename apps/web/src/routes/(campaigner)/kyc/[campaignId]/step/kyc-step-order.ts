const KYC_STEP_ORDER = [
  "identity",
  "contact",
  "consent",
  "upload-ktp",
  "upload-selfie",
  "hold",
  "summary",
  "pending",
] as const;

export function getKycStepOrder(): string[] {
  return [...KYC_STEP_ORDER];
}

export function nextKycStep(currentStep: string): string | null {
  const index = KYC_STEP_ORDER.indexOf(currentStep as (typeof KYC_STEP_ORDER)[number]);
  if (index === -1 || index === KYC_STEP_ORDER.length - 1) return null;
  return KYC_STEP_ORDER[index + 1] ?? null;
}

export function previousKycStep(currentStep: string): string | null {
  const index = KYC_STEP_ORDER.indexOf(currentStep as (typeof KYC_STEP_ORDER)[number]);
  if (index <= 0) return null;
  return KYC_STEP_ORDER[index - 1] ?? null;
}
