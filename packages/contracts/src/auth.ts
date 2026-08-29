import { FormatRegistry, type Static, Type } from "@sinclair/typebox";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Registered once, at module load, so every schema in this file (and any
// other route later bound with these same format strings) validates
// correctly rather than silently rejecting every payload. Pragmatic
// validators, not full RFC 5322/4122 compliance -- sufficient for this
// platform's actual inputs (a browser's own <input type="email">
// validation and Postgres's uuid column type are the other two layers
// this data passes through).
FormatRegistry.Set("email", (value) => EMAIL_RE.test(value));
FormatRegistry.Set("uuid", (value) => UUID_RE.test(value));

export const UserSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  phone: Type.Union([Type.String(), Type.Null()]),
  email: Type.Union([Type.String(), Type.Null()]),
  name: Type.Union([Type.String(), Type.Null()]),
  avatarUrl: Type.Union([Type.String(), Type.Null()]),
});
export type UserResponse = Static<typeof UserSchema>;

export const AuthSuccessSchema = Type.Object({
  user: UserSchema,
});
export type AuthSuccessResponse = Static<typeof AuthSuccessSchema>;

export const OtpRequestBodySchema = Type.Object({
  phone: Type.String({ minLength: 8 }),
});

export const OtpVerifyBodySchema = Type.Object({
  phone: Type.String({ minLength: 8 }),
  code: Type.String({ minLength: 6, maxLength: 6 }),
});

export const RegisterBodySchema = Type.Object({
  email: Type.String({ format: "email" }),
  password: Type.String({ minLength: 8 }),
  name: Type.Optional(Type.String()),
});

export const LoginBodySchema = Type.Object({
  email: Type.String({ format: "email" }),
  password: Type.String({ minLength: 1 }),
});

export const AuthErrorSchema = Type.Object({
  error: Type.String(),
});
