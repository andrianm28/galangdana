import type { NewCampaignCategory } from "../schema/categories";

// zakat (27), wakaf (45), masjid-berdaya (48) and wakafproduktif (49) were
// cut from the product (zakat/wakaf are regulated functions this platform
// does not perform -- see the fixture note in campaigns.seed.ts) and are
// archived via isActive: false, not deleted. They stay in this list, and in
// the database, as historical FK targets: existing rows (including any
// production campaign that predates the cut) keep resolving their
// categoryId join instead of pointing at nothing. Do not remove these
// entries or reassign their ids.
export const CATEGORY_SEED_DATA: NewCampaignCategory[] = [
  { id: 22, slug: "bencana-alam", title: "Bencana Alam", isFavorite: true },
  { id: 8, slug: "balita-anak-sakit", title: "Balita & Anak Sakit", isFavorite: true },
  { id: 9, slug: "bantuan-medis", title: "Bantuan Medis & Kesehatan", isFavorite: true },
  { id: 42, slug: "kemanusiaan", title: "Kemanusiaan", isFavorite: false },
  { id: 23, slug: "rumah-ibadah", title: "Rumah Ibadah", isFavorite: false },
  { id: 7, slug: "kegiatan-sosial", title: "Kegiatan Sosial", isFavorite: false },
  { id: 27, slug: "zakat", title: "Zakat", isFavorite: true, isActive: false },
  { id: 5, slug: "beasiswa-pendidikan", title: "Bantuan Pendidikan", isFavorite: false },
  { id: 11, slug: "infrastruktur", title: "Infrastruktur Umum", isFavorite: false },
  { id: 28, slug: "panti-asuhan", title: "Panti Asuhan", isFavorite: false },
  { id: 24, slug: "difabel", title: "Difabel", isFavorite: false },
  { id: 19, slug: "hewan", title: "Menolong Hewan", isFavorite: false },
  { id: 13, slug: "karya-kreatif", title: "Karya Kreatif & Modal Usaha", isFavorite: false },
  { id: 6, slug: "lingkungan", title: "Lingkungan", isFavorite: false },
  { id: 45, slug: "wakaf", title: "Wakaf", isFavorite: false, isActive: false },
  { id: 48, slug: "masjid-berdaya", title: "Masjid Berdaya", isFavorite: false, isActive: false },
  {
    id: 49,
    slug: "wakafproduktif",
    title: "Wakaf Produktif",
    isFavorite: false,
    isActive: false,
  },
];
