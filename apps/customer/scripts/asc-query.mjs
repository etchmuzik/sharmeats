#!/usr/bin/env node
// Read-only App Store Connect API query helper.
// Signs an ES256 JWT with the ASC .p8 key and reports:
//  - the app's recent builds + processing state
//  - the current App Store version + its state
//  - the App Review details (notes/contact) for the editable version
//
// Node sandbox has no reliable wall clock, so the issued-at epoch is passed
// in as argv[2] (from shell `date +%s`) rather than read via Date.now().

import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";

const KEY_ID = "C4TFQQ5AAD";
const ISSUER_ID = "d19fd03e-1f5b-44b1-a3e9-519b25a39274";
const APP_ID = "6776864451";
const KEY_PATH = new URL("../credentials/AuthKey_C4TFQQ5AAD.p8", import.meta.url);

const iat = parseInt(process.argv[2], 10);
if (!Number.isFinite(iat)) {
  console.error("Pass epoch seconds as argv[2] (shell: date +%s)");
  process.exit(2);
}
const exp = iat + 60 * 15; // 15 min, ASC max is 20

function b64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function makeJwt() {
  const header = { alg: "ES256", kid: KEY_ID, typ: "JWT" };
  const payload = { iss: ISSUER_ID, iat, exp, aud: "appstoreconnect-v1" };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const key = readFileSync(KEY_PATH, "utf8");
  const signer = createSign("SHA256");
  signer.update(signingInput);
  signer.end();
  const sig = signer.sign({ key, dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${b64url(sig)}`;
}

const JWT = makeJwt();
const BASE = "https://api.appstoreconnect.apple.com/v1";

async function api(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${JWT}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${path}\n${body.slice(0, 500)}`);
  }
  return res.json();
}

async function main() {
  console.log("=== RECENT BUILDS (newest first) ===");
  const builds = await api(
    `/builds?filter[app]=${APP_ID}&sort=-version&limit=6&fields[builds]=version,processingState,uploadedDate,expired`
  );
  for (const b of builds.data) {
    const a = b.attributes;
    console.log(
      `build ${a.version}  state=${a.processingState}  uploaded=${(a.uploadedDate || "").slice(0, 19)}  expired=${a.expired}`
    );
  }

  console.log("\n=== APP STORE VERSIONS ===");
  const versions = await api(
    `/apps/${APP_ID}/appStoreVersions?limit=3&fields[appStoreVersions]=versionString,appStoreState,platform&include=build`
  );
  for (const v of versions.data) {
    const a = v.attributes;
    const buildRel = v.relationships?.build?.data;
    console.log(
      `v${a.versionString} [${a.platform}]  state=${a.appStoreState}  build=${buildRel ? buildRel.id : "(none attached)"}  versionId=${v.id}`
    );
  }

  // Resolve attached build numbers for any included builds
  if (versions.included) {
    console.log("\n=== ATTACHED BUILD DETAIL ===");
    for (const inc of versions.included) {
      if (inc.type === "builds") {
        console.log(`  attached build id ${inc.id} = version ${inc.attributes.version} (state ${inc.attributes.processingState})`);
      }
    }
  }
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
