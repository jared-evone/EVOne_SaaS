import logo from '../assets/evone-logo.png';

interface LogoProps {
  height?: number;
}

export function Logo({ height = 36 }: LogoProps) {
  return (
    <img
      src={logo}
      alt="EVOne"
      style={{ height, width: 'auto', display: 'block' }}
    />
  );
}
