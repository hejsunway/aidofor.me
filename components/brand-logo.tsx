import Image from "next/image";
import Link from "next/link";

type BrandLogoProps = {
  inverse?: boolean;
  compact?: boolean;
  href?: string;
};

export function BrandLogo({ inverse = false, compact = false, href = "/" }: BrandLogoProps) {
  return (
    <Link className={compact ? "brand brand--compact" : "brand"} href={href} aria-label="AidoFor.me home">
      <Image
        src={inverse ? "/brand/aidoforme-logo-white.svg" : "/brand/aidoforme-logo.svg"}
        alt="AidoFor.me"
        width={465}
        height={86}
        priority
      />
    </Link>
  );
}
