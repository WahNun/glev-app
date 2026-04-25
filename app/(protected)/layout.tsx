import Layout from "@/components/Layout";
import CgmAutoFillProvider from "@/components/CgmAutoFillProvider";
import CgmJobsTicker from "@/components/CgmJobsTicker";

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <Layout>
      <CgmAutoFillProvider />
      <CgmJobsTicker />
      {children}
    </Layout>
  );
}
