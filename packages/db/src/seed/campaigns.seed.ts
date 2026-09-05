export interface CampaignSeedRow {
  slug: string;
  title: string;
  shortDescription: string;
  story: string;
  coverMediaUrl: string;
  categorySlug: string;
  campaignerName: string;
  model: "goal" | "program";
  goalAmount: bigint | null;
  expiresAt: Date | null;
  collectedAmount: bigint;
  disbursedAmount: bigint;
  donationCount: number;
}

// expiresAt values are computed relative to a fixed reference date rather
// than `new Date()` so this file's own describe-what-you-see comments
// ("closes in ~3 weeks") stay accurate regardless of when `bun run
// db:seed` actually runs -- see run-seed.ts for how these get finalized.
const DAY_MS = 24 * 60 * 60 * 1000;

export const CAMPAIGN_SEED_DATA: CampaignSeedRow[] = [
  {
    slug: "bantu-korban-banjir-bandang-kalimantan-selatan",
    title: "Bantu Korban Banjir Bandang di Kalimantan Selatan",
    shortDescription:
      "Ratusan keluarga kehilangan tempat tinggal akibat banjir bandang. Bantu mereka mendapatkan kebutuhan darurat.",
    story:
      "Banjir bandang yang melanda beberapa desa di Kalimantan Selatan telah memaksa ratusan keluarga mengungsi. Dana yang terkumpul akan disalurkan untuk logistik darurat, tempat tinggal sementara, dan kebutuhan sanitasi bagi para pengungsi.",
    coverMediaUrl: "campaigns/covers/banjir-kalimantan-selatan.47344aab.jpg",
    categorySlug: "bencana-alam",
    campaignerName: "Yayasan Peduli Sesama",
    model: "goal",
    goalAmount: 500_000_000n,
    expiresAt: new Date(Date.now() + 21 * DAY_MS), // closes in ~3 weeks
    collectedAmount: 312_500_000n,
    disbursedAmount: 0n,
    donationCount: 1284,
  },
  {
    slug: "uluran-tangan-untuk-aldi-kelainan-jantung",
    title: "Uluran Tangan untuk Aldi, Balita Penderita Kelainan Jantung Bawaan",
    shortDescription:
      "Aldi (2 tahun) membutuhkan operasi jantung segera. Keluarganya tidak mampu menanggung biaya operasi.",
    story:
      "Aldi didiagnosis kelainan jantung bawaan sejak lahir dan membutuhkan tindakan operasi secepatnya. Biaya yang dibutuhkan jauh di luar kemampuan keluarganya. Setiap donasi akan langsung disalurkan ke rumah sakit tempat Aldi dirawat.",
    coverMediaUrl: "campaigns/covers/aldi-kelainan-jantung.85328047.jpg",
    categorySlug: "balita-anak-sakit",
    campaignerName: "Rina Wijaya",
    model: "goal",
    goalAmount: 250_000_000n,
    expiresAt: new Date(Date.now() + 45 * DAY_MS),
    collectedAmount: 74_800_000n,
    disbursedAmount: 0n,
    donationCount: 512,
  },
  {
    slug: "renovasi-musala-al-ikhlas",
    title: "Renovasi Musala Al-Ikhlas yang Rusak Parah",
    shortDescription:
      "Atap musala bocor dan lantai retak sejak lama. Warga sekitar ingin merenovasinya agar layak dipakai kembali.",
    story:
      "Musala Al-Ikhlas telah berdiri lebih dari 20 tahun dan menjadi pusat kegiatan ibadah warga sekitar. Kondisinya kini memprihatinkan: atap bocor saat hujan dan lantai mulai retak. Dana akan digunakan untuk perbaikan atap, lantai, dan fasilitas wudu.",
    coverMediaUrl: "campaigns/covers/renovasi-musala-al-ikhlas.9724e66a.jpg",
    categorySlug: "rumah-ibadah",
    campaignerName: "Budi Santoso",
    model: "goal",
    goalAmount: 80_000_000n,
    expiresAt: new Date(Date.now() + 14 * DAY_MS),
    collectedAmount: 71_200_000n,
    disbursedAmount: 0n,
    donationCount: 340,
  },
  {
    slug: "program-amil-zakat-mitra",
    title: "Dana Zakat untuk Program Amil Mitra FundForIndonesia",
    shortDescription:
      "Salurkan zakat Anda melalui amil mitra terpercaya untuk didistribusikan kepada mustahik secara berkelanjutan.",
    story:
      "Program ini menghimpun zakat dari para donatur dan menyalurkannya secara berkelanjutan kepada delapan asnaf melalui jaringan amil mitra. Karena sifatnya berkelanjutan, program ini tidak memiliki target atau tenggat waktu -- dana yang tersedia langsung disalurkan sesuai kebutuhan mustahik yang terverifikasi.",
    coverMediaUrl: "campaigns/covers/program-amil-zakat-mitra.15f20114.jpg",
    categorySlug: "zakat",
    campaignerName: "FundForIndonesia Program Mitra",
    model: "program",
    goalAmount: null,
    expiresAt: null,
    collectedAmount: 1_820_400_000n,
    disbursedAmount: 1_650_000_000n,
    donationCount: 6210,
  },
  {
    slug: "wakaf-produktif-sumur-bor-desa-kering",
    title: "Wakaf Produktif: Sumur Bor untuk Desa yang Kekeringan",
    shortDescription:
      "Bangun sumur bor wakaf untuk desa yang setiap musim kemarau kesulitan air bersih.",
    story:
      "Setiap musim kemarau, warga desa ini harus berjalan berkilo-kilometer untuk mendapatkan air bersih. Wakaf sumur bor ini akan memberikan akses air bersih jangka panjang bagi ratusan keluarga, dan hasilnya dapat dirasakan turun-temurun.",
    coverMediaUrl: "campaigns/covers/wakaf-sumur-bor.aa962d7e.jpg",
    categorySlug: "wakaf",
    campaignerName: "Yayasan Bina Umat Sejahtera",
    model: "goal",
    goalAmount: 120_000_000n,
    expiresAt: new Date(Date.now() + 30 * DAY_MS),
    collectedAmount: 54_000_000n,
    disbursedAmount: 0n,
    donationCount: 198,
  },
  {
    slug: "bantu-panti-asuhan-kasih-bunda",
    title: "Bantu Panti Asuhan Kasih Bunda Penuhi Kebutuhan Harian",
    shortDescription:
      "Dukung kebutuhan harian 34 anak di Panti Asuhan Kasih Bunda secara berkelanjutan.",
    story:
      "Panti Asuhan Kasih Bunda menampung 34 anak dari berbagai latar belakang. Program ini menghimpun donasi rutin untuk kebutuhan sehari-hari: makan, pendidikan, dan kesehatan. Karena kebutuhannya berkelanjutan, program ini tidak memiliki target akhir -- dana yang tersedia langsung digunakan untuk operasional panti.",
    coverMediaUrl: "campaigns/covers/panti-asuhan-kasih-bunda.c3761293.jpg",
    categorySlug: "panti-asuhan",
    campaignerName: "Yayasan Peduli Sesama",
    model: "program",
    goalAmount: null,
    expiresAt: null,
    collectedAmount: 425_600_000n,
    disbursedAmount: 398_000_000n,
    donationCount: 3021,
  },
  {
    slug: "beasiswa-anak-yatim-berprestasi",
    title: "Beasiswa Pendidikan untuk Anak Yatim Berprestasi",
    shortDescription:
      "Bantu anak-anak yatim berprestasi melanjutkan pendidikan mereka tanpa terbebani biaya sekolah.",
    story:
      "Banyak anak yatim berprestasi terpaksa putus sekolah karena keterbatasan biaya. Program beasiswa ini menanggung biaya pendidikan bagi 20 anak terpilih selama satu tahun ajaran penuh, mulai dari SPP hingga perlengkapan sekolah.",
    coverMediaUrl: "campaigns/covers/beasiswa-anak-yatim.7db6cc00.jpg",
    categorySlug: "beasiswa-pendidikan",
    campaignerName: "Rina Wijaya",
    model: "goal",
    goalAmount: 150_000_000n,
    expiresAt: new Date(Date.now() + 60 * DAY_MS),
    collectedAmount: 22_100_000n,
    disbursedAmount: 0n,
    donationCount: 89,
  },
  {
    slug: "pengobatan-darurat-nenek-sari",
    title: "Pengobatan Darurat untuk Nenek Sari, Lansia Tanpa Keluarga",
    shortDescription:
      "Nenek Sari (78) membutuhkan perawatan intensif namun tidak memiliki keluarga yang dapat membantu.",
    story:
      "Nenek Sari tinggal sendiri dan didiagnosis membutuhkan perawatan intensif. Tanpa keluarga yang dapat membantu membiayai pengobatannya, warga sekitar berinisiatif menggalang dana untuk memastikan beliau mendapat perawatan yang layak.",
    coverMediaUrl: "campaigns/covers/nenek-sari-pengobatan.54344116.jpg",
    categorySlug: "bantuan-medis",
    campaignerName: "Budi Santoso",
    model: "goal",
    goalAmount: 60_000_000n,
    expiresAt: new Date(Date.now() + 5 * DAY_MS),
    collectedAmount: 57_300_000n,
    disbursedAmount: 0n,
    donationCount: 421,
  },
];
