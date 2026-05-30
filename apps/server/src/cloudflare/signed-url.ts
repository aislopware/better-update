import { S3mini } from "s3mini";

const CHECKSUM_SHA256_HEADER = "x-amz-checksum-sha256";

const makeS3Client = (env: Env, bucketName: string) =>
  new S3mini({
    region: "auto",
    endpoint: `https://${env.ACCOUNT_ID}.r2.cloudflarestorage.com/${bucketName}`,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    fetch,
  });

export const createDirectUploadHeaders = (params: {
  readonly checksumSha256Base64?: string;
  readonly contentType: string;
  readonly cacheControl?: string;
}) => ({
  ...(params.checksumSha256Base64 ? { [CHECKSUM_SHA256_HEADER]: params.checksumSha256Base64 } : {}),
  "content-type": params.contentType,
  ...(params.cacheControl ? { "cache-control": params.cacheControl } : {}),
});

export const generateUploadUrl = async (
  env: Env,
  params: {
    readonly bucketName: string;
    readonly key: string;
    readonly contentType: string;
    readonly checksumSha256Base64?: string;
    readonly cacheControl?: string;
    readonly expiresIn?: number;
  },
) =>
  makeS3Client(env, params.bucketName).getPresignedUrl(
    "PUT",
    params.key,
    params.expiresIn ?? 7200,
    {},
    createDirectUploadHeaders({
      contentType: params.contentType,
      ...(params.checksumSha256Base64 ? { checksumSha256Base64: params.checksumSha256Base64 } : {}),
      ...(params.cacheControl ? { cacheControl: params.cacheControl } : {}),
    }),
  );

export const generateDownloadUrl = async (
  env: Env,
  params: {
    readonly bucketName: string;
    readonly key: string;
    readonly expiresIn?: number;
  },
) =>
  makeS3Client(env, params.bucketName).getPresignedUrl("GET", params.key, params.expiresIn ?? 900);
