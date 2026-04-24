import Layout from "@/components/Layout";
import CgmAutoFillProvider from "@/components/CgmAutoFillProvider";

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <Layout>
      <CgmAutoFillProvider />
      {children}
    </Layout>
  );
}
