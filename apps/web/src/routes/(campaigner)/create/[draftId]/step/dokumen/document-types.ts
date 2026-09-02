type Track = "medical" | "non_medical";
type DocumentType =
  | "kartu_mahasiswa"
  | "kartu_pelajar"
  | "tagihan_rumah_sakit"
  | "tagihan_institusi_pendidikan"
  | "media_sosial"
  | "sumber_gambar"
  | "riwayat_medis";

const MEDICAL_TYPES: Array<{ value: DocumentType; label: string }> = [
  { value: "riwayat_medis", label: "Riwayat medis" },
  { value: "tagihan_rumah_sakit", label: "Tagihan rumah sakit" },
];

const NON_MEDICAL_TYPES: Array<{ value: DocumentType; label: string }> = [
  { value: "kartu_mahasiswa", label: "Kartu mahasiswa" },
  { value: "kartu_pelajar", label: "Kartu pelajar" },
  { value: "tagihan_institusi_pendidikan", label: "Tagihan institusi pendidikan" },
  { value: "media_sosial", label: "Tautan/tangkapan layar media sosial" },
  { value: "sumber_gambar", label: "Sumber gambar" },
];

export function getDocumentTypes(track: Track) {
  return track === "medical" ? MEDICAL_TYPES : NON_MEDICAL_TYPES;
}
