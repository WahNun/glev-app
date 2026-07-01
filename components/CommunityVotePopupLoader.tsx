"use client";

import dynamic from "next/dynamic";

const CommunityVotePopup = dynamic(
  () => import("@/components/CommunityVotePopup"),
  { ssr: false },
);

export default function CommunityVotePopupLoader() {
  return <CommunityVotePopup />;
}
