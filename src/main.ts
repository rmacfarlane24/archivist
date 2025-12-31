// Load environment variables first, before any other imports
import * as path from 'path';
import * as dotenv from 'dotenv';
import { existsSync } from 'fs';

// Function to find and load the environment file
function loadEnvironmentFile() {
  const possiblePaths = [];
  
  if (process.env.NODE_ENV === 'production') {
    // Try multiple possible locations for packaged apps
    possiblePaths.push(
      path.join(process.resourcesPath, '.env.production'),
      path.join(__dirname, '../.env.production'),
      path.join(process.cwd(), '.env.production'),
      path.join(path.dirname(process.execPath), '.env.production'),
      path.join(path.dirname(process.execPath), 'resources', '.env.production'),
      // Additional paths for app.asar structure
      path.join(__dirname, '../../.env.production'),
      path.join(__dirname, '../../../.env.production'),
      // Try relative to the app bundle
      path.join(path.dirname(path.dirname(__dirname)), '.env.production')
    );
  } else {
    // Development mode
    possiblePaths.push(
      path.resolve(__dirname, '../.env'),
      path.resolve(__dirname, '../.env.production')
    );
  }
  
  console.log('Environment loading debug:', {
    NODE_ENV: process.env.NODE_ENV,
    __dirname: __dirname,
    'process.cwd()': process.cwd(),
    'process.execPath': process.execPath,
    'process.resourcesPath': process.resourcesPath
  });
  
  // Try to find the first existing environment file
  for (const envPath of possiblePaths) {
    console.log(`Trying path: ${envPath}`);
    if (existsSync(envPath)) {
      console.log(`Loading environment from: ${envPath}`);
      dotenv.config({ path: envPath });
      return;
    }
  }
  
  console.error('No environment file found. Tried paths:', possiblePaths);
  
  // If no file is found, try to load from current working directory as fallback
  dotenv.config();
}

loadEnvironmentFile();

// Enable unsigned auto-updates
process.env.ELECTRON_UPDATER_ALLOW_UNSIGNED = 'true';

// Ensure critical environment variables are set for packaged apps
if (process.env.NODE_ENV === 'production' && !process.env.REACT_APP_SUPABASE_URL) {
  // Fallback values for packaged apps
  process.env.REACT_APP_SUPABASE_URL = 'https://xslphflkpeyfqcwwlrih.supabase.co';
  process.env.REACT_APP_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhzbHBoZmxrcGV5ZnFjd3dscmloIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTMyNzkwNTgsImV4cCI6MjA2ODg1NTA1OH0.WICKm7rDZ899epi_0Nz7N435V2WEQI5sNxSzCoJ40EQ';
  console.log('Applied fallback environment variables for packaged app');
}

import { app, BrowserWindow, ipcMain, dialog, protocol, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import * as fs from 'fs-extra';
import * as http from 'http';
import { exec } from 'child_process';
import { promisify } from 'util';
import { PerDriveStorage } from './per-drive-storage';
import type { DriveInfo, FileInfo, SearchResult } from './types';
import { auth, supabase } from './supabase';
import { supabaseAdmin } from './supabase-admin';

// Logging configuration
const LOG_LEVEL = process.env.LOG_LEVEL || 'info'; // 'debug', 'info', 'warn', 'error'
const isDebugMode = LOG_LEVEL === 'debug';
const isVerboseMode = LOG_LEVEL === 'debug' || LOG_LEVEL === 'info';

// Clean logging function
function log(level: 'debug' | 'info' | 'warn' | 'error', message: string, ...args: any[]) {
  if (level === 'debug' && !isDebugMode) return;
  if (level === 'info' && !isVerboseMode) return;
  
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  
  switch (level) {
    case 'debug':
      console.log(prefix, message, ...args);
      break;
    case 'info':
      console.log(prefix, message, ...args);
      break;
    case 'warn':
      console.warn(prefix, message, ...args);
      break;
    case 'error':
      console.error(prefix, message, ...args);
      break;
  }
}

// Global storage manager instance
let storageManager: PerDriveStorage | null = null;

// Helper function to generate IDs
function generateId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// Global reference to prevent garbage collection
let mainWindow: BrowserWindow | null = null;

// Global scan cancellation tracking
let currentScanProcessor: StreamingScanProcessor | null = null;
let currentScanDriveId: string | null = null;
let isScanCancelled = false; // Track cancellation state globally

// Path normalization helper
function normalizePath(inputPath: string): string {
  try {
    if (!inputPath) return inputPath;
    // Resolve, remove trailing separators, normalize unicode (macOS), and standardize separators
    const resolved = path.resolve(inputPath);
    const withoutTrailing = resolved.replace(/[\\/]+$/, '');
    const unicodeNormalized = withoutTrailing.normalize('NFC');
    return path.normalize(unicodeNormalized);
  } catch {
    return inputPath;
  }
}

// Concurrent scan prevention system
interface ScanState {
  driveId: string;
  drivePath: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  priority: number; // Higher number = higher priority
  startTime: number;
  progress: {
    processed: number;
    errors: number;
    message: string;
  };
  total: number;
  currentDirectory: string;
  canCancel: boolean;
}

interface ScanQueue {
  driveId: string;
  priority: number;
  timestamp: number;
}

// Scan management system
class ScanManager {
  private activeScans = new Map<string, ScanState>();
  private scanQueue: ScanQueue[] = [];
  private scanLock = new Map<string, boolean>(); // driveId -> isLocked
  
  // Global: is any scan currently running?
  hasAnyRunningScan(): boolean {
    for (const state of this.activeScans.values()) {
      if (state.status === 'running') return true;
    }
    return false;
  }
  
  // Check if a drive is currently being scanned
  isDriveBeingScanned(driveId: string): boolean {
    return this.activeScans.has(driveId) && 
           this.activeScans.get(driveId)!.status === 'running';
  }
  
  // Check if a drive is locked (any scan operation in progress)
  isDriveLocked(driveId: string): boolean {
    // In single-scan mode, consider the system locked if any scan is running
    return this.hasAnyRunningScan() || (this.scanLock.get(driveId) || false);
  }
  
  // Lock a drive for scanning
  lockDrive(driveId: string): boolean {
    // Enforce single-scan mode: don't allow lock if any scan is running
    if (this.hasAnyRunningScan()) {
      return false;
    }
    if (this.isDriveLocked(driveId)) {
      return false; // Already locked
    }
    this.scanLock.set(driveId, true);
    return true;
  }
  
  // Unlock a drive
  unlockDrive(driveId: string): void {
    this.scanLock.delete(driveId);
  }
  
  // Start a scan
  startScan(driveId: string, drivePath: string, priority: number = 1): boolean {
    // Enforce single-scan mode globally
    if (this.hasAnyRunningScan()) {
      console.warn(`Cannot start scan for ${driveId}. Another scan is already running.`);
      return false;
    }
    if (this.isDriveLocked(driveId)) {
      console.warn(`Drive ${driveId} is already locked for scanning`);
      return false;
    }
    
    // Lock the drive
    if (!this.lockDrive(driveId)) {
      return false;
    }
    
    // Add to active scans
    const scanState: ScanState = {
      driveId,
      drivePath,
      status: 'running',
      priority,
      startTime: Date.now(),
      progress: {
        processed: 0,
        errors: 0,
        message: 'Starting scan...'
      },
      total: 0,
      currentDirectory: drivePath,
      canCancel: true
    };
    
    this.activeScans.set(driveId, scanState);
    console.log(`Started scan for drive ${driveId} (single-scan mode)`);
    
    return true;
  }
  
  // Update scan progress
  updateScanProgress(driveId: string, progress: Partial<ScanState['progress']>, currentDirectory?: string): void {
    const scanState = this.activeScans.get(driveId);
    if (scanState) {
      scanState.progress = { ...scanState.progress, ...progress };
      if (currentDirectory) {
        scanState.currentDirectory = currentDirectory;
      }
    }
  }
  
  // Complete a scan
  completeScan(driveId: string, status: 'completed' | 'failed' | 'cancelled' = 'completed'): void {
    const scanState = this.activeScans.get(driveId);
    if (scanState) {
      scanState.status = status;
      console.log(`Scan ${status} for drive ${driveId}`);
    }
    
    // Unlock the drive
    this.unlockDrive(driveId);
    
    // Remove from active scans after a delay
    setTimeout(() => {
      this.activeScans.delete(driveId);
    }, 5000); // Keep state for 5 seconds for UI updates
  }
  
  // Cancel a scan
  cancelScan(driveId: string): boolean {
    const scanState = this.activeScans.get(driveId);
    if (scanState && scanState.canCancel) {
      scanState.status = 'cancelled';
      scanState.canCancel = false;
      console.log(`Cancelled scan for drive ${driveId}`);
      
      // Unlock the drive
      this.unlockDrive(driveId);
      
      return true;
    }
    return false;
  }
  
  // Queue-related methods are disabled in single-scan mode
  queueScan(_driveId: string, _priority: number = 1): void {
    console.log('Queueing disabled (single-scan mode)');
  }
  
  getNextScan(): ScanQueue | null {
    return null;
  }
  
  // Get scan state
  getScanState(driveId: string): ScanState | undefined {
    return this.activeScans.get(driveId);
  }
  
  // Get all active scans
  getAllActiveScans(): ScanState[] {
    return Array.from(this.activeScans.values());
  }
  
  // Get queue status
  getQueueStatus(): { queued: number; active: number } {
    return {
      queued: 0, // Always zero in single-scan mode
      active: this.hasAnyRunningScan() ? 1 : 0
    };
  }
  
  // Clear scan queue (noop)
  clearScanQueue(): { cleared: number } {
    console.log('Clear queue noop (single-scan mode)');
    return { cleared: 0 };
  }
  
  // Check for scan conflicts
  checkScanConflicts(driveId: string): { hasConflict: boolean; conflicts: string[] } {
    const conflicts: string[] = [];
    
    // Single-scan mode: block if any scan is running and it's not this drive
    if (this.hasAnyRunningScan() && !this.isDriveBeingScanned(driveId)) {
      conflicts.push('Another scan is already in progress (single-scan mode)');
    }
    
    // Check if drive is already being scanned
    if (this.isDriveBeingScanned(driveId)) {
      conflicts.push('This drive is currently being scanned');
    }
    
    return {
      hasConflict: conflicts.length > 0,
      conflicts
    };
  }
  
  // Resolve scan conflicts (no queueing)
  async resolveScanConflicts(driveId: string, _priority: number = 1): Promise<{ canStart: boolean; message: string }> {
    if (this.hasAnyRunningScan() && !this.isDriveBeingScanned(driveId)) {
      return { canStart: false, message: 'A scan is already in progress. Single-scan mode enforced.' };
    }
    
    if (this.isDriveBeingScanned(driveId)) {
      return { canStart: false, message: 'This drive is already being scanned.' };
    }
    
    return { canStart: true, message: 'No conflicts detected' };
  }
}

// Global scan manager instance
const scanManager = new ScanManager();

// Calculate directory size recursively (with caching)
const sizeCache = new Map<string, number>();
const MAX_CACHE_SIZE = 10000; // Prevent unlimited cache growth

// Function to clear size cache
function clearSizeCache(): void {
  sizeCache.clear();
  console.log('Size cache cleared');
}

// Function to manage cache size
function manageSizeCache(): void {
  if (sizeCache.size > MAX_CACHE_SIZE) {
    // Remove oldest entries (simple FIFO approach)
    const entries = Array.from(sizeCache.entries());
    const toRemove = entries.slice(0, sizeCache.size - MAX_CACHE_SIZE + 1000);
    toRemove.forEach(([key]) => sizeCache.delete(key));
    console.log(`Cleared ${toRemove.length} entries from size cache`);
  }
}

// Directories that are safe to ignore during size calculations (system/hidden)
const IGNORABLE_DIRS = new Set<string>([
  '.Spotlight-V100',
  '.TemporaryItems',
  '.Trashes',
  'System Volume Information'
]);

function isIgnorableSystemPath(p: string): boolean {
  try {
    const base = path.basename(p);
    return IGNORABLE_DIRS.has(base);
  } catch {
    return false;
  }
}

// Compute accurate totals for a set of files (files only, de-duplicate hard links by inode when available)
function computeFileTotals(files: Array<Omit<import('./sqlite-storage').FileInfo, 'id'>>): { count: number; total: number } {
  try {
    const seen = new Set<string>();
    let total = 0;
    let count = 0;
    for (const f of files) {
      if (!f || (f as any).isDirectory) continue;
      const inode = (f as any).inode as number | undefined;
      const key = inode !== undefined && inode !== null ? `inode:${inode}` : `path:${(f as any).path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const size = typeof (f as any).size === 'number' ? (f as any).size : 0;
      total += size;
      count += 1;
    }
    return { count, total };
  } catch {
    // Fallback: naive sum of files only
    const onlyFiles = files.filter((f: any) => !f.isDirectory);
    return { count: onlyFiles.length, total: onlyFiles.reduce((s: number, f: any) => s + (f.size || 0), 0) };
  }
}

async function calculateDirectorySize(dirPath: string): Promise<number> {
  // Check cache first
  if (sizeCache.has(dirPath)) {
    return sizeCache.get(dirPath)!;
  }
  
  // Skip known system directories quietly
  const baseName = path.basename(dirPath);
  if (IGNORABLE_DIRS.has(baseName)) {
    return 0;
  }

  // If the directory no longer exists, skip quietly
  if (!(await fs.pathExists(dirPath))) {
    return 0;
  }

  try {
    let totalSize = 0;
    const items = await fs.readdir(dirPath);
    
    // Add a safety check for very large directories
    if (items.length > 10000) {
      console.warn(`Large directory detected: ${dirPath} has ${items.length} items. This may take a while.`);
      
      // Process large directories in batches to prevent memory issues
      const batchSize = 1000;
      for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        
        for (const item of batch) {
          try {
          const itemPath = normalizePath(path.join(dirPath, item));
            
            // Get file stats with error handling
            let stats;
            try {
              stats = await fs.stat(itemPath);
            } catch (statError: any) {
              if (statError.code === 'ENOENT') {
                // File was deleted between readdir and stat
                console.warn(`File no longer exists during size calculation: ${itemPath}`);
                continue;
              }
              throw statError;
            }
            
            // Skip symbolic links to avoid infinite loops
            if (stats.isSymbolicLink()) {
              continue;
            }
            
            if (stats.isDirectory()) {
              totalSize += await calculateDirectorySize(itemPath);
            } else {
              totalSize += stats.size;
            }
          } catch (itemError: any) {
            // Skip items that can't be accessed
            console.warn(`Skipping item ${item} in ${dirPath} during size calculation: ${itemError.message}`);
            continue;
          }
        }
        
        // Manage cache size periodically during large directory processing
        if (i % (batchSize * 5) === 0) {
          manageSizeCache();
        }
      }
    } else {
      // Normal processing for smaller directories
    for (const item of items) {
      try {
        const itemPath = normalizePath(path.join(dirPath, item));
          
          // Get file stats with error handling
          let stats;
          try {
            stats = await fs.stat(itemPath);
          } catch (statError: any) {
            if (statError.code === 'ENOENT') {
              // File was deleted between readdir and stat
              console.warn(`File no longer exists during size calculation: ${itemPath}`);
              continue;
            }
            throw statError;
          }
        
        // Skip symbolic links to avoid infinite loops
        if (stats.isSymbolicLink()) {
          continue;
        }
        
        if (stats.isDirectory()) {
          totalSize += await calculateDirectorySize(itemPath);
        } else {
          totalSize += stats.size;
        }
      } catch (itemError: any) {
        // Skip items that can't be accessed
          console.warn(`Skipping item ${item} in ${dirPath} during size calculation: ${itemError.message}`);
        continue;
        }
      }
    }
    
    // Cache the result and manage cache size
    sizeCache.set(dirPath, totalSize);
    manageSizeCache();
    return totalSize;
  } catch (error: any) {
    if (['ENOENT', 'EACCES', 'EPERM'].includes(error?.code)) {
      console.warn(`Skipping directory ${dirPath}: ${error.code} ${error.message}`);
      return 0;
    }
    console.error(`Error calculating directory size for ${dirPath}:`, error.message);
    return 0;
  }
}

// Validation function to check scan results
function validateScanResults(allFiles: Omit<FileInfo, 'id'>[]): { isValid: boolean; issues: string[] } {
  const issues: string[] = [];
  const filesByParent = new Map<string, Omit<FileInfo, 'id'>[]>();
  
  // Group files by parent
  for (const file of allFiles) {
    const parent = file.parentPath || 'root';
    if (!filesByParent.has(parent)) {
      filesByParent.set(parent, []);
    }
    filesByParent.get(parent)!.push(file);
  }
  
  // Check for empty directories that should have files
  for (const file of allFiles) {
    if (file.isDirectory) {
      const children = filesByParent.get(file.path) || [];
      if (children.length === 0 && file.size > 0) {
        issues.push(`Directory ${file.path} has size ${file.size} but no children found`);
      }
    }
  }
  
  // Check for orphaned files (files with parent that doesn't exist)
  for (const file of allFiles) {
    if (file.parentPath && file.parentPath !== 'root') {
      const parentExists = allFiles.some(f => f.path === file.parentPath);
      if (!parentExists) {
        issues.push(`File ${file.path} has parent ${file.parentPath} that doesn't exist`);
      }
    }
  }
  
  // Check for duplicate paths
  const paths = new Set<string>();
  for (const file of allFiles) {
    if (paths.has(file.path)) {
      issues.push(`Duplicate file path found: ${file.path}`);
    }
    paths.add(file.path);
  }
  
  return {
    isValid: issues.length === 0,
    issues
  };
}

// (Removed) Network drive optimization - not needed for local drives only

// (Removed) Network drive optimization - not needed for local drives only

