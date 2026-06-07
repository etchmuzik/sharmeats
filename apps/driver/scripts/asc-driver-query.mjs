#!/usr/bin/env node
// Read-only ASC query for the DRIVER app — focus on build icon assets.
// Driver app id 6777379638, bundle eg.sharmeats.driver.
// Uses the shared ASC .p8 key (account-scoped). Pass epoch as argv[2].

import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";

const KEY_ID = "C4TFQQ5AAD";
const ISSUER_ID = "d19fd03e-1f5b-44b1-a3e9-519b25a39274";
const APP_ID = "6777379638"; // DRIVER
// Shared key lives in the customer app's credentials dir + ~/.appstoreconnect
const KEY_PATH = new URL(
  "../../customer/credentials/AuthKey_C4TFQQ5AAD.p8",
  import.meta.url
);

const iat = parseInt(process.argv[2], 10);
if (!Number.isFinite(iat)) { console.error("pass epoch argv[2]"); process.exit(2); }
const exp = iat + 60 * 15;
const b64 = (b) => Buffer.from(b).toString("base64").replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
const jwt = (() => {
  const h = b64(JSON.stringify({ alg:"ES256", kid:KEY_ID, typ:"JWT" }));
  const p = b64(JSON.stringify({ iss:ISSUER_ID, iat, exp, aud:"appstoreconnect-v1" }));
  const s = createSign("SHA256"); s.update(`${h}.${p}`); s.end();
  return `${h}.${p}.${b64(s.sign({ key: readFileSync(KEY_PATH,"utf8"), dsaEncoding:"ieee-p1363" }))}`;
})();
const BASE = "https://api.appstoreconnect.apple.com/v1";
const api = async (path) => {
  const r = await fetch(`${BASE}${path}`, { headers: { Authorization:`Bearer ${jwt}` } });
  if (!r.ok) throw new Error(`${r.status} ${path}\n${(await r.text()).slice(0,400)}`);
  return r.json();
};

(async () => {
  console.log("=== DRIVER builds + icon assets ===");
  // iconAssetToken tells us if ASC extracted an icon from the binary
  const builds = await api(`/builds?filter[app]=${APP_ID}&sort=-version&limit=5&fields[builds]=version,processingState,uploadedDate,iconAssetToken`);
  for (const b of builds.data) {
    const a = b.attributes;
    const hasIcon = a.iconAssetToken ? `YES (${a.iconAssetToken.templateUrl ? "templateUrl present" : "token present"})` : "NO ICON";
    console.log(`build ${a.version}  state=${a.processingState}  uploaded=${(a.uploadedDate||"").slice(0,19)}  icon=${hasIcon}`);
  }

  console.log("\n=== DRIVER app store versions (public submission?) ===");
  const v = await api(`/apps/${APP_ID}/appStoreVersions?limit=3&fields[appStoreVersions]=versionString,appStoreState,createdDate`);
  if (!v.data.length) console.log("  (none — app has NEVER been submitted to the public App Store; TestFlight only)");
  for (const vv of v.data) console.log(`  v${vv.attributes.versionString} state=${vv.attributes.appStoreState}`);

  console.log("\n=== DRIVER app info (marketing 1024 icon / name) ===");
  const app = await api(`/apps/${APP_ID}?fields[apps]=name,bundleId,sku`);
  console.log(`  name=${app.data.attributes.name}  bundleId=${app.data.attributes.bundleId}  sku=${app.data.attributes.sku}`);
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
