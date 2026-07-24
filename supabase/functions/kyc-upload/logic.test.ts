import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  detectKycImage,
  parseKycUploadFields,
} from "./logic.ts";

Deno.test("detectKycImage accepts matching JPEG, PNG, and WebP signatures", () => {
  assertEquals(
    detectKycImage(
      new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
      "image/jpeg",
    ),
    { contentType: "image/jpeg", extension: "jpg" },
  );
  assertEquals(
    detectKycImage(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      "image/png",
    ),
    { contentType: "image/png", extension: "png" },
  );
  assertEquals(
    detectKycImage(
      new Uint8Array([
        0x52,
        0x49,
        0x46,
        0x46,
        0x00,
        0x00,
        0x00,
        0x00,
        0x57,
        0x45,
        0x42,
        0x50,
      ]),
      "image/webp",
    ),
    { contentType: "image/webp", extension: "webp" },
  );
});

Deno.test("detectKycImage rejects a spoofed declared MIME type", () => {
  assertThrows(
    () =>
      detectKycImage(
        new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
        "image/png",
      ),
    Error,
    "IMAGE_TYPE_MISMATCH",
  );
});

Deno.test("detectKycImage rejects unknown and truncated content", () => {
  assertThrows(
    () => detectKycImage(new Uint8Array([0x3c, 0x68, 0x74, 0x6d]), "image/jpeg"),
    Error,
    "UNSUPPORTED_IMAGE_CONTENT",
  );
  assertThrows(
    () => detectKycImage(new Uint8Array(), "image/jpeg"),
    Error,
    "UNSUPPORTED_IMAGE_CONTENT",
  );
});

Deno.test("parseKycUploadFields accepts only the required role document sets", () => {
  const subjectId = crypto.randomUUID();
  assertEquals(
    parseKycUploadFields("driver", "national_id", subjectId),
    {
      subjectType: "driver",
      docType: "national_id",
      subjectId,
    },
  );
});

Deno.test("parseKycUploadFields rejects cross-role and malformed identifiers", () => {
  assertThrows(
    () => parseKycUploadFields("driver", "tax_card", crypto.randomUUID()),
    Error,
    "INVALID_DOCUMENT_TYPE",
  );
  assertThrows(
    () => parseKycUploadFields("restaurant", "food_license", "not-a-uuid"),
    Error,
    "INVALID_SUBJECT_ID",
  );
});