// Enhanced scan directory function for local drives
async function scanDirectory(
  dirPath: string, 
  parentPath: string | null, 
  depth: number, 
  scannedFiles: Set<string>,
  allFiles: Omit<FileInfo, 'id'>[],
  processedCount: { value: number },
  errorCount: { value: number },
  errors: string[],
  drivePath: string,
  driveId: string,
  inodeMap: Map<number, string[]>,
  hardLinkGroups: Map<string, string[]>,
  streamingProcessor: StreamingScanProcessor | null = null,
  fileCount?: number
): Promise<number> {
  // Check depth limit
  const MAX_DEPTH = 100;
  if (depth > MAX_DEPTH) {
    console.warn(`Maximum depth reached for ${dirPath}`);
    return 0;
  }
  
  let directorySize = 0;
  
  try {
    // Read directory contents
    const items = await fs.readdir(dirPath);
    
    // Process items in batches for local drives
    const batchSize = 3000; // Fixed batch size for local drives
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      
      // Process batch for local drives
      for (const item of batch) {
        try {
          const itemPath = path.join(dirPath, item);
          
          // Check if already scanned (prevent duplicates)
          if (scannedFiles.has(itemPath)) {
            console.warn(`Duplicate file path detected: ${itemPath}`);
            continue;
          }
          
          // Get file stats for local drive
          let stats: import('fs').Stats;
          try {
            stats = await fs.stat(itemPath);
          } catch (statError: any) {
            if (statError.code === 'ENOENT') {
              // File was deleted between readdir and stat
              console.warn(`File no longer exists: ${itemPath}`);
              continue;
            }
            throw statError;
          }
            
            // Skip symbolic links to avoid infinite loops
            if (stats.isSymbolicLink()) {
              console.log(`Skipping symbolic link: ${itemPath}`);
              continue;
            }
            
            let fileSize = stats.size;
          let childSize = 0;
          
            if (stats.isDirectory()) {
            // Recursively scan subdirectory
            childSize = await scanDirectory(
              itemPath, 
              dirPath, 
              depth + 1, 
              scannedFiles,
              allFiles,
              processedCount,
              errorCount,
              errors,
              drivePath,
              driveId,
              inodeMap,
              hardLinkGroups,
              streamingProcessor,
              fileCount
            );
            fileSize = childSize;
          }
          
          // Handle hard links
          let inode: number | undefined;
          let hardLinkCount: number | undefined;
          let isHardLink = false;
          let hardLinkGroup: string | undefined;
          
          if (!stats.isDirectory() && stats.nlink > 1) {
            // This is a hard link
            inode = stats.ino;
            hardLinkCount = stats.nlink;
            isHardLink = true;
            
            // Track inode for hard link detection
            if (inode !== undefined) {
              if (!inodeMap.has(inode)) {
                inodeMap.set(inode, []);
              }
              inodeMap.get(inode)!.push(itemPath);
              
              // Create hard link group if this is the first occurrence
              if (inodeMap.get(inode)!.length === 1) {
                hardLinkGroup = `hardlink_${inode}_${Date.now()}`;
                hardLinkGroups.set(hardLinkGroup, [itemPath]);
              } else {
                // Find existing group for this inode
                for (const [groupId, paths] of hardLinkGroups.entries()) {
                  if (paths.includes(inodeMap.get(inode)![0])) {
                    hardLinkGroup = groupId;
                    paths.push(itemPath);
                    break;
                  }
                }
              }
              
              console.log(`Hard link detected: ${itemPath} (inode: ${inode}, links: ${hardLinkCount})`);
            }
            }
            
            const fileInfo: Omit<FileInfo, 'id'> = {
              name: item,
              path: itemPath,
              // The parent of an item inside dirPath is dirPath itself (normalized)
              parentPath: normalizePath(dirPath),
              size: fileSize,
              created: stats.birthtime.toISOString(),
              modified: stats.mtime.toISOString(),
              isDirectory: stats.isDirectory(),
              folderPath: normalizePath(drivePath),
              driveId: driveId,
            depth: depth,
            // Hard link metadata
            inode,
            hardLinkCount,
            isHardLink,
            hardLinkGroup
          };
          
          // Check for cancellation before processing each file
          if (streamingProcessor && streamingProcessor.getIsCancelled()) {
            console.log('Scan cancelled during directory scanning - stopping scan');
            throw new Error('Scan cancelled by user');
          }
          
          // Add file to tracking sets
          scannedFiles.add(itemPath);
          
          // Use streaming processor if available, otherwise add to allFiles
          if (streamingProcessor) {
            await streamingProcessor.processFile(fileInfo);
          } else {
            allFiles.push(fileInfo);
          }
          
          processedCount.value++;
          
          // Add to directory size (only count once for hard links)
          if (!isHardLink || (inode !== undefined && inodeMap.get(inode)!.indexOf(itemPath) === 0)) {
            directorySize += fileSize;
          }
          
          // Update scan progress
          scanManager.updateScanProgress(driveId, {
            processed: processedCount.value,
            errors: errorCount.value,
            message: `Processed ${processedCount.value} files, ${errorCount.value} errors`
          });
          
          // Send batch progress updates every 3000 files for progressive rendering
          if (processedCount.value % 3000 === 0 && mainWindow) {
            const batchFiles = allFiles.slice(-3000); // Get last 3000 files
            log('debug', `Sending batch update: ${batchFiles.length} files, processed: ${processedCount.value}`);
            log('debug', `mainWindow exists: ${!!mainWindow}, webContents exists: ${!!mainWindow.webContents}`);
            
            try {
              const progressEvent = {
                type: 'batch',
                driveId: driveId,
                fileCount: batchFiles.length,
                processed: processedCount.value,
                total: fileCount,
                message: `Processed ${processedCount.value} files...`
              };
              
              console.log('[BACKEND PROGRESS DEBUG] Sending batch event:', progressEvent);
              console.log('[BACKEND PROGRESS DEBUG] fileCount parameter value:', fileCount);
              console.log('[BACKEND PROGRESS DEBUG] processedCount.value:', processedCount.value);
              
              mainWindow.webContents.send('scan-progress', progressEvent);
              console.log('[BACKEND PROGRESS DEBUG] Batch event sent successfully');
              log('debug', `Batch update sent successfully`);
              
              // Store this batch progressively based on scan type
              if (storageManager && batchFiles.length > 0) {
                const isSyncScan = (global as any).isSyncScan && (global as any).currentSyncDriveId === driveId;
                
                if (isSyncScan) {
                  log('debug', `Storing batch of ${batchFiles.length} files in NEW scan database (SYNC mode)...`);
                  try {
                    await storageManager.storeFileTreeToNewDatabase(driveId, batchFiles);
                    log('debug', `Batch stored successfully in NEW scan database (SYNC mode)`);
                  } catch (storageError) {
                    console.error(`[PROGRESSIVE] Failed to store batch in NEW scan database (SYNC mode):`, storageError);
                  }
                } else {
                  log('debug', `Storing batch of ${batchFiles.length} files directly in main database (ADD NEW mode)...`);
                  try {
                    await storageManager.storeFileTreeProgressive(driveId, batchFiles);
                    log('debug', `Batch stored successfully in main database (ADD NEW mode)`);
                  } catch (storageError) {
                    console.error(`[PROGRESSIVE] Failed to store batch in main database (ADD NEW mode):`, storageError);
                  }
                }
              }
            } catch (error) {
              console.error(`[PROGRESSIVE] Failed to send batch update:`, error);
            }
          }
          
        } catch (itemError: any) {
          if (isIgnorableSystemPath(path.join(dirPath, item)) && (itemError?.code === 'EPERM' || itemError?.code === 'EACCES')) {
            console.warn(`Skipping system item ${path.join(dirPath, item)}: ${itemError.code}`);
          } else {
            errorCount.value++;
            const errorMsg = `Error processing item ${item} in ${dirPath}: ${itemError.message}`;
            console.error(errorMsg);
            errors.push(errorMsg);
          }
          // Continue with next item instead of stopping
        }
      }
      
      // Progress update for local drives
      if (processedCount.value % 3000 === 0) {
        console.log(`Scan progress: Processed ${processedCount.value} files, ${errorCount.value} errors`);
        if (mainWindow) {
          mainWindow.webContents.send('scan-progress', {
            type: 'progress',
            message: `Scan progress: Processed ${processedCount.value} files, ${errorCount.value} errors`
          });
        }
      }
    }
  } catch (error: any) {
    if (isIgnorableSystemPath(dirPath) && (error?.code === 'EPERM' || error?.code === 'EACCES')) {
      console.warn(`Skipping system directory ${dirPath}: ${error.code} ${error.message}`);
    } else {
      errorCount.value++;
      const errorMsg = `Error scanning directory ${dirPath}: ${error.message}`;
      console.error(errorMsg);
      errors.push(errorMsg);
    }
  }
  
  return directorySize;
}

async function scanDriveTree(drivePath: string, driveId: string, fileCount?: number): Promise<Omit<FileInfo, 'id'>[]> {
  try {
    // Check for scan conflicts before starting
    const conflictResolution = await scanManager.resolveScanConflicts(driveId, 1);
    if (!conflictResolution.canStart) {
      throw new Error(`Cannot start scan: ${conflictResolution.message}`);
    }
    
    // Start the scan
    if (!scanManager.startScan(driveId, drivePath, 1)) {
      throw new Error('Failed to start scan - drive is locked');
    }
    
    const processedCount = { value: 0 };
    const errorCount = { value: 0 };
    const errors: string[] = [];
    const MAX_DEPTH = 100; // Prevent stack overflow
    const PROGRESS_INTERVAL = 5000; // Less frequent progress updates
    
    console.log(`Starting scan of drive: ${drivePath}`);
    
    // Determine if we should use streaming for this scan
    const streamingConfig = { ...DEFAULT_STREAMING_SCAN_CONFIG };
    const useStreaming = streamingConfig.enableStreaming; // Always use streaming for local drives
    
    let streamingProcessor: StreamingScanProcessor | null = null;
    let allFiles: Omit<FileInfo, 'id'>[] = [];
    
    if (useStreaming) {
      console.log('Using streaming processing for large dataset support');
      streamingProcessor = new StreamingScanProcessor(streamingConfig, fileCount);
      
      // Track the current processor for cancellation
      currentScanProcessor = streamingProcessor;
      currentScanDriveId = driveId;
      
      // Check for early cancellation
      if (isScanCancelled) {
        console.log('🚫 [CANCELLATION] ===== EARLY CANCELLATION DETECTED =====');
        console.log('🚫 [CANCELLATION] Scan cancelled before starting file processing');
        throw new Error('Scan was cancelled by user');
      }
    } else {
      allFiles = [];
    }
    
    // Don't send start event immediately - let frontend populate drive info first
    // The start event will be sent when we actually start processing files
    console.log('[BACKEND PROGRESS DEBUG] Skipping immediate start event - will send when file processing begins');
    
    // Add timeout protection for local drives
    const timeout = setTimeout(() => {
      const timeoutMinutes = 30;
      console.error(`Drive scan timed out after ${timeoutMinutes} minutes`);
      scanManager.completeScan(driveId, 'failed');
      if (mainWindow) {
        mainWindow.webContents.send('scan-progress', {
          type: 'complete',
          processed: processedCount.value,
          errors: errorCount.value + 1,
          message: `Scan timed out after ${timeoutMinutes} minutes`
        });
      }
    }, 30 * 60 * 1000);
    
    // Track scanned files for validation (with cleanup)
    const scannedFiles = new Set<string>();
    
    // Hard link tracking
    const inodeMap = new Map<number, string[]>(); // inode -> array of file paths
    const hardLinkGroups = new Map<string, string[]>(); // group ID -> array of file paths
    
    // Memory management for large scans
    let memoryCheckCount = 0;
    const MEMORY_CHECK_INTERVAL = 10000; // Check memory every 10k files
    
    // Check for scan cancellation periodically
    const checkCancellation = () => {
      const scanState = scanManager.getScanState(driveId);
      if (scanState && scanState.status === 'cancelled') {
        throw new Error('Scan was cancelled by user');
      }
    };
    
    // Scan the contents of the drive
    try {
      const items = await fs.readdir(drivePath);
      
      // Now send the start event since we're about to process files
      if (mainWindow) {
        console.log('[BACKEND PROGRESS DEBUG] Sending start event now that file processing is beginning:', { type: 'start', driveId, total: fileCount, message: `Starting scan of drive: ${drivePath}${useStreaming ? ' (streaming mode)' : ''}` });
        mainWindow.webContents.send('scan-progress', {
          type: 'start',
          driveId: driveId,
          total: fileCount,
          message: `Starting scan of drive: ${drivePath}${useStreaming ? ' (streaming mode)' : ''}`
        });
      }
      
      for (const item of items) {
        try {
          const itemPath = normalizePath(path.join(drivePath, item));
          
          // Check if already scanned
          if (scannedFiles.has(itemPath)) {
            continue;
          }
          
          let stats;
          try {
            stats = await fs.stat(itemPath);
          } catch (statError: any) {
            if (statError.code === 'ENOENT') {
              console.warn(`File no longer exists: ${itemPath}`);
              continue;
            }
            throw statError;
          }
          
          // Skip symbolic links
          if (stats.isSymbolicLink()) {
            console.log(`Skipping symbolic link: ${itemPath}`);
            continue;
          }
          
          let fileSize = stats.size;
          let childSize = 0;
          
          if (stats.isDirectory()) {
            // Recursively scan subdirectory
            childSize = await scanDirectory(
              itemPath, 
              drivePath, 
             1, 
              scannedFiles,
              allFiles,
              processedCount,
              errorCount,
              errors,
              drivePath,
              driveId,
              inodeMap,
              hardLinkGroups,
              streamingProcessor,
              fileCount
            );
            fileSize = childSize;
          }
          
          // Handle hard links for root items
          let inode: number | undefined;
          let hardLinkCount: number | undefined;
          let isHardLink = false;
          let hardLinkGroup: string | undefined;
          
          if (!stats.isDirectory() && stats.nlink > 1) {
            // This is a hard link
            inode = stats.ino;
            hardLinkCount = stats.nlink;
            isHardLink = true;
            
            // Track inode for hard link detection
            if (inode !== undefined) {
              if (!inodeMap.has(inode)) {
                inodeMap.set(inode, []);
              }
              inodeMap.get(inode)!.push(itemPath);
              
              // Create hard link group if this is the first occurrence
              if (inodeMap.get(inode)!.length === 1) {
                hardLinkGroup = `hardlink_${inode}_${Date.now()}`;
                hardLinkGroups.set(hardLinkGroup, [itemPath]);
              } else {
                // Find existing group for this inode
                for (const [groupId, paths] of hardLinkGroups.entries()) {
                  if (paths.includes(inodeMap.get(inode)![0])) {
                    hardLinkGroup = groupId;
                    paths.push(itemPath);
                    break;
                  }
                }
              }
              
              console.log(`Hard link detected (root): ${itemPath} (inode: ${inode}, links: ${hardLinkCount})`);
            }
          }
          
          const fileInfo: Omit<FileInfo, 'id'> = {
            name: item,
            path: itemPath,
            parentPath: '', // Root items have empty string parent path
            size: fileSize,
            created: stats.birthtime.toISOString(),
            modified: stats.mtime.toISOString(),
            isDirectory: stats.isDirectory(),
            folderPath: normalizePath(drivePath),
            driveId: driveId,
            depth: 0,
            // Hard link metadata
            inode,
            hardLinkCount,
            isHardLink,
            hardLinkGroup
          };
          
          // Add file to tracking sets
          scannedFiles.add(itemPath);
          
          // Check for cancellation before processing each file
          if (streamingProcessor && streamingProcessor.getIsCancelled()) {
            console.log('Scan cancelled during file processing - stopping scan');
            throw new Error('Scan cancelled by user');
          }
          
          // Use streaming processor if available, otherwise add to allFiles
          if (streamingProcessor) {
            await streamingProcessor.processFile(fileInfo);
          } else {
            allFiles.push(fileInfo);
          }
          
          processedCount.value++;
          
          // Send batch progress updates every 3000 files for progressive rendering
          if (processedCount.value % 3000 === 0 && mainWindow) {
            const batchFiles = allFiles.slice(-3000); // Get last 3000 files
            log('debug', `Sending batch update: ${batchFiles.length} files, processed: ${processedCount.value}`);
            log('debug', `mainWindow exists: ${!!mainWindow}, webContents exists: ${!!mainWindow.webContents}`);
            
            try {
              const progressEvent = {
                type: 'batch',
                driveId: driveId,
                fileCount: batchFiles.length,
                processed: processedCount.value,
                total: fileCount,
                message: `Processed ${processedCount.value} files...`
              };
              
              console.log('[BACKEND PROGRESS DEBUG] Sending batch event:', progressEvent);
              console.log('[BACKEND PROGRESS DEBUG] fileCount parameter value:', fileCount);
              console.log('[BACKEND PROGRESS DEBUG] processedCount.value:', processedCount.value);
              
              mainWindow.webContents.send('scan-progress', progressEvent);
              console.log('[BACKEND PROGRESS DEBUG] Batch event sent successfully');
              log('debug', `Batch update sent successfully`);
              
              // Store this batch progressively based on scan type
              if (storageManager && batchFiles.length > 0) {
                const isSyncScan = (global as any).isSyncScan && (global as any).currentSyncDriveId === driveId;
                
                if (isSyncScan) {
                  log('debug', `Storing batch of ${batchFiles.length} files in NEW scan database (SYNC mode)...`);
                  try {
                    await storageManager.storeFileTreeToNewDatabase(driveId, batchFiles);
                    log('debug', `Batch stored successfully in NEW scan database (SYNC mode)`);
                  } catch (storageError) {
                    console.error(`[PROGRESSIVE] Failed to store batch in NEW scan database (SYNC mode):`, storageError);
                  }
                } else {
                  log('debug', `Storing batch of ${batchFiles.length} files directly in main database (ADD NEW mode)...`);
                  try {
                    await storageManager.storeFileTreeProgressive(driveId, batchFiles);
                    log('debug', `Batch stored successfully in main database (ADD NEW mode)`);
                  } catch (storageError) {
                    console.error(`[PROGRESSIVE] Failed to store batch in main database (ADD NEW mode):`, storageError);
                  }
                }
              }
            } catch (error) {
              console.error(`[PROGRESSIVE] Failed to send batch update:`, error);
            }
          }
          
        } catch (itemError: any) {
          const currentPath = normalizePath(path.join(drivePath, item));
          if (isIgnorableSystemPath(currentPath) && (itemError?.code === 'EPERM' || itemError?.code === 'EACCES')) {
            console.warn(`Skipping system root item ${currentPath}: ${itemError.code}`);
          } else {
            errorCount.value++;
            const errorMsg = `Error processing root item ${item}: ${itemError.message}`;
            console.error(errorMsg);
            errors.push(errorMsg);
          }
        }
      }
    } catch (error: any) {
      if (isIgnorableSystemPath(drivePath) && (error?.code === 'EPERM' || error?.code === 'EACCES')) {
        console.warn(`Skipping system directory at root ${drivePath}: ${error.code} ${error.message}`);
      } else {
        errorCount.value++;
        const errorMsg = `Error reading drive root ${drivePath}: ${error.message}`;
        console.error(errorMsg);
        errors.push(errorMsg);
      }
    }
    
    // Clear timeout since scan completed
    clearTimeout(timeout);
    
    // Clean up scannedFiles set to free memory
    scannedFiles.clear();
    
    // Get final results from streaming processor if used (but only if not cancelled)
    if (streamingProcessor && !streamingProcessor.getIsCancelled()) {
      console.log('Finalizing streaming processor...');
      allFiles = await streamingProcessor.finalize();
    } else if (streamingProcessor && streamingProcessor.getIsCancelled()) {
      console.log('Streaming processor was cancelled');
      console.log('Note: Backup restoration will be handled by cancelScan() handler');
      
      allFiles = []; // Return empty array since scan was cancelled
    }
    
    // Report hard link statistics
    const hardLinkStats = {
      totalHardLinks: 0,
      uniqueHardLinkGroups: hardLinkGroups.size,
      totalInodes: inodeMap.size
    };
    
    for (const [inode, paths] of inodeMap.entries()) {
      hardLinkStats.totalHardLinks += paths.length;
    }
    
    if (hardLinkStats.totalHardLinks > 0) {
      console.log(`Hard link statistics: ${hardLinkStats.totalHardLinks} hard links found across ${hardLinkStats.uniqueHardLinkGroups} groups (${hardLinkStats.totalInodes} unique inodes)`);
    }
    
    console.log(`Scan completed. Processed ${processedCount.value} files with ${errorCount.value} errors.`);
    if (errors.length > 0) {
      console.log('Errors encountered:', errors.slice(0, 10)); // Show first 10 errors
    }
    
    // Validate scan results (only for smaller datasets to avoid performance issues)
    if (allFiles.length < 100000) {
      const validation = validateScanResults(allFiles);
      if (!validation.isValid) {
        console.warn('Scan validation issues found:');
        validation.issues.slice(0, 10).forEach(issue => console.warn(`  - ${issue}`));
        if (validation.issues.length > 10) {
          console.warn(`  ... and ${validation.issues.length - 10} more issues`);
        }
      } else {
        console.log('Scan validation passed - no issues detected');
      }
    } else {
      console.log('Skipping validation for large dataset (>100k files) to maintain performance');
    }
    
    // Check for cancellation BEFORE marking scan as completed
    const finalScanState = scanManager.getScanState(driveId);
    if (finalScanState && finalScanState.status === 'cancelled' || isScanCancelled) {
      console.log('🚫 [CANCELLATION] ===== SCAN CANCELLATION DETECTED BEFORE COMPLETION =====');
      console.log('🚫 [CANCELLATION] Drive ID:', driveId);
      console.log('🚫 [CANCELLATION] Scan state status:', finalScanState?.status || 'undefined');
      console.log('🚫 [CANCELLATION] Global cancellation state:', isScanCancelled);
      console.log('🚫 [CANCELLATION] NOT marking scan as completed - scan was cancelled');
      throw new Error('Scan was cancelled by user');
    }
    
    // Complete the scan (only if not cancelled)
    scanManager.completeScan(driveId, 'completed');
    log('debug', `Scan marked as completed for drive ${driveId}`);
    
    // Note: No backup cleanup needed with new database approach
    // New databases are cleaned up by start-sync-scan handler on success/failure
    log('debug', `===== SCAN COMPLETED SUCCESSFULLY =====`);
    log('debug', `Note: New database cleanup handled by start-sync-scan handler`);
    
    // Send completion progress update
    if (mainWindow) {
      mainWindow.webContents.send('scan-progress', {
        type: 'complete',
        processed: processedCount.value,
        errors: errorCount.value,
        message: `Scan completed. Processed ${processedCount.value} files with ${errorCount.value} errors.`,
        errorMessages: errors.slice(0, 50)
      });
    }
    
    return allFiles;
  } catch (error: any) {
    // Handle scan cancellation or other errors
    const scanState = scanManager.getScanState(driveId);
    if (scanState && scanState.status === 'cancelled' || error.message === 'Scan cancelled by user' || isScanCancelled) {
      console.log('🚫 [CANCELLATION] ===== SCAN CANCELLATION DETECTED IN SCANNING FUNCTION =====');
      console.log('🚫 [CANCELLATION] Drive ID:', driveId);
      console.log('🚫 [CANCELLATION] Scan state status:', scanState?.status || 'undefined');
      console.log('🚫 [CANCELLATION] Error message:', error.message);
      console.log('🚫 [CANCELLATION] Global cancellation state:', isScanCancelled);
      console.log('🚫 [CANCELLATION] NOT marking scan as completed - letting cancelScan() handle it');
      console.log('🚫 [CANCELLATION] Throwing cancellation error to stop scanning...');
      
      // Don't mark scan as completed here - let cancelScan() handle it
      throw new Error('Scan was cancelled by user');
    } else {
      console.log('❌ [ERROR] Scan failed - marking as failed');
      scanManager.completeScan(driveId, 'failed');
      throw error;
    }
  }
}

