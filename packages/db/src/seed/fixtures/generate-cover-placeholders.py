#!/usr/bin/env python3
"""
Regenerates the seeded campaign cover placeholders in ./covers/.

WHY THESE ARE PLACEHOLDERS AND NOT PHOTOS
-----------------------------------------
These images previously came from picsum.photos -- i.e. arbitrary stock
photography with no relationship to the campaign it was attached to. That was a
reasonable call when nothing rendered them, but the seeded campaigns are visible
on a public domain, and the result was a snowy European rooftop illustrating
"Pengobatan Darurat untuk Nenek Sari, Lansia Tanpa Keluarga" and a guitar
headstock illustrating a scholarship appeal.

For a platform whose entire premise is that donors can trust what they are shown,
an unrelated photograph of real people attached to a fabricated appeal is worse
than no photograph. So these are deliberately NOT photographs: they are labelled
placeholders that say, in Indonesian, that they are example data. Nobody can
mistake them for a real campaign, and no real person's image is attached to a
fictional case.

Replace an individual file here with a real, rights-cleared photograph as soon as
a campaign becomes real -- the seed script picks up whatever bytes are on disk.

Deterministic: same inputs produce byte-comparable output, so regenerating does
not create spurious diffs.

Run:  python3 generate-cover-placeholders.py
Needs: Pillow  (pip install Pillow)
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# --- Nila & Kertas palette (see docs/brand) --------------------------------
KERTAS = (248, 245, 239)
TINTA = (20, 24, 31)
TINTA_LEMAH = (90, 100, 114)
NILA = (36, 54, 94)
GARIS = (222, 215, 200)
TANDA = (178, 58, 24)

W, H = 1200, 900
MARGIN = 64

FONT_DIR = Path("/usr/share/fonts/truetype/dejavu")
SERIF_BOLD = FONT_DIR / "DejaVuSerif-Bold.ttf"
MONO = FONT_DIR / "DejaVuSansMono.ttf"
MONO_BOLD = FONT_DIR / "DejaVuSansMono-Bold.ttf"

# filename -> (category label, subject label)
COVERS = {
    "banjir-kalimantan-selatan.jpg": ("Bencana Alam", "Banjir Bandang\nKalimantan Selatan"),
    "aldi-kelainan-jantung.jpg": ("Balita & Anak Sakit", "Kelainan Jantung\nBawaan"),
    "renovasi-musala-al-ikhlas.jpg": ("Rumah Ibadah", "Renovasi Musala\nAl-Ikhlas"),
    "program-amil-zakat-mitra.jpg": ("Zakat", "Program Amil\nZakat Mitra"),
    "wakaf-sumur-bor.jpg": ("Wakaf", "Sumur Bor untuk\nDesa Kering"),
    "panti-asuhan-kasih-bunda.jpg": ("Panti Asuhan", "Panti Asuhan\nKasih Bunda"),
    "beasiswa-anak-yatim.jpg": ("Beasiswa Pendidikan", "Beasiswa Anak\nYatim Berprestasi"),
    "nenek-sari-pengobatan.jpg": ("Bantuan Medis", "Pengobatan Darurat\nLansia"),
}


def font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size)


def render(category: str, subject: str) -> Image.Image:
    img = Image.new("RGB", (W, H), KERTAS)
    d = ImageDraw.Draw(img)

    # Hairline grid -- the "built from rules" motif, kept very quiet.
    step = 60
    for x in range(step, W, step):
        d.line([(x, 0), (x, H)], fill=GARIS, width=1)
    for y in range(step, H, step):
        d.line([(0, y), (W, y)], fill=GARIS, width=1)

    # Inset frame.
    d.rectangle([MARGIN, MARGIN, W - MARGIN, H - MARGIN], outline=GARIS, width=2)

    # "CONTOH" chip, top-left inside the frame.
    chip_f = font(MONO_BOLD if MONO_BOLD.exists() else MONO, 24)
    chip_text = "CONTOH · DATA DEMO"
    tb = d.textbbox((0, 0), chip_text, font=chip_f)
    pad_x, pad_y = 18, 12
    cx0, cy0 = MARGIN + 36, MARGIN + 36
    cx1 = cx0 + (tb[2] - tb[0]) + pad_x * 2
    cy1 = cy0 + (tb[3] - tb[1]) + pad_y * 2
    d.rectangle([cx0, cy0, cx1, cy1], fill=KERTAS, outline=TANDA, width=2)
    d.text((cx0 + pad_x - tb[0], cy0 + pad_y - tb[1]), chip_text, font=chip_f, fill=TANDA)

    # Category, small mono, above the subject.
    cat_f = font(MONO, 26)
    cat_y = int(H * 0.46)
    d.text((MARGIN + 36, cat_y), category.upper(), font=cat_f, fill=TINTA_LEMAH)

    # Subject, serif display, the visual anchor.
    sub_f = font(SERIF_BOLD, 64)
    d.multiline_text(
        (MARGIN + 36, cat_y + 48),
        subject,
        font=sub_f,
        fill=NILA,
        spacing=14,
    )

    # Footer rule + note.
    fy = H - MARGIN - 74
    d.line([(MARGIN + 36, fy), (W - MARGIN - 36, fy)], fill=GARIS, width=2)
    note_f = font(MONO, 21)
    d.text(
        (MARGIN + 36, fy + 20),
        "Gambar contoh — bukan foto penerima manfaat",
        font=note_f,
        fill=TINTA_LEMAH,
    )
    return img


def main() -> None:
    out_dir = Path(__file__).parent / "covers"
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, (category, subject) in sorted(COVERS.items()):
        img = render(category, subject)
        img.save(out_dir / name, "JPEG", quality=88, optimize=True, progressive=True)
        print(f"wrote {name}")


if __name__ == "__main__":
    main()
