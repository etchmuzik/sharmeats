export const MAX_KYC_FILE_BYTES = 5 * 1024 * 1024;

const DRIVER_DOC_TYPES = new Set([
  "national_id",
  "driving_license",
  "vehicle_reg",
]);
const RESTAURANT_DOC_TYPES = new Set([
  "commercial_reg",
  "tax_card",
  "food_license",
]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type KycSubjectType = "driver" | "restaurant";

export interface KycImageType {
  contentType: "image/jpeg" | "image/png" | "image/webp";
  extension: "jpg" | "png" | "webp";
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

export function detectKycImage(
  bytes: Uint8Array,
  declaredMimeType: string,
): KycImageType {
  let detected: KycImageType | null = null;
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    detected = { contentType: "image/jpeg", extension: "jpg" };
  } else if (
    startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  ) {
    detected = { contentType: "image/png", extension: "png" };
  } else if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    detected = { contentType: "image/webp", extension: "webp" };
  }

  if (!detected) throw new Error("UNSUPPORTED_IMAGE_CONTENT");
  if (declaredMimeType.trim().toLowerCase() !== detected.contentType) {
    throw new Error("IMAGE_TYPE_MISMATCH");
  }
  return detected;
}

export function parseKycUploadFields(
  subjectTypeValue: unknown,
  docTypeValue: unknown,
  subjectIdValue: unknown,
): {
  subjectType: KycSubjectType;
  docType: string;
  subjectId: string;
} {
  if (subjectTypeValue !== "driver" && subjectTypeValue !== "restaurant") {
    throw new Error("INVALID_SUBJECT_TYPE");
  }
  if (
    typeof subjectIdValue !== "string" ||
    !UUID_PATTERN.test(subjectIdValue)
  ) {
    throw new Error("INVALID_SUBJECT_ID");
  }
  if (typeof docTypeValue !== "string") {
    throw new Error("INVALID_DOCUMENT_TYPE");
  }
  const allowed = subjectTypeValue === "driver"
    ? DRIVER_DOC_TYPES
    : RESTAURANT_DOC_TYPES;
  if (!allowed.has(docTypeValue)) throw new Error("INVALID_DOCUMENT_TYPE");
  return {
    subjectType: subjectTypeValue,
    docType: docTypeValue,
    subjectId: subjectIdValue,
  };
}
