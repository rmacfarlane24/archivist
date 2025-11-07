import * as fs from 'fs-extra';
import * as path from 'path';
import { app } from 'electron';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as zlib from 'zlib';

// Compression utilities
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

// Compression configuration
const COMPRESSION_THRESHOLD = 1000000; // 1MB - compress files larger than this
const COMPRESSION_LEVEL = 6; // Balance between speed and compression ratio

// Function to compress data
async function compressData(data: any): Promise<Buffer> {
  const jsonString = JSON.stringify(data);
  const buffer = Buffer.from(jsonString, 'utf8');
  
  if (buffer.length < COMPRESSION_THRESHOLD) {
    return buffer; // Return uncompressed for small files
  }
  
  try {
    const compressed = await gzip(buffer, { level: COMPRESSION_LEVEL });
    const compressionRatio = (1 - compressed.length / buffer.length) * 100;
    console.log(`Compressed data: ${buffer.length} -> ${compressed.length} bytes (${compressionRatio.toFixed(1)}% reduction)`);
    return compressed;
  } catch (error: any) {
    console.warn('Compression failed, using uncompressed data:', error.message);
    return buffer;
  }
}

// Function to decompress data
async function decompressData(buffer: Buffer): Promise<any> {
  try {
    // Try to decompress first
    const decompressed = await gunzip(buffer);
    const jsonString = decompressed.toString('utf8');
    return JSON.parse(jsonString);
  } catch (error: any) {
    // If decompression fails, try to parse as uncompressed JSON
    try {
      const jsonString = buffer.toString('utf8');
      return JSON.parse(jsonString);
    } catch (parseError: any) {
      throw new Error(`Failed to parse data: ${parseError.message}`);
    }
  }
}



// Enhanced read with compression support
async function readJsonWithCompression(filePath: string): Promise<any> {
  try {
    const buffer = await fs.readFile(filePath);
    
    // Try to decompress first (in case it's compressed)
    try {
      return await decompressData(buffer);
    } catch (decompressError) {
      // If decompression fails, try to parse as uncompressed JSON
      const jsonString = buffer.toString('utf8');
      return JSON.parse(jsonString);
    }
  } catch (error: any) {
    throw new Error(`Failed to read file ${filePath}: ${error.message}`);
  }
}

// Storage paths
const STORAGE_DIR = path.join(app.getPath('userData'), 'storage');
const DRIVES_FILE = path.join(STORAGE_DIR, 'drives.json');
const FILES_DIR = path.join(STORAGE_DIR, 'files');

// Ensure storage directory exists
async function ensureStorageDir(): Promise<void> {
  await fs.ensureDir(STORAGE_DIR);
  await fs.ensureDir(FILES_DIR);
}

// Drive storage
export interface DriveInfo {
  id: string;
  name: string;
  path: string;
  totalCapacity: number;
  usedSpace: number;
  freeSpace: number;
  serialNumber: string;
  formatType: string;
  addedDate: string;
  lastUpdated?: string;
  // (Removed) online status tracking
  // isOnline?: boolean;
  // lastChecked?: string;
}

export interface FileInfo {
  id: string;
  name: string;
  path: string;
  parentPath: string | null;
  size: number;
  created: string;
  modified: string;
  isDirectory: boolean;
  folderPath: string;
  driveId: string;
  depth: number;
  // Hard link support
  inode?: number;
  hardLinkCount?: number;
  isHardLink?: boolean;
  hardLinkGroup?: string; // Group ID for hard links sharing the same inode
}

// Search result interface
export interface SearchResult {
  fileId: string;
  driveId: string;
  driveName: string;
  fileName: string;
  fullPath: string;
  isDirectory: boolean;
  size?: number;
  modified?: string;
}

// Search index class
class SearchIndex {
  private index: Map<string, SearchResult[]> = new Map();
  private isBuilt: boolean = false;
  private totalIndexed: number = 0;

  // Normalize a string for indexing (lowercase, trim)
  private normalizeString(str: string): string {
    return str.toLowerCase().trim();
  }

