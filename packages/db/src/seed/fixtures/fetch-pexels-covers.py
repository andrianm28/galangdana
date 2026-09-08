#!/usr/bin/env python3
"""
Fetches the seeded campaign cover photographs from Pexels into ./covers/.

RELATIONSHIP TO generate-cover-placeholders.py
----------------------------------------------
That script drew labelled placeholder cards, for the reason its own docstring
gives: an unrelated photograph of real people attached to a fabricated appeal is
worse than no photograph, on a platform whose premise is that donors can trust
what they are shown. It also said what should happen next:

    "Replace an individual file here with a real, rights-cleared photograph as
     soon as a campaign becomes real -- the seed script picks up whatever bytes
     are on disk."

This script is that replacement step, with one caveat kept deliberately in view:
the eight seeded campaigns are still fixtures, not real appeals. So the original
concern has not gone away, it has only been narrowed, and two rules follow from
it. Both are load-bearing -- do not quietly drop either one when adding a cover.

1. NO PHOTOGRAPH WHOSE SUBJECT IS AN IDENTIFIABLE PERSON PRESENTED AS THE
   BENEFICIARY. Every image here is a situation or a place: floodwater over a
   village, an empty ward, a well, a classroom, a dormitory. Where a person
   appears they are mid-activity and incidental, never a portrait standing in
   for "Nenek Sari" or "Aldi", who do not exist. Candidate photos of children's
   faces were rejected on exactly this ground.

2. EVERY IMAGE CARRIES A BAKED-IN "FOTO ILUSTRASI" MARK. The placeholders said
   "CONTOH - DATA DEMO" in their own pixels, so the disclosure travelled with the
   file into any surface that rendered it -- card, OG image, scraped copy. A
   caption in one component would not have survived that trip. The mark is
   burned in here for the same reason.

LICENCE
-------
Pexels licence: free for commercial and personal use, no attribution required,
no permission needed. Attribution is recorded in COVER-CREDITS.md anyway --
crediting a photographer costs nothing and the provenance of every image on a
donation site should be answerable.

Deterministic in naming (content hash), but NOT byte-reproducible: Pexels may
re-encode, and Pillow versions differ. Treat regeneration as a local, committed
step. Re-run only when changing the selection; the committed JPEGs are the
source of truth for CI, which never runs this.

Run:   python3 fetch-pexels-covers.py
Needs: Pillow, network access to images.pexels.com
"""

import hashlib
import urllib.request
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 900  # 4:3 -- the aspect CampaignCard renders
QUALITY = 82

FONT_DIR = Path("/usr/share/fonts/truetype/dejavu")
MONO_BOLD = FONT_DIR / "DejaVuSansMono-Bold.ttf"
MONO = FONT_DIR / "DejaVuSansMono.ttf"

# base name -> (pexels photo id, photographer, what it shows)
#
# Keys match campaigns.seed.ts's coverMediaUrl base names exactly.
# seed-covers.test.ts asserts that correspondence in both directions.
COVERS: dict[str, tuple[int, str, str]] = {
    "banjir-kalimantan-selatan": (
        6471946,
        "Pok Rie",
        "aerial view of a flooded village, water over the roads between houses",
    ),
    "aldi-kelainan-jantung": (
        5049242,
        "Pixabay",
        "an empty, made-up hospital bed in a clean treatment room",
    ),
    # Chosen over a visually cleaner rural mosque that turned out to be an
    # Anatolian winter scene -- bare trees and hills under a campaign called
    # "Musala Al-Ikhlas" read as obviously borrowed. This one is unmistakably a
    # kampung musala: tiered tajug roof, loudspeaker horns, tiled roofs around.
    "renovasi-musala-al-ikhlas": (
        34511486,
        "Fahmi Fakhrudin",
        "a modest neighbourhood musala with a tiered roof among tiled house roofs",
    ),
    "pangan-keluarga-prasejahtera": (
        6994946,
        "Julia M Cameron",
        "packaged staple food and bottled water sorted for distribution",
    ),
    "sumur-bor-desa-kering": (
        11795987,
        "Sanjay Rai",
        "drawing water from a village well into containers",
    ),
    "panti-asuhan-kasih-bunda": (
        35165103,
        "Kaan Demircan",
        "a warm, lived-in dormitory of wooden bunk beds",
    ),
    "beasiswa-anak-yatim": (
        12168815,
        "Max Fischer",
        "an empty classroom of desks and chairs",
    ),
    "nenek-sari-pengobatan": (
        8589764,
        "Kampus Production",
        "the hands of an older person resting on a blanket",
    ),
}

