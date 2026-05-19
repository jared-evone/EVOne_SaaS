import evoneLogo    from '../assets/evone-logo.png';
import eveLogo      from '../assets/eve-logo.png';
import goparkinLogo from '../assets/goparkin-logo.png';
import spLogo       from '../assets/sp-logo.png';

export type Brand    = 'evone' | 'eve';
export type Platform = 'goparkin' | 'sp';

const BRAND_SRC: Record<Brand | Platform, { src: string; alt: string }> = {
  evone:    { src: evoneLogo,    alt: 'EVOne' },
  eve:      { src: eveLogo,      alt: 'EVE' },
  goparkin: { src: goparkinLogo, alt: 'GoParkin' },
  sp:       { src: spLogo,       alt: 'SP' },
};

interface BrandLogoProps {
  brand: Brand | Platform;
  height?: number;
}

export function BrandLogo({ brand, height = 22 }: BrandLogoProps) {
  const { src, alt } = BRAND_SRC[brand];
  return (
    <img src={src} alt={alt} style={{ height, width: 'auto', display: 'block' }} />
  );
}