async function getDriveInfo(drivePath: string): Promise<Omit<DriveInfo, 'id' | 'addedDate'>> {
  try {
    const stats = await fs.stat(drivePath);
    const driveName = path.basename(drivePath);
    
    let totalCapacity = 0;
    let usedSpace = 0;
    let freeSpace = 0;
    let serialNumber = '';
    let formatType = '';
    
    // Try to get disk information, but fall back gracefully if it fails
    try {
      if (process.platform === 'darwin') {
        // macOS
        const { stdout: dfOutput } = await promisify(exec)(`df -k "${drivePath}"`);
        const lines = dfOutput.trim().split('\n');
        if (lines.length > 1) {
          const parts = lines[1].split(/\s+/);
          if (parts.length >= 4) {
            // df -k shows sizes in 1024-byte blocks
            totalCapacity = parseInt(parts[1]) * 1024;
            usedSpace = parseInt(parts[2]) * 1024;
            freeSpace = parseInt(parts[3]) * 1024;
          }
        }
        
        // Try to get disk info using diskutil, but don't fail if it doesn't work
        try {
          const { stdout: diskInfo } = await promisify(exec)(`diskutil info "${drivePath}"`);
          // Serial number retrieval removed
          
          const formatMatch = diskInfo.match(/File System Personality:\s+(.+)/);
          if (formatMatch) {
            formatType = formatMatch[1].trim();
          }
          
          // Also try to get more accurate size info from diskutil
          const totalSizeMatch = diskInfo.match(/Total Size:\s+([0-9,]+)\s+\(([0-9,]+)\s+Bytes\)/);
          if (totalSizeMatch) {
            const totalSizeBytes = parseInt(totalSizeMatch[2].replace(/,/g, ''));
            if (totalSizeBytes > 0) {
              totalCapacity = totalSizeBytes;
            }
          }
        } catch (diskutilError: any) {
          // This is expected for regular folders, not actual disk drives
          console.log('Could not get detailed drive info (this is normal for folders):', diskutilError.message);
        }
      } else if (process.platform === 'win32') {
        // Windows
        const { stdout: wmicOutput } = await promisify(exec)(`wmic logicaldisk where "DeviceID='${drivePath.charAt(0)}:'" get Size,FreeSpace,FileSystem /format:csv`);
        const lines = wmicOutput.trim().split('\n');
        if (lines.length > 1) {
          const parts = lines[1].split(',');
          if (parts.length >= 4) {
            totalCapacity = parseInt(parts[1]) || 0;
            freeSpace = parseInt(parts[2]) || 0;
            usedSpace = totalCapacity - freeSpace;
            formatType = parts[3] || '';
          }
        }
      } else {
        // Linux and other Unix-like systems
        const { stdout: dfOutput } = await promisify(exec)(`df "${drivePath}"`);
        const lines = dfOutput.trim().split('\n');
        if (lines.length > 1) {
          const parts = lines[1].split(/\s+/);
          if (parts.length >= 4) {
            totalCapacity = parseInt(parts[1]) * 1024; // Convert 1K blocks to bytes
            usedSpace = parseInt(parts[2]) * 1024;
            freeSpace = parseInt(parts[3]) * 1024;
          }
        }
      }
    } catch (dfError: any) {
      console.log('Could not get disk usage info (this is normal for folders):', dfError.message);
      // For regular folders, calculate the actual folder size
      try {
        usedSpace = await calculateDirectorySize(drivePath);
        totalCapacity = usedSpace; // For folders, total capacity = used space
        freeSpace = 0; // No free space concept for folders
        console.log(`Calculated folder size for ${driveName}: ${usedSpace} bytes`);
      } catch (sizeError: any) {
        console.log('Could not calculate folder size:', sizeError.message);
        totalCapacity = 0;
        usedSpace = 0;
        freeSpace = 0;
      }
    }
    

    
    // Get actual file count from the drive
    let actualFileCount = 0;
    try {
      if (process.platform === 'win32') {
        // Windows: use dir /s to count files quickly
        const { stdout: dirOutput } = await promisify(exec)(`dir /s /b "${drivePath}" | find /c /v ""`);
        actualFileCount = parseInt(dirOutput.trim()) || 0;
      } else if (process.platform === 'darwin') {
        // macOS: use find to count files quickly
        const { stdout: findOutput } = await promisify(exec)(`find "${drivePath}" -type f -o -type d | wc -l`);
        actualFileCount = parseInt(findOutput.trim()) || 0;
      } else {
        // Linux: use find to count files quickly
        const { stdout: findOutput } = await promisify(exec)(`find "${drivePath}" -type f -o -type d | wc -l`);
        actualFileCount = parseInt(findOutput.trim()) || 0;
      }
      
      if (actualFileCount > 0) {
        log('debug', `Actual file count for ${drivePath}: ${actualFileCount} files/directories`);
      } else {
        log('debug', `File count for ${drivePath}: 0 or failed to parse`);
      }
    } catch (countError: any) {
      log('debug', `Could not get file count for ${drivePath}:`, countError.message);
      actualFileCount = 0;
    }
    
    return {
      name: driveName,
      path: drivePath,
      totalCapacity,
      usedSpace,
      freeSpace,
      serialNumber,
      formatType,
      fileCount: actualFileCount
    };
  } catch (error) {
    console.error('Error getting drive info:', error);
    throw error;
  }
}

