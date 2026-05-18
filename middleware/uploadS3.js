import multer from "multer";
import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";
import _config from "../config/_config.js";
import log from "../utils/logger.js";

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

export const s3 = new S3Client({
  region: _config.S3_REGION,
  credentials: {
    accessKeyId: _config.S3_ACCESS_KEY,
    secretAccessKey: _config.S3_SECRET_KEY,
  },
  forcePathStyle: false,
});


export const uploadToS3 = async (buffer, filename, mimetype, folder = "uploads") => {
  try {
    if (!buffer) throw new Error("Missing file buffer");

    const safeName = filename.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9._-]/g, "");
    const key = `${folder}/${Date.now()}_${safeName}`;

    await s3.send(
      new PutObjectCommand({
        Bucket: _config.S3_BUCKET_NAME,
        Key: key,
        Body: buffer,
        ContentType: mimetype || "application/octet-stream"
      })
    );

    return `https://${_config.S3_BUCKET_NAME}.s3.${_config.S3_REGION}.amazonaws.com/${key}`;
  } catch (error) {
    console.error("S3 Upload Error:", error);
    throw new Error("Failed to upload to S3");
  }
};


export const resizeImage = async (buffer, options = { width: 1024, height: 768, quality: 80 }) => {
  try {
    return await sharp(buffer)
      .resize(options.width, options.height)
      .jpeg({ quality: options.quality })
      .toBuffer();
  } catch (error) {
    log.error("Sharp Resize Error:", error);
    throw new Error("Failed to process image");
  }
};


export const listAllS3Images = async () => {
  try {
    let continuationToken = undefined;
    let allUrls = [];

    do {
      const params = {
        Bucket: _config.S3_BUCKET_NAME,
        ContinuationToken: continuationToken,
      };

      const command = new ListObjectsV2Command(params);
      const response = await s3.send(command);

      if (response.Contents) {
        const urls = response.Contents.map(
          (item) => `https://${_config.S3_BUCKET_NAME}.s3.${_config.S3_REGION}.amazonaws.com/${item.Key}`
        );
        allUrls = allUrls.concat(urls);
      }

      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);

    return allUrls;
  } catch (error) {
    log.error("❌ Failed to list all S3 images", error);
    throw error;
  }
};

export const deleteFromS3 = async (key) => {
  if (!key) throw new Error("S3 object key is required for deletion");

  const command = new DeleteObjectCommand({
    Bucket: _config.S3_BUCKET_NAME,
    Key: key,
  });

  try {
    await s3.send(command);
    log.success(`✅ Successfully deleted S3 file: ${key}`);
    return true;
  } catch (error) {
    log.error(`❌ Failed to delete S3 file: ${key}`, error);
    throw error;
  }
};

export const deleteMultipleFromS3 = async (keys = []) => {
  if (!Array.isArray(keys) || keys.length === 0) {
    log.warn("No S3 keys provided for deletion.");
    return;
  }

  try {
    const results = await Promise.allSettled(keys.map((key) => deleteFromS3(key)));

    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        log.success(`✅ Deleted S3 file: ${keys[index]}`);
      } else {
        log.error(`❌ Failed to delete S3 file: ${keys[index]}`, result.reason);
      }
    });

    return results;
  } catch (error) {
    log.error("deleteMultipleFromS3 Error:", error);
    throw error;
  }
};