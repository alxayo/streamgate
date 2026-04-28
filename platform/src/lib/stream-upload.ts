// =========================================================================
// Streaming Multipart Upload Helper
// =========================================================================
// Parses multipart/form-data requests using busboy and streams the file
// directly to disk — never buffering the entire file in memory. This is
// critical for large video uploads (hundreds of MB to several GB) running
// on containers with limited RAM (e.g. 1 GB).
//
// How it works:
//   1. The raw request body (a Web ReadableStream) is piped into busboy.
//   2. Busboy fires a 'file' event for each <input type="file"> part.
//   3. We pipe the file data into a Node.js fs.createWriteStream on disk.
//   4. When the stream finishes, we return file metadata (name, size, type).
//
// Usage:
//   const result = await streamMultipartToDisk(request, '/path/to/upload/dir');
//   // result = { fileName: '...', fileSize: 1234, mimeType: 'video/mp4' }
// =========================================================================

import { Readable } from 'stream';
import { createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import path from 'path';
import busboy from 'busboy';

/**
 * Result returned after a file is successfully streamed to disk.
 */
export interface StreamUploadResult {
  /** The sanitized filename (safe for filesystem use) */
  fileName: string;
  /** Total file size in bytes */
  fileSize: number;
  /** MIME type reported by the browser (e.g. 'video/mp4') */
  mimeType: string;
  /** Full absolute path where the file was saved */
  filePath: string;
}

/**
 * Sanitize a filename to prevent directory traversal and filesystem issues.
 * Only alphanumeric characters, hyphens, underscores, and dots are kept.
 * Everything else (including path separators) becomes an underscore.
 */
function sanitizeFileName(rawName: string): string {
  return rawName
    .replace(/[/\\]/g, '')               // Strip path separators first
    .replace(/[^a-zA-Z0-9._-]/g, '_');   // Replace unsafe chars with underscore
}

/**
 * Stream a multipart/form-data request body directly to disk.
 *
 * This function NEVER loads the entire file into memory — it pipes data
 * from the HTTP request stream through busboy into a file write stream.
 * Memory usage stays constant regardless of file size.
 *
 * @param request     - The incoming Next.js Request (must have multipart Content-Type)
 * @param uploadDir   - Directory where the file should be saved (created if missing)
 * @param fieldName   - The form field name to look for (default: 'file')
 * @param maxFileSize - Maximum allowed file size in bytes (0 = no limit)
 * @returns           - File metadata, or throws an error on failure
 */
export async function streamMultipartToDisk(
  request: Request,
  uploadDir: string,
  fieldName: string = 'file',
  maxFileSize: number = 0,
): Promise<StreamUploadResult> {
  // Ensure the upload directory exists (recursive creates parents too)
  await mkdir(uploadDir, { recursive: true });

  // Extract the Content-Type header — busboy needs it to find the multipart boundary
  const contentType = request.headers.get('content-type');
  if (!contentType || !contentType.includes('multipart/form-data')) {
    throw new Error('Request must be multipart/form-data');
  }

  // The request body is a Web ReadableStream. We need a Node.js Readable
  // so we can pipe it into busboy (which expects Node.js streams).
  const bodyStream = request.body;
  if (!bodyStream) {
    throw new Error('Request body is empty');
  }

  // Convert Web ReadableStream to Node.js Readable stream
  const nodeStream = Readable.fromWeb(bodyStream as Parameters<typeof Readable.fromWeb>[0]);

  return new Promise<StreamUploadResult>((resolve, reject) => {
    let fileFound = false;
    let bytesWritten = 0;

    // Create a busboy instance configured with the Content-Type header.
    // Busboy uses the boundary string from Content-Type to split the
    // multipart stream into individual fields/files.
    const bb = busboy({
      headers: { 'content-type': contentType },
      limits: {
        // Only accept 1 file — reject if more are sent
        files: 1,
        // Set file size limit if provided (busboy truncates at this limit)
        ...(maxFileSize > 0 ? { fileSize: maxFileSize } : {}),
      },
    });

    // ── Handle file parts ─────────────────────────────────────────────
    // busboy emits a 'file' event for each file field in the form data.
    // Parameters:
    //   name     - the form field name (e.g. 'file')
    //   stream   - a Readable stream of the file's binary data
    //   info     - { filename, encoding, mimeType }
    bb.on('file', (name: string, stream: Readable, info: { filename: string; encoding: string; mimeType: string }) => {
      // Only process the field we're looking for — skip others
      if (name !== fieldName) {
        // Drain (discard) unwanted file streams to prevent busboy from stalling
        stream.resume();
        return;
      }

      fileFound = true;
      const rawFileName = info.filename || 'upload.mp4';
      const safeName = sanitizeFileName(rawFileName);
      const filePath = path.join(uploadDir, safeName);

      // Create a write stream to the destination file on disk.
      // Data flows: HTTP body → busboy parser → file write stream
      const writeStream = createWriteStream(filePath);

      // Track how many bytes we've written (for the result and size validation)
      stream.on('data', (chunk: Buffer) => {
        bytesWritten += chunk.length;
      });

      // If busboy hits the file size limit, it emits 'limit' on the file stream.
      // We abort the write and reject with a clear error message.
      stream.on('limit', () => {
        writeStream.destroy();
        reject(new Error(`File exceeds maximum allowed size of ${maxFileSize} bytes`));
      });

      // Pipe the file data stream into the disk write stream.
      // When the file stream ends, the write stream flushes and closes.
      stream.pipe(writeStream);

      writeStream.on('finish', () => {
        resolve({
          fileName: safeName,
          fileSize: bytesWritten,
          mimeType: info.mimeType,
          filePath,
        });
      });

      writeStream.on('error', (err) => {
        reject(new Error(`Failed to write file to disk: ${err.message}`));
      });
    });

    // ── Handle completion without finding a file ────────────────────────
    bb.on('close', () => {
      if (!fileFound) {
        reject(new Error(`Missing "${fieldName}" field in form data`));
      }
    });

    // ── Handle parsing errors ──────────────────────────────────────────
    bb.on('error', (err: Error) => {
      reject(new Error(`Failed to parse multipart form data: ${err.message}`));
    });

    // ── Pipe the request body into busboy ───────────────────────────────
    // This is where the streaming magic happens: data flows from the HTTP
    // connection through busboy's parser and out to the file on disk,
    // chunk by chunk, without ever holding the full file in memory.
    nodeStream.pipe(bb);
  });
}
