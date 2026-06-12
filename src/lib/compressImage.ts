// Downscale + JPEG-encode a photo before it is stored as a data URL inside a
// work order's jsonb. Raw phone-camera images are 5–15 MB; uncompressed they
// blow past request limits and the save fails. ~1280px @ q0.78 ≈ 150–400 KB.
export function compressImage(file: File, maxDim = 1280, quality = 0.78): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.onload = () => {
      const original = String(reader.result);
      const img = new Image();
      img.onerror = () => reject(new Error('Not a readable image'));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
        if (scale === 1 && file.size < 300_000) {
          resolve(original);
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(original);
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = original;
    };
    reader.readAsDataURL(file);
  });
}
