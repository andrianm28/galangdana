import { describe, expect, test } from "bun:test";
import { terbilang, terbilangRupiah } from "./terbilang.ts";

describe("terbilang", () => {
  test("spells zero", () => {
    expect(terbilang(0n)).toBe("nol");
  });

  test("spells the units", () => {
    expect(terbilang(1n)).toBe("satu");
    expect(terbilang(9n)).toBe("sembilan");
  });

  test("uses the se- contraction for ten and eleven", () => {
    // Indonesian contracts a leading one at several scales; "satu puluh" and
    // "satu belas" are both wrong.
    expect(terbilang(10n)).toBe("sepuluh");
    expect(terbilang(11n)).toBe("sebelas");
  });

  test("spells the teens as '<unit> belas'", () => {
    expect(terbilang(12n)).toBe("dua belas");
    expect(terbilang(19n)).toBe("sembilan belas");
  });

  test("spells the tens, with and without a remainder", () => {
    expect(terbilang(20n)).toBe("dua puluh");
    expect(terbilang(21n)).toBe("dua puluh satu");
    expect(terbilang(99n)).toBe("sembilan puluh sembilan");
  });

  test("contracts a leading one hundred to 'seratus'", () => {
    expect(terbilang(100n)).toBe("seratus");
    expect(terbilang(101n)).toBe("seratus satu");
    expect(terbilang(150n)).toBe("seratus lima puluh");
    expect(terbilang(200n)).toBe("dua ratus");
  });

  test("contracts a leading one thousand to 'seribu'", () => {
    expect(terbilang(1_000n)).toBe("seribu");
    expect(terbilang(1_500n)).toBe("seribu lima ratus");
  });

  test("does NOT contract a leading one at higher scales", () => {
    // The contraction stops at thousands: "sejuta" exists colloquially but
    // "satu juta" is what a receipt prints.
    expect(terbilang(1_000_000n)).toBe("satu juta");
    expect(terbilang(1_000_000_000n)).toBe("satu miliar");
  });

  test("drops empty thousands groups instead of printing zeros", () => {
    expect(terbilang(1_000_000n + 5n)).toBe("satu juta lima");
    expect(terbilang(2_000_050n)).toBe("dua juta lima puluh");
  });

  test("spells the donation presets the checkout screen offers", () => {
    expect(terbilang(25_000n)).toBe("dua puluh lima ribu");
    expect(terbilang(50_000n)).toBe("lima puluh ribu");
    expect(terbilang(100_000n)).toBe("seratus ribu");
    expect(terbilang(250_000n)).toBe("dua ratus lima puluh ribu");
  });

  test("spells the platform's donation bounds", () => {
    expect(terbilang(10_000n)).toBe("sepuluh ribu");
    expect(terbilang(500_000_000n)).toBe("lima ratus juta");
  });

  test("spells across every scale at once", () => {
    expect(terbilang(1_234_567_891n)).toBe(
      "satu miliar dua ratus tiga puluh empat juta lima ratus enam puluh tujuh ribu delapan ratus sembilan puluh satu",
    );
  });

  test("reaches trillions", () => {
    expect(terbilang(1_000_000_000_000n)).toBe("satu triliun");
  });

  test("refuses a negative amount rather than inventing a spelling", () => {
    expect(() => terbilang(-1n)).toThrow(/negative/);
  });

  test("refuses an amount past the supported range", () => {
    // Silently printing a wrong receipt is the worst possible outcome here.
    expect(() => terbilang(1_000_000_000_000_000n)).toThrow(/supported range/);
    expect(terbilang(999_999_999_999_999n)).toContain("triliun");
  });
});

describe("terbilangRupiah", () => {
  test("appends the currency word", () => {
    expect(terbilangRupiah(50_000n)).toBe("lima puluh ribu rupiah");
  });
});
