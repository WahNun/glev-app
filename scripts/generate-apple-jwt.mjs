import appleSigninAuth from "apple-signin-auth";
import fs from "fs";
import os from "os";
import path from "path";

const KEY_ID = "5YK68D8NRN";

function findP8(dir) {
  try {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, item.name);
      if (item.isDirectory()) {
        const r = findP8(p);
        if (r) return r;
      } else if (item.name.endsWith(".p8") && item.name.includes(KEY_ID)) {
        return p;
      }
    }
  } catch {}
  return null;
}

const p8Path = findP8(path.join(os.homedir(), "Documents", "Glev"));
if (!p8Path) {
  console.error("No .p8 with", KEY_ID, "found under ~/Documents/Glev");
  process.exit(1);
}
console.error("Using:", p8Path);

const privateKey = fs.readFileSync(p8Path, "utf8");
const clientSecret = appleSigninAuth.getClientSecret({
  clientID: "com.glev.app",
  teamID: "WD7WPDLG2S",
  keyIdentifier: KEY_ID,
  privateKey,
  expAfter: 15552000,
});
console.log(clientSecret);
