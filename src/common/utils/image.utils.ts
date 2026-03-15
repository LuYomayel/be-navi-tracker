/**
 * Resolves an image input to a URL suitable for OpenAI Vision API's image_url.url field.
 *
 * Accepts three formats:
 *  - HTTP(S) URL  -> returned as-is
 *  - Data URI     -> returned as-is  (e.g. "data:image/png;base64,...")
 *  - Raw base64   -> prefixed with "data:image/jpeg;base64,"
 */
export function resolveImageUrl(image: string): string {
  if (image.startsWith('http://') || image.startsWith('https://')) {
    return image;
  }
  if (image.startsWith('data:')) {
    return image;
  }
  return `data:image/jpeg;base64,${image}`;
}

/**
 * Returns true when the image input is an HTTP(S) URL rather than base64 data.
 */
export function isImageUrl(image: string): boolean {
  return image.startsWith('http://') || image.startsWith('https://');
}
