type Track = "medical" | "non_medical";

const MEDICAL_QUESTIONS = [
  "Sejak kapan kondisi ini dialami?",
  "Apa diagnosis atau kondisi medis yang dihadapi?",
  "Tindakan medis apa yang sudah dilakukan sejauh ini?",
  "Mengapa bantuan ini dibutuhkan sekarang?",
  "Bagaimana dana yang terkumpul akan digunakan?",
  "Apa harapan Anda untuk pasien ke depannya?",
] as const;

const NON_MEDICAL_QUESTIONS = [
  "Apa latar belakang atau situasi yang mendasari penggalangan dana ini?",
  "Siapa yang akan menerima manfaat dari dana ini?",
  "Apa dampak yang diharapkan dari campaign ini?",
  "Bagaimana dana akan digunakan secara rinci?",
  "Apakah ada upaya lain yang sudah dilakukan sebelumnya?",
  "Mengapa bantuan ini mendesak?",
  "Apa harapan Anda untuk keberlanjutan setelah campaign ini selesai?",
] as const;

export function getGuidedQuestions(track: Track): readonly string[] {
  return track === "medical" ? MEDICAL_QUESTIONS : NON_MEDICAL_QUESTIONS;
}
