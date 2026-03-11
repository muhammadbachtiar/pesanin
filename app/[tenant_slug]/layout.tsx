import { notFound } from "next/navigation";
import { getTenantBySlugServer } from "@/services/tenantServiceServer";

export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenant_slug: string }>;
}) {
  const { tenant_slug } = await params;
  const tenant = await getTenantBySlugServer(tenant_slug);
  if (!tenant) notFound();

  const { primary_color, secondary_color } = tenant.visual_config;

  return (
    <>
      <style>{`
        :root {
          --tenant-primary: ${primary_color};
          --tenant-secondary: ${secondary_color};
        }
      `}</style>
      {children}
    </>
  );
}
