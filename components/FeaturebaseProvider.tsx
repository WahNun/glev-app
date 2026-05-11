"use client";

import { FeaturebaseProvider as FBProvider } from "featurebase-js/react";
import type { ReactNode } from "react";

const FEATUREBASE_APP_ID = "6a02376b161c3ac09a57c9dd";

export default function FeaturebaseProvider({ children }: { children: ReactNode }) {
  return <FBProvider appId={FEATUREBASE_APP_ID}>{children}</FBProvider>;
}
