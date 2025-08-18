import { Storage, File } from "@google-cloud/storage";
import { Response } from "express";
import { randomUUID } from "crypto";
import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
  getObjectAclPolicy,
  setObjectAclPolicy,
} from "./objectAcl";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

// The object storage client is used to interact with the object storage service.
export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

// The object storage service is used to interact with the object storage service.
export class ObjectStorageService {
  constructor() {}

  // Gets the public object search paths.
  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((path) => path.trim())
          .filter((path) => path.length > 0)
      )
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' " +
          "tool and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths)."
      );
    }
    return paths;
  }

  // Gets the private object directory.
  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }
    return dir;
  }

  // Search for a public object from the search paths.
  async searchPublicObject(filePath: string): Promise<File | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;

      // Full path format: /<bucket_name>/<object_name>
      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      // Check if file exists
      const [exists] = await file.exists();
      if (exists) {
        return file;
      }
    }

    return null;
  }

  // Downloads an object to the response.
  async downloadObject(file: File, res: Response, cacheTtlSec: number = 3600) {
    try {
      // Get file metadata
      const [metadata] = await file.getMetadata();
      // Get the ACL policy for the object.
      const aclPolicy = await getObjectAclPolicy(file);
      const isPublic = aclPolicy?.visibility === "public";
      // Set appropriate headers
      res.set({
        "Content-Type": metadata.contentType || "application/octet-stream",
        "Content-Length": metadata.size,
        "Cache-Control": `${
          isPublic ? "public" : "private"
        }, max-age=${cacheTtlSec}`,
      });

      // Stream the file to the response
      const stream = file.createReadStream();

      stream.on("error", (err) => {
        console.error("Stream error:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Error streaming file" });
        }
      });

      stream.pipe(res);
    } catch (error) {
      console.error("Error downloading file:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Error downloading file" });
      }
    }
  }

  // Gets the upload URL for an object entity.
  async getObjectEntityUploadURL(): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    if (!privateObjectDir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }

    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;

    const { bucketName, objectName } = parseObjectPath(fullPath);

    // Sign URL for PUT method with TTL
    return signObjectURL({
      bucketName,
      objectName,
      method: "PUT",
      ttlSec: 900,
    });
  }

  // Gets the upload URL for PDF attachments
  async getPdfUploadURL(filename: string): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/pdfs/${objectId}_${sanitizedFilename}`;

    const { bucketName, objectName } = parseObjectPath(fullPath);

    return signObjectURL({
      bucketName,
      objectName,
      method: "PUT",
      ttlSec: 900,
    });
  }

  // Gets the object entity file from the object path.
  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join("/");
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    
    // For stored attachments, construct the path properly
    const objectEntityPath = `${entityDir}${entityId}`;
    console.log('Looking for object at path:', objectEntityPath);
    
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const objectFile = bucket.file(objectName);
    
    const [exists] = await objectFile.exists();
    if (!exists) {
      console.log(`Object not found: ${objectEntityPath} (bucket: ${bucketName}, object: ${objectName})`);
      throw new ObjectNotFoundError();
    }
    return objectFile;
  }

  // List files in the private directory
  async listStoredFiles(): Promise<Array<{
    filename: string;
    size: number;
    contentType: string;
    uploaded: Date;
    path: string;
  }>> {
    try {
      const privateDir = this.getPrivateObjectDir();
      const { bucketName, objectName } = parseObjectPath(privateDir);
      const bucket = objectStorageClient.bucket(bucketName);
      
      // Get the prefix for the private directory
      const prefix = objectName.endsWith('/') ? objectName : objectName + '/';
      
      console.log('Listing files with prefix:', prefix, 'in bucket:', bucketName);
      
      const [files] = await bucket.getFiles({ prefix });
      
      console.log('Found', files.length, 'files');
      
      return files
        .filter(file => !file.name.endsWith('/')) // Filter out directories
        .map(file => {
          const metadata = file.metadata;
          const relativePath = file.name.replace(prefix, '');
          
          return {
            filename: file.name.split('/').pop() || file.name,
            size: parseInt(metadata.size?.toString() || '0') || 0,
            contentType: metadata.contentType || 'application/octet-stream',
            uploaded: new Date(metadata.timeCreated || metadata.updated || Date.now()),
            path: `/objects/${relativePath}`
          };
        });
    } catch (error) {
      console.error('Error listing stored files:', error);
      return [];
    }
  }

  normalizeObjectEntityPath(
    rawPath: string,
  ): string {
    if (!rawPath.startsWith("https://storage.googleapis.com/")) {
      return rawPath;
    }
  
    // Extract the path from the URL by removing query parameters and domain
    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;
  
    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith("/")) {
      objectEntityDir = `${objectEntityDir}/`;
    }
  
    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }
  
    // Extract the entity ID from the path
    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  // Tries to set the ACL policy for the object entity and return the normalized path.
  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }

    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  // Checks if the user can access the object entity.
  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: File;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }

  // Store any attachment from email processing
  async storeAttachment(buffer: Buffer, filename: string, contentType: string): Promise<string> {
    try {
      const privateObjectDir = this.getPrivateObjectDir();
      const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
      const timestamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const fullPath = `${privateObjectDir}/attachments/${timestamp}_${sanitizedFilename}`;

      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      // Upload the buffer
      await file.save(buffer, {
        metadata: {
          contentType: contentType || 'application/octet-stream',
          metadata: {
            originalFilename: filename,
            uploadedAt: new Date().toISOString(),
          },
        },
      });

      return `/objects/attachments/${timestamp}_${sanitizedFilename}`;
    } catch (error) {
      console.log(`⚠️  Object storage failed for ${filename}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      console.log(`   📝 Continuing processing without object storage...`);
      // Return a placeholder path to indicate storage failed but processing continues
      const timestamp = new Date().toISOString().slice(0, 10);
      const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
      return `/local-fallback/attachments/${timestamp}_${sanitizedFilename}`;
    }
  }

  // Store PDF attachment from email processing
  async storePdfAttachment(emailId: string, filename: string, buffer: Buffer): Promise<string> {
    try {
      const privateObjectDir = this.getPrivateObjectDir();
      const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
      const fullPath = `${privateObjectDir}/pdfs/${emailId}_${sanitizedFilename}`;

      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      // Upload the buffer
      await file.save(buffer, {
        metadata: {
          contentType: 'application/pdf',
          metadata: {
            emailId,
            originalFilename: filename,
            uploadedAt: new Date().toISOString(),
          },
        },
      });

      return `/objects/pdfs/${emailId}_${sanitizedFilename}`;
    } catch (error) {
      console.log(`⚠️  Object storage failed for PDF ${filename}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      console.log(`   📝 Continuing processing without object storage...`);
      // Return a placeholder path to indicate storage failed but processing continues
      const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
      return `/local-fallback/pdfs/${emailId}_${sanitizedFilename}`;
    }
  }

  // Store original email as .eml file for classified emails
  async storeEmailFile(emailId: string, subject: string, emailContent: string): Promise<string> {
    try {
      const privateObjectDir = this.getPrivateObjectDir();
      const sanitizedSubject = subject.replace(/[^a-zA-Z0-9\s-]/g, '').slice(0, 50);
      const timestamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const filename = `${emailId}_${timestamp}_${sanitizedSubject || 'email'}.eml`;
      const fullPath = `${privateObjectDir}/emails/${filename}`;

      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      // Upload the email content as .eml file
      await file.save(Buffer.from(emailContent, 'utf-8'), {
        metadata: {
          contentType: 'message/rfc822',
          metadata: {
            emailId,
            subject,
            preservedAt: new Date().toISOString(),
            fileType: 'original_email',
          },
        },
      });

      return `/objects/emails/${filename}`;
    } catch (error) {
      console.log(`⚠️  Object storage failed for email ${emailId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      console.log(`   📝 Continuing processing without object storage...`);
      // Return a placeholder path to indicate storage failed but processing continues
      const sanitizedSubject = subject.replace(/[^a-zA-Z0-9\s-]/g, '').slice(0, 50);
      const timestamp = new Date().toISOString().slice(0, 10);
      const filename = `${emailId}_${timestamp}_${sanitizedSubject || 'email'}.eml`;
      return `/local-fallback/emails/${filename}`;
    }
  }

  // Clear all files from object storage for testing purposes
  async clearAllFiles(): Promise<{ deleted: number; errors: string[] }> {
    const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
    if (!bucketId) {
      throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not found");
    }

    const bucket = objectStorageClient.bucket(bucketId);
    const errors: string[] = [];
    let deleted = 0;

    try {
      // List all files in the bucket
      const [files] = await bucket.getFiles();
      
      console.log(`Found ${files.length} files to delete in bucket ${bucketId}`);
      
      // Delete each file
      for (const file of files) {
        try {
          await file.delete();
          deleted++;
          console.log(`Deleted: ${file.name}`);
        } catch (error) {
          const errorMsg = `Failed to delete ${file.name}: ${error instanceof Error ? error.message : 'Unknown error'}`;
          errors.push(errorMsg);
          console.error(errorMsg);
        }
      }

      return { deleted, errors };
    } catch (error) {
      throw new Error(`Failed to clear object storage: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");

  return {
    bucketName,
    objectName,
  };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, ` +
        `make sure you're running on Replit`
    );
  }

  const { signed_url: signedURL } = await response.json();
  return signedURL;
}