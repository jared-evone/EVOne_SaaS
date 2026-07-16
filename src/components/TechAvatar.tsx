import { C } from '../theme';
import { supabase } from '../lib/supabase';

// Technician photos live in the public `technician-photos` bucket; a technician
// without one falls back to their initial.
export function techPhotoUrl(path: string): string {
  return supabase.storage.from('technician-photos').getPublicUrl(path).data.publicUrl;
}

export function TechAvatar({ name, photoPath, size = 30, ring }: {
  name: string;
  photoPath?: string | null;
  size?: number;
  /** Draw a white ring — for overlapping stacks of avatars. */
  ring?: boolean;
}) {
  const border = ring ? `2px solid ${C.white}` : '1px solid #EBEBEB';
  if (photoPath) {
    return (
      <img src={techPhotoUrl(photoPath)} alt={name} title={name}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', border, flexShrink: 0 }} />
    );
  }
  return (
    <div title={name}
      style={{ width: size, height: size, borderRadius: '50%', background: C.honeydew, color: C.green, border, boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: size * 0.42, flexShrink: 0 }}>
      {(name.trim().charAt(0) || '?').toUpperCase()}
    </div>
  );
}
