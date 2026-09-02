import { type Static, Type } from "@sinclair/typebox";

export const CampaignDraftTrackSchema = Type.Union([
  Type.Literal("medical"),
  Type.Literal("non_medical"),
]);

export const CreateCampaignDraftBodySchema = Type.Object({
  track: CampaignDraftTrackSchema,
  categoryId: Type.Optional(Type.Number()),
});

export const CampaignDraftSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  track: CampaignDraftTrackSchema,
  categoryId: Type.Union([Type.Number(), Type.Null()]),
  currentStep: Type.String(),
  answers: Type.Record(Type.String(), Type.Unknown()),
  expiresAt: Type.String(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});
export type CampaignDraftResponse = Static<typeof CampaignDraftSchema>;

export const CampaignDraftErrorSchema = Type.Object({ error: Type.String() });

export const SaveDraftAnswersBodySchema = Type.Object({
  step: Type.String(),
  answers: Type.Record(Type.String(), Type.Unknown()),
});

export const StoryQuestionAnswerSchema = Type.Object({
  questionNumber: Type.Number({ minimum: 1 }),
  answerText: Type.String({ minLength: 1 }),
});

export const SaveGuidedStoryBodySchema = Type.Object({
  mode: Type.Literal("guided"),
  answers: Type.Array(StoryQuestionAnswerSchema, { minItems: 1 }),
});

export const SaveManualStoryBodySchema = Type.Object({
  mode: Type.Literal("manual"),
  text: Type.String({ minLength: 1 }),
});

// age/hospitalName/relationshipToCampaigner accept `null` (not just plain
// Optional) so the web client can send an explicit `null` to clear a
// previously-filled field: this endpoint always receives the full current
// form state, and Elysia/TypeBox serialization OMITS `undefined`-valued
// keys from the actual wire body, so `undefined` can never overwrite a
// stale value in `.onConflictDoUpdate({ set: body })` -- only a real,
// present `null` key can. Still `Type.Optional` too so a caller that omits
// the key entirely (never having had a value to clear) remains valid.
export const SavePatientBodySchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  age: Type.Optional(Type.Union([Type.Number({ minimum: 0 }), Type.Null()])),
  illness: Type.String({ minLength: 1 }),
  hospitalName: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  relationshipToCampaigner: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const SaveBeneficiaryBodySchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  relationship: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  needDescription: Type.String({ minLength: 1 }),
});

export const CampaignDocumentTypeSchema = Type.Union([
  Type.Literal("kartu_mahasiswa"),
  Type.Literal("kartu_pelajar"),
  Type.Literal("tagihan_rumah_sakit"),
  Type.Literal("tagihan_institusi_pendidikan"),
  Type.Literal("media_sosial"),
  Type.Literal("sumber_gambar"),
  Type.Literal("riwayat_medis"),
]);

export const PresignDocumentUploadBodySchema = Type.Object({
  type: CampaignDocumentTypeSchema,
  fileName: Type.String({ minLength: 1 }),
});

export const PresignDocumentUploadResponseSchema = Type.Object({
  uploadUrl: Type.String(),
  objectKey: Type.String(),
  expiresInSeconds: Type.Number(),
});

export const ConfirmDocumentUploadBodySchema = Type.Object({
  type: CampaignDocumentTypeSchema,
  objectKey: Type.String({ minLength: 1 }),
});

export const CampaignDocumentSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  type: CampaignDocumentTypeSchema,
  objectKey: Type.String(),
  uploadedAt: Type.String(),
});
export type CampaignDocumentResponse = Static<typeof CampaignDocumentSchema>;

// The full draft-detail response (GET /campaign-drafts/:id and the
// `rangkuman` summary step) aggregates the draft plus every related
// table this plan builds -- present whichever of patient/beneficiary
// applies to the draft's track, null for the other.
export const CampaignDraftDetailSchema = Type.Composite([
  CampaignDraftSchema,
  Type.Object({
    storyAnswers: Type.Array(StoryQuestionAnswerSchema),
    manualStory: Type.Union([Type.String(), Type.Null()]),
    patient: Type.Union([
      Type.Object({
        name: Type.String(),
        age: Type.Union([Type.Number(), Type.Null()]),
        illness: Type.String(),
        hospitalName: Type.Union([Type.String(), Type.Null()]),
        relationshipToCampaigner: Type.Union([Type.String(), Type.Null()]),
      }),
      Type.Null(),
    ]),
    beneficiary: Type.Union([
      Type.Object({
        name: Type.String(),
        relationship: Type.Union([Type.String(), Type.Null()]),
        needDescription: Type.String(),
      }),
      Type.Null(),
    ]),
    documents: Type.Array(CampaignDocumentSchema),
  }),
]);
export type CampaignDraftDetailResponse = Static<typeof CampaignDraftDetailSchema>;
