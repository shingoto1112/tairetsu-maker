import { FileText, LifeBuoy, ShieldCheck } from "lucide-react";
import { PUBLIC_LINKS } from "../config/publicLinks";

type LegalLinksProps = {
  className?: string;
};

export const LegalLinks = ({ className = "" }: LegalLinksProps) => (
  <nav
    className={`legal-links${className ? ` ${className}` : ""}`}
    aria-label="規約とサポート"
  >
    <a href={PUBLIC_LINKS.privacy} target="_blank" rel="noreferrer">
      <ShieldCheck size={15} />
      プライバシー
    </a>
    <a href={PUBLIC_LINKS.terms} target="_blank" rel="noreferrer">
      <FileText size={15} />
      利用規約
    </a>
    <a href={PUBLIC_LINKS.support} target="_blank" rel="noreferrer">
      <LifeBuoy size={15} />
      サポート
    </a>
  </nav>
);