MARK = "FOTO ILUSTRASI"


def cover_crop(im: Image.Image) -> Image.Image:
    """Scale to cover W x H, then centre-crop. Never letterboxes, never squashes."""
    scale = max(W / im.width, H / im.height)
    im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
    left, top = (im.width - W) // 2, (im.height - H) // 2
    return im.crop((left, top, left + W, top + H))


def stamp(im: Image.Image) -> Image.Image:
    """Burn the disclosure into the pixels -- see rule 2 in the module docstring.

    Drawn onto a translucent dark pill so it stays legible over a bright sky and
    over a dark interior alike, rather than tuning per image.
    """
    im = im.convert("RGBA")
    layer = Image.new("RGBA", im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    f = ImageFont.truetype(str(MONO_BOLD if MONO_BOLD.exists() else MONO), 26)

    pad_x, pad_y, margin = 18, 11, 28
    tb = d.textbbox((0, 0), MARK, font=f)
    tw, th = tb[2] - tb[0], tb[3] - tb[1]
    x1, y1 = W - margin, H - margin
    x0, y0 = x1 - (tw + 2 * pad_x), y1 - (th + 2 * pad_y)

    d.rounded_rectangle([x0, y0, x1, y1], radius=(y1 - y0) // 2, fill=(16, 20, 27, 168))
    d.text((x0 + pad_x - tb[0], y0 + pad_y - tb[1]), MARK, font=f, fill=(255, 255, 255, 235))

    return Image.alpha_composite(im, layer).convert("RGB")


def main() -> None:
    out_dir = Path(__file__).parent / "covers"
    out_dir.mkdir(exist_ok=True)
    credits: list[str] = []

    for base, (pid, photographer,description) in COVERS.items():
        url = (
            f"https://images.pexels.com/photos/{pid}/pexels-photo-{pid}.jpeg"
            "?auto=compress&cs=tinysrgb&w=1600"
        )
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        raw = urllib.request.urlopen(req, timeout=60).read()

        im = stamp(cover_crop(Image.open(BytesIO(raw)).convert("RGB")))

        buf = BytesIO()
        im.save(buf, "JPEG", quality=QUALITY, optimize=True, progressive=True)
        data = buf.getvalue()
        digest = hashlib.sha256(data).hexdigest()[:8]

        # Drop older hashes of THIS base name only. A base that has been renamed
        # out of COVERS is not matched by this glob and must be git rm'd by hand
        # -- the same trap that once shipped a cover reading "ZAKAT" under a
        # renamed campaign.
        for stale in out_dir.glob(f"{base}.*.jpg"):
            stale.unlink()

        path = out_dir / f"{base}.{digest}.jpg"
        path.write_bytes(data)
        print(f'  coverMediaUrl: "campaigns/covers/{path.name}",  ({len(data) // 1024} KB)')

        credits.append(
            f"- **{path.name}** — [Pexels #{pid}]"
            f"(https://www.pexels.com/photo/{pid}/) by {photographer} — {description}"
        )

    # Deliberately written OUTSIDE covers/. seed-covers.test.ts asserts that
    # every file in that directory is referenced by a seed row -- a strict
    # invariant worth keeping strict, rather than loosening it to a *.jpg filter
    # so a docs file can sit alongside the images.
    (out_dir.parent / "COVER-CREDITS.md").write_text(
        "# Cover photo credits\n\n"
        "Fetched by `fetch-pexels-covers.py`. Pexels licence: free for "
        "commercial use, no attribution required — recorded here anyway, because "
        "the provenance of every image on a donation site should be answerable.\n\n"
        "Every file carries a baked-in `FOTO ILUSTRASI` mark: these eight "
        "campaigns are seed fixtures, not real appeals.\n\n" + "\n".join(credits) + "\n"
    )
    print(f"\nWrote {len(COVERS)} covers into {out_dir}\nWrote COVER-CREDITS.md into {out_dir.parent}")


if __name__ == "__main__":
    main()