  // Build search index from all drives
  async buildIndex(): Promise<void> {
    console.log('Building search index...');
    this.index.clear();
    this.totalIndexed = 0;

    try {
      const drives = await getStoredDrives();
      
      for (const drive of drives) {
        console.log(`Indexing drive: ${drive.name}`);
        const files = await getDriveFiles(drive.id);
        
        // Process files in batches to prevent memory issues
        const batchSize = 3000;
        for (let i = 0; i < files.length; i += batchSize) {
          const batch = files.slice(i, i + batchSize);
          
          for (const file of batch) {
            const normalizedName = this.normalizeString(file.name);
            
            if (!this.index.has(normalizedName)) {
              this.index.set(normalizedName, []);
            }
            
            const searchResult: SearchResult = {
              fileId: file.id,
              driveId: drive.id,
              driveName: drive.name,
              fileName: file.name,
              fullPath: file.path,
              isDirectory: file.isDirectory,
              size: file.size > 0 ? file.size : undefined,
              modified: file.modified
            };
            
            this.index.get(normalizedName)!.push(searchResult);
            this.totalIndexed++;
          }
          
          // Log progress for large datasets
          if (files.length > 10000 && i % (batchSize * 5) === 0) {
            console.log(`Indexed ${this.totalIndexed} files so far...`);
          }
        }
      }
      
      this.isBuilt = true;
      console.log(`Search index built successfully. Indexed ${this.totalIndexed} files/folders.`);
    } catch (error: any) {
      console.error('Error building search index:', error.message);
      this.isBuilt = false;
      throw error;
    }
  }

  // Search for files/folders
  search(query: string): SearchResult[] {
    if (!this.isBuilt) {
      console.warn('Search index not built. Returning empty results.');
      return [];
    }

    const normalizedQuery = this.normalizeString(query);
    if (!normalizedQuery) {
      return [];
    }

    const results: SearchResult[] = [];
    
    // Search through all indexed entries
    for (const [normalizedName, searchResults] of this.index.entries()) {
      // Exact match
      if (normalizedName === normalizedQuery) {
        results.push(...searchResults);
      }
      // Partial match (contains)
      else if (normalizedName.includes(normalizedQuery)) {
        results.push(...searchResults);
      }
    }

    return results;
  }

  // Get index status
  getStatus(): { isBuilt: boolean; totalIndexed: number } {
    return {
      isBuilt: this.isBuilt,
      totalIndexed: this.totalIndexed
    };
  }

  // Clear index (called when drives are modified)
  clearIndex(): void {
    this.index.clear();
    this.isBuilt = false;
    this.totalIndexed = 0;
  }

  // Rebuild index (called when drives are added/removed)
  async rebuildIndex(): Promise<void> {
    this.clearIndex();
    await this.buildIndex();
  }
}

// Global search index instance
export const searchIndex = new SearchIndex();

// Initialize storage
export async function initializeStorage(): Promise<void> {
  await ensureStorageDir();
  
  // Create drives.json if it doesn't exist
  if (!await fs.pathExists(DRIVES_FILE)) {
    await fs.writeJson(DRIVES_FILE, []);
  }
}

// Drive operations
export async function storeDriveInfo(driveInfo: Omit<DriveInfo, 'id' | 'addedDate'> | DriveInfo): Promise<DriveInfo> {
  await ensureStorageDir();
  
  const drives = await getStoredDrives();
  
  // Check if this is an update to an existing drive
  if ('id' in driveInfo) {
    const existingDriveIndex = drives.findIndex(drive => drive.id === driveInfo.id);
    if (existingDriveIndex !== -1) {
      // Update existing drive
      const updated: DriveInfo = {
        ...(drives[existingDriveIndex] as DriveInfo),
        ...(driveInfo as DriveInfo),
        lastUpdated: new Date().toISOString()
      };
      drives[existingDriveIndex] = updated;
      await fs.writeJson(DRIVES_FILE, drives, { spaces: 2 });
      return updated;
    }
  }
  
  // Create new drive
  const newDrive: DriveInfo = {
    ...driveInfo,
    id: generateId(),
    addedDate: new Date().toISOString(),
    lastUpdated: new Date().toISOString()
  };
  
  drives.push(newDrive);
  await fs.writeJson(DRIVES_FILE, drives, { spaces: 2 });
  
  // Don't rebuild search index here - it will be rebuilt when first search is performed
  // This prevents performance issues during drive addition
  
  return newDrive;
}

