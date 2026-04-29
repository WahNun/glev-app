import Layout from "@/components/Layout";
import CgmAutoFillProvider from "@/components/CgmAutoFillProvider";
import CgmJobsTicker from "@/components/CgmJobsTicker";
import LanguageSync from "@/components/LanguageSync";
import PostMealPrompt from "@/components/PostMealPrompt";

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <Layout>
      <LanguageSync />
      <CgmAutoFillProvider />
      <CgmJobsTicker />
      {children}
      <PostMealPrompt />
    </Layout>
  );
}
