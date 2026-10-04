/**
 * lib/pin.ts — Hash & verifikasi PIN staf (SERVER ONLY).
 *
 * Memakai scrypt bawaan Node (tanpa dependency baru).
 * Format tersimpan: scrypt$<saltHex>$<hashHex>
 */

import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

export const PIN_REGEX = /^\d{4,6}$/;
export const PIN_MAX_ATTEMPTS = 5;
export const PIN_LOCK_MINUTES = 5;

export function isValidPin(pin: unknown): pin is string {
  return typeof pin === "string" && PIN_REGEX.test(pin);
}

export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, 32);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(pin, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(expected, actual);
}
