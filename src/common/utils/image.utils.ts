/**
 * Resolves an image input to a URL suitable for OpenAI Vision API's image_url.url field.
 *
 * Accepts three formats:
 *  - HTTP(S) URL  -> returned as-is
 *  - Data URI     -> returned as-is  (e.g. "data:image/png;base64,...")
 *  - Raw base64   -> detects MIME type from magic bytes and prefixes with data URI
 */
export function resolveImageUrl(image: string): string {
  if (image.startsWith('http://') || image.startsWith('https://')) {
    return image;
  }
  if (image.startsWith('data:')) {
    return image;
  }
  const mimeType = detectMimeType(image);
  return `data:${mimeType};base64,${image}`;
}

/**
 * Returns true when the image input is an HTTP(S) URL rather than base64 data.
 */
export function isImageUrl(image: string): boolean {
  return image.startsWith('http://') || image.startsWith('https://');
}

/**
 * Detects MIME type from base64-encoded image data by reading magic bytes.
 * Falls back to image/jpeg if unknown.
 */
function detectMimeType(base64: string): string {
  try {
    const bytes = Buffer.from(base64.slice(0, 16), 'base64');

    // PNG: 89 50 4E 47
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      return 'image/png';
    }
    // JPEG: FF D8 FF
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return 'image/jpeg';
    }
    // GIF: 47 49 46
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
      return 'image/gif';
    }
    // WebP: RIFF....WEBP
    if (
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
    ) {
      return 'image/webp';
    }
    // BMP: 42 4D
    if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
      return 'image/bmp';
    }
  } catch {
    // If decoding fails, default to JPEG
  }

  return 'image/jpeg';
}
