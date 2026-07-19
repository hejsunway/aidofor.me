import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { SiteHeader } from "@/components/site-header";

export function MarketingShell({ children, darkHeader = false }: { children: React.ReactNode; darkHeader?: boolean }) {
  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <SiteHeader inverse={darkHeader} />
      <main id="main">{children}</main>
      <MarketingFooter />
    </>
  );
}
