import Layout from "@/components/Layout";
import { EntriesProvider } from "@/context/EntriesContext";

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <EntriesProvider>
      <Layout>{children}</Layout>
    </EntriesProvider>
  );
}
