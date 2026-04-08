export interface Part {
  readonly name: string;
  readonly contentType: string;
  readonly headers?: Record<string, string>;
  readonly body: string;
}

const encodePart = (boundary: string, part: Part): string => {
  const lines = [
    `--${boundary}`,
    `content-disposition: inline; name="${part.name}"`,
    `content-type: ${part.contentType}`,
    ...Object.entries(part.headers ?? {}).map(([key, val]) => `${key}: ${val}`),
    "",
    part.body,
  ];
  return lines.join("\r\n");
};

export const encodeMultipart = (boundary: string, parts: readonly Part[]): string =>
  [...parts.map((part) => encodePart(boundary, part)), `--${boundary}--\r\n`].join("\r\n");
