import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const makeS3Client = (env: Env) =>
  new S3Client({
    region: "auto",
    endpoint: `https://${env.ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });

export const generateUploadUrl = async (env: Env, key: string, expiresIn = 7200) =>
  getSignedUrl(
    makeS3Client(env),
    new PutObjectCommand({ Bucket: env.BUILD_BUCKET_NAME, Key: key }),
    { expiresIn },
  );

export const generateDownloadUrl = async (env: Env, key: string, expiresIn = 900) =>
  getSignedUrl(
    makeS3Client(env),
    new GetObjectCommand({ Bucket: env.BUILD_BUCKET_NAME, Key: key }),
    { expiresIn },
  );
