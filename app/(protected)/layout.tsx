import Layout from "@/components/Layout";
import CgmAutoFillProvider from "@/components/CgmAutoFillProvider";
import CgmJobsTicker from "@/components/CgmJobsTicker";
import LanguageSync from "@/components/LanguageSync";

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <Layout>
      <LanguageSync />
      <CgmAutoFillProvider />
      <CgmJobsTicker />
      {children}
    </Layout>
  );
}
