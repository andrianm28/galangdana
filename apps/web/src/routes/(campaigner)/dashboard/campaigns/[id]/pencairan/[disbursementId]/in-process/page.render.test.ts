// @vitest-environment happy-dom
import type { DisbursementDetailResponse } from "@galangdana/contracts";
import { render, screen } from "@testing-library/svelte";
import { describe, expect, test } from "vitest";
import Page from "./+page.svelte";

const PARAMS = { id: "c1", disbursementId: "d1" };

function disbursement(
  overrides: Pick<DisbursementDetailResponse, "status"> &
    Partial<Pick<DisbursementDetailResponse, "rejectedReason" | "payoutRef" | "paidAt">>,
): DisbursementDetailResponse {
  return {
    id: "d1",
    campaignId: "c1",
    bankAccountId: "ba1",
    type: "partial",
    amount: { amount: "100000", currency: "IDR" },
    narrative: "Untuk biaya pengobatan",
    proofObjectKey: "disbursements/d1/proof/abc.pdf",
    otpVerifiedAt: new Date().toISOString(),
    rejectedReason: null,
    payoutRef: null,
    paidAt: null,
    withdrawableAmount: { amount: "500000", currency: "IDR" },
    ...overrides,
  };
}

function renderPage(overrides: Parameters<typeof disbursement>[0]) {
  return render(Page, {
    props: {
      data: { disbursement: disbursement(overrides) },
      params: PARAMS,
      form: null,
    },
  });
}

describe("pencairan/in-process page", () => {
  test("renders the requested status label", () => {
    renderPage({ status: "requested" });
    expect(screen.getByText("Menunggu peninjauan admin")).not.toBeNull();
  });

  test("renders the approved status label", () => {
    renderPage({ status: "approved" });
    expect(screen.getByText("Disetujui, menunggu pencairan")).not.toBeNull();
  });

  test("renders the rejected status label and the rejection reason", () => {
    renderPage({ status: "rejected", rejectedReason: "Dokumen tidak lengkap" });
    expect(screen.getByText("Ditolak")).not.toBeNull();
    expect(screen.getByText("Dokumen tidak lengkap")).not.toBeNull();
  });

  test("does not render a rejection reason when not rejected", () => {
    renderPage({ status: "approved" });
    expect(screen.queryByText("Dokumen tidak lengkap")).toBeNull();
  });

  test("renders the paid status label and the payout reference", () => {
    renderPage({
      status: "paid",
      payoutRef: "xendit-payout-123",
      paidAt: new Date().toISOString(),
    });
    expect(screen.getByText("Dana telah dicairkan")).not.toBeNull();
    expect(screen.getByText("Referensi: xendit-payout-123")).not.toBeNull();
  });

  test("does not render a payout reference when not paid", () => {
    renderPage({ status: "requested" });
    expect(screen.queryByText(/Referensi:/)).toBeNull();
  });

  test("renders the failed status label", () => {
    renderPage({ status: "failed" });
    expect(screen.getByText("Pencairan gagal")).not.toBeNull();
  });
});