export async function getStoredDrives(): Promise<DriveInfo[]> {
  await ensureStorageDir();
  
  if (!await fs.pathExists(DRIVES_FILE)) {
    return [];
  }
  
  try {
    return await fs.readJson(DRIVES_FILE);
  } catch (error) {
    console.error('Error reading drives file:', error);
    return [];
  }
}

export async function getDriveById(driveId: string): Promise<DriveInfo | null> {
  const drives = await getStoredDrives();
  return drives.find(drive => drive.id === driveId) || null;
}

export async function deleteDrive(driveId: string): Promise<void> {
  const drives = await getStoredDrives();
  const filteredDrives = drives.filter(drive => drive.id !== driveId);
  await fs.writeJson(DRIVES_FILE, filteredDrives, { spaces: 2 });
  
  // Delete associated files
  const filesPath = path.join(FILES_DIR, `${driveId}.json`);
  if (await fs.pathExists(filesPath)) {
    await fs.remove(filesPath);
  }
  
  // Clear search index when drive is deleted
  searchIndex.clearIndex();
}

// File operations
// Atomic file operations for data integrity
async function atomicWriteJson(filePath: string, data: any, options?: { spaces?: number; compress?: boolean }): Promise<void> {
  const tempPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).substring(2)}`;
  const backupPath = `${filePath}.backup.${Date.now()}`;
  const shouldCompress = options?.compress !== false && JSON.stringify(data).length > COMPRESSION_THRESHOLD;
  
  try {
    // Create backup if file exists
    if (await fs.pathExists(filePath)) {
      await fs.copy(filePath, backupPath);
    }
    
    let dataToWrite: Buffer | string;
    
    if (shouldCompress) {
      // Compress the data
      dataToWrite = await compressData(data);
      console.log(`Writing compressed data to ${tempPath}`);
    } else {
      // Write uncompressed JSON
      dataToWrite = JSON.stringify(data, null, options?.spaces || 2);
      console.log(`Writing uncompressed data to ${tempPath}`);
    }
    
    // Write to temporary file
    if (Buffer.isBuffer(dataToWrite)) {
      await fs.writeFile(tempPath, dataToWrite);
    } else {
      await fs.writeFile(tempPath, dataToWrite, 'utf8');
    }
    
    // Verify the written data
    let writtenData: any;
    if (shouldCompress) {
      const readBuffer = await fs.readFile(tempPath);
      writtenData = await decompressData(readBuffer);
    } else {
      writtenData = await fs.readJson(tempPath);
    }
    
    if (JSON.stringify(writtenData) !== JSON.stringify(data)) {
      throw new Error('Data verification failed after write');
    }
    
    // Atomic move to final location
    await fs.move(tempPath, filePath, { overwrite: true });
    
    // Remove backup if write was successful
    if (await fs.pathExists(backupPath)) {
      await fs.remove(backupPath);
    }
    
    console.log(`Atomic write completed successfully: ${filePath}${shouldCompress ? ' (compressed)' : ''}`);
  } catch (error: any) {
    // Cleanup temporary file
    if (await fs.pathExists(tempPath)) {
      try {
        await fs.remove(tempPath);
      } catch (cleanupError) {
        console.warn('Failed to cleanup temporary file:', cleanupError);
      }
    }
    
    // Restore from backup if available
    if (await fs.pathExists(backupPath)) {
      try {
        await fs.move(backupPath, filePath, { overwrite: true });
        console.log(`Restored from backup: ${filePath}`);
      } catch (restoreError) {
        console.error('Failed to restore from backup:', restoreError);
      }
    }
    
    throw error;
  }
}

// Transaction-like operations for multi-step operations
class StorageTransaction {
  private operations: Array<() => Promise<void>> = [];
  private rollbacks: Array<() => Promise<void>> = [];
  
  addOperation(operation: () => Promise<void>, rollback?: () => Promise<void>): void {
    this.operations.push(operation);
    if (rollback) {
      this.rollbacks.unshift(rollback); // Add rollback in reverse order
    }
  }
  
  async commit(): Promise<void> {
    const completedOperations: Array<() => Promise<void>> = [];
    
    try {
      for (const operation of this.operations) {
        await operation();
        completedOperations.push(operation);
      }
      console.log(`Transaction committed successfully with ${this.operations.length} operations`);
    } catch (error: any) {
      console.error('Transaction failed, rolling back:', error.message);
      
      // Rollback completed operations
      for (const rollback of this.rollbacks.slice(0, completedOperations.length)) {
        try {
          await rollback();
        } catch (rollbackError: any) {
          console.error('Rollback operation failed:', rollbackError.message);
        }
      }
      
      throw error;
    }
  }
}

// Enhanced storeFileTree function with streaming support for large datasets
export async function storeFileTree(driveId: string, fileTree: Omit<FileInfo, 'id'>[]): Promise<void> {
  const startTime = Date.now();
  console.log(`Storing file tree for drive ${driveId} with ${fileTree.length} files`);

  try {
    await ensureStorageDir();
    
    // Use streaming storage for large datasets (more than 50,000 files)
    if (fileTree.length > 50000) {
      console.log(`Large dataset detected (${fileTree.length} files), using streaming storage`);
      await streamingStorage.storeFileTreeStreaming(driveId, fileTree);
    } else {
      // Use traditional storage for smaller datasets
      console.log(`Small dataset (${fileTree.length} files), using traditional storage`);
      
      const transaction = new StorageTransaction();
      
      const filesWithIds = fileTree.map(file => ({
        ...file,
        id: generateId()
      }));
      
      const filesPath = path.join(FILES_DIR, `${driveId}.json`);
      
      // Add atomic write operation
      transaction.addOperation(
        async () => {
          const data = {
            driveId,
            totalFiles: filesWithIds.length,
            processedAt: new Date().toISOString(),
            files: filesWithIds
          };
          await atomicWriteJson(filesPath, data, { spaces: 2, compress: true });
        },
        async () => {
          // Rollback: remove the file if it was created
          if (await fs.pathExists(filesPath)) {
            await fs.remove(filesPath);
          }
        }
      );
      
      // Add memory cache update operation
      transaction.addOperation(
        async () => {
          if (memoryCache) {
            memoryCache.setFiles(driveId, filesWithIds);
          }
        },
        async () => {
          // Rollback: clear the cache for this drive
          if (memoryCache) {
            memoryCache.clearFiles(driveId);
          }
        }
      );
      
      await transaction.commit();
    }
    
    const totalTime = Date.now() - startTime;
    console.log(`File tree storage completed in ${totalTime}ms for ${fileTree.length} files`);
    
  } catch (error: any) {
    console.error(`Error storing file tree: ${error.message}`);
    throw error;
  }
}

// Enhanced getDriveFiles function with streaming support
export async function getDriveFiles(driveId: string): Promise<FileInfo[]> {
  try {
    await ensureStorageDir();
    
    const filesPath = path.join(FILES_DIR, `${driveId}.json`);
    
    if (!await fs.pathExists(filesPath)) {
      return [];
    }
    
    try {
      const data = await readJsonWithCompression(filesPath);
      
      // Handle streaming format (has files array)
      if (data.files && Array.isArray(data.files)) {
        return data.files.map((file: any, index: number) => ({
          ...file,
          id: file.id || `${driveId}_${index}`
        }));
      }
      
      // Handle legacy format (direct array)
      if (Array.isArray(data)) {
        return data.map((file: any, index: number) => ({
          ...file,
          id: file.id || `${driveId}_${index}`
        }));
      }
      
      return [];
    } catch (readError: any) {
      console.error(`Error reading drive files for ${driveId}:`, readError.message);
      
      // Try to recover from corrupted file
      try {
        console.log(`Attempting to recover corrupted file: ${filesPath}`);
        
        // Try to read the file as text first to see if it's partially corrupted
        const fileContent = await fs.readFile(filesPath, 'utf8');
        
        // Try to find the last valid JSON object
        const lines = fileContent.split('\n');
        let lastValidLine = -1;
        
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            JSON.parse(lines[i]);
            lastValidLine = i;
            break;
          } catch (parseError) {
            // Continue searching
          }
        }
        
        if (lastValidLine >= 0) {
          const partialContent = lines.slice(0, lastValidLine + 1).join('\n');
          const partialData = JSON.parse(partialContent);
          
          // Handle both formats in recovery
          if (partialData.files && Array.isArray(partialData.files)) {
            console.log(`Recovered partial streaming data: ${partialData.files.length} files`);
            return partialData.files.map((file: any, index: number) => ({
              ...file,
              id: file.id || `${driveId}_${index}`
            }));
          } else if (Array.isArray(partialData)) {
            console.log(`Recovered partial legacy data: ${partialData.length} files`);
            return partialData.map((file: any, index: number) => ({
              ...file,
              id: file.id || `${driveId}_${index}`
            }));
          }
        }
      } catch (recoveryError: any) {
        console.error('Recovery failed:', recoveryError.message);
      }
      
      // If all else fails, return empty array
      console.warn(`Returning empty file list for drive ${driveId} due to corruption`);
      return [];
    }
  } catch (error: any) {
    console.error(`Error in getDriveFiles for ${driveId}:`, error.message);
    return [];
  }
}

export async function storeMetadata(folderPath: string, metadata: Omit<FileInfo, 'id'>[]): Promise<void> {
  await ensureStorageDir();
  
  // Find the drive that contains this folder
  const drives = await getStoredDrives();
  const drive = drives.find(d => folderPath.startsWith(d.path));
  
  if (!drive) {
    throw new Error('No drive found for folder path');
  }
  
  // Get existing files for this drive
  const existingFiles = await getDriveFiles(drive.id);
  
  // Remove files that are in the same folder
  const filteredFiles = existingFiles.filter(file => !file.folderPath.startsWith(folderPath));
  
  // Add new metadata with IDs
  const newFiles = metadata.map(file => ({
    ...file,
    id: generateId(),
    driveId: drive.id
  }));
  
  // Store updated file list
  await storeFileTree(drive.id, [...filteredFiles, ...newFiles]);
}

export async function getStoredMetadata(folderPath: string): Promise<FileInfo[]> {
  const drives = await getStoredDrives();
  const drive = drives.find(d => folderPath.startsWith(d.path));
  
  if (!drive) {
    return [];
  }
  
  const files = await getDriveFiles(drive.id);
  return files.filter(file => file.folderPath === folderPath);
}

export async function updateFileSize(driveId: string, filePath: string, newSize: number): Promise<void> {
  try {
    await ensureStorageDir();
    
    const files = await getDriveFiles(driveId);
    const fileIndex = files.findIndex(file => file.path === filePath);
    
    if (fileIndex !== -1) {
      files[fileIndex].size = newSize;
      await storeFileTree(driveId, files);
      
      // Update memory cache if available
      if (memoryCache) {
        memoryCache.setFiles(driveId, files);
      }
    } else {
      console.warn(`File not found for size update: ${filePath} in drive ${driveId}`);
    }
  } catch (error: any) {
    console.error(`Error updating file size for ${filePath} in drive ${driveId}:`, error.message);
    throw error;
  }
}

// Search operations
export async function searchFiles(query: string): Promise<SearchResult[]> {
  // Build index if not already built
  if (!searchIndex.getStatus().isBuilt) {
    await searchIndex.buildIndex();
  }
  
  return searchIndex.search(query);
}

export async function buildSearchIndex(): Promise<void> {
  await searchIndex.buildIndex();
}

export async function getSearchIndexStatus(): Promise<{ isBuilt: boolean; totalIndexed: number }> {
  return searchIndex.getStatus();
}

// Utility functions
function generateId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

export { generateId };

// IndexedDB-like caching for better performance
class MemoryCache {
  private drives: Map<string, DriveInfo> = new Map();
  private files: Map<string, FileInfo[]> = new Map();
  
  async initialize(): Promise<void> {
    try {
      // Load drives into memory
      const drives = await getStoredDrives();
      this.drives.clear();
      drives.forEach(drive => this.drives.set(drive.id, drive));
    } catch (error: any) {
      console.error('Error initializing memory cache:', error.message);
      // Continue with empty cache if initialization fails
    }
  }
  
  getDrive(driveId: string): DriveInfo | undefined {
    return this.drives.get(driveId);
  }
  
  getAllDrives(): DriveInfo[] {
    return Array.from(this.drives.values());
  }
  
  setDrive(drive: DriveInfo): void {
    this.drives.set(drive.id, drive);
  }
  
  deleteDrive(driveId: string): void {
    this.drives.delete(driveId);
    this.files.delete(driveId);
  }
  
  async getFiles(driveId: string): Promise<FileInfo[]> {
    try {
      if (this.files.has(driveId)) {
        return this.files.get(driveId)!;
      }
      
      const files = await getDriveFiles(driveId);
      this.files.set(driveId, files);
      return files;
    } catch (error: any) {
      console.error(`Error getting files from memory cache for drive ${driveId}:`, error.message);
      return [];
    }
  }
  
  setFiles(driveId: string, files: FileInfo[]): void {
    this.files.set(driveId, files);
  }
  
  clearFiles(driveId: string): void {
    this.files.delete(driveId);
  }
}

export const memoryCache = new MemoryCache();

// Streaming support for very large datasets
interface StreamingConfig {
  chunkSize: number;
  memoryThreshold: number; // MB
  compressionThreshold: number; // MB
  batchWriteSize: number;
  enableCompression: boolean;
}

// Default streaming configuration
const DEFAULT_STREAMING_CONFIG: StreamingConfig = {
  chunkSize: 1000, // Process 1000 files at a time
  memoryThreshold: 500, // 500MB memory threshold
  compressionThreshold: 10, // 10MB compression threshold
          batchWriteSize: 3000, // Write 3000 files at a time
  enableCompression: true
};

// Memory monitoring utilities
class MemoryMonitor {
  private static instance: MemoryMonitor;
  private memoryUsage: NodeJS.MemoryUsage | null = null;
  private lastCheck = 0;
  private checkInterval = 5000; // Check every 5 seconds

  static getInstance(): MemoryMonitor {
    if (!MemoryMonitor.instance) {
      MemoryMonitor.instance = new MemoryMonitor();
    }
    return MemoryMonitor.instance;
  }

  getMemoryUsage(): NodeJS.MemoryUsage {
    const now = Date.now();
    if (!this.memoryUsage || now - this.lastCheck > this.checkInterval) {
      this.memoryUsage = process.memoryUsage();
      this.lastCheck = now;
    }
    return this.memoryUsage;
  }

  getMemoryUsageMB(): { rss: number; heapUsed: number; heapTotal: number; external: number } {
    const usage = this.getMemoryUsage();
    return {
      rss: Math.round(usage.rss / 1024 / 1024),
      heapUsed: Math.round(usage.heapUsed / 1024 / 1024),
      heapTotal: Math.round(usage.heapTotal / 1024 / 1024),
      external: Math.round(usage.external / 1024 / 1024)
    };
  }

  isMemoryHigh(thresholdMB: number = 500): boolean {
    const usage = this.getMemoryUsageMB();
    return usage.heapUsed > thresholdMB;
  }

  async forceGarbageCollection(): Promise<void> {
    if (global.gc) {
      global.gc();
      console.log('Forced garbage collection');
    }
  }

  logMemoryUsage(context: string = ''): void {
    const usage = this.getMemoryUsageMB();
    console.log(`Memory usage ${context}: RSS: ${usage.rss}MB, Heap: ${usage.heapUsed}/${usage.heapTotal}MB, External: ${usage.external}MB`);
  }
}

// Streaming file processor for large datasets
class StreamingFileProcessor {
  private config: StreamingConfig;
  private memoryMonitor: MemoryMonitor;
  private processedCount = 0;
  private writtenCount = 0;
  private currentBatch: Omit<FileInfo, 'id'>[] = [];
  private tempFiles: string[] = [];
  private driveId: string;
  private outputPath: string;

  constructor(driveId: string, config: StreamingConfig = DEFAULT_STREAMING_CONFIG) {
    this.config = config;
    this.memoryMonitor = MemoryMonitor.getInstance();
    this.driveId = driveId;
    this.outputPath = path.join(FILES_DIR, `${driveId}.json`);
  }

  async processFile(fileInfo: Omit<FileInfo, 'id'>): Promise<void> {
    this.currentBatch.push(fileInfo);
    this.processedCount++;

    // Check if we need to write the current batch
    if (this.currentBatch.length >= this.config.chunkSize) {
      await this.writeBatch();
    }

    // Check memory usage and force GC if needed
    if (this.memoryMonitor.isMemoryHigh(this.config.memoryThreshold)) {
      console.log(`Memory threshold reached (${this.config.memoryThreshold}MB), forcing garbage collection`);
      await this.memoryMonitor.forceGarbageCollection();
    }
  }

  private async writeBatch(): Promise<void> {
    if (this.currentBatch.length === 0) return;

    try {
      // Create temporary file for this batch
      const tempFile = path.join(FILES_DIR, `${this.driveId}_temp_${Date.now()}_${this.writtenCount}.json`);
      
      // Write batch to temporary file
      const batchData = {
        batchIndex: this.writtenCount,
        timestamp: new Date().toISOString(),
        count: this.currentBatch.length,
        files: this.currentBatch
      };

      // Compress if enabled and data is large enough
      let dataToWrite: Buffer | string;
      if (this.config.enableCompression && JSON.stringify(batchData).length > this.config.compressionThreshold * 1024 * 1024) {
        dataToWrite = await compressData(batchData);
        console.log(`Compressed batch ${this.writtenCount} (${this.currentBatch.length} files)`);
      } else {
        dataToWrite = JSON.stringify(batchData, null, 2);
      }

      await fs.writeFile(tempFile, dataToWrite);
      this.tempFiles.push(tempFile);
      this.writtenCount++;

      // Clear the batch to free memory
      this.currentBatch = [];
      
      console.log(`Wrote batch ${this.writtenCount - 1} with ${batchData.count} files`);
    } catch (error: any) {
      console.error(`Error writing batch: ${error.message}`);
      throw error;
    }
  }

  async finalize(): Promise<void> {
    // Write any remaining files in the current batch
    if (this.currentBatch.length > 0) {
      await this.writeBatch();
    }

    // Combine all temporary files into the final output
    await this.combineTempFiles();
    
    // Clean up temporary files
    await this.cleanupTempFiles();
  }

  private async combineTempFiles(): Promise<void> {
    if (this.tempFiles.length === 0) {
      console.log('No temporary files to combine');
      return;
    }

    console.log(`Combining ${this.tempFiles.length} temporary files into final output...`);
    
    const finalData: Omit<FileInfo, 'id'>[] = [];
    let totalFiles = 0;

    for (const tempFile of this.tempFiles) {
      try {
        const tempData = await readJsonWithCompression(tempFile);
        if (tempData.files && Array.isArray(tempData.files)) {
          finalData.push(...tempData.files);
          totalFiles += tempData.files.length;
        }
      } catch (error: any) {
        console.error(`Error reading temporary file ${tempFile}: ${error.message}`);
      }
    }

    // Write the combined data to the final output file
    const finalOutput = {
      driveId: this.driveId,
      totalFiles,
      totalBatches: this.writtenCount,
      processedAt: new Date().toISOString(),
      files: finalData
    };

    await atomicWriteJson(this.outputPath, finalOutput, { 
      spaces: 2, 
      compress: this.config.enableCompression 
    });

    console.log(`Finalized streaming processing: ${totalFiles} files in ${this.writtenCount} batches`);
  }

  private async cleanupTempFiles(): Promise<void> {
    for (const tempFile of this.tempFiles) {
      try {
        await fs.remove(tempFile);
      } catch (error: any) {
        console.warn(`Failed to remove temporary file ${tempFile}: ${error.message}`);
      }
    }
    this.tempFiles = [];
  }

  getProgress(): { processed: number; written: number; batches: number } {
    return {
      processed: this.processedCount,
      written: this.writtenCount,
      batches: this.tempFiles.length
    };
  }

  getMemoryUsage(): NodeJS.MemoryUsage {
    return this.memoryMonitor.getMemoryUsage();
  }
}

// Streaming JSON storage for large datasets
class StreamingJsonStorage {
  private config: StreamingConfig;
  private memoryMonitor: MemoryMonitor;

  constructor(config: StreamingConfig = DEFAULT_STREAMING_CONFIG) {
    this.config = config;
    this.memoryMonitor = MemoryMonitor.getInstance();
  }

  async storeFileTreeStreaming(driveId: string, fileTree: Omit<FileInfo, 'id'>[]): Promise<void> {
    console.log(`Starting streaming storage for drive ${driveId} with ${fileTree.length} files`);
    
    const processor = new StreamingFileProcessor(driveId, this.config);
    const startTime = Date.now();

    try {
      // Process files in chunks
      for (let i = 0; i < fileTree.length; i += this.config.chunkSize) {
        const chunk = fileTree.slice(i, i + this.config.chunkSize);
        
        for (const fileInfo of chunk) {
          await processor.processFile(fileInfo);
        }

        // Log progress every 10 chunks
        if (i % (this.config.chunkSize * 10) === 0) {
          const progress = processor.getProgress();
          const memoryUsage = processor.getMemoryUsage();
          const elapsed = Date.now() - startTime;
          const rate = progress.processed / (elapsed / 1000);
          
          console.log(`Streaming progress: ${progress.processed}/${fileTree.length} files (${(progress.processed/fileTree.length*100).toFixed(1)}%) - ${rate.toFixed(1)} files/sec`);
          console.log(`Memory usage: ${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`);
        }
      }

      // Finalize the streaming process
      await processor.finalize();
      
      const totalTime = Date.now() - startTime;
      console.log(`Streaming storage completed in ${totalTime}ms for ${fileTree.length} files`);
      
    } catch (error: any) {
      console.error(`Error in streaming storage: ${error.message}`);
      throw error;
    }
  }

  async readFileTreeStreaming(driveId: string): Promise<FileInfo[]> {
    const filePath = path.join(FILES_DIR, `${driveId}.json`);
    
    if (!await fs.pathExists(filePath)) {
      return [];
    }

    try {
      const data = await readJsonWithCompression(filePath);
      
      if (data.files && Array.isArray(data.files)) {
        // Add IDs to the files
        return data.files.map((file: Omit<FileInfo, 'id'>, index: number) => ({
          ...file,
          id: `${driveId}_${index}`
        }));
      }
      
      return [];
    } catch (error: any) {
      console.error(`Error reading streaming file tree: ${error.message}`);
      return [];
    }
  }
}

// Global streaming storage instance
const streamingStorage = new StreamingJsonStorage(); 

// Export streaming storage functions
export { StreamingJsonStorage, StreamingFileProcessor, MemoryMonitor };
export type { StreamingConfig }; 