#!/usr/bin/env node
// Swap the build attached to the editable App Store version, then verify.
// Uses the ASC v1 API (PATCH appStoreVersions/{id}/relationships/build).
//
// Usage: node asc-attach-build.mjs <epoch> <buildVersionNumber>
//   epoch  -> shell `date +%s` (Node sandbox lacks a reliable clock)
//   buildVersionNumber -> e.g. "15"
//
// Safe: only attaches an already-VALID build to the version that is in
// PREPARE_FOR_SUBMISSION. Does NOT submit.

import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";

const KEY_ID = "C4TFQQ5AAD";
const ISSUER_ID = "d19fd03e-1f5b-44b1-a3e9-519b25a39274";
const APP_ID = "6776864451";
const VERSION_ID = "55130c89-79d2-464d-8f07-0f94ad1181cd";
const KEY_PATH = new URL("../credentials/AuthKey_C4TFQQ5AAD.p8", import.meta.url);

const iat = parseInt(process.argv[2], 10);
const wantVersion = process.argv[3];
if (!Number.isFinite(iat) || !wantVersion) {
  console.error("Usage: node asc-attach-build.mjs <epoch> <buildVersionNumber>");
  process.exit(2);
}
const exp = iat + 60 * 15;

const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

function makeJwt() {
  const header = { alg: "ES256", kid: KEY_ID, typ: "JWT" };
  const payload = { iss: ISSUER_ID, iat, exp, aud: "appstoreconnect-v1" };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signer = createSign("SHA256");
  signer.update(input);
  signer.end();
  const sig = signer.sign({ key: readFileSync(KEY_PATH, "utf8"), dsaEncoding: "ieee-p1363" });
  return `${input}.${b64url(sig)}`;
}

const JWT = makeJwt();
const BASE = "https://api.appstoreconnect.apple.com/v1";

async function api(path, method = "GET", body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${JWT}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${method} ${path}\n${text.slice(0, 600)}`);
  return text ? JSON.parse(text) : {};
}

async function main() {
  // 1. Find the build id for the requested version number
  const builds = await api(
    `/builds?filter[app]=${APP_ID}&filter[version]=${wantVersion}&limit=1&fields[builds]=version,processingState`
  );
  if (!builds.data.length) throw new Error(`No build with version ${wantVersion} found`);
  const build = builds.data[0];
  if (build.attributes.processingState !== "VALID") {
    throw new Error(`Build ${wantVersion} is ${build.attributes.processingState}, not VALID — cannot attach yet`);
  }
  console.log(`Build ${wantVersion} -> id ${build.id} (VALID)`);

  // 2. Attach it to the version (PATCH relationship)
  await api(`/appStoreVersions/${VERSION_ID}/relationships/build`, "PATCH", {
    data: { type: "builds", id: build.id },
  });
  console.log(`Attached build ${wantVersion} to version ${VERSION_ID}`);

  // 3. Verify
  const check = await api(
    `/appStoreVersions/${VERSION_ID}?include=build&fields[appStoreVersions]=versionString,appStoreState`
  );
  const attached = check.included?.find((i) => i.type === "builds");
  console.log(
    `VERIFY: v${check.data.attributes.versionString} state=${check.data.attributes.appStoreState} attachedBuild=${attached ? attached.attributes.version : "(none)"}`
  );
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