// Wait for React build to be ready in development
async function waitForReactBuild(): Promise<void> {
  const indexPath = path.join(__dirname, '../app/dist/index.html');
  let attempts = 0;
  const maxAttempts = 30; // 30 seconds
  
  while (attempts < maxAttempts) {
    try {
      if (fs.existsSync(indexPath)) {
        console.log('React build is ready');
        return;
      }
    } catch (error) {
      // File doesn't exist yet, continue waiting
    }
    
    attempts++;
    console.log(`Waiting for React build... attempt ${attempts}/${maxAttempts}`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  throw new Error('React build did not complete within 30 seconds');
}

async function createWindow(): Promise<void> {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Load the app
  if (process.env.NODE_ENV === 'development') {
    // In development, wait for React build and load from dist folder
    await waitForReactBuild();
    mainWindow.loadFile(path.join(__dirname, '../app/dist/index.html'));
  } else {
    // In production, load the built app
    mainWindow.loadFile(path.join(__dirname, '../app/dist/index.html'));
  }

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Handle external URLs - open them in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Check if URL is external (not localhost or app:// protocol)
    if (url.startsWith('http://') || url.startsWith('https://')) {
      // Open external URLs in system browser
      shell.openExternal(url);
      return { action: 'deny' }; // Prevent Electron from opening a new window
    }
    
    // Allow internal URLs to open normally
    return { action: 'allow' };
  });
}

// IPC Handlers
ipcMain.handle('get-stored-metadata', async (event, folderPath: string) => {
  try {
    if (!storageManager) throw new Error('Storage manager not initialized');
    return await storageManager.getStoredMetadata(folderPath);
  } catch (error) {
    console.error('Error in get-stored-metadata handler:', error);
    throw error;
  }
});



// On-demand hydrate a folder's immediate children from filesystem and merge into storage
ipcMain.handle('hydrate-folder', async (event, driveId: string, folderPath: string) => {
  try {
    if (!storageManager) throw new Error('Storage manager not initialized');
    const drive = await storageManager.getDriveById(driveId);
    if (!drive) return { success: false, error: 'Drive not found' };
    const target = normalizePath(folderPath);
    log('debug', `Hydrating children for ${target}`);
    const entries = await fs.readdir(target);
    const current = await storageManager.listDriveFiles(driveId, '');
    const existingPaths = new Set(current.map(f => normalizePath(f.path)));
    const normalizedFolder = normalizePath(drive.path);
    const toAdd: Omit<FileInfo, 'id'>[] = [];
    for (const name of entries) {
      try {
        const full = normalizePath(path.join(target, name));
        if (existingPaths.has(full)) continue;
        const st = await fs.stat(full);
        toAdd.push({
          name,
          path: full,
          parentPath: target,
          size: st.isDirectory() ? 0 : st.size,
          created: st.birthtime.toISOString(),
          modified: st.mtime.toISOString(),
          isDirectory: st.isDirectory(),
          folderPath: normalizedFolder,
          driveId,
          depth: full.replace(normalizedFolder, '').split(path.sep).filter(Boolean).length
        });
      } catch (e: any) {
        console.warn(`[hydrate-folder] Failed ${name}: ${e.message}`);
      }
    }
    if (toAdd.length > 0) {
      const updated = [...current, ...toAdd.map(f => ({ ...f, id: generateId() }))];
      await storageManager.storeFileTree(driveId, updated);
      // if (memoryCache) memoryCache.setFiles(driveId, updated);
      log('debug', `Added ${toAdd.length} children for ${target}`);
    } else {
      console.log('[hydrate-folder] No new children discovered');
    }
    return { success: true, added: toAdd.length };
  } catch (error: any) {
    console.error('[hydrate-folder] Error:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('open-folder-picker', async (_event, opts: any = {}) => {
  try {
    // Optional pre-prompt (non-macOS)
    if (process.platform !== 'darwin' && opts.prePrompt) {
      const pre = await dialog.showMessageBox(mainWindow!, {
        type: 'warning',
        buttons: ['Continue', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
        title: opts.prePrompt.title ?? 'Confirm',
        message: opts.prePrompt.message ?? '',
        detail: opts.prePrompt.detail ?? ''
      });
      if (pre.response !== 0) return null;
    }

    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
      title: opts.title ?? 'Select folder',
      buttonLabel: opts.buttonLabel ?? 'Use this folder',
      // macOS-only: shows above the file chooser; ignored on other platforms
      message: opts.message ?? undefined
    });
    
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    return null;
  } catch (error) {
    console.error('Error in open-folder-picker handler:', error);
    throw error;
  }
});

ipcMain.handle('add-drive', async (event, drivePath: string) => {
  const startTime = Date.now();
  log('info', `===== STARTING DRIVE ADDITION PROCESS =====`);
  log('info', `Drive path: ${drivePath}`);
  log('info', `Timestamp: ${new Date().toISOString()}`);
  
  try {
    // Check for scan conflicts before adding drive
    log('info', `Checking for scan conflicts...`);
    const driveId = generateId();
    const conflicts = scanManager.checkScanConflicts(driveId);
    
    if (conflicts.hasConflict) {
      console.warn(`[MAIN] Scan conflicts detected, cannot add drive:`, conflicts.conflicts);
      return {
        success: false,
        error: 'Cannot add drive due to scan conflicts',
        conflicts: conflicts.conflicts
      };
    }
    
    log('info', `No scan conflicts detected, proceeding with drive addition`);
    
    // Get drive information
    log('info', `Gathering drive information for path: ${drivePath}`);
    const driveInfo = await getDriveInfo(drivePath);
    
    if (!driveInfo) {
      const error = 'Failed to get drive information';
      console.error(`[MAIN] Drive addition failed: ${error}`);
      return { success: false, error };
    }
    
    log('info', `Drive info resolved successfully:`);
    log('info', `  - Name: ${driveInfo.name}`);
    log('info', `  - Total capacity: ${driveInfo.totalCapacity} bytes`);
    log('info', `  - Used space: ${driveInfo.usedSpace} bytes`);
    log('info', `  - Format type: ${driveInfo.formatType}`);
    
    if (!storageManager) {
      const error = 'Storage manager not initialized';
      console.error(`[MAIN] Drive addition failed: ${error}`);
      throw new Error(error);
    }
    
    log('info', `Adding drive to storage manager...`);
    const driveWithId = await storageManager.addDrive({
      ...driveInfo,
      id: driveId,
      addedDate: new Date().toISOString()
    });
    
    log('info', `Drive successfully stored in storage manager:`);
    log('info', `  - Stored ID: ${driveWithId.id}`);
    log('info', `  - Stored name: ${driveWithId.name}`);
    
    if (driveWithId.id !== driveId) {
      console.warn(`[MAIN] Drive ID mismatch detected:`);
      console.warn(`[MAIN]   - Requested ID: ${driveId}`);
      console.warn(`[MAIN]   - Stored ID: ${driveWithId.id}`);
      console.warn(`[MAIN] Using stored ID for subsequent operations`);
    }
    
    const actualDriveId = driveWithId.id;
    
    // Update memory cache (if needed)
    // memoryCache.setDrive(driveWithId);
    
    // Start file system watcher for the new drive
    log('info', `Starting file system watcher for drive ${actualDriveId}...`);
    await startWatchingDrive(drivePath, actualDriveId);
    log('info', `File system watcher started successfully for ${driveWithId.name} (${actualDriveId})`);
    
    // Don't start the scan immediately - let the frontend signal when it's ready
    log('info', `Drive added successfully. Scan will start when frontend signals readiness.`);
    
    // Return success immediately, scan will start later
    const totalDuration = Date.now() - startTime;
    log('info', `===== DRIVE ADDITION PROCESS COMPLETED SUCCESSFULLY =====`);
    log('info', `Total process duration: ${totalDuration}ms`);
    log('info', `Drive: ${driveWithId.name} (${actualDriveId})`);
    log('info', `Path: ${drivePath}`);
    
    return {
      success: true,
      drive: driveWithId,
      message: 'Drive added successfully (scan pending)'
    };
    
  } catch (error: any) {
    const totalDuration = Date.now() - startTime;
    console.error(`[MAIN] ===== DRIVE ADDITION PROCESS FAILED =====`);
    console.error(`[MAIN] Error: ${error.message}`);
    console.error(`[MAIN] Total process duration: ${totalDuration}ms`);
    console.error(`[MAIN] Drive path: ${drivePath}`);
    console.error(`[MAIN] Stack trace:`, error.stack);
    
    return { success: false, error: error.message };
  }
});

// Sync drive (new database approach - no backup verification needed)
ipcMain.handle('sync-drive', async (event, driveId: string, folderPath: string) => {
  const startTime = Date.now();
  const drivePath = folderPath;
  log('info', `===== STARTING DRIVE SYNC PROCESS (NEW DATABASE APPROACH) =====`);
  log('info', `Drive ID: ${driveId}`);
  log('info', `New path: ${drivePath}`);
  log('info', `Timestamp: ${new Date().toISOString()}`);
  
  try {
    if (!storageManager) {
      const error = 'Storage manager not initialized';
      console.error(`[MAIN] Drive sync failed: ${error}`);
      return { success: false, error };
    }
    
    log('info', `Storage manager is available, proceeding...`);
    
    // Get the existing drive info
    log('info', `Fetching existing drive info for ID: ${driveId}...`);
    const existingDrive = await storageManager.getDriveById(driveId);
    if (!existingDrive) {
      const error = `Drive not found: ${driveId}`;
      console.error(`[MAIN] Drive sync failed: ${error}`);
      return { success: false, error };
    }
    
    log('info', `Existing drive found successfully:`);
    log('info', `  - Name: ${existingDrive.name}`);
    log('info', `  - Current path: ${existingDrive.path}`);
    log('info', `  - Current capacity: ${existingDrive.totalCapacity} bytes`);
    log('info', `  - Current used space: ${existingDrive.usedSpace} bytes`);
    log('info', `  - Current file count: ${existingDrive.fileCount || 'Unknown'}`);
    log('info', `  - Added date: ${existingDrive.addedDate}`);
    log('info', `  - Last updated: ${existingDrive.lastUpdated || 'Never'}`);
    
    // Check for scan conflicts before syncing
    log('info', `Checking for scan conflicts...`);
    const conflicts = scanManager.checkScanConflicts(driveId);
    log('info', `Scan conflict check result:`, conflicts);
    
    if (conflicts.hasConflict) {
      console.warn(`[MAIN] Scan conflicts detected, cannot sync drive:`, conflicts.conflicts);
      return {
        success: false,
        error: 'Cannot sync drive due to scan conflicts',
        conflicts: conflicts.conflicts
      };
    }
    
    log('info', `No scan conflicts detected, proceeding with drive sync`);
    
    // Get drive information for the new path
    log('info', `Gathering drive information for new path: ${drivePath}`);
    const newDriveInfo = await getDriveInfo(drivePath);
    
    if (!newDriveInfo) {
      const error = 'Failed to get drive information for new path';
      console.error(`[MAIN] Drive sync failed: ${error}`);
      return { success: false, error };
    }
    
    // Update the drive info in storage (path, capacity, etc.)
    log('info', `===== UPDATING DRIVE INFO =====`);
    log('info', `Updating drive info in storage manager...`);
    const updateStartTime = Date.now();
    await storageManager.updateDriveInfo(driveId, {
      name: newDriveInfo.name,
      path: newDriveInfo.path,
      totalCapacity: newDriveInfo.totalCapacity,
      usedSpace: newDriveInfo.usedSpace,
      freeSpace: newDriveInfo.freeSpace,
      formatType: newDriveInfo.formatType,
      serialNumber: newDriveInfo.serialNumber,
      lastUpdated: new Date().toISOString()
    });
    const updateDuration = Date.now() - updateStartTime;
    log('info', `Drive info updated successfully in ${updateDuration}ms`);
    log('info', `===== DRIVE INFO UPDATE COMPLETE =====`);
    
    // Start file system watcher for the new path
    log('info', `===== STARTING FILE WATCHER =====`);
    log('info', `Starting file system watcher for new path ${drivePath}...`);
    const watcherStartTime = Date.now();
    await startWatchingDrive(drivePath, driveId);
    const watcherDuration = Date.now() - watcherStartTime;
    log('info', `File system watcher started successfully for ${newDriveInfo.name} (${driveId}) in ${watcherDuration}ms`);
    log('info', `===== FILE WATCHER STARTED =====`);
    
    // Get the updated drive info to return
    log('info', `Fetching updated drive info for verification...`);
    const updatedDrive = await storageManager.getDriveById(driveId);
    if (updatedDrive) {
      log('info', `Updated drive info verified:`);
      log('info', `  - Name: ${updatedDrive.name}`);
      log('info', `  - Path: ${updatedDrive.path}`);
      log('info', `  - Last updated: ${updatedDrive.lastUpdated}`);
    } else {
      console.warn(`[MAIN] Warning: Could not fetch updated drive info`);
    }
    
    const totalDuration = Date.now() - startTime;
    log('info', `===== DRIVE SYNC PROCESS COMPLETED SUCCESSFULLY =====`);
    log('info', `Total process duration: ${totalDuration}ms`);
    log('info', `Breakdown:`);
    log('info', `  - Drive info update: ${updateDuration}ms`);
    log('info', `  - File watcher: ${watcherDuration}ms`);
    log('info', `  - Other operations: ${totalDuration - updateDuration - watcherDuration}ms`);
    log('info', `Drive: ${newDriveInfo.name} (${driveId})`);
    log('info', `New path: ${drivePath}`);
    log('info', `===== SYNC READY FOR SCAN =====`);
    log('info', `NOTE: New scan database will be created by create-backup-before-sync`);
    log('info', `NOTE: Scan will use start-sync-scan with new database approach`);
    
    return {
      success: true,
      drive: updatedDrive,
      message: 'Drive synced successfully (scan pending)'
    };
    
  } catch (error: any) {
    const totalDuration = Date.now() - startTime;
    console.error(`[MAIN] ===== DRIVE SYNC PROCESS FAILED =====`);
    console.error(`[MAIN] Total process duration: ${totalDuration}ms`);
    console.error(`[MAIN] Drive ID: ${driveId}`);
    console.error(`[MAIN] New path: ${drivePath}`);
    console.error(`[MAIN] Error:`, error.message);
    console.error(`[MAIN] Error stack:`, error.stack);
    
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-drives', async () => {
  try {
    if (!storageManager) throw new Error('Storage manager not initialized');
    const drives = await storageManager.getActiveDrives();
    log('debug', `Returning ${drives.length} active drives`);
    
    // Return only active drives for the main UI
    return drives;
  } catch (error) {
    console.error('Error in get-drives handler:', error);
    throw error;
  }
});

ipcMain.handle('get-all-drives', async () => {
  try {
    if (!storageManager) throw new Error('Storage manager not initialized');
    const drives = await storageManager.getAllDrives();
    log('debug', `Returning ${drives.length} drives (including deleted)`);
    
    // Return all drives including deleted ones
    return drives;
  } catch (error) {
    console.error('Error in get-all-drives handler:', error);
    throw error;
  }
});

// Create a demo drive (no filesystem access, used for UI mock)

ipcMain.handle('get-drive-files', async (event, driveId: string) => {
  try {
    if (!storageManager) throw new Error('Storage manager not initialized');
    const files = await storageManager.listDriveFiles(driveId, '');
    log('debug', `Drive ${driveId} -> ${files.length} files`);
    if (!files || files.length === 0) {
      console.warn(`[get-drive-files] No files found for drive ${driveId}. File tree may not have been stored yet.`);
    }
    // Normalize paths defensively on read (legacy entries)
    for (const f of files) {
      f.path = normalizePath(f.path);
      if (f.parentPath) f.parentPath = normalizePath(f.parentPath);
      f.folderPath = normalizePath(f.folderPath);
    }
    
    // Calculate sizes for directories on-demand if they're missing or 0
    for (const file of files) {
      if (file.isDirectory && (file.size === 0 || file.size === undefined)) {
        try {
          const actualSize = await calculateDirectorySize(file.path);
          file.size = actualSize; // Persist even when 0 so UI can show 0 instead of Calculating
          console.log(`Calculated size for ${file.name}: ${actualSize} bytes`);
          
          // Update the file in storage with the calculated size (including 0)
          await storageManager.updateFileSize(file.id, actualSize);
        } catch (error: any) {
          if (['ENOENT', 'EACCES', 'EPERM'].includes(error?.code)) {
            console.warn(`Skipping size calc for ${file.path}: ${error.code} ${error.message}`);
            file.size = 0; // Ensure we have a fallback value
          } else {
            console.error(`Error calculating size for ${file.path}:`, error.message);
            file.size = 0; // Ensure we have a fallback value
          }
        }
      }
    }
    
    return files;
  } catch (error: any) {
    console.error('Error in get-drive-files handler:', error.message);
    throw error;
  }
});

ipcMain.handle('delete-drive', async (event, driveId: string) => {
  try {
    if (!storageManager) throw new Error('Storage manager not initialized');
    await storageManager.removeDrive(driveId);
    // memoryCache.deleteDrive(driveId);
    return { success: true };
  } catch (error) {
    console.error('Error in delete-drive handler:', error);
    throw error;
  }
});

// Start scan for a drive when frontend is ready (ADD NEW DRIVE)
ipcMain.handle('start-drive-scan', async (event, driveId: string) => {
  try {
    log('info', `===== START-DRIVE-SCAN CALLED (ADD NEW DRIVE) =====`);
    log('info', `Drive ID: ${driveId}`);
    log('info', `Caller: ${event.sender.getURL()}`);
    log('info', `Timestamp: ${new Date().toISOString()}`);
    log('info', `NOTE: This is ADD NEW DRIVE - writing directly to main database`);
    
    if (!storageManager) throw new Error('Storage manager not initialized');
    const drive = await storageManager.getDriveById(driveId);
    if (!drive) {
      return { success: false, error: `Drive not found: ${driveId}` };
    }
    
    log('info', `Drive found: ${drive.name} at ${drive.path}`);
    log('info', `Starting scan for ${drive.name} (${driveId}) at ${drive.path}`);
    log('info', `ADD NEW DRIVE: Writing scan results directly to main database`);
    
    const files = await scanDriveTree(normalizePath(drive.path), driveId, drive.fileCount);
    log('info', `Scan complete. Files discovered: ${files.length}`);
    log('info', `ADD NEW DRIVE: Files written directly to main database - no swapping needed`);
    
    // Create backup after successful scan
    log('info', `Creating backup after successful scan...`);
    try {
      const backupManager = storageManager.getBackupManager();
      if (backupManager) {
        // Use getCurrentDriveDatabasePath to get the active database path
        const driveDbPath = await storageManager.getCurrentDriveDatabasePath(driveId);
        const backupSuccess = await backupManager.backupDrive(driveId, drive.name, driveDbPath, drive);
        if (backupSuccess) {
          log('info', `Backup created successfully for drive ${driveId}`);
        } else {
          console.warn(`[start-drive-scan] Backup creation failed for drive ${driveId}`);
        }
      }
    } catch (backupError: any) {
      console.error(`[start-drive-scan] Error creating backup:`, backupError.message);
      // Don't fail the scan if backup fails
    }
    
    return { success: true, filesFound: files.length };
  } catch (error: any) {
    console.error(`[start-drive-scan] Error scanning drive ${driveId}:`, error.message);
    
    // Check if this was a cancellation error
    if (error.message.includes('cancelled') || error.message.includes('Scan was cancelled')) {
      log('info', `Scan was cancelled for drive ${driveId}`);
      log('info', `ADD NEW DRIVE: No cleanup needed - files written directly to main database`);
    } else {
      // For non-cancellation errors, we should remove the partially created drive
      log('info', `Scan failed for drive ${driveId}, removing partially created drive...`);
      try {
        if (storageManager) {
          await storageManager.removeDrive(driveId);
          log('info', `Partially created drive ${driveId} removed successfully`);
        } else {
          console.error(`[start-drive-scan] Cannot remove drive: Storage manager not available`);
        }
      } catch (removeError: any) {
        console.error(`[start-drive-scan] Failed to remove partially created drive ${driveId}:`, removeError.message);
      }
    }
    
    return { success: false, error: error.message };
  }
});

// Start scan for a drive after sync operations (SYNC EXISTING DRIVE)
ipcMain.handle('start-sync-scan', async (event, driveId: string) => {
  const syncStartTime = Date.now();
  
  try {
    log('info', `===== START-SYNC-SCAN CALLED (SYNC EXISTING DRIVE) =====`);
    log('info', `Drive ID: ${driveId}`);
    log('info', `Caller: ${event.sender.getURL()}`);
    log('info', `Timestamp: ${new Date().toISOString()}`);
    log('info', `NOTE: This is SYNC EXISTING DRIVE - using new database approach`);
    
    if (!storageManager) throw new Error('Storage manager not initialized');
    const drive = await storageManager.getDriveById(driveId);
    if (!drive) {
      return { success: false, error: `Drive not found: ${driveId}` };
    }
    
    log('info', `Drive found: ${drive.name} at ${drive.path}`);
    log('info', `SYNC EXISTING DRIVE: New scan database should already exist from create-backup-before-sync`);
    log('info', `Starting scan for ${drive.name} (${driveId}) at ${drive.path}`);
    
    // ===== CRASH DETECTION SETUP =====
    log('info', `===== SETTING UP CRASH DETECTION =====`);
    const currentDbPath = await storageManager.getCurrentDriveDatabasePath(driveId);
    const newDbPath = await storageManager.getDriveDatabasePath(driveId);
    
    const crashData = {
      driveId,
      driveName: drive.name,
      operation: 'sync-scan',
      startTime: syncStartTime,
      currentDatabase: require('path').basename(currentDbPath),
      newDatabase: require('path').basename(newDbPath),
      catalogBackupCreated: false,
      phase: 'initialization'
    };
    
    await storageManager.createCrashDetectionFiles(crashData);
    log('info', `Crash detection files created`);
    
    // Get fresh drive info to get accurate file count (same as add new process)
    log('info', `Getting fresh drive info for accurate file count...`);
    const freshDriveInfo = await getDriveInfo(drive.path);
    const freshFileCount = freshDriveInfo.fileCount;
    log('info', `Fresh file count: ${freshFileCount} (stored was: ${drive.fileCount})`);
    
    // ===== PHASE 1: CREATE CATALOG BACKUP =====
    await storageManager.updateCrashDetectionPhase('catalog-backup');
    
    // Create backup of CURRENT database before sync starts (if not already exists)
    log('info', `Checking for existing backup of current database before sync...`);
    try {
      const backupManager = storageManager.getBackupManager();
      if (backupManager) {
        // Get the CURRENT database path (this will be the old database we want to backup)
        log('info', `Current database to backup: ${currentDbPath}`);
        
        // Check if backup already exists for this database
        const backups = await backupManager.getAvailableBackups();
        const driveBackups = backups.filter(b => b.type === 'drive' && b.driveId === driveId);
        
        // Extract suffix from current database path to match against existing backups
        const currentDbName = require('path').basename(currentDbPath);
        const suffixMatch = currentDbName.match(/^.+?(_(?:init|sync\d+))\.db$/);
        const currentSuffix = suffixMatch ? suffixMatch[1] : '_init';
        
        const existingBackup = driveBackups.find(b => {
          const backupFileName = require('path').basename(b.path);
          return backupFileName.includes(currentSuffix);
        });
        
        if (existingBackup) {
          const backupFileName = require('path').basename(existingBackup.path);
          log('info', `Backup already exists for current database: ${backupFileName}`);
        } else {
          log('info', `No existing backup found, creating backup of current database...`);
          const backupSuccess = await backupManager.backupDrive(driveId, drive.name, currentDbPath, drive);
          if (backupSuccess) {
            log('info', `Pre-sync backup created successfully for drive ${driveId}`);
          } else {
            console.warn(`[start-sync-scan] Pre-sync backup creation failed for drive ${driveId}`);
          }
        }
      }
    } catch (backupError: any) {
      console.error(`[start-sync-scan] Error creating pre-sync backup:`, backupError.message);
      // Don't fail the sync if backup fails, but warn the user
      console.warn(`[start-sync-scan] Proceeding with sync without backup`);
    }
    
    // Set global flag to indicate this is a sync scan (will be used by scanDriveTree)
    (global as any).isSyncScan = true;
    (global as any).currentSyncDriveId = driveId;
    
    // ===== PHASE 2: FILE SCANNING =====
    await storageManager.updateCrashDetectionPhase('file-scan');
    
    try {
      const files = await scanDriveTree(normalizePath(drive.path), driveId, freshFileCount);
      log('info', `Scan complete. Files discovered: ${files.length}`);
    
    // ===== PHASE 3: FINALIZATION (FTS INDEX UPDATE) =====
    await storageManager.updateCrashDetectionPhase('finalization');
    
    // If scan completed successfully, finalize by updating FTS index from new database
    log('info', `===== FINALIZING SCAN (UPDATING FTS INDEX) =====`);
    try {
      const finalizeStartTime = Date.now();
      
      // Create progress callback to send updates to frontend during finalization
      const progressCallback = (progress: { current: number; total: number; phase: string; message: string; etaSeconds?: number }) => {
        if (mainWindow) {
          mainWindow.webContents.send('scan-progress', {
            type: 'finalize-progress',
            driveId: driveId,
            current: progress.current,
            total: progress.total,
            phase: progress.phase,
            message: progress.message,
            etaSeconds: progress.etaSeconds
          });
        }
      };
      
      const finalizeResult = await storageManager.finalizeScanSync(driveId, progressCallback);
      const finalizeDuration = Date.now() - finalizeStartTime;
      
      console.log(`[DEBUG] Finalization result:`, finalizeResult);
      
      if (finalizeResult.success) {
        console.log(`[DEBUG] Finalization was successful, entering cleanup section...`);
        log('info', `Scan finalization successful in ${finalizeDuration}ms`);
        log('info', `===== SCAN FINALIZATION COMPLETE =====`);
        
        // Create backup of NEW database after successful sync
        log('info', `Creating backup of new database after successful sync...`);
        try {
          const backupManager = storageManager.getBackupManager();
          if (backupManager) {
            // Get the NEW database path (this will now return the sync1 database)
            const newDbPath = await storageManager.getCurrentDriveDatabasePath(driveId);
            log('info', `New database to backup: ${newDbPath}`);
            const backupSuccess = await backupManager.backupDrive(driveId, drive.name, newDbPath, drive);
            if (backupSuccess) {
              log('info', `Post-sync backup created successfully for drive ${driveId}`);
            } else {
              console.warn(`[start-sync-scan] Post-sync backup creation failed for drive ${driveId}`);
            }
          }
        } catch (backupError: any) {
          console.error(`[start-sync-scan] Error creating post-sync backup:`, backupError.message);
          // Don't fail the sync if backup fails
        }
        
        // Send sync completion event to frontend after database swap is complete
        if (mainWindow) {
          mainWindow.webContents.send('scan-progress', {
            type: 'sync-complete',
            driveId: driveId,
            processed: files.length,
            message: `Sync completed successfully. Finalization finished in ${finalizeDuration}ms.`,
            finalizeDuration: finalizeDuration
          });
        }
        
        // Clean up catalog backup after successful sync (moved here from finalization)
        log('info', `===== CLEANING UP CATALOG BACKUP AFTER SUCCESSFUL SYNC =====`);
        console.log(`[CATALOG-CLEANUP] Starting catalog backup cleanup process...`);
        try {
          const backupManager = storageManager.getBackupManager();
          console.log(`[CATALOG-CLEANUP] Backup manager available:`, !!backupManager);
          if (backupManager) {
            const backups = await backupManager.getAvailableBackups();
            console.log(`[CATALOG-CLEANUP] Total backups found:`, backups.length);
            const catalogBackups = backups.filter(b => b.type === 'catalog');
            console.log(`[CATALOG-CLEANUP] Catalog backups found:`, catalogBackups.length);
            console.log(`[CATALOG-CLEANUP] Catalog backup details:`, catalogBackups.map(b => ({ id: b.id, timestamp: b.timestamp })));
            
            if (catalogBackups.length > 0) {
              // Delete ALL catalog backups since they're only temporary during sync
              console.log(`[CATALOG-CLEANUP] Deleting all ${catalogBackups.length} catalog backups...`);
              let deletedCount = 0;
              
              for (const catalogBackup of catalogBackups) {
                console.log(`[CATALOG-CLEANUP] Deleting catalog backup:`, catalogBackup.id);
                const deleteSuccess = await backupManager.deleteBackup(catalogBackup.id);
                if (deleteSuccess) {
                  deletedCount++;
                  console.log(`[CATALOG-CLEANUP] Successfully deleted catalog backup:`, catalogBackup.id);
                } else {
                  console.log(`[CATALOG-CLEANUP] Failed to delete catalog backup:`, catalogBackup.id);
                }
              }
              
              if (deletedCount === catalogBackups.length) {
                console.log(`[CATALOG-CLEANUP] All catalog backups cleaned up successfully (${deletedCount}/${catalogBackups.length})`);
                log('info', `Catalog backup cleanup successful - deleted ${deletedCount} catalog backups`);
              } else {
                console.log(`[CATALOG-CLEANUP] Partial catalog backup cleanup (${deletedCount}/${catalogBackups.length})`);
                log('warn', `Partial catalog backup cleanup: deleted ${deletedCount}/${catalogBackups.length} catalog backups`);
              }
            } else {
              console.log(`[CATALOG-CLEANUP] No catalog backups found to cleanup`);
              log('info', `No catalog backups found to cleanup`);
            }
          } else {
            log('warn', `Backup manager not available for catalog cleanup`);
          }
        } catch (cleanupError: any) {
          log('warn', `Catalog backup cleanup failed: ${cleanupError.message}, but sync completed successfully`);
        }
        
        // ===== REMOVE CRASH DETECTION FILES ON SUCCESS =====
        log('info', `===== REMOVING CRASH DETECTION FILES (SUCCESS) =====`);
        try {
          await storageManager.removeCrashDetectionFiles();
          log('info', `Crash detection files removed successfully`);
        } catch (cleanupError: any) {
          log('warn', `Failed to remove crash detection files: ${cleanupError.message}`);
        }
        
      } else {
        console.error(`[start-sync-scan] Scan finalization failed: ${finalizeResult.error}`);
        log('info', `===== SCAN FINALIZATION FAILED =====`);
        return { success: false, error: `Scan completed but finalization failed: ${finalizeResult.error}` };
      }
    } catch (finalizeError: any) {
      console.error(`[start-sync-scan] Exception during scan finalization:`, finalizeError.message);
      return { success: false, error: `Scan completed but finalization failed: ${finalizeError.message}` };
    }
    
      return { success: true, filesFound: files.length };
    } finally {
      // Always clear the sync flag, even if scan fails
      (global as any).isSyncScan = false;
      (global as any).currentSyncDriveId = null;
    }
  } catch (error: any) {
    // Clear the sync flag on error
    (global as any).isSyncScan = false;
    (global as any).currentSyncDriveId = null;
    
    console.error(`[start-sync-scan] Error scanning drive ${driveId}:`, error.message);
    
    // ===== COMPREHENSIVE SYNC FAILURE RECOVERY =====
    log('info', `===== STARTING COMPREHENSIVE SYNC FAILURE RECOVERY =====`);
    
    if (storageManager) {
      try {
        // Determine if this was a user cancellation
        const isCancellation = error.message.includes('cancelled') || error.message.includes('Scan was cancelled');
        
        if (isCancellation) {
          log('info', `Sync was cancelled by user`);
        } else {
          log('info', `Sync failed due to error: ${error.message}`);
        }
        
        // Use comprehensive recovery system
        const recoveryResult = await storageManager.recoverFromSyncFailure(driveId, {
          deleteNewDatabase: true,     // Clean up new database being created
          deleteCatalog: false,        // Don't delete catalog unless corrupted
          restoreDriveBackup: true,    // Restore previous drive database
          restoreCatalogBackup: true,  // Restore catalog if backup exists
          validateIntegrity: true      // Validate restored databases
        });
        
        if (recoveryResult.success) {
          log('info', `Recovery completed successfully: ${recoveryResult.details.join(', ')}`);
          
          // Clean up crash detection files after successful recovery
          try {
            await storageManager.removeCrashDetectionFiles();
            log('info', `Crash detection files cleaned up after recovery`);
          } catch (cleanupError: any) {
            log('warn', `Failed to clean up crash detection files: ${cleanupError.message}`);
          }
          
          const message = isCancellation 
            ? 'Sync cancelled, system restored to previous state'
            : `Sync failed but recovery completed: ${error.message}`;
          
          return { 
            success: false, 
            error: message,
            recovered: true,
            recoveryDetails: recoveryResult.details
          };
        } else {
          log('error', `Recovery also failed: ${recoveryResult.error}`);
          return { 
            success: false, 
            error: `Sync failed and recovery failed: ${error.message}. Recovery error: ${recoveryResult.error}`,
            recovered: false
          };
        }
      } catch (recoveryError: any) {
        log('error', `Exception during recovery: ${recoveryError.message}`);
        return {
          success: false,
          error: `Sync failed and recovery exception: ${error.message}. Recovery exception: ${recoveryError.message}`,
          recovered: false
        };
      }
    } else {
      return { success: false, error: `Sync failed: ${error.message}. Cannot recover: Storage manager unavailable` };
    }
  }
});

// Create new scan database before sync (called immediately after user selects drive)
ipcMain.handle('create-backup-before-sync', async (event, driveId: string) => {
  try {
    if (!storageManager) {
      return { success: false, error: 'Storage manager not initialized' };
    }
    
    log('debug', `===== CREATING CATALOG BACKUP AND NEW SCAN DATABASE BEFORE SYNC =====`);
    log('debug', `Drive ID: ${driveId}`);
    log('debug', `Timestamp: ${new Date().toISOString()}`);
    
    // First, create catalog.db backup
    log('debug', `Creating catalog.db backup...`);
    const catalogBackupStartTime = Date.now();
    const backupManager = storageManager.getBackupManager();
    if (!backupManager) {
      return { success: false, error: 'Backup manager not initialized' };
    }
    
    const catalogPath = path.join(storageManager.getUserStorageDir(), 'catalog.db');
    const catalogBackupResult = await backupManager.backupCatalog(catalogPath);
    const catalogBackupDuration = Date.now() - catalogBackupStartTime;
    
    if (!catalogBackupResult) {
      log('warn', `Catalog backup failed, but continuing with sync...`);
      // Note: We continue even if catalog backup fails, as per the document
    } else {
      log('debug', `Catalog backup completed successfully in ${catalogBackupDuration}ms`);
    }
    
    // Then create new scan database
    const newDbStartTime = Date.now();
    const newDbResult = await storageManager.createNewScanDatabase(driveId);
    const newDbDuration = Date.now() - newDbStartTime;
    
    if (!newDbResult.success) {
      console.error(`[PRE-SYNC-NEW-DB] ===== NEW SCAN DATABASE CREATION FAILED =====`);
      console.error(`[PRE-SYNC-NEW-DB] Error: ${newDbResult.error}`);
      return { success: false, error: newDbResult.error };
    }
    
    log('debug', `===== BACKUP AND NEW SCAN DATABASE CREATION SUCCESSFUL =====`);
    log('debug', `Catalog backup duration: ${catalogBackupDuration}ms (${catalogBackupResult ? 'success' : 'failed'})`);
    log('debug', `New database duration: ${newDbDuration}ms`);
    log('debug', `New database path: ${newDbResult.newDbPath}`);
    
    return { 
      success: true, 
      duration: newDbDuration,
      catalogBackupDuration,
      catalogBackupSuccess: catalogBackupResult,
      message: `Backup and new scan database created successfully before sync${catalogBackupResult ? '' : ' (catalog backup failed but sync will continue)'}`
    };
    
  } catch (error: any) {
    console.error(`[PRE-SYNC-BACKUP] ===== BACKUP AND NEW SCAN DATABASE CREATION EXCEPTION =====`);
    console.error(`[PRE-SYNC-BACKUP] Error: ${error.message}`);
    console.error(`[PRE-SYNC-BACKUP] Stack: ${error.stack}`);
    return { success: false, error: error.message };
  }
});

// Recovery functionality removed for MVP - will be rebuilt later

// (Removed) Drive status IPC handlers

ipcMain.handle('clear-size-cache', async () => {
  try {
    clearSizeCache();
    return { success: true };
  } catch (error: any) {
    console.error('Error clearing size cache:', error.message);
    return { success: false, error: error.message };
  }
});

// Clear in-memory cache for all drives
ipcMain.handle('clear-memory-cache', async () => {
  try {
    console.log('[clear-memory-cache] Clearing in-memory cache for drives and files');
          // TODO: Implement memory cache clearing in storage manager
      console.log('[clear-memory-cache] Memory cache clearing skipped (not implemented yet)');
    return { success: true };
  } catch (error: any) {
    console.error('[clear-memory-cache] Error:', error.message);
    return { success: false, error: error.message };
  }
});

// File system watcher handlers
ipcMain.handle('start-watching-drive', async (event, drivePath: string, driveId: string) => {
  try {
    await startWatchingDrive(drivePath, driveId);
    return { success: true };
  } catch (error: any) {
    console.error('Error starting file system watcher:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('stop-watching-drive', async (event, driveId: string) => {
  try {
    stopWatchingDrive(driveId);
    return { success: true };
  } catch (error: any) {
    console.error('Error stopping file system watcher:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-watcher-status', async (event, driveId: string) => {
  try {
    const isWatching = fileWatchers.has(driveId);
    const pendingChanges = changeQueue.get(driveId)?.length || 0;
    return { 
      success: true, 
      isWatching, 
      pendingChanges 
    };
  } catch (error: any) {
    console.error('Error getting watcher status:', error.message);
    return { success: false, error: error.message };
  }
});

// Periodic cache cleanup to prevent memory leaks
setInterval(() => {
  if (sizeCache.size > MAX_CACHE_SIZE * 0.8) {
    console.log('Performing periodic size cache cleanup...');
    manageSizeCache();
  }
}, 5 * 60 * 1000); // Every 5 minutes

// (Removed) Serial/matching and online check IPC handlers

// Search IPC handlers
ipcMain.handle('search-files-paged', async (event, query: string, offset: number, limit: number, hideSystemFiles?: boolean) => {
  try {
    log('info', `search-files-paged called with query="${query}", offset=${offset}, limit=${limit}, hideSystemFiles=${hideSystemFiles}`);
    if (!storageManager || !storageManager.searchFilesPaged) throw new Error('Storage manager not initialized');
    log('info', `About to call storageManager.searchFilesPaged with:`, { query, offset, limit, hideSystemFiles });
    log('info', `storageManager type:`, storageManager.constructor.name);
    log('info', `storageManager methods:`, Object.getOwnPropertyNames(Object.getPrototypeOf(storageManager)));
    const result = await storageManager.searchFilesPaged(query, offset, limit, undefined, hideSystemFiles);
    log('info', `search-files-paged returned:`, result);
    return result;
  } catch (error) {
    console.error('Error in search-files-paged handler:', error);
    throw error;
  }
});

ipcMain.handle('get-file-details-for-navigation', async (event, fileName: string, driveId: string, filePath: string) => {
  try {
    if (!storageManager) throw new Error('Storage manager not initialized');
    const result = await storageManager.getFileDetailsForNavigation(fileName, driveId, filePath);
    return result;
  } catch (error) {
    console.error('Error in get-file-details-for-navigation handler:', error);
    throw error;
  }
});

ipcMain.handle('list-children-batch', async (event, driveId: string, parentPaths: string[]) => {
  try {
    if (!storageManager || !storageManager.listChildrenBatch) throw new Error('Storage manager not initialized');
    return await storageManager.listChildrenBatch(driveId, parentPaths);
  } catch (error) {
    console.error('Error in list-children-batch handler:', error);
    throw error;
  }
});

ipcMain.handle('build-search-index', async () => {
  try {
    if (!storageManager) throw new Error('Storage manager not initialized');
    await storageManager.buildSearchIndex();
    return { success: true };
  } catch (error) {
    console.error('Error in build-search-index handler:', error);
    throw error;
  }
});

ipcMain.handle('populate-search-index', async () => {
  try {
    if (!storageManager) throw new Error('Storage manager not initialized');
    await storageManager.populateSearchIndex();
    return { success: true };
  } catch (error) {
    console.error('Error in populate-search-index handler:', error);
    throw error;
  }
});



ipcMain.handle('get-search-index-status', async () => {
  try {
    if (!storageManager) throw new Error('Storage manager not initialized');
    const status = await storageManager.getSearchIndexStatus();
    return status;
  } catch (error) {
    console.error('Error in get-search-index-status handler:', error);
    throw error;
  }
});

ipcMain.handle('check-search-index-health', async () => {
  try {
    if (!storageManager) throw new Error('Storage manager not initialized');
    const health = await storageManager.checkSearchIndexHealth();
    return health;
  } catch (error) {
    console.error('Error in check-search-index-health handler:', error);
    throw error;
  }
});

ipcMain.handle('test-search', async (event, query: string) => {
  try {
    if (!storageManager) throw new Error('Storage manager not initialized');
    const result = await storageManager.testSearch(query);
    return result;
  } catch (error) {
    console.error('Error in test-search handler:', error);
    throw error;
  }
});

// File deletion IPC handlers
ipcMain.handle('soft-delete-file', async (event, fileId: string, reason: string) => {
  try {
    if (!storageManager) throw new Error('Storage manager not initialized');
    await storageManager.softDeleteFile(fileId, reason as 'file_removed' | 'drive_deleted' | 'system');
    return { success: true };
  } catch (error) {
    console.error('Error in soft-delete-file handler:', error);
    throw error;
  }
});

ipcMain.handle('soft-delete-files-by-path', async (event, driveId: string, filePath: string, reason: string) => {
  try {
    if (!storageManager) throw new Error('Storage manager not initialized');
    const deletedCount = await storageManager.softDeleteFilesByPath(driveId, filePath, reason as 'file_removed' | 'drive_deleted' | 'system');
    return { success: true, deletedCount };
  } catch (error) {
    console.error('Error in soft-delete-files-by-path handler:', error);
    throw error;
  }
});

// Recovery functionality removed for MVP - will be rebuilt later

ipcMain.handle('permanently-delete-file', async (event, fileId: string) => {
  try {
    if (!storageManager) throw new Error('Storage manager not initialized');
    await storageManager.permanentlyDeleteFile(fileId);
    return { success: true };
  } catch (error) {
    console.error('Error in permanently-delete-file handler:', error);
    throw error;
  }
});

ipcMain.handle('cleanup-soft-deleted-records', async (event) => {
  try {
    if (!storageManager) throw new Error('Storage manager not initialized');
    console.log('[main] Starting cleanup of soft-deleted records...');
    const result = await storageManager.cleanupSoftDeletedRecords();
    console.log('[main] Cleanup completed:', result);
    return { success: true, ...result };
  } catch (error) {
    console.error('Error in cleanup-soft-deleted-records handler:', error);
    throw error;
  }
});

// Backup and recovery IPC handlers
ipcMain.handle('get-available-backups', async () => {
  try {
    if (!storageManager) throw new Error('Storage manager not initialized');
    const backupManager = storageManager.getBackupManager();
    if (!backupManager) throw new Error('Backup manager not initialized');
    
    const backups = await backupManager.getAvailableBackups();
    return { success: true, backups };
  } catch (error: any) {
    console.error('[get-available-backups] Error:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-grouped-backups', async () => {
  try {
    if (!storageManager) throw new Error('Storage manager not initialized');
    const backupManager = storageManager.getBackupManager();
    if (!backupManager) throw new Error('Backup manager not initialized');
    
    const groupedBackups = await backupManager.getGroupedBackups();
    return { success: true, groupedBackups };
  } catch (error: any) {
    console.error('[get-grouped-backups] Error:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('restore-drive-from-backup', async (event, backupId: string) => {
  try {
    if (!storageManager) throw new Error('Storage manager not initialized');
    const backupManager = storageManager.getBackupManager();
    if (!backupManager) throw new Error('Backup manager not initialized');
    
    const backups = await backupManager.getAvailableBackups();
    const backup = backups.find(b => b.id === backupId);
    if (!backup) throw new Error('Backup not found');
    
    const result = await backupManager.restoreDrive(backup);
    
    // Notify frontend about the restored drive
    if (result.success && result.restoredDrive && mainWindow) {
      mainWindow.webContents.send('drive-restored', {
        drive: result.restoredDrive,
        message: result.message
      });
    }
    
    return { success: result.success, message: result.message };
  } catch (error: any) {
    console.error('[restore-drive-from-backup] Error:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('restore-catalog-from-backup', async (event, backupId: string) => {
  try {
    if (!storageManager) throw new Error('Storage manager not initialized');
    const backupManager = storageManager.getBackupManager();
    if (!backupManager) throw new Error('Backup manager not initialized');
    
    const backups = await backupManager.getAvailableBackups();
    const backup = backups.find(b => b.id === backupId);
    if (!backup) throw new Error('Backup not found');
    
    const userStorageDir = storageManager.getUserStorageDir();
    const targetCatalogPath = path.join(userStorageDir, 'catalog.db');
    
    const result = await backupManager.restoreCatalog(backup, targetCatalogPath);
    return { success: result.success, message: result.message };
  } catch (error: any) {
    console.error('[restore-catalog-from-backup] Error:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-backup-storage-usage', async () => {
  try {
    if (!storageManager) throw new Error('Storage manager not initialized');
    const backupManager = storageManager.getBackupManager();
    if (!backupManager) throw new Error('Backup manager not initialized');
    
    const usage = await backupManager.getBackupStorageUsage();
    return { success: true, ...usage };
  } catch (error: any) {
    console.error('[get-backup-storage-usage] Error:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('cleanup-old-backups', async (event, maxAgeDays: number = 30) => {
  try {
    if (!storageManager) throw new Error('Storage manager not initialized');
    const backupManager = storageManager.getBackupManager();
    if (!backupManager) throw new Error('Backup manager not initialized');
    
    const deletedCount = await backupManager.cleanupOldBackups(maxAgeDays);
    return { success: true, deletedCount };
  } catch (error: any) {
    console.error('[cleanup-old-backups] Error:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('validate-backup', async (event, backupId: string) => {
  try {
    if (!storageManager) throw new Error('Storage manager not initialized');
    const backupManager = storageManager.getBackupManager();
    if (!backupManager) throw new Error('Backup manager not initialized');
    
    const backups = await backupManager.getAvailableBackups();
    const backup = backups.find(b => b.id === backupId);
    if (!backup) throw new Error('Backup not found');
    
    const isValid = await backupManager.validateBackup(backup);
    return { success: true, isValid };
  } catch (error: any) {
    console.error('[validate-backup] Error:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('create-backup', async (event, driveId: string) => {
  try {
    if (!storageManager) throw new Error('Storage manager not initialized');
    const backupManager = storageManager.getBackupManager();
    if (!backupManager) throw new Error('Backup manager not initialized');
    
    // Get drive info
    const drives = await storageManager.getAllDrives();
    const drive = drives.find(d => d.id === driveId);
    if (!drive) throw new Error('Drive not found');
    
    // Get drive database path
    const userStorageDir = storageManager.getUserStorageDir();
    const driveDbPath = path.join(userStorageDir, `drive_${driveId}.db`);
    
    // Create backup
    const success = await backupManager.backupDrive(driveId, drive.name, driveDbPath, drive);
    
    if (success) {
      return { success: true, message: `Backup created for ${drive.name}` };
    } else {
      return { success: false, error: 'Failed to create backup' };
    }
  } catch (error: any) {
    console.error('[create-backup] Error:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-backup', async (event, backupId: string) => {
  try {
    if (!storageManager) throw new Error('Storage manager not initialized');
    const backupManager = storageManager.getBackupManager();
    if (!backupManager) throw new Error('Backup manager not initialized');
    
    const success = await backupManager.deleteBackup(backupId);
    
    if (success) {
      return { success: true, message: 'Backup deleted successfully' };
    } else {
      return { success: false, error: 'Failed to delete backup' };
    }
  } catch (error: any) {
    console.error('[delete-backup] Error:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-backup-file-tree', async (event, backupId: string) => {
  try {
    console.log(`[get-backup-file-tree] Requested for backup ID: ${backupId}`);
    if (!storageManager) throw new Error('Storage manager not initialized');
    const backupManager = storageManager.getBackupManager();
    if (!backupManager) throw new Error('Backup manager not initialized');
    
    const fileTree = await backupManager.getBackupFileTree(backupId);
    console.log(`[get-backup-file-tree] Returning ${fileTree.length} items`);
    return { success: true, fileTree };
  } catch (error: any) {
    console.error('[get-backup-file-tree] Error:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('list-backup-root', async (event, backupId: string) => {
  try {
    console.log(`[list-backup-root] Requested for backup ID: ${backupId}`);
    if (!storageManager) throw new Error('Storage manager not initialized');
    const backupManager = storageManager.getBackupManager();
    if (!backupManager) throw new Error('Backup manager not initialized');
    
    const files = await backupManager.listBackupRoot(backupId);
    console.log(`[list-backup-root] Returning ${files.length} root files`);
    return files;
  } catch (error: any) {
    console.error('[list-backup-root] Error:', error.message);
    return [];
  }
});

ipcMain.handle('list-backup-children', async (event, backupId: string, parentPath: string, limit?: number, offset?: number) => {
  try {
    console.log(`[list-backup-children] Requested for backup ID: ${backupId}, path: ${parentPath}`);
    if (!storageManager) throw new Error('Storage manager not initialized');
    const backupManager = storageManager.getBackupManager();
    if (!backupManager) throw new Error('Backup manager not initialized');
    
    const result = await backupManager.listBackupChildren(backupId, parentPath, limit, offset);
    console.log(`[list-backup-children] Returning ${result.files.length} children, hasMore: ${result.hasMore}`);
    return result;
  } catch (error: any) {
    console.error('[list-backup-children] Error:', error.message);
    return { files: [], hasMore: false };
  }
});

ipcMain.handle('cancel-scan', async (event) => {
  try {
    console.log('🚫 [CANCELLATION] ===== CANCEL-SCAN IPC HANDLER CALLED =====');
    console.log('🚫 [CANCELLATION] Current scan processor:', currentScanProcessor ? 'EXISTS' : 'NULL');
    console.log('🚫 [CANCELLATION] Current scan drive ID:', currentScanDriveId || 'NULL');
    
    if (!currentScanProcessor || !currentScanDriveId) {
      console.log('🚫 [CANCELLATION] ===== NO ACTIVE SCAN TO CANCEL =====');
      console.log('🚫 [CANCELLATION] Cannot cancel: scan processor or drive ID is null');
      return { success: false, error: 'No active scan to cancel' };
    }

    // Verify there's actually an active scan in the scan manager
    const scanState = scanManager.getScanState(currentScanDriveId);
    if (!scanState || scanState.status !== 'running') {
      console.log('🚫 [CANCELLATION] ===== NO RUNNING SCAN TO CANCEL =====');
      console.log('🚫 [CANCELLATION] Scan state:', scanState?.status || 'undefined');
      console.log('🚫 [CANCELLATION] Cannot cancel: scan is not in running state');
      return { success: false, error: 'No running scan to cancel' };
    }

    console.log('🚫 [CANCELLATION] ===== CANCELLING SCAN AND RESTORING FROM BACKUP =====');
    console.log('🚫 [CANCELLATION] Drive ID:', currentScanDriveId);
    console.log('🚫 [CANCELLATION] Timestamp:', new Date().toISOString());
    console.log('🚫 [CANCELLATION] Scan status before cancellation:', scanState.status);
    
    // Set global cancellation state FIRST
    isScanCancelled = true;
    console.log('🚫 [CANCELLATION] Global cancellation state set to TRUE');
    
    // Cancel the scan processor
    console.log('🚫 [CANCELLATION] Cancelling scan processor...');
    currentScanProcessor.cancel();
    console.log('🚫 [CANCELLATION] Scan processor cancelled successfully');
    
    // Store the drive ID before resetting it
    const cancelledDriveId = currentScanDriveId;
    console.log('🚫 [CANCELLATION] Stored cancelled drive ID:', cancelledDriveId);
    
    // Reset global tracking immediately to prevent further operations
    currentScanProcessor = null;
    currentScanDriveId = null;
    console.log('🚫 [CANCELLATION] Global tracking reset');
    
    // Also reset the scan manager state for this drive
    if (scanManager && cancelledDriveId) {
      console.log('🚫 [CANCELLATION] Marking scan as cancelled in scan manager...');
      scanManager.completeScan(cancelledDriveId, 'cancelled');
      console.log('🚫 [CANCELLATION] Scan marked as cancelled in scan manager');
    }
    
    // Note: Backup restoration is now handled IMMEDIATELY in start-sync-scan when cancellation is detected
    // This prevents race conditions between restoration and backup cleanup
    // We only need to handle cleanup here if restoration was successful
    if (storageManager && cancelledDriveId) {
      try {
        // Check if restoration was already handled by start-sync-scan
        console.log('🚫 [CANCELLATION] ===== CHECKING IF RESTORATION WAS ALREADY HANDLED =====');
        
        // IMPORTANT: Do NOT clean up backup files here, even if drive exists
        // The drive might exist but be in a corrupted state
        // Backup cleanup should only happen after CONFIRMED successful restoration
        console.log('🚫 [CANCELLATION] ===== PRESERVING BACKUP FILES FOR SAFETY =====');
        console.log('🚫 [CANCELLATION] Backup files will be cleaned up by start-sync-scan after successful restoration');
        console.log('🚫 [CANCELLATION] This prevents race conditions and ensures data safety');
        
      } catch (checkError: any) {
        console.error('🚫 [CANCELLATION] ===== ERROR CHECKING DRIVE STATE =====');
        console.error('🚫 [CANCELLATION] Error:', checkError.message);
        console.log('🚫 [CANCELLATION] Preserving backup files for safety');
      }
    } else {
      console.warn(`[main] Cannot check drive state: Storage manager not available`);
    }
    
    console.log('🚫 [CANCELLATION] ===== SCAN CANCELLATION COMPLETED SUCCESSFULLY =====');
    console.log('🚫 [CANCELLATION] Drive restored and backup cleanup scheduled');
    return { success: true, message: 'Scan cancelled and drive restored from backup' };
  } catch (error) {
    console.error('Error in cancel-scan handler:', error);
    throw error;
  }
});



// Tree browsing IPC backed by SQLite
ipcMain.handle('list-root', async (event, driveId: string) => {
  try {
    if (!storageManager) throw new Error('Storage manager not initialized');
    
    log('debug', `[list-root] Requesting root files for drive: ${driveId}`);
    
    // Check if the drive exists first
    const drive = await storageManager.getDriveById(driveId);
    log('debug', `[list-root] Drive info:`, drive);
    
    // Check if the drive database exists and has files
    // Use storage manager to get the correct user-specific path
    const driveDbPath = await storageManager.getDriveDatabasePath(driveId);
    const dbExists = await fs.pathExists(driveDbPath);
    log('debug', `[list-root] Drive database exists: ${dbExists}, path: ${driveDbPath}`);
    
    if (dbExists) {
      // Quick check of file count in the database
      try {
        const db = new (await import('better-sqlite3')).default(driveDbPath);
        const fileCount = db.prepare(`SELECT COUNT(*) as count FROM files WHERE drive_id = ?`).get(driveId) as any;
        log('debug', `Database contains ${fileCount.count} files for drive ${driveId}`);
        db.close();
      } catch (dbError: any) {
        console.error(`[list-root] Error checking database:`, dbError.message);
      }
    }
    
    const files = await storageManager.listRoot(driveId);
    log('debug', `[list-root] listRoot returned ${files.length} files for drive ${driveId}`);
    
    // Log first few files for debugging
    if (files.length > 0) {
      log('debug', `[list-root] First 3 files:`, files.slice(0, 3));
    } else {
      log('debug', `[list-root] No files found in database`);
      // Also log the SQL query used to fetch files if no files found
      try {
        const db = new (await import('better-sqlite3')).default(driveDbPath);
        const sql = `SELECT * FROM files WHERE drive_id = ? AND (parent_path IS NULL OR parent_path = '') LIMIT 1`;
        const testFile = db.prepare(sql).get(driveId);
        log('debug', `[list-root] Test query result:`, testFile);
        db.close();
      } catch (dbError: any) {
        log('debug', `[list-root] Error running test query:`, dbError.message);
      }
    }
    
    return files;
  } catch (error: any) {
    console.error('Error in list-root handler:', error.message);
    return [];
  }
});

ipcMain.handle('list-children', async (event, driveId: string, parentPath: string, limit?: number, offset?: number) => {
  try {
    if (!storageManager) throw new Error('Storage manager not initialized');
    const { files, hasMore } = await storageManager.listChildren(driveId, parentPath, limit, offset);
    return { files, hasMore };
  } catch (error: any) {
    console.error('Error in list-children handler:', error.message);
    return { files: [], hasMore: false };
  }
});

ipcMain.handle('get-drive-file-count', async (event, driveId: string) => {
  try {
    if (!storageManager) throw new Error('Storage manager not initialized');
    const count = await storageManager.getDriveFileCount(driveId);
    return count;
  } catch (error: any) {
    console.error('Error in get-drive-file-count handler:', error.message);
    return { total: 0, directories: 0, files: 0 };
  }
});

// Auth IPC handlers
ipcMain.handle('auth-signin', async (event, email: string, password: string) => {
  try {
    const { data, error } = await auth.signIn(email, password);
    return { data, error };
  } catch (error) {
    console.error('Error in auth-signin handler:', error);
    throw error;
  }
});

ipcMain.handle('auth-signup', async (event, email: string, password: string, name?: string) => {
  try {
    const { data, error } = await auth.signUp(email, password, name);
    return { data, error };
  } catch (error) {
    console.error('Error in auth-signup handler:', error);
    throw error;
  }
});

ipcMain.handle('auth-signout', async () => {
  try {
    const { error } = await auth.signOut();
    return { error };
  } catch (error) {
    console.error('Error in auth-signout handler:', error);
    throw error;
  }
});

ipcMain.handle('auth-get-session', async () => {
  try {
    const { session, error } = await auth.getSession();
    return { session, error };
  } catch (error) {
    console.error('Error in auth-get-session handler:', error);
    throw error;
  }
});

ipcMain.handle('auth-get-user', async () => {
  try {
    const { user, error } = await auth.getUser();
    return { user, error };
  } catch (error) {
    console.error('Error in auth-get-user handler:', error);
    throw error;
  }
});

ipcMain.handle('auth-reset-password', async (event, email: string) => {
  try {
    const { error } = await auth.resetPassword(email);
    return { error };
  } catch (error) {
    console.error('Error in auth-reset-password handler:', error);
    throw error;
  }
});

ipcMain.handle('check-trial-status', async () => {
  try {
    const { user, error: userError } = await auth.getUser();
    if (userError || !user) {
      return { profile: null };
    }

    // Use regular supabase client instead of admin client for profile query
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (profileError) {
      console.error('Error fetching profile:', profileError);
      return { profile: null };
    }
    return { profile };
  } catch (error) {
    console.error('Error in check-trial-status handler:', error);
    return { profile: null };
  }
});

// Switch storage to different user
ipcMain.handle('switch-storage-user', async (event, userId: string | null) => {
  const operationStartTime = Date.now();
  let operationPhase = 'validation';
  
  try {
    log('info', `===== STORAGE SWITCH REQUESTED =====`);
    log('info', `Switching storage to user: ${userId || 'anonymous'}`);
    
    // Phase 1: Handle anonymous storage (clear user data)
    if (userId === null) {
      log('info', `Phase 1: Switching to anonymous storage - clearing user data`);
      
      if (storageManager) {
        log('info', `Closing existing storage manager...`);
        await storageManager.close();
        storageManager = null;
        (global as any).storageManager = null;
      }
      
      log('info', `Successfully switched to anonymous storage`);
      log('info', `===== STORAGE SWITCH COMPLETED =====`);
      
      // Notify renderer of storage readiness
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('storage-ready', { 
          ready: false, 
          userId: null, 
          phase: 'anonymous',
          duration: Date.now() - operationStartTime
        });
      }
      
      return { 
        success: true, 
        phase: 'anonymous',
        duration: Date.now() - operationStartTime
      };
    }
    
    // Phase 2: Validate user ID
    operationPhase = 'validation';
    log('info', `Phase 2: Validating user ID: ${userId}`);
    
    if (typeof userId !== 'string' || userId.trim() === '') {
      throw new Error('Invalid user ID provided for storage initialization');
    }
    
    const validatedUserId = userId.trim();
    log('info', `User ID validated: ${validatedUserId}`);
    
    // Phase 3: Close existing storage manager
    operationPhase = 'cleanup';
    if (storageManager) {
      log('info', `Phase 3: Closing existing storage manager...`);
      await storageManager.close();
      log('info', `Existing storage manager closed`);
    }
    
    // Phase 4: Create new storage manager
    operationPhase = 'creation';
    log('info', `Phase 4: Creating new storage manager instance...`);
    const { PerDriveStorage } = await import('./per-drive-storage');
    const storageDir = path.join(app.getPath('userData'), 'storage');
    
    storageManager = new PerDriveStorage(storageDir, validatedUserId);
    log('info', `New storage manager created for user: ${validatedUserId}`);
    
    // Phase 5: Initialize storage manager
    operationPhase = 'initialization';
    log('info', `Phase 5: Initializing new storage manager...`);
    const initStartTime = Date.now();
    
    try {
      await storageManager.initialize();
      const initDuration = Date.now() - initStartTime;
      log('info', `Storage initialization completed in ${initDuration}ms`);
    } catch (initError) {
      console.error('[STORAGE] Storage initialization failed:', initError);
      // Clean up failed storage manager
      storageManager = null;
      (global as any).storageManager = null;
      throw new Error(`Storage initialization failed: ${initError instanceof Error ? initError.message : String(initError)}`);
    }
    
    // Phase 6: Verify storage readiness
    operationPhase = 'verification';
    if (!storageManager || !storageManager.isReady()) {
      throw new Error('Storage manager failed to initialize properly or is not ready');
    }
    
    // Make storageManager globally accessible for streaming processor
    (global as any).storageManager = storageManager;
    
    // Phase 6.5: Check for app crashes and recover if needed
    operationPhase = 'crash-detection';
    log('info', `Phase 6.5: Checking for app crashes during sync...`);
    try {
      await detectAndRecoverFromCrash();
      log('info', `Crash detection completed successfully`);
    } catch (crashError: any) {
      log('error', `Crash detection failed: ${crashError.message}`);
      // Don't fail initialization due to crash detection errors
    }
    
    // Phase 7: Load user drives
    operationPhase = 'drive-loading';
    log('info', `Phase 7: Loading user drives...`);
    let drives: any[] = [];
    let driveLoadError: string | null = null;
    
    try {
      drives = await storageManager.getAllDrives();
      log('info', `Loaded ${drives.length} drives for user: ${validatedUserId}`);
    } catch (driveError) {
      console.warn(`[STORAGE] Warning: Failed to load drives: ${driveError}`);
      driveLoadError = driveError instanceof Error ? driveError.message : String(driveError);
    }
    
    // Phase 8: Complete operation
    operationPhase = 'completion';
    const totalDuration = Date.now() - operationStartTime;
    log('info', `Successfully switched storage to user: ${validatedUserId} in ${totalDuration}ms`);
    log('info', `===== STORAGE SWITCH COMPLETED =====`);
    
    // Notify renderer of storage readiness
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('storage-ready', { 
        ready: true, 
        userId: validatedUserId, 
        phase: 'complete',
        duration: totalDuration,
        driveCount: drives.length,
        driveLoadError: driveLoadError
      });
    }
    
    return { 
      success: true, 
      phase: 'complete',
      duration: totalDuration,
      userId: validatedUserId,
      driveCount: drives.length,
      driveLoadError: driveLoadError
    };
    
  } catch (error) {
    const totalDuration = Date.now() - operationStartTime;
    console.error(`[STORAGE] Error switching storage user (phase: ${operationPhase}):`, error);
    console.error('[STORAGE] Error details:', {
      phase: operationPhase,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : 'Unknown',
      duration: totalDuration
    });
    
    // Ensure storage manager is cleaned up on error
    if (storageManager) {
      try {
        await storageManager.close();
      } catch (closeError) {
        console.error('[STORAGE] Error closing storage manager during error recovery:', closeError);
      }
      storageManager = null;
      (global as any).storageManager = null;
    }
    
    // Notify renderer of storage error
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('storage-error', { 
        phase: operationPhase,
        error: error instanceof Error ? error.message : String(error),
        duration: totalDuration
      });
    }
    
    throw error;
  }
});

// Check storage readiness
ipcMain.handle('check-storage-ready', async (event) => {
  try {
    const isReady = storageManager !== null && storageManager.isReady();
    let userId: string | null = null;
    
    if (storageManager) {
      try {
        userId = storageManager.getUserId();
      } catch (error) {
        log('info', `Error getting user ID: ${error}`);
        // User ID not set, storage not ready
      }
    }
    
    log('info', `Storage readiness check: ${isReady ? 'ready' : 'not ready'}`);
    if (isReady && userId) {
      log('info', `Current user: ${userId}`);
    }
    
    return { 
      ready: isReady, 
      userId: userId,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('[STORAGE] Error checking storage readiness:', error);
    return { 
      ready: false, 
      userId: null,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    };
  }
});

// Get storage status
ipcMain.handle('get-storage-status', async (event) => {
  try {
    if (!storageManager) {
      return {
        initialized: false,
        userId: null,
        storagePath: null,
        driveCount: 0,
        error: 'Storage manager not initialized'
      };
    }
    
    const status = storageManager.getStorageStatus();
    let userId: string | null = null;
    let storagePath: string | null = null;
    
    try {
      userId = storageManager.getUserId();
      storagePath = storageManager.getStoragePath();
    } catch (error) {
      log('info', `Error getting storage details: ${error}`);
      // Storage not fully ready
    }
    
    const drives = status.ready ? await storageManager.getAllDrives() : [];
    
    return {
      initialized: status.ready,
      userId: userId,
      storagePath: storagePath,
      driveCount: drives.length,
      drives: drives.map(drive => ({ id: drive.id, name: drive.name }))
    };
  } catch (error) {
    console.error('[STORAGE] Error getting storage status:', error);
    return {
      initialized: false,
      userId: null,
      storagePath: null,
      driveCount: 0,
      error: error instanceof Error ? error.message : String(error)
    };
  }
});

// Storage readiness notification handler
ipcMain.handle('notify-storage-ready', async (event) => {
  try {
    if (!storageManager) {
      return { ready: false, error: 'Storage manager not initialized' };
    }
    
    const status = storageManager.getStorageStatus();
    let userId: string | null = null;
    
    try {
      userId = storageManager.getUserId();
    } catch (error) {
      log('info', `Error getting user ID: ${error}`);
    }
    
    return { 
      ready: status.ready, 
      userId: userId,
      catalogDbExists: status.catalogDbExists,
      driveCount: status.driveCount,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('[STORAGE] Error notifying storage readiness:', error);
    return { 
      ready: false, 
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    };
  }
});

// Storage error recovery handler
ipcMain.handle('recover-storage-error', async (event, operation: string) => {
  try {
    log('info', `Attempting to recover from storage error: ${operation}`);
    
    // Close and reinitialize storage manager
    if (storageManager) {
      log('info', `Closing storage manager for recovery...`);
      await storageManager.close();
      storageManager = null;
      (global as any).storageManager = null;
    }
    
    // Notify renderer of recovery attempt
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('storage-recovery-attempt', { 
        operation: operation,
        timestamp: new Date().toISOString()
      });
    }
    
    return { 
      success: true, 
      message: `Storage recovery initiated for operation: ${operation}`,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('[STORAGE] Error during storage recovery:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    };
  }
});

// Storage health check handler
ipcMain.handle('check-storage-health', async (event) => {
  try {
    if (!storageManager) {
      return {
        healthy: false,
        error: 'Storage manager not initialized',
        timestamp: new Date().toISOString()
      };
    }
    
    const status = storageManager.getStorageStatus();
    let userId: string | null = null;
    let storagePath: string | null = null;
    let driveCount = 0;
    
    try {
      userId = storageManager.getUserId();
      storagePath = storageManager.getStoragePath();
      const drives = await storageManager.getAllDrives();
      driveCount = drives.length;
    } catch (error) {
      log('info', `Error getting storage health details: ${error}`);
    }
    
    const healthy = status.ready && userId !== null && storagePath !== null;
    
    return {
      healthy: healthy,
      userId: userId,
      storagePath: storagePath,
      catalogDbExists: status.catalogDbExists,
      driveCount: driveCount,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('[STORAGE] Error checking storage health:', error);
    return {
      healthy: false,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    };
  }
});

// =====================================================
// ADMIN OPERATIONS (Service Role Key Required)
// =====================================================

// User management operations
ipcMain.handle('admin-get-user', async (event, userId: string) => {
  try {
    return await supabaseAdmin.getUserById(userId);
  } catch (error) {
    console.error('Error in admin-get-user handler:', error);
    throw error;
  }
});

ipcMain.handle('admin-update-user', async (event, userId: string, updates: any) => {
  try {
    return await supabaseAdmin.updateUserProfile(userId, updates);
  } catch (error) {
    console.error('Error in admin-update-user handler:', error);
    throw error;
  }
});

ipcMain.handle('admin-delete-user', async (event, userId: string) => {
  try {
    return await supabaseAdmin.deleteUser(userId);
  } catch (error) {
    console.error('Error in admin-delete-user handler:', error);
    throw error;
  }
});

// Data management operations
ipcMain.handle('admin-get-user-data', async (event, userId: string) => {
  try {
    return await supabaseAdmin.getAllUserData(userId);
  } catch (error) {
    console.error('Error in admin-get-user-data handler:', error);
    throw error;
  }
});

ipcMain.handle('admin-delete-user-data', async (event, userId: string) => {
  try {
    return await supabaseAdmin.deleteUserData(userId);
  } catch (error) {
    console.error('Error in admin-delete-user-data handler:', error);
    throw error;
  }
});

ipcMain.handle('admin-migrate-user-data', async (event, fromUserId: string, toUserId: string) => {
  try {
    return await supabaseAdmin.migrateUserData(fromUserId, toUserId);
  } catch (error) {
    console.error('Error in admin-migrate-user-data handler:', error);
    throw error;
  }
});

// System operations
ipcMain.handle('admin-get-system-stats', async () => {
  try {
    return await supabaseAdmin.getSystemStats();
  } catch (error) {
    console.error('Error in admin-get-system-stats handler:', error);
    throw error;
  }
});

ipcMain.handle('admin-cleanup-orphaned-data', async () => {
  try {
    return await supabaseAdmin.cleanupOrphanedData();
  } catch (error) {
    console.error('Error in admin-cleanup-orphaned-data handler:', error);
    throw error;
  }
});

ipcMain.handle('admin-backup-user-data', async (event, userId: string) => {
  try {
    return await supabaseAdmin.backupUserData(userId);
  } catch (error) {
    console.error('Error in admin-backup-user-data handler:', error);
    throw error;
  }
});

// Auto-updater IPC handlers
ipcMain.handle('updater-check-for-updates', async () => {
  try {
    console.log('Checking for updates... NODE_ENV:', process.env.NODE_ENV, 'isDev:', !app.isPackaged);
    
    if (process.env.NODE_ENV === 'development') {
      // In development, use GitHub API
      const https = require('https');
      const options = {
        hostname: 'api.github.com',
        path: '/repos/rmacfarlane24/archivist/releases/latest',
        method: 'GET',
        headers: { 'User-Agent': 'Archivist-App' }
      };
      
      const response = await new Promise<any>((resolve, reject) => {
        const req = https.request(options, (res: any) => {
          let data = '';
          res.on('data', (chunk: any) => data += chunk);
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(e);
            }
          });
        });
        req.on('error', reject);
        req.end();
      });
      
      const latestVersion = response.tag_name?.replace('v', '') || app.getVersion();
      const currentVersion = app.getVersion();
      const updateAvailable = latestVersion !== currentVersion;
      
      return { 
        available: updateAvailable,
        version: latestVersion,
        currentVersion,
        message: updateAvailable ? undefined : 'You have the latest version'
      };
    }
    
    // For packaged apps, use electron-updater
    if (app.isPackaged) {
      try {
        console.log('Using electron-updater for packaged app...');
        const result = await autoUpdater.checkForUpdates();
        
        if (result && result.updateInfo) {
          const currentVersion = app.getVersion();
          const latestVersion = result.updateInfo.version;
          const updateAvailable = latestVersion !== currentVersion;
          
          console.log(`Version comparison - Current: ${currentVersion}, Latest: ${latestVersion}, Update available: ${updateAvailable}`);
          
          return { 
            available: updateAvailable,
            version: latestVersion,
            currentVersion,
            updateInfo: result.updateInfo
          };
        } else {
          console.log('No update info returned from electron-updater');
          return { 
            available: false,
            version: app.getVersion(),
            currentVersion: app.getVersion(),
            message: 'No updates available'
          };
        }
      } catch (error) {
        console.error('Electron-updater check failed:', error);
        throw error;
      }
    }
    
    throw new Error('Update check not available in this environment');
    
  } catch (error) {
    console.error('Error checking for updates:', error);
    return { available: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('updater-download-update', async () => {
  try {
    console.log('Starting update download...');
    
    if (process.env.NODE_ENV === 'development') {
      // In development, redirect to GitHub releases
      const https = require('https');
      const options = {
        hostname: 'api.github.com',
        path: '/repos/rmacfarlane24/archivist/releases/latest',
        method: 'GET',
        headers: { 'User-Agent': 'Archivist-App' }
      };
      
      const response = await new Promise<any>((resolve, reject) => {
        const req = https.request(options, (res: any) => {
          let data = '';
          res.on('data', (chunk: any) => data += chunk);
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(e);
            }
          });
        });
        req.on('error', reject);
        req.end();
      });
      
      const latestVersion = response.tag_name || `v${app.getVersion()}`;
      
      return { 
        success: false, 
        message: 'Manual download required in development',
        redirectUrl: `https://github.com/rmacfarlane24/archivist/releases/tag/${latestVersion}`,
        version: latestVersion.replace('v', '')
      };
    }

    // Get platform-specific download info
    const platform = process.platform;
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    
    // First, get the latest version info
    const result = await autoUpdater.checkForUpdates();
    if (!result?.updateInfo) {
      return { success: false, message: 'No update information available' };
    }
    
    const version = result.updateInfo.version;
    const baseUrl = `https://github.com/rmacfarlane24/archivist/releases/download/v${version}`;
    
    // Platform-specific file names and URLs
    let fileName: string;
    let downloadUrl: string;
    
    switch (platform) {
      case 'darwin':
        fileName = arch === 'arm64' ? `Archivist-${version}-arm64.dmg` : `Archivist-${version}.dmg`;
        downloadUrl = `${baseUrl}/${fileName}`;
        break;
      case 'win32':
        fileName = `Archivist Setup ${version}.exe`;
        downloadUrl = `${baseUrl}/${fileName}`;
        break;
      case 'linux':
        fileName = `Archivist-${version}.AppImage`;
        downloadUrl = `${baseUrl}/${fileName}`;
        break;
      default:
        return { success: false, message: `Unsupported platform: ${platform}` };
    }
    
    console.log(`Downloading ${fileName} for ${platform} ${arch}...`);
    console.log(`Download URL: ${downloadUrl}`);
    
    // For packaged apps, use electron-updater for download, then copy to Downloads
    if (app.isPackaged) {
      try {
        console.log('=== UPDATE DOWNLOAD START ===');
        console.log(`Platform: ${platform}, Arch: ${arch}`);
        console.log(`Expected filename: ${fileName}`);
        console.log(`Download URL would be: ${downloadUrl}`);
        console.log('Starting electron-updater download...');
        
        // Use electron-updater to download (handles redirects and platform detection)
        const downloadPromise = new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            console.error('Download timeout after 5 minutes');
            reject(new Error('Download timeout'));
          }, 300000); // 5 minute timeout
          
          autoUpdater.once('update-downloaded', (info) => {
            console.log('update-downloaded event fired:', info);
            clearTimeout(timeout);
            resolve(info);
          });
          
          autoUpdater.once('error', (error) => {
            console.error('autoUpdater error:', error);
            clearTimeout(timeout);
            reject(error);
          });
        });
        
        // Start the download
        console.log('Calling autoUpdater.downloadUpdate()...');
        await autoUpdater.downloadUpdate();
        
        // Wait for download to complete
        console.log('Waiting for download to complete...');
        const updateInfo = await downloadPromise;
        
        console.log('=== DOWNLOAD COMPLETED, LOOKING FOR FILE ===');
        
        // Find the downloaded file in electron-updater's cache and copy to Downloads
        const fs = require('fs');
        const path = require('path');
        const os = require('os');
        
        // electron-updater typically stores files in app cache directory
        const app = require('electron').app;
        const userDataPath = app.getPath('userData');
        const tempPath = app.getPath('temp');
        const downloadedPath = path.join(os.homedir(), 'Downloads', fileName);
        
        console.log(`User data path: ${userDataPath}`);
        console.log(`Temp path: ${tempPath}`);
        console.log(`Target downloads path: ${downloadedPath}`);
        
        // Try to find the downloaded file (electron-updater may name it differently)
        let sourceFile = null;
        
        // Common locations where electron-updater might store the file
        const possiblePaths = [
          path.join(userDataPath, 'pending', fileName),
          path.join(userDataPath, 'pending', 'update.dmg'),
          path.join(userDataPath, 'pending', 'update.exe'),
          path.join(userDataPath, 'pending', 'update.AppImage'),
          path.join(userDataPath, fileName),
          path.join(tempPath, fileName),
          path.join(tempPath, 'update.dmg'),
          path.join(tempPath, 'update.exe'),
          path.join(tempPath, 'ArchiCryst-updater', fileName),
          // Try some other common electron-updater paths
          path.join(userDataPath, 'pending', 'update'),
          path.join(userDataPath, '.cache', fileName)
        ];
        
        console.log('Searching for downloaded file in these locations:');
        for (let i = 0; i < possiblePaths.length; i++) {
          const possiblePath = possiblePaths[i];
          console.log(`[${i + 1}] Checking: ${possiblePath}`);
          
          try {
            if (fs.existsSync(possiblePath)) {
              const stats = fs.statSync(possiblePath);
              console.log(`  → FOUND! Size: ${stats.size} bytes, Modified: ${stats.mtime}`);
              sourceFile = possiblePath;
              break;
            } else {
              console.log('  → Not found');
            }
          } catch (error) {
            console.log(`  → Error checking: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        
        if (!sourceFile) {
          console.error('=== FILE NOT FOUND IN CACHE ===');
          console.log('Listing contents of key directories:');
          
          // List contents of pending directory
          const pendingDir = path.join(userDataPath, 'pending');
          try {
            const pendingContents = fs.readdirSync(pendingDir);
            console.log(`Pending directory (${pendingDir}):`, pendingContents);
          } catch (e) {
            console.log(`Pending directory doesn't exist or can't read: ${e instanceof Error ? e.message : String(e)}`);
          }
          
          // List contents of userData
          try {
            const userDataContents = fs.readdirSync(userDataPath);
            console.log(`User data directory (${userDataPath}):`, userDataContents);
          } catch (e) {
            console.log(`Can't read user data directory: ${e instanceof Error ? e.message : String(e)}`);
          }
          
          return { 
            success: false, 
            error: 'Downloaded file not found in expected locations. Check console for details.' 
          };
        }
        
        console.log(`=== COPYING FILE ===`);
        console.log(`From: ${sourceFile}`);
        console.log(`To: ${downloadedPath}`);
        
        // Copy the file to Downloads with proper name
        try {
          fs.copyFileSync(sourceFile, downloadedPath);
          
          // Verify the copy worked
          const copiedStats = fs.statSync(downloadedPath);
          console.log(`✅ Copy successful! Downloaded file size: ${copiedStats.size} bytes`);
          console.log(`File location: ${downloadedPath}`);
          
          return { success: true, filePath: downloadedPath };
        } catch (copyError) {
          console.error('❌ Failed to copy file to Downloads:', copyError);
          // Still return success since the file was downloaded, just tell user where it is
          return { 
            success: true, 
            filePath: sourceFile,
            message: `Download completed but copy failed. File is at: ${sourceFile}`
          };
        }
        
      } catch (error) {
        console.error('=== DOWNLOAD FAILED ===');
        console.error('Error details:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
    
    return { success: false, message: 'Updates not available in this environment' };
    
  } catch (error) {
    console.error('Error downloading update:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// Open downloaded file (DMG, EXE, etc.)
ipcMain.handle('open-downloaded-file', async (_, filePath: string) => {
  try {
    const { shell } = require('electron');
    await shell.openPath(filePath);
    return { success: true };
  } catch (error) {
    console.error('Error opening file:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// Show file in folder
ipcMain.handle('show-file-in-folder', async (_, filePath: string) => {
  try {
    const { shell } = require('electron');
    shell.showItemInFolder(filePath);
    return { success: true };
  } catch (error) {
    console.error('Error showing file in folder:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// Get current platform info
ipcMain.handle('get-platform-info', async () => {
  return {
    platform: process.platform,
    arch: process.arch
  };
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.handle('open-external', (event, url: string) => {
  const { shell } = require('electron');
  return shell.openExternal(url);
});

// Protocol registration removed - using simple web confirmation instead
function registerAppProtocol() {
  // No protocol registration needed for Option 3
  console.log('Using simple web confirmation - no protocol registration needed');
}

// Handle app:// protocol URLs
function handleAppProtocol() {
  const gotTheLock = app.requestSingleInstanceLock();
  
  if (!gotTheLock) {
    app.quit();
    return;
  }
  
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window instead.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  
    // No protocol handling needed for Option 3 - using simple web confirmation
  console.log('Using simple web confirmation - no protocol handling needed');
}

// Auto-updater configuration (only for production builds)
function configureAutoUpdater() {
  if (process.env.NODE_ENV === 'development') {
    log('debug', 'Auto-updater disabled in development mode');
    return;
  }

  // Configure auto-updater
  autoUpdater.logger = console;
  autoUpdater.autoDownload = false; // Don't auto-download, let user decide
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.autoInstallOnAppQuit = false;
  
  // Note: setFeedURL not needed for GitHub releases - electron-updater auto-detects from package.json
  // Manual update checking (don't call checkForUpdatesAndNotify automatically)

  // Auto-updater event handlers
  autoUpdater.on('checking-for-update', () => {
    log('info', 'Checking for application updates...');
  });

  autoUpdater.on('update-available', (info) => {
    log('info', 'Update available:', info.version);
    // TODO: Notify user via main window or system notification
  });

  autoUpdater.on('update-not-available', () => {
    log('debug', 'Application is up to date');
  });

  autoUpdater.on('error', (err) => {
    log('error', 'Auto-updater error:', err);
  });

  autoUpdater.on('download-progress', (progress) => {
    log('info', `Download progress: ${Math.round(progress.percent)}%`);
  });

  autoUpdater.on('update-downloaded', () => {
    log('info', 'Update downloaded - restart required to apply');
    // TODO: Notify user and prompt for restart
  });

  // Check for updates on startup (with delay to ensure app is fully loaded)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(err => {
      log('warn', 'Failed to check for updates:', err);
    });
  }, 10000); // 10 second delay
}

// App lifecycle
app.whenReady().then(async () => {
  try {
    registerAppProtocol();
    handleAppProtocol();
    
    // Initialize auto-updater (production only)
    configureAutoUpdater();
    
    // Storage manager will be initialized when user authenticates
    // No anonymous storage initialization - storage only for authenticated users
    if (isDebugMode) {
      log('debug', 'Skipping anonymous storage initialization');
      log('debug', 'Storage will be initialized when user authenticates');
    }
    
    await createWindow();
  } catch (error) {
    console.error('Error during app initialization:', error);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
}); 

// ===== APP CRASH DETECTION AND RECOVERY =====

/**
 * Detect and recover from potential app crashes during sync operations
 */
async function detectAndRecoverFromCrash(): Promise<void> {
  if (!storageManager) {
    log('debug', 'Storage manager not initialized, skipping crash detection');
    return;
  }

  try {
    log('info', '===== CHECKING FOR APP CRASH DURING SYNC =====');
    
    const crashResult = await storageManager.checkForAppCrash();
    
    if (!crashResult.crashDetected) {
      log('info', 'No crash detected during startup');
      return;
    }
    
    log('warn', 'Potential app crash detected during sync operation');
    
    if (!crashResult.crashData) {
      log('warn', 'Crash detected but no crash data available, cleaning up files');
      await storageManager.cleanupCrashDetectionFiles();
      return;
    }
    
    const crashData = crashResult.crashData;
    const crashTime = new Date(crashData.startTime).toLocaleString();
    const driveName = crashData.driveName || crashData.driveId;
    
    log('info', `Crash details: Drive=${driveName}, Operation=${crashData.operation}, Phase=${crashData.phase}, Time=${crashTime}`);
    
    // Show recovery dialog to user
    const response = await dialog.showMessageBox({
      type: 'warning',
      title: 'Potential Data Corruption Detected',
      message: 'The app may have crashed during a sync operation. Would you like to restore from backup?',
      detail: `Drive: ${driveName}\nOperation: ${crashData.operation}\nPhase: ${crashData.phase}\nStarted: ${crashTime}`,
      buttons: ['Restore from Backup', 'Continue Anyway', 'Show Details'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    });
    
    if (response.response === 0) {
      // User chose to restore
      log('info', 'User chose to restore from backup');
      
      try {
        // Show progress dialog
        const progressDialog = new BrowserWindow({
          width: 400,
          height: 200,
          modal: true,
          parent: mainWindow || undefined,
          show: false,
          resizable: false,
          webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
          }
        });
        
        progressDialog.loadURL(`data:text/html;charset=utf-8,
          <html>
            <head><title>Recovery in Progress</title></head>
            <body style="font-family: system-ui; padding: 20px; text-align: center;">
              <h3>Restoring from Backup</h3>
              <p>Recovering drive: ${driveName}</p>
              <p id="status">Preparing recovery...</p>
            </body>
          </html>
        `);
        
        progressDialog.show();
        
        // Execute recovery
        const recoveryResult = await storageManager.executeAppCrashRecovery(crashData);
        
        progressDialog.close();
        
        if (recoveryResult.success) {
          await dialog.showMessageBox({
            type: 'info',
            title: 'Recovery Successful',
            message: 'Your data has been restored from backup.',
            detail: recoveryResult.details.join('\n'),
            buttons: ['OK']
          });
          log('info', 'App crash recovery completed successfully');
        } else {
          await dialog.showMessageBox({
            type: 'error',
            title: 'Recovery Failed',
            message: 'Failed to restore from backup.',
            detail: recoveryResult.error || 'Unknown error occurred during recovery',
            buttons: ['OK']
          });
          log('error', `App crash recovery failed: ${recoveryResult.error}`);
        }
      } catch (recoveryError: any) {
        log('error', `Exception during app crash recovery: ${recoveryError.message}`);
        await dialog.showMessageBox({
          type: 'error',
          title: 'Recovery Error',
          message: 'An error occurred during recovery.',
          detail: recoveryError.message,
          buttons: ['OK']
        });
      }
    } else if (response.response === 2) {
      // Show details
      const detailsText = JSON.stringify(crashData, null, 2);
      await dialog.showMessageBox({
        type: 'info',
        title: 'Crash Details',
        message: 'Sync operation details:',
        detail: detailsText,
        buttons: ['OK']
      });
      log('info', 'Showed crash details to user');
    } else {
      // User chose to continue anyway
      log('info', 'User chose to continue without recovery');
    }
    
    // Clean up crash detection files regardless of user choice
    await storageManager.cleanupCrashDetectionFiles();
    log('info', 'Crash detection files cleaned up');
    
  } catch (error: any) {
    log('error', `Error during crash detection: ${error.message}`);
    // Clean up on error
    try {
      if (storageManager) {
        await storageManager.cleanupCrashDetectionFiles();
      }
    } catch (cleanupError: any) {
      log('error', `Failed to cleanup crash detection files: ${cleanupError.message}`);
    }
  }
}

// File system watchers for real-time updates
const fileWatchers = new Map<string, fs.FSWatcher>();
const changeQueue = new Map<string, { type: 'add' | 'change' | 'unlink'; path: string; timestamp: number }[]>();
const DEBOUNCE_DELAY = 1000; // 1 second debounce

// Function to start watching a drive
async function startWatchingDrive(drivePath: string, driveId: string): Promise<void> {
  log('debug', `Starting file system watcher for drive: ${driveId}`);
  log('debug', `Drive path: ${drivePath}`);
  
  try {
    // Stop existing watcher if any
    if (fileWatchers.has(driveId)) {
      log('debug', `Stopping existing watcher for drive ${driveId}...`);
      fileWatchers.get(driveId)!.close();
      fileWatchers.delete(driveId);
      log('debug', `Existing watcher stopped for drive ${driveId}`);
    }
    
    log('debug', `Creating new file system watcher for drive: ${drivePath}`);
    
    // Create watcher with recursive option
    const watcher = fs.watch(drivePath, { recursive: true }, (eventType, filename) => {
      if (filename) {
        const fullPath = path.join(drivePath, filename);
        const change = {
          type: eventType as 'add' | 'change' | 'unlink',
          path: fullPath,
          timestamp: Date.now()
        };
        
        // Add to change queue
        if (!changeQueue.has(driveId)) {
          changeQueue.set(driveId, []);
        }
        changeQueue.get(driveId)!.push(change);
        
        // Debounce changes
        setTimeout(() => {
          processChangeQueue(driveId);
        }, DEBOUNCE_DELAY);
      }
    });
    
    fileWatchers.set(driveId, watcher);
    log('debug', `File system watcher started successfully for drive: ${driveId}`);
    log('debug', `Watcher will monitor changes recursively in: ${drivePath}`);
  } catch (error: any) {
    console.error(`[FILE_WATCHER] Failed to start file system watcher for ${drivePath}:`, error.message);
    throw error;
  }
}

// Function to stop watching a drive
function stopWatchingDrive(driveId: string): void {
  log('debug', `Stopping file system watcher for drive: ${driveId}`);
  
  try {
    if (fileWatchers.has(driveId)) {
      log('debug', `Closing watcher connection for drive ${driveId}...`);
      fileWatchers.get(driveId)!.close();
      fileWatchers.delete(driveId);
      changeQueue.delete(driveId);
      log('debug', `File system watcher stopped successfully for drive: ${driveId}`);
    } else {
      log('debug', `No active watcher found for drive ${driveId}`);
    }
  } catch (error: any) {
    console.error(`[FILE_WATCHER] Error stopping file system watcher for ${driveId}:`, error.message);
  }
}

// Function to process change queue
async function processChangeQueue(driveId: string): Promise<void> {
  try {
    const changes = changeQueue.get(driveId);
    if (!changes || changes.length === 0) return;
    
    console.log(`Processing ${changes.length} file system changes for drive: ${driveId}`);
    
    // Group changes by type
    const adds = changes.filter(c => c.type === 'add');
    const changes_ = changes.filter(c => c.type === 'change');
    const unlinks = changes.filter(c => c.type === 'unlink');
    
    // Process changes
    if (adds.length > 0) {
      await processFileAdditions(driveId, adds.map(c => c.path));
    }
    
    if (changes_.length > 0) {
      await processFileChanges(driveId, changes_.map(c => c.path));
    }
    
    if (unlinks.length > 0) {
      await processFileDeletions(driveId, unlinks.map(c => c.path));
    }
    
    // Clear processed changes
    changeQueue.set(driveId, []);
    
    // Notify UI of changes
    if (mainWindow) {
      mainWindow.webContents.send('file-system-changes', {
        driveId,
        changes: {
          added: adds.length,
          changed: changes_.length,
          deleted: unlinks.length
        }
      });
    }
  } catch (error: any) {
    console.error(`Error processing change queue for ${driveId}:`, error.message);
  }
}

// Function to process file additions
async function processFileAdditions(driveId: string, filePaths: string[]): Promise<void> {
  try {
    if (!storageManager) throw new Error('Storage manager not initialized');
    const files = await storageManager.listDriveFiles(driveId, '');
    const newFiles: Omit<FileInfo, 'id'>[] = [];
    
    for (const filePath of filePaths) {
      try {
        const stats = await fs.stat(filePath);
        const normalizedFolder = normalizePath(files[0]?.folderPath || '');
        const normalizedFile = normalizePath(filePath);
        const relativePath = path.relative(normalizedFolder, normalizedFile);
        const parentPath = normalizePath(path.dirname(normalizedFile));
        
        // Handle hard links
        let inode: number | undefined;
        let hardLinkCount: number | undefined;
        let isHardLink = false;
        let hardLinkGroup: string | undefined;
        
        if (!stats.isDirectory() && stats.nlink > 1) {
          inode = stats.ino;
          hardLinkCount = stats.nlink;
          isHardLink = true;
          hardLinkGroup = `hardlink_${inode}_${Date.now()}`;
        }
        
        const fileInfo: Omit<FileInfo, 'id'> = {
          name: path.basename(normalizedFile),
          path: normalizedFile,
          parentPath: parentPath === normalizedFolder ? null : parentPath,
          size: stats.isDirectory() ? 0 : stats.size,
          created: stats.birthtime.toISOString(),
          modified: stats.mtime.toISOString(),
          isDirectory: stats.isDirectory(),
          folderPath: normalizedFolder,
          driveId: driveId,
          depth: relativePath.split(path.sep).length - 1,
          inode,
          hardLinkCount,
          isHardLink,
          hardLinkGroup
        };
        
        newFiles.push(fileInfo);
      } catch (error: any) {
        console.warn(`Error processing added file ${filePath}:`, error.message);
      }
    }
    
    if (newFiles.length > 0) {
      // Add new files to storage
      const updatedFiles = [...files, ...newFiles.map(f => ({ ...f, id: generateId() }))];
      await storageManager.storeFileTree(driveId, updatedFiles);
      
      // Update memory cache
      // if (memoryCache) {
      //   memoryCache.setFiles(driveId, updatedFiles);
      // }
      
      console.log(`Added ${newFiles.length} new files to drive: ${driveId}`);
    }
  } catch (error: any) {
    console.error(`Error processing file additions for ${driveId}:`, error.message);
  }
}

// Function to process file changes
async function processFileChanges(driveId: string, filePaths: string[]): Promise<void> {
  try {
    if (!storageManager) throw new Error('Storage manager not initialized');
    const files = await storageManager.listDriveFiles(driveId, '');
    let updatedCount = 0;
    
    for (const filePath of filePaths) {
      try {
        const stats = await fs.stat(filePath);
        const fileIndex = files.findIndex(f => f.path === filePath);
        
        if (fileIndex !== -1) {
          // Update file metadata
          files[fileIndex].size = stats.isDirectory() ? 0 : stats.size;
          files[fileIndex].modified = stats.mtime.toISOString();
          
          // Update hard link info if needed
          if (!stats.isDirectory() && stats.nlink > 1) {
            files[fileIndex].inode = stats.ino;
            files[fileIndex].hardLinkCount = stats.nlink;
            files[fileIndex].isHardLink = true;
          }
          
          updatedCount++;
        }
      } catch (error: any) {
        console.warn(`Error processing changed file ${filePath}:`, error.message);
      }
    }
    
    if (updatedCount > 0) {
      // Update storage
      await storageManager.storeFileTree(driveId, files);
      
      // Update memory cache
      // if (memoryCache) {
      //   memoryCache.setFiles(driveId, files);
      // }
      
      console.log(`Updated ${updatedCount} files in drive: ${driveId}`);
    }
  } catch (error: any) {
    console.error(`Error processing file changes for ${driveId}:`, error.message);
  }
}

// Function to process file deletions
async function processFileDeletions(driveId: string, filePaths: string[]): Promise<void> {
  try {
    if (!storageManager) throw new Error('Storage manager not initialized');
    const files = await storageManager.listDriveFiles(driveId, '');
    const filesToRemove = new Set(filePaths);
    const remainingFiles = files.filter(f => !filesToRemove.has(f.path));
    
    if (remainingFiles.length < files.length) {
      // Update storage
      await storageManager.storeFileTree(driveId, remainingFiles);
      
      // Update memory cache
      // if (memoryCache) {
      //   memoryCache.setFiles(driveId, remainingFiles);
      // }
      
      console.log(`Removed ${files.length - remainingFiles.length} files from drive: ${driveId}`);
    }
  } catch (error: any) {
    console.error(`Error processing file deletions for ${driveId}:`, error.message);
  }
} 

// (Removed) Network drive monitoring and optimization handlers

// Simplified Scan management IPC handlers for single-scan mode
ipcMain.handle('check-scan-conflicts', async (event, driveId: string) => {
  try {
    const conflicts = scanManager.checkScanConflicts(driveId);
    const resolution = await scanManager.resolveScanConflicts(driveId, 1);
    
    return {
      success: true,
      hasConflicts: conflicts.hasConflict,
      conflicts: conflicts.conflicts,
      canStart: resolution.canStart,
      message: resolution.message,
      queueStatus: scanManager.getQueueStatus()
    };
  } catch (error: any) {
    console.error('Error checking scan conflicts:', error.message);
    return { success: false, error: error.message };
  }
});

// Removed duplicate cancel-scan handler - using the main one instead

ipcMain.handle('get-scan-status', async (event, driveId?: string) => {
  try {
    if (driveId) {
      // Get status for specific drive
      const scanState = scanManager.getScanState(driveId);
      return {
        success: true,
        driveId,
        scanState,
        isLocked: scanManager.isDriveLocked(driveId),
        isBeingScanned: scanManager.isDriveBeingScanned(driveId)
      };
    } else {
      // Get status for all drives (single-scan mode)
      const allScans = scanManager.getAllActiveScans();
      const queueStatus = scanManager.getQueueStatus();
      return {
        success: true,
        activeScans: allScans,
        queueStatus,
        totalActive: allScans.length,
        totalQueued: 0
      };
    }
  } catch (error: any) {
    console.error('Error getting scan status:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-active-scan-info', async (event) => {
  try {
    return {
      success: true,
      hasActiveScan: !!currentScanProcessor,
      currentDriveId: currentScanDriveId,
      isCancelled: isScanCancelled,
      scanManagerStatus: scanManager.getQueueStatus()
    };
  } catch (error: any) {
    console.error('Error getting active scan info:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-scan-queue', async () => {
  // Always empty in single-scan mode
  return {
    success: true,
    queueStatus: { queued: 0, active: scanManager.getQueueStatus().active },
    activeScans: scanManager.getAllActiveScans(),
    message: 'Queue disabled (single-scan mode)'
  };
});

ipcMain.handle('clear-scan-queue', async () => {
  // Noop in single-scan mode
  return { success: true, cleared: 0, message: 'Queue disabled (single-scan mode)' };
});

ipcMain.handle('set-scan-priority', async () => {
  // Noop in single-scan mode
  return { success: false, message: 'Priority not supported (single-scan mode)' };
});

// Streaming support for very large datasets
interface StreamingScanConfig {
  enableStreaming: boolean;
  chunkSize: number;
  memoryThreshold: number; // MB
  progressInterval: number;
  enableMemoryMonitoring: boolean;
}

// Default streaming scan configuration
const DEFAULT_STREAMING_SCAN_CONFIG: StreamingScanConfig = {
  enableStreaming: true,
              chunkSize: 3000, // Process 3000 files at a time for better performance while maintaining UI responsiveness
  memoryThreshold: 800, // 800MB memory threshold
  progressInterval: 10000, // Progress update every 10k files
  enableMemoryMonitoring: true
};

// Memory monitoring for scanning
class ScanMemoryMonitor {
  private static instance: ScanMemoryMonitor;
  private memoryUsage: NodeJS.MemoryUsage | null = null;
  private lastCheck = 0;
  private checkInterval = 3000; // Check every 3 seconds

  static getInstance(): ScanMemoryMonitor {
    if (!ScanMemoryMonitor.instance) {
      ScanMemoryMonitor.instance = new ScanMemoryMonitor();
    }
    return ScanMemoryMonitor.instance;
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

  isMemoryHigh(thresholdMB: number = 800): boolean {
    const usage = this.getMemoryUsageMB();
    return usage.heapUsed > thresholdMB;
  }

  async forceGarbageCollection(): Promise<void> {
    if (global.gc) {
      global.gc();
      console.log('Forced garbage collection during scan');
    }
  }

  logMemoryUsage(context: string = ''): void {
    const usage = this.getMemoryUsageMB();
    console.log(`Scan memory usage ${context}: RSS: ${usage.rss}MB, Heap: ${usage.heapUsed}/${usage.heapTotal}MB, External: ${usage.external}MB`);
  }
}

// Streaming file processor for large scans
class StreamingScanProcessor {
  private config: StreamingScanConfig;
  private memoryMonitor: ScanMemoryMonitor;
  private processedCount = 0;
  private currentChunk: Omit<FileInfo, 'id'>[] = [];
  private allFiles: Omit<FileInfo, 'id'>[] = [];
  private startTime: number;
  private lastProgressUpdate = 0;
  private fileCount: number;
  private isCancelled = false;

  constructor(config: StreamingScanConfig = DEFAULT_STREAMING_SCAN_CONFIG,  fileCount: number = 0) {
    this.config = config;
    this.memoryMonitor = ScanMemoryMonitor.getInstance();
    this.startTime = Date.now();
    this.fileCount = fileCount;
  }

  async processFile(fileInfo: Omit<FileInfo, 'id'>): Promise<void> {
    // Check for cancellation
    if (this.isCancelled) {
      throw new Error('Scan cancelled by user');
    }

    this.currentChunk.push(fileInfo);
    this.processedCount++;

    // Check if we need to process the current chunk
    if (this.currentChunk.length >= this.config.chunkSize) {
      await this.processChunk();
    }

    // Check memory usage and force GC if needed
    if (this.config.enableMemoryMonitoring && this.memoryMonitor.isMemoryHigh(this.config.memoryThreshold)) {
      console.log(`Memory threshold reached (${this.config.memoryThreshold}MB), forcing garbage collection`);
      await this.memoryMonitor.forceGarbageCollection();
    }

    // Progress updates
    if (this.processedCount % this.config.progressInterval === 0) {
      this.logProgress();
    }
  }

  cancel(): void {
    this.isCancelled = true;
    console.log('[StreamingScanProcessor] Scan cancelled by user');
  }

  getIsCancelled(): boolean {
    return this.isCancelled;
  }

  private async processChunk(): Promise<void> {
    if (this.currentChunk.length === 0) return;
    
    // Don't process chunk if cancelled
    if (this.isCancelled) {
      console.log('StreamingScanProcessor processChunk() called but scan was cancelled - skipping');
      this.currentChunk = []; // Clear the chunk
      return;
    }

    // Add chunk to all files
    this.allFiles.push(...this.currentChunk);
    
    // Send batch progress update for progressive rendering
    if (mainWindow) {
      log('debug', `Streaming processor sending batch: ${this.currentChunk.length} files, processed: ${this.processedCount}`);
      log('debug', `mainWindow exists: ${!!mainWindow}, webContents exists: ${!!mainWindow.webContents}`);
      
      try {
        mainWindow.webContents.send('scan-progress', {
          type: 'batch',
          driveId: this.currentChunk[0]?.driveId, // Get driveId from first file in chunk
          files: this.currentChunk,
          processed: this.processedCount,
          total: this.fileCount,
          message: `Streaming batch: ${this.currentChunk.length} files (${this.processedCount} total)`
        });
        console.log('[BACKEND PROGRESS DEBUG] Streaming batch event sent with total:', this.fileCount);
        log('debug', `Streaming batch update sent successfully`);
        
        // Store this batch in the database progressively
        if (this.currentChunk.length > 0) {
          // Check if this is a sync scan
          const isSyncScan = (global as any).isSyncScan && (global as any).currentSyncDriveId === this.currentChunk[0]?.driveId;
          
          if (isSyncScan) {
            log('debug', `Storing streaming batch of ${this.currentChunk.length} files in NEW scan database (SYNC streaming mode)...`);
            try {
              // We need to get the storageManager instance - let's pass it through
              if ((global as any).storageManager) {
                await (global as any).storageManager.storeFileTreeToNewDatabase(
                  this.currentChunk[0]?.driveId, 
                  this.currentChunk
                );
                log('debug', `Streaming batch stored successfully in NEW scan database (SYNC streaming mode)`);
              }
            } catch (storageError) {
              console.error(`[PROGRESSIVE] Failed to store streaming batch in NEW scan database (SYNC streaming mode):`, storageError);
            }
          } else {
            log('debug', `Storing streaming batch of ${this.currentChunk.length} files in main database (ADD NEW streaming mode)...`);
            try {
              // We need to get the storageManager instance - let's pass it through
              if ((global as any).storageManager) {
                await (global as any).storageManager.storeFileTreeProgressive(
                  this.currentChunk[0]?.driveId, 
                  this.currentChunk
                );
                log('debug', `Streaming batch stored successfully in main database (ADD NEW streaming mode)`);
              }
            } catch (storageError) {
              console.error(`[PROGRESSIVE] Failed to store streaming batch in main database (ADD NEW streaming mode):`, storageError);
            }
          }
        }
      } catch (error) {
        console.error(`[PROGRESSIVE] Failed to send streaming batch update:`, error);
      }
    }
    
    // Clear the chunk to free memory
    this.currentChunk = [];
    
    // Force garbage collection after each chunk
    if (this.config.enableMemoryMonitoring) {
      await this.memoryMonitor.forceGarbageCollection();
    }
  }

  private logProgress(): void {
    const elapsed = Date.now() - this.startTime;
    const rate = this.processedCount / (elapsed / 1000);
    const memoryUsage = this.memoryMonitor.getMemoryUsageMB();
    
    console.log(`Streaming scan progress: ${this.processedCount} files processed - ${rate.toFixed(1)} files/sec`);
    console.log(`Memory usage: ${memoryUsage.heapUsed}MB/${memoryUsage.heapTotal}MB`);
    
    // Send progress update to UI
    if (mainWindow) {
      mainWindow.webContents.send('scan-progress', {
        type: 'streaming-progress',
        processed: this.processedCount,
        rate: rate.toFixed(1),
        memoryUsage: memoryUsage,
        message: `Streaming scan: ${this.processedCount} files processed (${rate.toFixed(1)} files/sec)`
      });
    }
  }

  async finalize(): Promise<Omit<FileInfo, 'id'>[]> {
    // Don't finalize if cancelled
    if (this.isCancelled) {
      console.log('StreamingScanProcessor finalize() called but scan was cancelled - skipping');
      console.log('Note: Backup restoration will be handled by cancelScan() handler');
      return this.allFiles;
    }
    
    // Process any remaining files in the current chunk
    if (this.currentChunk.length > 0) {
      await this.processChunk();
    }

    const totalTime = Date.now() - this.startTime;
    const rate = this.processedCount / (totalTime / 1000);
    
    console.log(`Streaming scan completed: ${this.processedCount} files in ${totalTime}ms (${rate.toFixed(1)} files/sec)`);
    
    // Note: Backup cleanup will be handled by the main scan completion logic
    // Don't attempt cleanup here to avoid conflicts
    log('debug', `Note: Backup cleanup will be handled by main scan completion`);
    
    // Send completion signal to UI for progressive rendering
    if (mainWindow) {
      try {
        mainWindow.webContents.send('scan-progress', {
          type: 'complete',
          processed: this.processedCount,
          message: `Streaming scan completed. Processed ${this.processedCount} files.`
        });
      } catch (error) {
        console.error(`[PROGRESSIVE] Failed to send completion signal:`, error);
      }
    }
    
    return this.allFiles;
  }

  getProgress(): { processed: number; chunks: number; memoryUsage: NodeJS.MemoryUsage } {
    return {
      processed: this.processedCount,
      chunks: Math.ceil(this.processedCount / this.config.chunkSize),
      memoryUsage: this.memoryMonitor.getMemoryUsage()
    };
  }
}

// Streaming IPC handlers
ipcMain.handle('get-streaming-status', async (event, driveId?: string) => {
  try {
    const memoryMonitor = ScanMemoryMonitor.getInstance();
    const memoryUsage = memoryMonitor.getMemoryUsageMB();
    
    return {
      success: true,
      memoryUsage,
      isMemoryHigh: memoryMonitor.isMemoryHigh(),
      streamingEnabled: DEFAULT_STREAMING_SCAN_CONFIG.enableStreaming,
      config: DEFAULT_STREAMING_SCAN_CONFIG
    };
  } catch (error: any) {
    console.error('Error getting streaming status:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-memory-usage', async (event) => {
  try {
    const memoryMonitor = ScanMemoryMonitor.getInstance();
    const memoryUsage = memoryMonitor.getMemoryUsageMB();
    
    return {
      success: true,
      memoryUsage,
      isMemoryHigh: memoryMonitor.isMemoryHigh(),
      threshold: DEFAULT_STREAMING_SCAN_CONFIG.memoryThreshold
    };
  } catch (error: any) {
    console.error('Error getting memory usage:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('force-garbage-collection', async (event) => {
  try {
    const memoryMonitor = ScanMemoryMonitor.getInstance();
    await memoryMonitor.forceGarbageCollection();
    
    const memoryUsage = memoryMonitor.getMemoryUsageMB();
    
    return {
      success: true,
      message: 'Garbage collection completed',
      memoryUsage
    };
  } catch (error: any) {
    console.error('Error forcing garbage collection:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-streaming-config', async (event) => {
  try {
    return {
      success: true,
      config: DEFAULT_STREAMING_SCAN_CONFIG
    };
  } catch (error: any) {
    console.error('Error getting streaming config:', error.message);
    return { success: false, error: error.message };
  }
});

// Recovery functionality removed for MVP - will be rebuilt later

// Utility IPC handlers
ipcMain.handle('format-bytes', async (event, bytes: number) => {
  try {
    if (bytes === 0) return '0 Bytes';
    const k = 1000; // Use decimal units to match Finder
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  } catch (error: any) {
    console.error('Error formatting bytes:', error.message);
    return '0 Bytes';
  }
});

ipcMain.handle('format-date', async (event, dateString: string) => {
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  } catch (error: any) {
    console.error('Error formatting date:', error.message);
    return dateString;
  }
});

// Scan progress IPC handler
ipcMain.handle('scan-progress', async (event, driveId: string) => {
  // This is just a placeholder - the actual progress will be emitted via ipcMain.emit
  return { success: true };
});

ipcMain.handle('check-backup-status', async (event, driveId: string) => {
  try {
    if (!storageManager) {
      return { success: false, error: 'Storage manager not initialized' };
    }
    
    log('info', `Checking backup status for drive: ${driveId}`);
    
    const backupExists = await storageManager.verifyBackupExists(driveId);
    const drive = await storageManager.getDriveById(driveId);
    
    return {
      success: true,
      driveId,
      drive: drive ? {
        id: drive.id,
        name: drive.name,
        path: drive.path,
        fileCount: drive.fileCount
      } : null,
      backupExists,
      backupPath: `/Users/rossmacfarlane/Library/Application Support/folder-metadata-manager/storage/drive_${driveId}_backup.db`,
      ftsBackupPath: `/Users/rossmacfarlane/Library/Application Support/folder-metadata-manager/storage/drive_${driveId}_fts_backup.db`
    };
  } catch (error: any) {
    console.error('Error checking backup status:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('debug-scan-methods', async (event) => {
  try {
    log('debug', `===== DEBUG SCAN METHODS =====`);
    log('debug', `Caller: ${event.sender.getURL()}`);
    log('debug', `Timestamp: ${new Date().toISOString()}`);
    log('debug', `Available scan methods:`);
    log('debug', `- start-drive-scan: For new drives (no backup verification)`);
    log('debug', `- start-sync-scan: For sync operations (with backup verification)`);
    log('debug', `- cancel-scan: For cancelling active scans`);
    
    return {
      success: true,
      message: 'Debug info logged to console',
      availableMethods: ['start-drive-scan', 'start-sync-scan', 'cancel-scan']
    };
  } catch (error: any) {
    console.error('Error in debug-scan-methods handler:', error.message);
    return { success: false, error: error.message };
  }
});