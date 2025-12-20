import { useState, useEffect, useRef, startTransition, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Virtuoso } from 'react-virtuoso';
import type { DriveInfo, FileMetadata, SearchResult } from './types/electron';
// RecoveryModal removed for MVP - will be rebuilt later
import { useFormatBytes, useFormatDate } from './hooks/useFormatting';
import { useDarkMode } from './hooks/useDarkMode';

import { Account } from './pages/Account';
import { Contact } from './pages/Contact';
import { RecoverPage } from './pages/RecoverPage';

import { useAuthEnhanced, useAuthStorage } from './contexts/AuthContext';
import { useAuthStateManager } from './contexts/AuthStateManager';




// Performance configuration - adjust these values to optimize for your system
const PERFORMANCE_CONFIG = {
  // Initial file load - how many files to show immediately after scan
  INITIAL_BATCH_SIZE: 100,
  
  // Progressive rendering - how many files to load in each batch
  PROGRESSIVE_BATCH_SIZE: 100,
  
  // Async tree building - how many files to process in each chunk
  ASYNC_TREE_CHUNK_SIZE: 1000,
  
  // Load more files - batch size for on-demand loading
  LOAD_MORE_BATCH_SIZE: 1000,
  
  // Large dataset threshold - when to use optimized rendering
  LARGE_DATASET_THRESHOLD: 5000,
  
  // Extremely large dataset threshold - when to use flat list
  EXTREMELY_LARGE_DATASET_THRESHOLD: 10000,
  
  // Progressive rendering delay - milliseconds between batches
  PROGRESSIVE_RENDER_DELAY: 50,
  
  // Async tree building delay - milliseconds between chunks
  ASYNC_TREE_DELAY: 10
};

// Confirmation Modal Component
interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = "Yes",
  cancelText = "No"
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black bg-opacity-50"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative p-6 rounded-lg shadow-xl max-w-md w-full mx-4 bg-custom-white text-custom-black dark:bg-gray-800 dark:text-white">
        <h3 className="text-lg font-semibold mb-2">{title}</h3>
        <p className="text-sm mb-6">{message}</p>
        
        <div className="flex justify-end space-x-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded bg-gray-100 text-custom-black hover:bg-gray-200 dark:bg-gray-600 dark:text-white dark:hover:bg-custom-gray"
          >
            {cancelText}
          </button>
          <button
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className="px-4 py-2 text-sm rounded bg-gray-100 text-red-600 hover:bg-gray-200 hover:text-red-700 dark:bg-gray-600 dark:text-red-400 dark:hover:bg-custom-gray dark:hover:text-red-300"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

// Utility to recursively sanitize the file tree
function sanitizeFileTree(nodes: any[]): any[] {
  return nodes
    .filter((node: any) => node && typeof node === 'object')
    .map((node: any) => ({
      ...node,
      children: node.children ? sanitizeFileTree(node.children) : [],
    }));
}

// (Removed) Context Menu UI in favor of inline controls per row

// Removed legacy system hidden helpers; backend now performs filtering

// New: simple, exact match system/AppleDouble filter applied only at render/search time
function isSystemEntrySimple(file: FileMetadata): boolean {
  const name = file.name;
  // Exact-name system entries
  const exactNames = new Set([
    '.DS_Store',
    '.Spotlight-V100',
    '.Trashes',
    '.fseventsd',
    '.TemporaryItems',
    'System Volume Information',
    '$RECYCLE.BIN',
  ]);
  if (exactNames.has(name)) return true;
  // AppleDouble resource fork files created on macOS when writing to non-HFS volumes
  if (name.startsWith('._')) return true;
  return false;
}

interface AppProps {
  onSignOut: () => void;
}

function App({ onSignOut }: AppProps) {
  const { isDark, preference, setPreference } = useDarkMode();
  const { drives: authDrives } = useAuthEnhanced();
  const { drivesLoaded } = useAuthStorage();
  const authStateManager = useAuthStateManager();
  // Subscription validation is now handled in AuthWrapper
  
  // Use the hook's dark mode state instead of the prop
  const effectiveDarkMode = isDark;
  // Utility function to format bytes
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1000; // Use decimal units to match Finder
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const [selectedDriveId, setSelectedDriveId] = useState<string>(() => {
    try {
      return localStorage.getItem('ui.selectedDriveId') || '';
    } catch {
      return '';
    }
  });
  const [hideSystemFiles, setHideSystemFiles] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('ui.sidebarOpen');
      return saved === null ? false : saved === '1';
    } catch {
      return false;
    }
  });
  const [currentPage, setCurrentPage] = useState<'main' | 'account' | 'contact' | 'recover'>('main');
  // Use drives from AuthStateManager instead of local state
  const drives = authDrives || [];
  
  // Note: Drives are now loaded by AuthStateManager during Phase 4: Data Loading
  // and stored in authState.drives. No need for separate loadDrives function.
  const [driveFiles, setDriveFiles] = useState<FileMetadata[]>([]);
  const [selectedDriveInfo, setSelectedDriveInfo] = useState<DriveInfo | null>(null);
  // Progressive rendering state
  const [progressiveFiles, setProgressiveFiles] = useState<FileMetadata[]>([]);
  const [isProgressiveRendering, setIsProgressiveRendering] = useState(false);
  // New: controls which views are visible (persisted)
  type ViewType = 'list' | 'details';
  const [visibleViews, setVisibleViews] = useState<ViewType[]>(() => {
    try {
      const saved = localStorage.getItem('ui.visibleViews');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
      return ['list']; // Default to list view only
    } catch {
      return ['list'];
    }
  });
  // New: track when file tree is being built to prevent beach ball
  const [isBuildingTree, setIsBuildingTree] = useState(false);
  // New: track when we're in the rendering phase after scanning
  const [isRenderingPhase, setIsRenderingPhase] = useState(false);
  // New: track rendering progress
  const [renderingProgress, setRenderingProgress] = useState({ current: 0, total: 0, phase: 'initial' });
  // New: track when we're waiting to start tree building
  const [isWaitingForTree, setIsWaitingForTree] = useState(false);
  // Sorting state for drives table
  type DriveSortKey = 'name' | 'used' | 'capacity' | 'free' | 'added' | 'updated';
  type SortDir = 'asc' | 'desc';
  // Sorting state for file tree
  type FileSortKey = 'name' | 'size' | 'modified';
  const [fileSortBy, setFileSortBy] = useState<FileSortKey>('name');
  const [fileSortDir, setFileSortDir] = useState<SortDir>('asc');
  const [driveSortBy, setDriveSortBy] = useState<DriveSortKey>('updated');
  const [driveSortDir, setDriveSortDir] = useState<SortDir>('desc');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [showConfirmationModal, setShowConfirmationModal] = useState(false);
  const [showBackupConfirmation, setShowBackupConfirmation] = useState(false);
  const [showBackupSuccess, setShowBackupSuccess] = useState(false);
  const [backupSuccessMessage, setBackupSuccessMessage] = useState('');

  const [scanActive, setScanActive] = useState(false);
  // Guards to prevent duplicate loads/merges per parent
  const loadingParentsRef = useRef<Set<string>>(new Set());
  const loadedParentsRef = useRef<Set<string>>(new Set());
  const pagingParentsRef = useRef<Set<string>>(new Set());
  const driveFilesCacheRef = useRef<Map<string, FileMetadata[]>>(new Map());
  // (Removed) context menu state

  // Search state
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchTotalCount, setSearchTotalCount] = useState<number>(0);
  const [isSearching, setIsSearching] = useState(false);
  const [highlightedFile, setHighlightedFile] = useState<string | null>(null);
  
  // Pagination state
  const [searchOffset, setSearchOffset] = useState<number>(0);
  const [hasMoreResults, setHasMoreResults] = useState<boolean>(false);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const lastSearchQueryRef = useRef<string>('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 0 });

  const updateDropdownPosition = () => {
    const input = searchInputRef.current;
    if (!input) return;
    const rect = input.getBoundingClientRect();
    setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
  };
  
  useEffect(() => {
  }, [highlightedFile]);
  
  // Note: Drives are loaded by AuthStateManager and should be accessed from authState
  
  // Error recovery effect
  useEffect(() => {
    // This will be handled by the AuthWrapper now
  }, []);

  // Listen for drive restoration events
  useEffect(() => {
    const handleDriveRestored = (data: any) => {
      console.log('Drive restored event received:', data);
      // Refresh the drives list by calling loadUserData
      authStateManager.loadUserData?.();
    };

    // Set up event listener for drive restored
    if (window.electronAPI?.onDriveRestored) {
      window.electronAPI.onDriveRestored(handleDriveRestored);
    }

    // Cleanup
    return () => {
      if (window.electronAPI?.removeDriveRestoredListener) {
        window.electronAPI.removeDriveRestoredListener();
      }
    };
  }, [authStateManager]);

  const [addDriveLoading, setAddDriveLoading] = useState(false);
  const [isNavigatingToSearchResult, setIsNavigatingToSearchResult] = useState(false);
  const [navigationStatus, setNavigationStatus] = useState<string>('');
  const navIndicatorTimerRef = useRef<number | null>(null);
  const navTokenRef = useRef<number>(0);
  const clearNavIndicator = () => {
    if (navIndicatorTimerRef.current) {
      window.clearTimeout(navIndicatorTimerRef.current);
      navIndicatorTimerRef.current = null;
    }
  };
  const [searchResultsVisible, setSearchResultsVisible] = useState<number>(20);
  const searchDropdownRef = useRef<HTMLDivElement>(null);
  const fileListRef = useRef<HTMLDivElement>(null);
  
  // Ref to track if we have an active scan progress listener
  const hasScanProgressListener = useRef(false);
  
  
  // Minimum children threshold to enable sticky bar
  // reserved for future tuning via dynamic thresholds
  // const STICKY_TRIGGER_MARGIN_PX = 48;

  // Persist expanded folders per drive in localStorage
  const expandedKeyFor = (driveId: string) => `ui.expanded:${driveId}`;
  const loadExpandedFromStorage = (driveId: string): Set<string> => {
    try {
      const raw = localStorage.getItem(expandedKeyFor(driveId));
      if (!raw) return new Set();
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? new Set(arr as string[]) : new Set();
    } catch {
      return new Set();
    }
  };
  const saveExpandedToStorage = (driveId: string, folders: Set<string>) => {
    try {
      localStorage.setItem(expandedKeyFor(driveId), JSON.stringify(Array.from(folders)));
    } catch {}
  };
  const clearExpandedFromStorage = (driveId: string) => {
    try { localStorage.removeItem(expandedKeyFor(driveId)); } catch {}
  };

  // Wrap setter to persist per drive
  const setExpandedFoldersPersisted = (folders: Set<string>) => {
    setExpandedFolders(folders);
    if (selectedDriveInfo?.id) {
      saveExpandedToStorage(selectedDriveInfo.id, folders);
    }
  };

  // Note: Drive loading is now handled by AuthStateManager during Phase 4: Data Loading
  // App.tsx should only render when state is DATA_LOADED

  // Persist view preference
  useEffect(() => {
    try { localStorage.setItem('ui.visibleViews', JSON.stringify(visibleViews)); } catch {}
  }, [visibleViews]);

  // Persist sidebar state
  useEffect(() => {
    try { localStorage.setItem('ui.sidebarOpen', sidebarOpen ? '1' : '0'); } catch {}
  }, [sidebarOpen]);

  // Persist selected drive
  useEffect(() => {
    try { localStorage.setItem('ui.selectedDriveId', selectedDriveId); } catch {}
  }, [selectedDriveId]);

  // (Removed) auto status refresh

  // Global scan activity subscription (controls disabling actions and overlay state)
  useEffect(() => {
    try {
      const handleScanProgress = (progress: any) => {
        if (progress?.type === 'start' || progress?.type === 'streaming-progress') {
          setScanActive(true);
          // Clear any existing progressive files - we'll render after scan completes
          setProgressiveFiles([]);
          setIsProgressiveRendering(false);
          setIsRenderingPhase(false);
          setRenderingProgress({ current: 0, total: 0, phase: 'initial' });
          setIsWaitingForTree(false);
        }
        
        if (progress?.type === 'complete') {
          setScanActive(false);
          
          // For regular scans, start rendering phase and close modal immediately
          // For sync scans, wait for 'sync-complete' event before doing anything
          const loadingMessage = document.querySelector('.fixed.inset-0.z-50') as HTMLElement;
          if (loadingMessage) {
            // Check if this is a sync scan by looking for sync-specific elements or context
            const isSyncScan = loadingMessage.textContent?.includes('Syncing Drive') || 
                              loadingMessage.querySelector('h3')?.textContent?.includes('Syncing Drive');
            
            if (!isSyncScan) {
              // Regular scan - start rendering and close modal immediately
              setIsRenderingPhase(true);
              if (progress.driveId && selectedDriveId === progress.driveId) {
                startLazyLoading(progress.driveId);
              }
              
              try {
                if (loadingMessage.parentNode) {
                  loadingMessage.parentNode.removeChild(loadingMessage);
                }
              } catch (removeError) {
                console.warn('Error auto-closing loading modal:', removeError);
              }
            } else {
              // Sync scan - don't start rendering yet, just wait for sync-complete
            }
          }
        }
        
        // Handle finalize progress updates during database finalization
        if (progress?.type === 'finalize-progress') {
          
          // Update the modal to show database swap progress
          const loadingMessage = document.querySelector('.fixed.inset-0.z-50') as HTMLElement;
          if (loadingMessage) {
            const messageEl = document.getElementById('scan-progress-message');
            const statsEl = document.getElementById('scan-stats');
            const barEl = document.getElementById('scan-progress-bar') as HTMLElement | null;
            const percentageEl = document.getElementById('scan-percentage');
            const etaEl = document.getElementById('scan-eta');
            
            if (messageEl) {
              // Keep the main message simple - just show the phase
              if (progress.phase === 'fts-indexing') {
                messageEl.textContent = 'Building search index...';
              } else {
                messageEl.textContent = 'Database swap in progress...';
              }
            }
            
            if (statsEl) {
              // Show just the progress count in the stats area (no ETA)
              const progressMessage = progress.message.replace(/ • est\..*$/, ''); // Remove ETA part
              statsEl.innerHTML = progressMessage;
              statsEl.className = 'text-xs text-gray-500 mb-1';
            }
            
            if (barEl && progress.total > 0) {
              const percentage = Math.min(100, (progress.current / progress.total) * 100);
              barEl.style.width = `${percentage}%`;
            }
            
            if (percentageEl && progress.total > 0) {
              const percentage = Math.min(100, Math.round((progress.current / progress.total) * 100));
              percentageEl.textContent = `${Math.round(percentage)}%`;
            }
            
            // Update the ETA in the running time area
            if (etaEl && progress.etaSeconds !== undefined) {
              const runningTimeEl = document.getElementById('scan-running-time');
              const etaTimeEl = document.getElementById('scan-eta-time');
              
              if (runningTimeEl) {
                // Keep the running time as is
                runningTimeEl.textContent = 'Running for 0:00'; // This will be updated by the existing progress handler
              }
              
              if (etaTimeEl && progress.etaSeconds > 0) {
                const etaMinutes = Math.floor(progress.etaSeconds / 60);
                const etaSecondsRemaining = Math.floor(progress.etaSeconds % 60);
                
                let etaText = '';
                if (progress.etaSeconds >= 60) {
                  etaText = `est. ${etaMinutes}:${etaSecondsRemaining.toString().padStart(2, '0')} remaining`;
                } else if (progress.etaSeconds >= 10) {
                  etaText = `est. ${Math.floor(progress.etaSeconds)} seconds remaining`;
                } else if (progress.etaSeconds >= 1) {
                  etaText = `est. ${Math.ceil(progress.etaSeconds)} second remaining`;
                } else {
                  etaText = `est. <1 second remaining`;
                }
                
                etaTimeEl.textContent = etaText;
              }
            }
          }
        }
        
        // Handle sync completion event (after database swap is complete)
        if (progress?.type === 'sync-complete') {
          setScanActive(false);
          
          // Start rendering phase for sync
          setIsRenderingPhase(true);
          if (progress.driveId && selectedDriveId === progress.driveId) {
            startLazyLoading(progress.driveId);
          }
          
          // Now close the loading modal for sync scans
          const loadingMessage = document.querySelector('.fixed.inset-0.z-50') as HTMLElement;
          if (loadingMessage) {
            try {
              if (loadingMessage.parentNode) {
                loadingMessage.parentNode.removeChild(loadingMessage);
              }
            } catch (removeError) {
              console.warn('Error closing sync modal:', removeError);
            }
          }
        }
        
        // Handle cancellation events to reset scan state
        if (progress?.type === 'cancelled' || progress?.message?.includes('cancelled')) {
          setScanActive(false);
          setIsProgressiveRendering(false);
          setIsRenderingPhase(false);
          setRenderingProgress({ current: 0, total: 0, phase: 'initial' });
          setIsWaitingForTree(false);
        }
      };

      // Only add listener if we don't already have one
      if (!hasScanProgressListener.current) {
        window.electronAPI.onScanProgress(handleScanProgress);
        hasScanProgressListener.current = true;
      } else {
      }
      
      return () => {
        // Cleanup scan progress listener
        if (hasScanProgressListener.current) {
          window.electronAPI.removeScanProgressListener();
          hasScanProgressListener.current = false;
        }
      };
    } catch (error) {
      console.error('[Scan] Error setting up scan progress listener:', error);
    }
  }, [selectedDriveId]);

  // Cleanup effect to remove scan progress listener on unmount
  useEffect(() => {
    return () => {
      if (hasScanProgressListener.current) {
        window.electronAPI.removeScanProgressListener();
        hasScanProgressListener.current = false;
      }
    };
  }, []);

  // No render progress listener needed - we're using lazy loading now

  // Load drive contents when selectedDriveId changes
  useEffect(() => {
    console.log('[Load Contents] Effect triggered - selectedDriveId:', selectedDriveId, 'drives.length:', drives.length, 'drivesLoaded:', drivesLoaded);
    
    if (selectedDriveId && drives.length > 0 && drivesLoaded) {
      console.log('[Load Contents] Loading drive contents for:', selectedDriveId);
      loadDriveContents(selectedDriveId);
    } else {
      console.log('[Load Contents] Conditions not met - selectedDriveId:', !!selectedDriveId, 'drives.length > 0:', drives.length > 0, 'drivesLoaded:', drivesLoaded);
    }
  }, [selectedDriveId, drives, drivesLoaded]);

  // Debounced search functionality
  useEffect(() => {
    // Keep dropdown anchored correctly while open
    if (searchResults.length > 0) {
      updateDropdownPosition();
      const handler = () => updateDropdownPosition();
      window.addEventListener('resize', handler);
      window.addEventListener('scroll', handler, true);
      return () => {
        window.removeEventListener('resize', handler);
        window.removeEventListener('scroll', handler, true);
      };
    }
  }, [searchResults.length]);

  // Debounced search functionality
  useEffect(() => {
    // Reset pagination when query changes
    const trimmed = searchQuery.trim();
    if (trimmed !== lastSearchQueryRef.current) {
      setSearchOffset(0);
      setHasMoreResults(false);
      lastSearchQueryRef.current = trimmed;
    }

    if (!searchQuery.trim()) {
      setSearchResults([]);
      setSearchTotalCount(0);
      setSearchOffset(0);
      setHasMoreResults(false);
      setIsSearching(false);
      setSearchResultsVisible(0);
      return;
    }

                    const timeoutId = setTimeout(async () => {
            console.log(`[SearchUI] Starting search for: "${searchQuery}" (length: ${searchQuery.length})`);
            setIsSearching(true);
            try {
              console.log(`[SearchUI] Calling searchFilesPaged with query: "${searchQuery}", offset: ${searchOffset}, limit: 50, hideSystemFiles: ${hideSystemFiles}`);
              const results = await window.electronAPI.searchFilesPaged(searchQuery, searchOffset, 50, hideSystemFiles);
              console.log(`[SearchUI] searchFilesPaged returned:`, results);

        // Use backend filtering only to avoid double-filtering to zero
        const driveMap = new Map(drives.map(d => [d.id, d.name]));
        const enrichedResults = results.rows.map(r => ({
          ...r,
          driveName: r.driveName || driveMap.get(r.driveId) || ''
        }));

        // Append new results to existing ones (for pagination)
        if (searchOffset === 0) {
          // First search: replace all results
          setSearchResults(enrichedResults);
        } else {
          // Subsequent searches: append to existing results
          setSearchResults(prev => [...prev, ...enrichedResults]);
        }
        
        // Use the backend total which now includes system files filtering
        setSearchTotalCount(results.total);
        
        // Check if there are more results to fetch
        const currentTotal = searchOffset + results.rows.length;
        setHasMoreResults(currentTotal < results.total);
        
        // Log search mode for debugging
        console.log(`[SearchUI] Search mode: ${results.mode}, Total results: ${results.total}, Current offset: ${searchOffset}, Has more: ${currentTotal < results.total}`);
      } catch (error) {
        console.error('[SearchUI] error', error);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchQuery, hideSystemFiles, drives]);

  // Reset visible count when results change
  useEffect(() => {
    setSearchResultsVisible(Math.min(50, searchResults.length));
  }, [searchResults]);

  // Function to load more search results
  const loadMoreSearchResults = async () => {
    if (!hasMoreResults || isLoadingMore || isSearching) return;
    
    // Add a small delay to prevent rapid firing
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Double-check conditions after delay
    if (!hasMoreResults || isLoadingMore || isSearching) return;
    
    setIsLoadingMore(true);
    try {
      const nextOffset = searchOffset + 50;
      console.log(`[SearchUI] Loading more results, offset: ${nextOffset}`);
      
      const results = await window.electronAPI.searchFilesPaged(searchQuery, nextOffset, 50, hideSystemFiles);
      
      // Trust backend filtering to avoid over-filtering here
      const driveMap = new Map(drives.map(d => [d.id, d.name]));
      const enrichedResults = results.rows.map(r => ({
        ...r,
        driveName: r.driveName || driveMap.get(r.driveId) || ''
      }));

      // Append new results
      setSearchResults(prev => [...prev, ...enrichedResults]);
      
      // Update pagination state
      setSearchOffset(nextOffset);
      const currentTotal = nextOffset + results.rows.length;
      setHasMoreResults(currentTotal < results.total);
      
      console.log(`[SearchUI] Loaded more results, new total: ${searchResults.length + enrichedResults.length}, has more: ${currentTotal < results.total}`);
    } catch (error) {
      console.error('[SearchUI] Error loading more results:', error);
    } finally {
      setIsLoadingMore(false);
    }
  };

  // No automatic infinite scrolling - users control loading via Load More button

  // Auto-highlight first search result when results appear
  useEffect(() => {
    if (searchResults.length > 0 && !highlightedFile) {
      setHighlightedFile(searchResults[0].fileId);
    } else if (searchResults.length === 0) {
      setHighlightedFile(null);
    }
  }, [searchResults]); // Removed highlightedFile dependency to prevent circular updates

  // (Removed) sticky parent feature

  // Keyboard navigation for search results
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!searchResults.length) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setHighlightedFile(prev => {
            if (!prev) return searchResults[0]?.fileId || null;
            const currentIndex = searchResults.findIndex(r => r.fileId === prev);
            const nextIndex = (currentIndex + 1) % searchResults.length;
            return searchResults[nextIndex]?.fileId || null;
          });
          break;
        case 'ArrowUp':
          e.preventDefault();
          setHighlightedFile(prev => {
            if (!prev) return searchResults[searchResults.length - 1]?.fileId || null;
            const currentIndex = searchResults.findIndex(r => r.fileId === prev);
            const prevIndex = currentIndex === 0 ? searchResults.length - 1 : currentIndex - 1;
            return searchResults[prevIndex]?.fileId || null;
          });
          break;
        case 'Enter':
          e.preventDefault();
          if (highlightedFile) {
            const result = searchResults.find(r => r.fileId === highlightedFile);
            if (result) {
              handleSearchResultSelect(result);
            }
          }
          break;
        case 'Escape':
          setSearchQuery('');
          setSearchResults([]);
          setHighlightedFile(null);
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [searchResults, highlightedFile]);

  // Clear highlighted file and search results when user clicks elsewhere
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      
      // Don't clear highlight if clicking on search results or file tree items
      const isSearchResult = target.closest('[data-search-result]');
      const isFileTreeItem = target.closest('[data-file-item]');
      
      if (!isSearchResult && !isFileTreeItem) {
        setHighlightedFile(null);
      }
      
      // Close search dropdown when clicking outside
      const searchContainer = document.querySelector('[data-search-container]');
      if (searchContainer && !searchContainer.contains(target) && !isSearchResult) {
        setSearchQuery('');
        setSearchResults([]);
        setHighlightedFile(null);
      }
    };

    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);



  // (Removed) refresh drive statuses handler

  // Removed unused handleClearCache function

  // Build file tree structure from flat file list; optionally filter at render-time
  const buildFileTree = (files: FileMetadata[], shouldHideSystemFiles: boolean = false) => {
    // Early return for empty files
    if (!files || files.length === 0) {
      return [];
    }

    // console.debug(`[buildFileTree] files=${files.length}`);
    
    // Create maps for quick lookup. Exclude sentinel loader rows from the tree itself.
    const nonLoader = files.filter(f => f.name !== 'Load more…');
    const visible = shouldHideSystemFiles ? nonLoader.filter(f => !isSystemEntrySimple(f)) : nonLoader;
    
    if (visible.length === 0) {
      return [];
    }
    
    // Use a more efficient approach for large datasets
    if (visible.length > PERFORMANCE_CONFIG.LARGE_DATASET_THRESHOLD) {
      // console.debug('[buildFileTree] using efficient build');
      return buildEfficientTree(visible);
    }
    
    // For smaller datasets, use the original approach
    return buildStandardTree(visible);
  };

  // Efficient tree building for large datasets - avoids recursive calls
  const buildEfficientTree = (files: FileMetadata[]) => {
    const fileMap = new Map<string, FileMetadata>();
    const childrenMap = new Map<string, FileMetadata[]>();
    
    // First pass: build maps
    files.forEach(file => {
      fileMap.set(file.path, file);
      if (file.parentPath) {
        if (!childrenMap.has(file.parentPath)) {
          childrenMap.set(file.parentPath, []);
        }
        childrenMap.get(file.parentPath)!.push(file);
      }
    });
    
    // Second pass: build tree structure without recursion
    const processedNodes = new Map<string, any>();
    
    const buildNodeEfficient = (filePath: string): any => {
      // Check if we've already processed this node
      if (processedNodes.has(filePath)) {
        return processedNodes.get(filePath);
      }
      
      const file = fileMap.get(filePath);
      if (!file) {
        return null;
      }
      
      // Get children
      const allChildren = childrenMap.get(filePath) || [];
      const children = allChildren.map(child => buildNodeEfficient(child.path)).filter(Boolean);
      
      const result = {
        ...file,
        children
      };
      
      // Cache the result to avoid reprocessing
      processedNodes.set(filePath, result);
      return result;
    };
    
    // Get root items and build tree
    const rootItems = files.filter(file => !file.parentPath);
    const tree = rootItems.map(file => buildNodeEfficient(file.path));
    
    // console.debug('[buildFileTree] efficient complete');
    return sanitizeFileTree(tree);
  };

  // Standard tree building for smaller datasets
  const buildStandardTree = (files: FileMetadata[]) => {
    const fileMap = new Map<string, FileMetadata>();
    const childrenMap = new Map<string, FileMetadata[]>();
    
    // Create maps for quick lookup
    files.forEach(file => {
      fileMap.set(file.path, file);
      if (file.parentPath) {
        if (!childrenMap.has(file.parentPath)) {
          childrenMap.set(file.parentPath, []);
        }
        childrenMap.get(file.parentPath)!.push(file);
      }
    });
    
    // Build tree structure
    const buildNode = (filePath: string): any => {
      const file = fileMap.get(filePath);
      if (!file) {
        return null;
      }
      
      // Dedupe children by path (or id fallback) to avoid duplicate nodes in tree
      const allChildren = childrenMap.get(filePath) || [];
      const seenChildKeys = new Set<string>();
      const children = allChildren.filter((child) => {
        const key = child.path || (child as any).id || `${child.name}`;
        if (seenChildKeys.has(key)) return false;
        seenChildKeys.add(key);
        return true;
      });
      
      const result = {
        ...file,
        children: children.map(child => buildNode(child.path)).filter(Boolean)
      };
      
      return result;
    };
    
    // Get root items (items with no parentPath or parentPath is null)
    const rootItems = files.filter(file => !file.parentPath);
    
    // console.debug(`[buildFileTree] rootItems=${rootItems.length}`);
    
    const tree = rootItems.map(file => buildNode(file.path));
    
    // console.debug('[buildFileTree] standard complete');
    
    // Sanitize the tree before returning
    return sanitizeFileTree(tree);
  };



  // Enhanced file tree with better large dataset handling
  const optimizedFileTree = useMemo(() => {
    const allFiles = [...driveFiles, ...progressiveFiles];
    if (allFiles.length === 0) return [];
    
    // For extremely large datasets, use flat list to prevent any blocking
    if (allFiles.length > PERFORMANCE_CONFIG.EXTREMELY_LARGE_DATASET_THRESHOLD) {
      console.log(`[Optimized Tree] Extremely large dataset detected (${allFiles.length} files), using flat list`);
      setIsBuildingTree(true);
      
      // Return an empty tree initially to prevent blocking
      // The real tree will be built asynchronously
      return [];
    }
    
    // For very large datasets, use a more efficient approach
    if (allFiles.length > PERFORMANCE_CONFIG.LARGE_DATASET_THRESHOLD) {
      console.log(`[Optimized Tree] Large dataset detected (${allFiles.length} files), using optimized rendering`);
      setIsBuildingTree(true);
      
      // Return an empty tree initially to prevent blocking
      // The real tree will be built asynchronously
      return [];
    }
    
    // For smaller datasets, build normally
    return buildFileTree(allFiles, hideSystemFiles);
  }, [driveFiles, progressiveFiles, hideSystemFiles]);

  // Asynchronous tree building for large datasets
  const [asyncTree, setAsyncTree] = useState<any[]>([]);
  
  useEffect(() => {
    const allFiles = [...driveFiles, ...progressiveFiles];
    if (allFiles.length === 0) return;
    
    // Only build async tree for large datasets
    if (allFiles.length > PERFORMANCE_CONFIG.LARGE_DATASET_THRESHOLD) {
      console.log(`[Async Tree] Starting async tree build for ${allFiles.length} files`);
      
      if (allFiles.length > PERFORMANCE_CONFIG.EXTREMELY_LARGE_DATASET_THRESHOLD) {
        // Extremely large dataset - use flat list approach
        buildFlatListTree(allFiles);
      } else {
        // Large dataset - use chunked tree building
        buildTreeInChunks(allFiles);
      }
    } else {
      // Small dataset - no async building needed
      setAsyncTree([]);
      setIsBuildingTree(false);
    }
  }, [driveFiles, progressiveFiles, hideSystemFiles]);

  // Build flat list tree for extremely large datasets
  const buildFlatListTree = async (files: FileMetadata[]) => {
    console.log(`[Async Tree] Building flat list tree for ${files.length} files`);
    
    // Create a flat list with folder indicators
    const flatTree = files.map(file => ({
      ...file,
      children: [], // No children in flat mode
      isFlatMode: true
    }));
    
    // Update UI immediately
    setAsyncTree(flatTree);
    setIsBuildingTree(false);
    
    console.log(`[Async Tree] Flat list tree complete`);
  };

  // Build tree in chunks for large datasets
  const buildTreeInChunks = async (files: FileMetadata[]) => {
    console.log(`[Async Tree] Building chunked tree for ${files.length} files`);
    
    const CHUNK_SIZE = PERFORMANCE_CONFIG.ASYNC_TREE_CHUNK_SIZE; // Increased from 500 for better performance
    let currentTree: any[] = [];
    
    // Process files in chunks
    for (let i = 0; i < files.length; i += CHUNK_SIZE) {
      const chunk = files.slice(i, i + CHUNK_SIZE);
      
      // Build tree for this chunk
      const chunkTree = buildFileTree(chunk, hideSystemFiles);
      
      // Merge with existing tree
      currentTree = mergeFileTrees(currentTree, chunkTree);
      
      // Update UI with partial tree
      setAsyncTree([...currentTree]);
      
      // Yield control to prevent blocking
      await new Promise(resolve => setTimeout(resolve, PERFORMANCE_CONFIG.ASYNC_TREE_DELAY));
    }
    
    console.log(`[Async Tree] Chunked tree build complete`);
    setIsBuildingTree(false);
  };

  // Merge two file trees (simplified implementation)
  const mergeFileTrees = (tree1: any[], tree2: any[]): any[] => {
    // For now, just return the larger tree
    // This is a simplified merge - in production you'd want more sophisticated merging
    return tree1.length > tree2.length ? tree1 : tree2;
  };

  const loadDriveContents = async (driveId: string) => {
    console.log('[DEBUG] loadDriveContents called with driveId:', driveId);
    try {
      const drive = drives.find(d => d.id === driveId);
      console.log('[DEBUG] Found drive:', drive);
      
      if (drive) {
        console.log('[DEBUG] Resetting guards and caches');
        // Reset per-drive guards when switching drives
        loadingParentsRef.current.clear();
        loadedParentsRef.current.clear();
        pagingParentsRef.current.clear();
        
        console.log('[DEBUG] Clearing progressive files and render states');
        // Clear progressive files when switching drives
        setProgressiveFiles([]);
        setIsProgressiveRendering(false);
        setIsRenderingPhase(false);
        setRenderingProgress({ current: 0, total: 0, phase: 'initial' });
        setIsWaitingForTree(false);
        
        setSelectedDriveInfo(drive);
        // If we have cached files for this drive, show them immediately
        const cached = driveFilesCacheRef.current.get(drive.id!);
        console.log('[DEBUG] Checking cache for drive files:', cached?.length || 0, 'files found');
        if (cached && cached.length) {
          console.log('[DEBUG] Using cached files');
          setDriveFiles(cached);
        }
        // Fetch fresh root in background
        console.log('[DEBUG] Calling window.electronAPI.listRoot');
        const files = await window.electronAPI.listRoot(drive.id!);
        console.log('[DEBUG] listRoot returned', files?.length || 0, 'files');
        console.log('[DEBUG] Setting driveFiles in startTransition');
        startTransition(() => setDriveFiles(files));
        console.log('[DEBUG] Updating cache with new files');
        driveFilesCacheRef.current.set(drive.id!, files);
        
        // Restore expanded folders and pre-hydrate children
        const savedExpanded = loadExpandedFromStorage(drive.id);
        console.log('[DEBUG] Loaded expanded folders:', savedExpanded);
        
        if (savedExpanded.size > 0) {
          console.log('[DEBUG] Restoring expanded state and hydrating children');
          setExpandedFolders(savedExpanded);
          // Batch hydrate children for saved expanded folders
          try {
            const parents = Array.from(savedExpanded);
            console.log('[DEBUG] Will hydrate children for paths:', parents);
            console.log('[DEBUG] Starting batch load of children');
            // TODO: Implement batch loading for multiple parent paths
        const grouped: { [parentPath: string]: FileMetadata[] } = {};
        for (const parent of parents) {
          try {
            console.log('[DEBUG] Loading children for path:', parent);
            const { files } = await window.electronAPI.listChildren(drive.id, parent, 1000, 0);
            console.log('[DEBUG] Got', files?.length || 0, 'children for', parent);
            grouped[parent] = files;
          } catch (error) {
            console.error(`[DEBUG] Error loading children for ${parent}:`, error);
            grouped[parent] = [];
          }
        }
            console.log('[DEBUG] Starting file state update');
            startTransition(() => {
              setDriveFiles(prev => {
                console.log('[DEBUG] Previous driveFiles state:', prev?.length || 0, 'files');
                const result: FileMetadata[] = [] as any;
                const existingIds = new Set<string>();
                for (const f of prev) {
                  result.push(f);
                  if ((f as any).id) existingIds.add((f as any).id);
                }
                console.log('[DEBUG] Existing files:', existingIds.size);
                for (const parent of parents) {
                  const children = grouped[parent] || [];
                  console.log('[DEBUG] Adding', children.length, 'children for', parent);
                  for (const child of children) {
                    if (child && (child as any).id && !existingIds.has((child as any).id)) {
                      result.push(child as any);
                      existingIds.add((child as any).id);
                    }
                  }
                }
                console.log('[DEBUG] Final file count:', result.length);
                driveFilesCacheRef.current.set(drive.id!, result);
                return result;
              });
            });
          } catch {}
        } else {
          setExpandedFolders(new Set());
        }
        
        // Preserve highlighted file when switching drives
        // The highlighting will be handled by the search result selection
        // (Removed) sticky parent state
      }
    } catch (error) {
      console.error('Error loading drive contents:', error);
    }
  };

  // Lazy-load children for a folder and merge into flat list
  const PAGE_SIZE = 500; // initial page size to keep first paint under ~50ms

  // Demo huge dir mock provider
  

  const loadChildren = async (driveId: string, parentPath: string) => {
    try {
      // Skip if already loading or loaded this parent's children
      if (loadedParentsRef.current.has(parentPath) || loadingParentsRef.current.has(parentPath)) return;
      loadingParentsRef.current.add(parentPath);
      const { files: children, hasMore } = await window.electronAPI.listChildren(driveId, parentPath, PAGE_SIZE, 0);
      if (children && children.length) {
        startTransition(() => {
          setDriveFiles(prev => {
            // Append children under this parent with de-duplication by id
            const result: FileMetadata[] = [] as any;
            const existingIds = new Set<string>();
            for (const f of prev) {
              if (!(f.parentPath === parentPath && f.name === 'Load more…')) {
                result.push(f);
                if (f && typeof f === 'object' && (f as any).id) existingIds.add((f as any).id);
              }
            }
            const uniqueChildren = (children as FileMetadata[]).filter(c => !existingIds.has(c.id));
            result.push(...uniqueChildren);
            if (hasMore) {
              result.push({
                id: `${parentPath}__LOAD_MORE__`,
                name: 'Load more…',
                path: `${parentPath}/${parentPath}__LOAD_MORE__`,
                parentPath,
                size: 0,
                created: '',
                modified: '',
                isDirectory: false,
                folderPath: '',
                driveId,
                depth: 0
              } as unknown as FileMetadata);
            }
            return result;
          });
        });
        // Mark as loaded after successful merge
        loadedParentsRef.current.add(parentPath);
      }
    } catch (e) {
      console.error('[renderer] listChildren failed:', e);
    } finally {
      loadingParentsRef.current.delete(parentPath);
    }
  };

  // Removed unused buildParentChain function

  // Removed unused scrollToTargetById function



  // Simple lazy loading - just load root items immediately
  const startLazyLoading = async (driveId: string) => {
    try {
      // Set waiting state while we prepare to load files
      setIsWaitingForTree(true);
      
      // Get total file count first to understand the scope
      const fileCount = await window.electronAPI.getDriveFileCount(driveId);
      console.log(`[Lazy Load] Drive ${driveId} contains ${fileCount.total} total files (${fileCount.directories} directories, ${fileCount.files} files)`);
      
      // Set rendering progress
      setRenderingProgress({ current: 0, total: fileCount.total, phase: 'initial' });
      
      // Load only root items (folders and files in root directory) with a limit
      const rootFiles = await window.electronAPI.listRoot(driveId);
      
      // Update progress after loading root files
      setRenderingProgress({ current: rootFiles.length, total: fileCount.total, phase: 'root-loaded' });
      
      // Limit initial load to prevent beach ball - only show first 1000 items initially (increased from 500)
      const INITIAL_BATCH_SIZE = PERFORMANCE_CONFIG.INITIAL_BATCH_SIZE;
      const initialFiles = rootFiles.slice(0, INITIAL_BATCH_SIZE);
      const hasMore = rootFiles.length > INITIAL_BATCH_SIZE;
      
      console.log(`[Lazy Load] Total root files: ${rootFiles.length}, showing initial batch: ${initialFiles.length}`);
      
      setDriveFiles(initialFiles);
      
      // Clear waiting state now that we have files
      setIsWaitingForTree(false);
      
      // If there are more files, store them for progressive loading
      if (hasMore) {
        setProgressiveFiles(rootFiles.slice(INITIAL_BATCH_SIZE));
        setIsProgressiveRendering(true);
        
        // Start progressive rendering in the background
        setTimeout(() => {
          renderProgressiveBatch(driveId, rootFiles.slice(INITIAL_BATCH_SIZE), INITIAL_BATCH_SIZE);
        }, PERFORMANCE_CONFIG.PROGRESSIVE_RENDER_DELAY);
      } else {
        setIsProgressiveRendering(false);
        setProgressiveFiles([]);
      }
      
      // Initial load complete - exit rendering phase
      setIsRenderingPhase(false);
      setRenderingProgress({ current: 0, total: 0, phase: 'complete' });
      
    } catch (error) {
      console.error('[Lazy Load] Error loading root files:', error);
      setIsProgressiveRendering(false);
      setIsRenderingPhase(false);
      setIsWaitingForTree(false);
      setRenderingProgress({ current: 0, total: 0, phase: 'error' });
    }
  };

  // Progressive rendering function to load files in batches
  const renderProgressiveBatch = async (driveId: string, remainingFiles: FileMetadata[], batchSize: number = PERFORMANCE_CONFIG.PROGRESSIVE_BATCH_SIZE) => {
    if (!remainingFiles.length) {
      setIsProgressiveRendering(false);
      // All progressive rendering complete - exit rendering phase
      setIsRenderingPhase(false);
      setRenderingProgress({ current: 0, total: 0, phase: 'complete' });
      return;
    }

    const batch = remainingFiles.slice(0, batchSize);
    const stillRemaining = remainingFiles.slice(batchSize);
    
    console.log(`[Progressive Render] Rendering batch of ${batch.length} files, ${stillRemaining.length} remaining`);
    
    // Update progress
    const totalProcessed = driveFiles.length + batch.length;
    setRenderingProgress({ current: totalProcessed, total: renderingProgress.total, phase: 'progressive' });
    
    // Use startTransition to prevent blocking the UI
    startTransition(() => {
      setDriveFiles(prev => [...prev, ...batch]);
      setProgressiveFiles(stillRemaining);
    });
    
    // If there are more files, schedule the next batch
    if (stillRemaining.length > 0) {
      setTimeout(() => {
        renderProgressiveBatch(driveId, stillRemaining, batchSize);
      }, PERFORMANCE_CONFIG.PROGRESSIVE_RENDER_DELAY); // Small delay to keep UI responsive
    } else {
      setIsProgressiveRendering(false);
      // All progressive rendering complete - exit rendering phase
      setIsRenderingPhase(false);
      setRenderingProgress({ current: 0, total: 0, phase: 'complete' });
    }
  };



  const handleAddDrive = async () => {
    let isCancelled = false; // Track cancellation state
    
    try {
      const drivePath = await window.electronAPI.openFolderPicker({
        title: 'Select an external hard drive',
        message: 'Select an external hard drive',
        buttonLabel: 'Select Drive'
      });
      
      if (drivePath) {
        setAddDriveLoading(true);
        console.log('Starting drive addition process...');
        
        // Show a more specific loading message
        const loadingMessage = document.createElement('div');
        loadingMessage.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50';
        loadingMessage.innerHTML = `
          <div class="bg-custom-white dark:bg-gray-800 p-8 rounded-2xl shadow-2xl max-w-3xl w-full mx-4 border border-gray-200 dark:border-gray-600">
            <h3 class="text-2xl font-bold mb-6 text-center text-gray-800 dark:text-gray-200">
              Add New Drive
            </h3>
            
            <!-- Drive Info Section -->
            <div class="mb-6 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600" id="drive-info-section">
              <div class="grid grid-cols-2 gap-6 text-sm">
                <div>
                  <div class="text-gray-600 dark:text-gray-400 text-xs uppercase tracking-wide">Name</div>
                  <div class="font-semibold text-custom-black dark:text-white" id="drive-name">Loading...</div>
                </div>
                <div>
                  <div class="text-gray-600 dark:text-gray-400 text-xs uppercase tracking-wide">Total Files</div>
                  <div class="font-semibold text-custom-black dark:text-white" id="drive-total-files">-</div>
                </div>
                <div>
                  <div class="text-gray-600 dark:text-gray-400 text-xs uppercase tracking-wide">Used/Capacity</div>
                  <div class="font-semibold text-custom-black dark:text-white" id="drive-used-space">-</div>
                </div>
                <div>
                  <div class="text-gray-600 dark:text-gray-400 text-xs uppercase tracking-wide">Free Space</div>
                  <div class="font-semibold text-custom-black dark:text-white" id="drive-free-space">-</div>
                </div>
              </div>
            </div>
            
            <!-- Progress Section -->
            <div class="mb-6 p-4 bg-custom-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-600">
              <h4 class="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">Scan Progress</h4>
              
              <div class="flex items-center space-x-3 mb-4">
                <div class="animate-spin h-6 w-6 rounded-full border-2 border-gray-300 dark:border-gray-600 border-t-gray-600" id="scan-spinner"></div>
                <p class="text-sm font-medium text-gray-700 dark:text-gray-300" id="scan-progress-message">Getting drive info...</p>
              </div>
              
              <!-- Progress Bar -->
              <div class="w-full h-4 bg-gray-200 dark:bg-gray-700 rounded-full mb-4 overflow-hidden">
                <div class="h-full bg-gray-600 dark:bg-gray-400 transition-all duration-300 ease-out rounded-full" id="scan-progress-bar" style="width: 0%"></div>
              </div>
              
              <!-- Progress Details -->
              <div class="grid grid-cols-2 gap-4 mb-4">
                <div class="text-center p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                  <div class="text-2xl font-bold text-gray-700 dark:text-gray-300" id="scan-percentage">0%</div>
                  <div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Complete</div>
                </div>
                <div class="text-center p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                  <div class="text-sm font-medium text-gray-700 dark:text-gray-300" id="scan-stats">Preparing...</div>
                  <div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Status</div>
                </div>
              </div>
              
              <!-- ETA -->
              <div class="text-center p-3 bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600" id="scan-eta">
                <div class="text-sm font-medium text-gray-700 dark:text-gray-300">
                  <span id="scan-running-time">Running for 0:00</span> • <span id="scan-eta-time">est. calculating...</span>
                </div>
              </div>
            </div>
            
            <!-- Cancel Button -->
            <div class="flex justify-start space-x-3">
              <button id="scan-cancel-btn" class="px-6 py-3 bg-white hover:bg-gray-50 text-red-600 border border-red-600 font-semibold rounded-lg transition-colors dark:bg-gray-100 dark:hover:bg-gray-200">
                Cancel
              </button>
            </div>
            
            <!-- Errors -->
            <div class="mt-4 text-xs" id="scan-errors" style="display:none">
              <button id="scan-errors-toggle" class="underline text-red-600">Show details</button>
              <div id="scan-errors-list" class="mt-2 hidden max-h-32 overflow-auto text-red-600"></div>
            </div>
          </div>
        `;
        // Add CSS for indeterminate animation and enhanced visual feedback
        const style = document.createElement('style');
        style.textContent = `
          @keyframes progress-indeterminate {
            0% { left: -100%; }
            100% { left: 100%; }
          }
          @keyframes pulse-text {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
          }
          @keyframes bounce-dots {
            0%, 80%, 100% { transform: translateY(0); }
            40% { transform: translateY(-4px); }
          }
          .animate-pulse {
            animation: pulse-text 2s infinite;
          }
          .bounce-dots::after {
            content: '';
            animation: bounce-dots 1.4s infinite;
          }
        `;
        document.head.appendChild(style);
        
        document.body.appendChild(loadingMessage);
        
        // Populate drive info immediately if we have it
        if ((window as any).currentDriveInfo) {
          const driveInfo = (window as any).currentDriveInfo;
          const driveInfoSection = document.getElementById('drive-info-section');
          if (driveInfoSection) {
            const driveNameEl = document.getElementById('drive-name');
            const driveTotalFilesEl = document.getElementById('drive-total-files');
            const driveUsedSpaceEl = document.getElementById('drive-used-space');
            const driveFreeSpaceEl = document.getElementById('drive-free-space');
            
            if (driveNameEl) driveNameEl.textContent = driveInfo.name || 'Unknown';
            if (driveTotalFilesEl) driveTotalFilesEl.textContent = (driveInfo.fileCount || 0).toLocaleString();
            if (driveUsedSpaceEl) driveUsedSpaceEl.textContent = `${formatBytes(driveInfo.usedSpace || 0)} / ${formatBytes(driveInfo.totalCapacity || 0)}`;
            if (driveFreeSpaceEl) driveFreeSpaceEl.textContent = formatBytes(driveInfo.freeSpace || 0);
            
            driveInfoSection.style.display = 'block';
          }
        }
        
        // Set up cancel button functionality BEFORE starting the scan
        const cancelBtn = document.getElementById('scan-cancel-btn') as HTMLButtonElement;
        if (cancelBtn) {
          cancelBtn.addEventListener('click', async () => {
            // Show confirmation dialog
            if (!confirm('Are you sure you want to cancel the scan?')) {
              return;
            }
            
            try {
              // Set cancellation flag immediately to prevent further processing
              isCancelled = true;
              
              // Remove the progress event listener to stop all progress events
              try {
                window.electronAPI.removeScanProgressListener();
                console.log('[CANCELLATION DEBUG] Progress event listener removed');
              } catch (removeError) {
                console.warn('[CANCELLATION DEBUG] Could not remove progress listener:', removeError);
              }
              
              cancelBtn.disabled = true;
              cancelBtn.textContent = 'Cancelling...';
              
              // Store the current drive ID being cancelled
              (window as any).cancelledDriveId = (window as any).currentDriveInfo?.id;
              
              const result = await window.electronAPI.cancelScan();
              if (result.success) {
                // Safely remove the loading message
                try {
                  if (loadingMessage && loadingMessage.parentNode) {
                    loadingMessage.parentNode.removeChild(loadingMessage);
                  }
                } catch (removeError) {
                  console.warn('Error removing loading message:', removeError);
                }
                
                setAddDriveLoading(false);
                
                // Clear any stored drive info
                (window as any).currentDriveInfo = null;
                (window as any).currentDriveEstimate = null;
                
                // Clear any selected drive if it was the one being cancelled
                if (selectedDriveId === (window as any).cancelledDriveId) {
                  setSelectedDriveId('');
                  setSelectedDriveInfo(null);
                  setDriveFiles([]);
                }
                
                // Don't reload drives since the cancelled drive was removed from database
                // The UI will naturally not show it
                
                // Show a brief success message instead of an error
                console.log('Scan cancelled successfully');
                
                // Optionally show a user-friendly message
                // (We could add a toast notification here if desired)
              } else {
                console.error('Failed to cancel scan:', result.error);
                cancelBtn.disabled = false;
                cancelBtn.textContent = 'Cancel';
              }
            } catch (error) {
              console.error('Error cancelling scan:', error);
              cancelBtn.disabled = false;
              cancelBtn.textContent = 'Cancel';
            }
          });
        }
        
        // Set up progress listener
        let startTime = Date.now();
        let lastProcessed = 0;
        let lastTime = startTime;
        let scanStartTime = startTime;
        let capturedTotal = 0; // Capture total from start event for consistency with sync
        
        // Create a progress handler function that we can remove later
        const progressHandler = (progress: any) => {
          // Check if scan was cancelled immediately
          if (isCancelled) {
            console.log('[PROGRESS DEBUG] Ignoring progress event - scan was cancelled');
            return;
          }
          console.log('[PROGRESS EVENT RECEIVED]', progress);
          
          const messageEl = document.getElementById('scan-progress-message');
          const statsEl = document.getElementById('scan-stats');
          const barEl = document.getElementById('scan-progress-bar') as HTMLElement | null;
          const percentageEl = document.getElementById('scan-percentage');
          const etaEl = document.getElementById('scan-eta');
          const errWrap = document.getElementById('scan-errors');
          const errList = document.getElementById('scan-errors-list');
          const errToggle = document.getElementById('scan-errors-toggle');
          
          console.log('[DOM ELEMENTS FOUND]', {
            messageEl: !!messageEl,
            statsEl: !!statsEl,
            barEl: !!barEl,
            percentageEl: !!percentageEl,
            etaEl: !!etaEl
          });
          
          // Calculate rate once for consistent usage
          let currentRate = 0;
          let currentTime = 0;
          let timeDiff = 0;
          let filesDiff = 0;
          
          if (progress.processed !== undefined) {
            currentTime = Date.now();
            timeDiff = (currentTime - lastTime) / 1000; // seconds
            filesDiff = progress.processed - lastProcessed;
            currentRate = timeDiff > 0 ? filesDiff / timeDiff : 0;
          }
          
          if (messageEl) {
            // Make messages more user-friendly
            let friendlyMessage = progress.message;
            if (progress.type === 'start') {
              friendlyMessage = 'Starting to scan your drive...';
              
              // Capture total from start event for accurate progress tracking (consistency with sync)
              capturedTotal = progress.total || 0;
              console.log('[PROGRESS DEBUG] Captured total from start event:', capturedTotal);
              
              // Show drive info section if we have drive details
              console.log('[PROGRESS DEBUG] Start event received, checking for drive info...');
              console.log('[PROGRESS DEBUG] currentDriveInfo:', (window as any).currentDriveInfo);
              
              const driveInfoSection = document.getElementById('drive-info-section');
              console.log('[PROGRESS DEBUG] Drive info section found:', !!driveInfoSection);
              
              if (driveInfoSection) {
                const driveInfo = (window as any).currentDriveInfo;
                
                if (driveInfo) {
                  console.log('[PROGRESS DEBUG] Populating drive info with:', driveInfo);
                  
                  // Populate drive info
                  const driveNameEl = document.getElementById('drive-name');
                  const driveTotalFilesEl = document.getElementById('drive-total-files');
                  const driveUsedSpaceEl = document.getElementById('drive-used-space');
                  const driveFreeSpaceEl = document.getElementById('drive-free-space');
                  
                  if (driveNameEl) driveNameEl.textContent = driveInfo.name || 'Unknown';
                  if (driveTotalFilesEl) driveTotalFilesEl.textContent = (driveInfo.fileCount || 0).toLocaleString();
                  if (driveUsedSpaceEl) driveUsedSpaceEl.textContent = `${formatBytes(driveInfo.usedSpace || 0)} / ${formatBytes(driveInfo.totalCapacity || 0)}`;
                  if (driveFreeSpaceEl) driveFreeSpaceEl.textContent = formatBytes(driveInfo.freeSpace || 0);
                  
                  driveInfoSection.style.display = 'block';
                  console.log('[PROGRESS DEBUG] Drive info populated successfully');
                } else {
                  console.log('[PROGRESS DEBUG] currentDriveInfo not available yet - this should not happen if addDrive completed successfully');
                  console.log('[PROGRESS DEBUG] The drive info should have been populated immediately after addDrive succeeded');
                }
              } else {
                console.log('[PROGRESS DEBUG] Drive info section not found.');
              }
              
              // Keep progress bar at 0% during initialization - no progress to show yet
              if (barEl) {
                barEl.style.animation = 'none';
                barEl.style.width = '0%';
              }
              // Show percentage as 0% during initialization
              if (percentageEl) {
                percentageEl.textContent = '0%';
              }
              // Add animated dots to show activity
              if (statsEl) {
                statsEl.innerHTML = 'Initializing scan engine<span class="bounce-dots">...</span>';
                statsEl.className = 'text-xs text-gray-500 mb-1 animate-pulse';
              }
            } else if (progress.type === 'streaming-progress') {
              if (currentRate > 0) {
                friendlyMessage = `Processing ${Math.round(currentRate).toLocaleString()} files/second`;
              } else {
                friendlyMessage = 'Scanning files and folders...';
              }
              
              // Remove progress bar update - let main logic handle it
              if (statsEl) {
                const processed = progress.processed?.toLocaleString() || '0';
                statsEl.innerHTML = `Streaming scan • ${processed} files processed`;
                statsEl.className = 'text-xs text-gray-500 mb-1';
              }
            } else if (progress.type === 'progress') {
              // General progress updates (sent every 3000 files)
              if (currentRate > 0) {
                friendlyMessage = `Processing ${Math.round(currentRate).toLocaleString()} files/second`;
              } else {
                friendlyMessage = 'Scanning files and folders...';
              }
              
              if (statsEl) {
                const processed = progress.processed?.toLocaleString() || '0';
                statsEl.innerHTML = `Scanning • ${processed} files processed`;
                statsEl.className = 'text-xs text-gray-500 mb-1';
              }
            } else if (progress.type === 'complete') {
              friendlyMessage = 'Scan complete! Finalizing...';
              // Show completion progress
              if (barEl) {
                barEl.style.animation = 'none';
                barEl.style.width = '100%';
              }
              // Update stats for rendering phase
              if (statsEl) {
                statsEl.innerHTML = 'Finalizing scan results...';
                statsEl.className = 'text-xs text-gray-500 mb-1 animate-pulse';
              }
            } else if (progress.type === 'batch') {
              if (currentRate > 0) {
                friendlyMessage = `Processing ${Math.round(currentRate).toLocaleString()} files/second`;
              } else if (progress.files && progress.files.length > 0) {
                friendlyMessage = `Processing batch of ${progress.files.length} files...`;
              } else {
                // When no files in batch, we're likely in database storage phase
                friendlyMessage = 'Saving files to database...';
              }
              
              // Show batch processing progress with total if available
              if (statsEl) {
                const processed = progress.processed?.toLocaleString() || '0';
                // Use captured total for batch processing if available
                const batchTotal = capturedTotal || progress.total;
                const total = batchTotal?.toLocaleString() || '?';
                if (batchTotal) {
                  const percentage = Math.min(100, Math.round(((progress.processed || 0) / batchTotal) * 100));
                  statsEl.innerHTML = `Batch processing • ${processed} of ${total} files (${percentage}%)`;
                } else {
                  statsEl.innerHTML = `Batch processing • ${processed} files scanned`;
                }
                statsEl.className = 'text-xs text-gray-500 mb-1';
              }
            }
            
            messageEl.textContent = friendlyMessage;
          }
          
          if (statsEl && progress.processed !== undefined) {
            const totalScanTime = (currentTime - scanStartTime) / 1000; // seconds
            
            // Use captured total from start event, fall back to progress.total, then to global estimate
            const total = capturedTotal || progress.total || (window as any).currentDriveEstimate || 0;
            
            console.log('[PROGRESS DEBUG]', {
              progressType: progress.type,
              processed: progress.processed,
              progressTotal: progress.total,
              globalEstimate: (window as any).currentDriveEstimate,
              calculatedTotal: total,
              currentTime,
              lastTime,
              timeDiff,
              lastProcessed,
              filesDiff,
              currentRate,
              timeElapsed: totalScanTime
            });
            
            let etaText = '';
            let timeElapsedText = '';
            
            if (total > 0 && progress.processed > 0 && totalScanTime > 0) {
              const remaining = total - progress.processed;
              
              // Use overall average rate since start instead of instantaneous rate
              // This is much more stable and accurate for ETA calculation
              const overallRate = progress.processed / totalScanTime; // files per second since start
              
              const etaSeconds = overallRate > 0 ? remaining / overallRate : 0;
              const etaMinutes = Math.floor(etaSeconds / 60);
              const etaSecondsRemaining = Math.floor(etaSeconds % 60);
              
              console.log('[ETA CALCULATION DEBUG]', {
                total,
                processed: progress.processed,
                remaining,
                totalScanTime,
                instantaneousRate: currentRate,
                overallRate,
                etaSeconds,
                etaMinutes,
                etaSecondsRemaining
              });
              
              // Only show ETA if we have reasonable data
              if (etaSeconds > 0 && etaSeconds < 3600) { // Don't show if > 1 hour (likely bad data)
                if (etaSeconds >= 60) {
                  etaText = ` • est. ${etaMinutes}:${etaSecondsRemaining.toString().padStart(2, '0')} remaining`;
                } else if (etaSeconds >= 10) {
                  etaText = ` • est. ${Math.floor(etaSeconds)} seconds remaining`;
                } else if (etaSeconds >= 1) {
                  etaText = ` • est. ${Math.ceil(etaSeconds)} second remaining`;
                } else {
                  etaText = ` • est. <1 second remaining`;
                }
              }
            }
            
            // Show elapsed time
            const elapsedMinutes = Math.floor(totalScanTime / 60);
            const elapsedSeconds = Math.floor(totalScanTime % 60);
            timeElapsedText = `Running for ${elapsedMinutes}:${elapsedSeconds.toString().padStart(2, '0')}`;
            
            // Remove files/sec from stats to prevent layout shifting
            // const rateText = currentRate > 0 ? ` • ${Math.round(currentRate)} files/sec` : '';
            const totalText = total > 0 ? ` out of ${total.toLocaleString()}` : '';
            statsEl.textContent = `Processed ${progress.processed.toLocaleString()} files${totalText}`;
            
            if (etaEl) {
              // Update the combined running time and ETA box
              const runningTimeEl = document.getElementById('scan-running-time');
              const etaTimeEl = document.getElementById('scan-eta-time');
              
              if (runningTimeEl) {
                runningTimeEl.textContent = timeElapsedText.replace(' • ', '');
              }
              
              if (etaTimeEl && etaText) {
                etaTimeEl.textContent = etaText.replace(' • ', '');
              }
            }
            
            // Update progress bar and percentage
            // Only update if we're not in start/complete phases (which set their own states)
            if (progress.type !== 'start' && progress.type !== 'complete') {
              if (barEl && total > 0) {
                const percentage = Math.min(100, (progress.processed / total) * 100);
                console.log('[PROGRESS BAR DEBUG] Using actual total:', { processed: progress.processed, total, percentage });
                barEl.style.width = `${percentage}%`;
                if (percentageEl) {
                  percentageEl.textContent = `${Math.round(percentage)}%`;
                }
                          } else if (barEl && progress.processed !== undefined) {
              // If no total available, don't show progress bar
              // Just show the processed count without percentage
              if (percentageEl) {
                percentageEl.textContent = `${progress.processed.toLocaleString()} files`;
              }
            }
            }
            
            lastProcessed = progress.processed;
            lastTime = currentTime;
          }

          // On completion, fill the bar to 100%
          if (barEl && (progress.type === 'complete')) {
            barEl.style.width = '100%';
            if (percentageEl) {
              percentageEl.textContent = '100%';
            }
          }

          // Show non-ignorable error details if provided
          if (progress.type === 'complete' && Array.isArray((progress as any).errorMessages) && (progress as any).errorMessages.length > 0) {
            if (errWrap && errList && errToggle) {
              (errWrap as HTMLElement).style.display = 'block';
              (errList as HTMLElement).innerHTML = (progress as any).errorMessages.map((m: string) => `<div>• ${m}</div>`).join('');
              (errToggle as HTMLElement).onclick = () => {
                const list = errList as HTMLElement;
                const btn = errToggle as HTMLElement;
                if (list.classList.contains('hidden')) {
                  list.classList.remove('hidden');
                  btn.textContent = 'Hide details';
                } else {
                  list.classList.add('hidden');
                  btn.textContent = 'Show details';
                }
              };
            }
          }
        };
        
        // Register the progress handler (only if we don't already have one)
        if (!hasScanProgressListener.current) {
          window.electronAPI.onScanProgress(progressHandler);
          hasScanProgressListener.current = true;
          console.log('[DEBUG] Scan progress listener added (Add Drive)');
        } else {
          console.log('[DEBUG] Scan progress listener already exists, skipping (Add Drive)');
        }
        
        try {
          // Check if scan was cancelled before proceeding
          if (isCancelled) {
            console.log('[DRIVE INFO DEBUG] Scan was cancelled, skipping addDrive');
            return;
          }
          
          console.log('[DRIVE INFO DEBUG] About to call addDrive...');
          const addResult: any = await window.electronAPI.addDrive(drivePath);
          console.log('[renderer] addDrive result:', addResult);
          if (!addResult?.success) {
            const conflicts = addResult?.conflicts?.length ? `\nConflicts: ${addResult.conflicts.join('; ')}` : '';
            alert(`Could not add drive. ${addResult?.error || 'Unknown error.'}${conflicts}`);
            return;
          }
          const addedDrive = addResult?.drive ? addResult.drive : addResult;
          console.log('[renderer] Parsed added drive:', addedDrive);
          
          // Store drive info for progress tracking
          if (addedDrive) {
            console.log('[DRIVE INFO DEBUG] Full addDrive response:', addedDrive);
            console.log('[DRIVE INFO DEBUG] Drive properties:', {
              name: addedDrive.name,
              usedSpace: addedDrive.usedSpace,
              totalCapacity: addedDrive.totalCapacity,
              freeSpace: addedDrive.freeSpace,
              fileCount: addedDrive.fileCount
            });
            
            (window as any).currentDriveInfo = addedDrive;
            (window as any).currentDriveEstimate = addedDrive.fileCount;
            console.log(`[renderer] Stored drive info:`, addedDrive);
            console.log(`[renderer] Stored file count: ${addedDrive.fileCount.toLocaleString()}`);
            
            // Now populate the drive info in the modal since we have the data
            const driveInfoSection = document.getElementById('drive-info-section');
            if (driveInfoSection) {
              const driveNameEl = document.getElementById('drive-name');
              const driveTotalFilesEl = document.getElementById('drive-total-files');
              const driveUsedSpaceEl = document.getElementById('drive-used-space');
              const driveFreeSpaceEl = document.getElementById('drive-free-space');
              
              if (driveNameEl) driveNameEl.textContent = addedDrive.name || 'Unknown';
              if (driveTotalFilesEl) driveTotalFilesEl.textContent = (addedDrive.fileCount || 0).toLocaleString();
              if (driveUsedSpaceEl) driveUsedSpaceEl.textContent = `${formatBytes(addedDrive.usedSpace || 0)} / ${formatBytes(addedDrive.totalCapacity || 0)}`;
              if (driveFreeSpaceEl) driveFreeSpaceEl.textContent = formatBytes(addedDrive.freeSpace || 0);
              
              driveInfoSection.style.display = 'block';
              console.log('[DRIVE INFO DEBUG] Drive info populated after addDrive success');
              
              // Now start the scan since we have the drive info
              console.log('[DRIVE INFO DEBUG] Starting drive scan...');
              
              // Check if scan was cancelled before starting
              if (isCancelled) {
                console.log('[DRIVE INFO DEBUG] Scan was cancelled, skipping startDriveScan');
                return;
              }
              
              try {
                const scanResult = await window.electronAPI.startDriveScan(addedDrive.id);
                if (scanResult.success) {
                  console.log('[DRIVE INFO DEBUG] Scan started successfully');
                  
                  // Immediately update the UI to show scan has started
                  const messageEl = document.getElementById('scan-progress-message');
                  if (messageEl) {
                    messageEl.textContent = 'Starting to scan your drive...';
                  }
                  
                  // Update stats to show scan is active
                  const statsEl = document.getElementById('scan-stats');
                  if (statsEl) {
                    statsEl.innerHTML = 'Initializing scan engine<span class="bounce-dots">...</span>';
                    statsEl.className = 'text-xs text-gray-500 mb-1 animate-pulse';
                  }
                  
                  // Update progress bar to show scan is starting
                  const barEl = document.getElementById('scan-progress-bar') as HTMLElement | null;
                  if (barEl) {
                    barEl.style.animation = 'none';
                    barEl.style.width = '0%';
                  }
                  
                  // Update percentage to show 0%
                  const percentageEl = document.getElementById('scan-percentage');
                  if (percentageEl) {
                    percentageEl.textContent = '0%';
                  }
                  
                } else {
                  console.error('[DRIVE INFO DEBUG] Failed to start scan:', scanResult.error);
                }
              } catch (scanError) {
                console.error('[DRIVE INFO DEBUG] Error starting scan:', scanError);
              }
            }
          }
          
          // Check if scan was cancelled before proceeding with drive setup
          if (isCancelled) {
            console.log('[DRIVE INFO DEBUG] Scan was cancelled, skipping drive setup');
            return;
          }
          
          // Reload drives to include the new one
          const updatedDrives = await window.electronAPI.getAllDrives();
          authStateManager.setState({ 
            drives: updatedDrives, 
            driveCount: updatedDrives.length 
          });
          
          if (addedDrive?.name) {
            console.log(`[renderer] Selecting newly added drive: ${addedDrive.name}`);
            setSelectedDriveId(addedDrive.id);
            // Also proactively load contents to avoid race on state
            try {
              const files = await window.electronAPI.listRoot(addedDrive.id);
              console.log(`[renderer] Post-add listRoot returned ${files.length} items for ${addedDrive.name}`);
              setDriveFiles(files);
              setSelectedDriveInfo(addedDrive);
            } catch (e) {
              console.error('[renderer] Error fetching files immediately after add:', e);
            }
          } else {
            console.warn('[renderer] Could not determine added drive name from addDrive response; applying fallback selection');
            try {
              // Fallback: select the most recently added active drive
              const refreshed = await window.electronAPI.getDrives();
              if (Array.isArray(refreshed) && refreshed.length > 0) {
                const newest = [...refreshed]
                  .filter(d => d && d.addedDate)
                  .sort((a, b) => (new Date(b.addedDate).getTime()) - (new Date(a.addedDate).getTime()))[0] || refreshed[0];
                if (newest?.name) {
                  setSelectedDriveId(newest.id);
                  setSelectedDriveInfo(newest);
                }
              }
            } catch (fallbackErr) {
              console.warn('[renderer] Fallback selection failed:', fallbackErr);
            }
          }
        } finally {
          // Only remove loading message if scan wasn't cancelled
          if (!isCancelled) {
            try {
              if (loadingMessage && loadingMessage.parentNode) {
                loadingMessage.parentNode.removeChild(loadingMessage);
              }
            } catch (removeError) {
              console.warn('Error removing loading message in finally block:', removeError);
            }
          }
        }
      }
    } catch (error) {
      // Don't show error alert if scan was cancelled
      if (!isCancelled) {
        console.error('Error adding drive:', error);
        // Show error message to user
        alert(`Error adding drive: ${error instanceof Error ? error.message : 'Unknown error'}`);
      } else {
        console.log('Scan was cancelled, not showing error alert');
      }
    } finally {
      setAddDriveLoading(false);
      // Cleanup scan progress listener
      if (hasScanProgressListener.current) {
        window.electronAPI.removeScanProgressListener();
        hasScanProgressListener.current = false;
        console.log('[DEBUG] Scan progress listener cleaned up (Add Drive)');
      }
    }
  };


  const handleConfirmBackup = async () => {
    if (!selectedDriveInfo?.id) return;
    
    setShowBackupConfirmation(false);
    
    try {
      console.log(`[BACKUP] Creating backup for drive: ${selectedDriveInfo.id}`);
      const result = await window.electronAPI.createBackup(selectedDriveInfo.id);
      
      if (result.success) {
        console.log(`[BACKUP] Backup created successfully: ${result.message}`);
        setBackupSuccessMessage(result.message || 'Backup created successfully');
        setShowBackupSuccess(true);
      } else {
        console.error(`[BACKUP] Failed to create backup: ${result.error}`);
        alert(`Error creating backup: ${result.error}`);
      }
    } catch (error: any) {
      console.error(`[BACKUP] Error creating backup:`, error.message);
      alert(`Error creating backup: ${error.message}`);
    }
  };

  const handleSyncDrive = async () => {
    if (!selectedDriveInfo?.id) return;
    
    let isCancelled = false; // Track cancellation state
    const syncStartTime = Date.now();
    
    console.log(`[SYNC] ===== STARTING FRONTEND SYNC PROCESS =====`);
    console.log(`[SYNC] Selected drive ID: ${selectedDriveInfo.id}`);
    console.log(`[SYNC] Selected drive name: ${selectedDriveInfo.name}`);
    console.log(`[SYNC] Selected drive path: ${selectedDriveInfo.path}`);
    console.log(`[SYNC] Timestamp: ${new Date().toISOString()}`);
    
    try {
      // Ask user to pick the same drive to sync
      console.log(`[SYNC] Opening folder picker for user selection...`);
      const drivePath = await window.electronAPI.openFolderPicker({
        title: 'Select the same drive you chose to sync',
        message: 'Pick the same drive you selected in Archivist. Choosing a different one will overwrite this drives info.',
        buttonLabel: 'Select Drive',
        prePrompt: {
          title: 'Sync reminder',
          message: 'Pick the same drive you selected in Archivist.',
          detail: 'Choosing a different drive will overwrite this drives info and contents.'
        }
      });
      
      if (!drivePath) {
        console.log(`[SYNC] User cancelled folder picker`);
        return;
      }
      
      console.log(`[SYNC] User selected path: ${drivePath}`);
      console.log(`[SYNC] Starting drive sync process...`);
      
      // Create new scan database immediately after user selects drive, before any backend operations
      console.log(`[SYNC] ===== CREATING NEW SCAN DATABASE IMMEDIATELY =====`);
      console.log(`[SYNC] Creating new scan database for drive ${selectedDriveInfo.id} before sync...`);
      
      try {
        const newDbResult = await window.electronAPI.createBackupBeforeSync(selectedDriveInfo.id);
        if (!newDbResult.success) {
          console.error(`[SYNC] Failed to create new scan database: ${newDbResult.error}`);
          alert(`Failed to create new scan database: ${newDbResult.error}. Cannot proceed with sync.`);
          return;
        }
        console.log(`[SYNC] ===== NEW SCAN DATABASE CREATED SUCCESSFULLY =====`);
        console.log(`[SYNC] New scan database created in ${newDbResult.duration}ms`);
      } catch (newDbError) {
        console.error(`[SYNC] Exception during new scan database creation:`, newDbError);
        alert(`Failed to create new scan database: ${newDbError}. Cannot proceed with sync.`);
        return;
      }
      
      // Show the same progress UI as Add New, but with "Syncing Drive" title
      const loadingMessage = document.createElement('div');
      loadingMessage.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50';
      loadingMessage.innerHTML = `
        <div class="bg-custom-white dark:bg-gray-800 p-8 rounded-2xl shadow-2xl max-w-3xl w-full mx-4 border border-gray-200 dark:border-gray-600">
          <h3 class="text-2xl font-bold mb-6 text-center text-gray-800 dark:text-gray-200">
            Syncing Drive
          </h3>
          
          <!-- Drive Info Section -->
          <div class="mb-6 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600" id="drive-info-section">
            <div class="grid grid-cols-2 gap-6 text-sm">
              <div>
                <div class="text-gray-600 dark:text-gray-400 text-xs uppercase tracking-wide">Name</div>
                <div class="font-semibold text-custom-black dark:text-white" id="drive-name">Loading...</div>
              </div>
              <div>
                <div class="text-gray-600 dark:text-gray-400 text-xs uppercase tracking-wide">Total Files</div>
                <div class="font-semibold text-custom-black dark:text-white" id="drive-total-files">-</div>
              </div>
              <div>
                <div class="text-gray-600 dark:text-gray-400 text-xs uppercase tracking-wide">Used/Capacity</div>
                <div class="font-semibold text-custom-black dark:text-white" id="drive-used-space">-</div>
              </div>
              <div>
                <div class="text-gray-600 dark:text-gray-400 text-xs uppercase tracking-wide">Free Space</div>
                <div class="font-semibold text-custom-black dark:text-white" id="drive-free-space">-</div>
              </div>
            </div>
          </div>
          
          <!-- Progress Section -->
          <div class="mb-6 p-4 bg-custom-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-600">
            <h4 class="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">Scan Progress</h4>
            
            <div class="flex items-center space-x-3 mb-4">
              <div class="animate-spin h-6 w-6 rounded-full border-2 border-gray-300 dark:border-gray-600 border-t-gray-600" id="scan-spinner"></div>
              <p class="text-sm font-medium text-gray-700 dark:text-gray-300" id="scan-progress-message">Getting drive info...</p>
            </div>
            
            <!-- Progress Bar -->
            <div class="w-full h-4 bg-gray-200 dark:bg-gray-700 rounded-full mb-4 overflow-hidden">
              <div class="h-full bg-gray-600 dark:bg-gray-400 transition-all duration-300 ease-out rounded-full" id="scan-progress-bar" style="width: 0%"></div>
            </div>
            
            <!-- Progress Details -->
            <div class="grid grid-cols-2 gap-4 mb-4">
              <div class="text-center p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div class="text-2xl font-bold text-gray-700 dark:text-gray-300" id="scan-percentage">0%</div>
                <div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Complete</div>
              </div>
              <div class="text-center p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div class="text-sm font-medium text-gray-700 dark:text-gray-300" id="scan-stats">Preparing...</div>
                <div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Status</div>
              </div>
            </div>
            
            <!-- ETA -->
            <div class="text-center p-3 bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600" id="scan-eta">
              <div class="text-sm font-medium text-gray-700 dark:text-gray-300">
                <span id="scan-running-time">Running for 0:00</span> • <span id="scan-eta-time">est. calculating...</span>
              </div>
            </div>
          </div>
          
          <!-- Cancel Button -->
          <div class="flex justify-start">
            <button id="scan-cancel-btn" class="px-6 py-3 bg-white hover:bg-gray-50 text-red-600 border border-red-600 font-semibold rounded-lg transition-colors dark:bg-gray-100 dark:hover:bg-gray-200">
              Cancel
            </button>
          </div>
          
          <!-- Errors -->
          <div class="mt-4 text-xs" id="scan-errors" style="display:none">
            <button id="scan-errors-toggle" class="underline text-red-600">Show details</button>
            <div id="scan-errors-list" class="mt-2 hidden max-h-32 overflow-auto text-red-600"></div>
          </div>
        </div>
      `;
      
      // Add CSS for animations
      const style = document.createElement('style');
      style.textContent = `
        @keyframes progress-indeterminate {
          0% { left: -100%; }
          100% { left: 100%; }
        }
        @keyframes pulse-text {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        @keyframes bounce-dots {
          0%, 80%, 100% { transform: translateY(0); }
          40% { transform: translateY(-4px); }
        }
        .animate-pulse {
          animation: pulse-text 2s infinite;
        }
        .bounce-dots::after {
          content: '';
          animation: bounce-dots 1.4s infinite;
        }
      `;
      document.head.appendChild(style);
      
      document.body.appendChild(loadingMessage);
      
      // Set up cancel button functionality
      const cancelBtn = document.getElementById('scan-cancel-btn') as HTMLButtonElement;
      if (cancelBtn) {
        cancelBtn.addEventListener('click', async () => {
          if (!confirm('Are you sure you want to cancel the sync?')) {
            return;
          }
          
          try {
            isCancelled = true;
            
            try {
              window.electronAPI.removeScanProgressListener();
              console.log('[SYNC CANCELLATION] Progress event listener removed');
            } catch (removeError) {
              console.warn('[SYNC CANCELLATION] Could not remove progress listener:', removeError);
            }
            
            cancelBtn.disabled = true;
            cancelBtn.textContent = 'Cancelling...';
            
            const result = await window.electronAPI.cancelScan();
            if (result.success) {
              try {
                if (loadingMessage && loadingMessage.parentNode) {
                  loadingMessage.parentNode.removeChild(loadingMessage);
                }
              } catch (removeError) {
                console.warn('Error removing loading message:', removeError);
              }
              
              console.log('Sync cancelled successfully');
              
              // Reset scan state to re-enable sync button
              setScanActive(false);
            } else {
              console.error('Failed to cancel sync:', result.error);
              
              // Handle case where scan is already complete
              if (result.error && result.error.includes('no running scan')) {
                console.log('Scan already completed, closing UI and resetting state');
                try {
                  if (loadingMessage && loadingMessage.parentNode) {
                    loadingMessage.parentNode.removeChild(loadingMessage);
                  }
                } catch (removeError) {
                  console.warn('Error removing loading message:', removeError);
                }
                
                // Reset scan state even if cancellation failed
                setScanActive(false);
                setIsProgressiveRendering(false);
                setIsRenderingPhase(false);
                setRenderingProgress({ current: 0, total: 0, phase: 'initial' });
                setIsWaitingForTree(false);
                
                return; // Exit early since we handled the case
              }
              
              cancelBtn.disabled = false;
              cancelBtn.textContent = 'Cancel';
            }
          } catch (error) {
            console.error('Error cancelling sync:', error);
            cancelBtn.disabled = false;
            cancelBtn.textContent = 'Cancel';
          }
        });
      }
      

      
      // Set up progress listener
      let startTime = Date.now();
      let lastProcessed = 0;
      let lastTime = startTime;
      let scanStartTime = startTime;
      let capturedTotal = 0; // Capture total from start event
      
      const progressHandler = (progress: any) => {
        if (isCancelled) {
          console.log('[SYNC PROGRESS] Ignoring progress event - sync was cancelled');
          return;
        }
        
        const messageEl = document.getElementById('scan-progress-message');
        const statsEl = document.getElementById('scan-stats');
        const barEl = document.getElementById('scan-progress-bar') as HTMLElement | null;
        const percentageEl = document.getElementById('scan-percentage');
        const etaEl = document.getElementById('scan-eta');
        const errWrap = document.getElementById('scan-errors');
        const errList = document.getElementById('scan-errors-list');
        const errToggle = document.getElementById('scan-errors-toggle');
        
        // Calculate rate
        let currentRate = 0;
        let currentTime = 0;
        let timeDiff = 0;
        let filesDiff = 0;
        
        if (progress.processed !== undefined) {
          currentTime = Date.now();
          timeDiff = (currentTime - lastTime) / 1000;
          filesDiff = progress.processed - lastProcessed;
          currentRate = timeDiff > 0 ? filesDiff / timeDiff : 0;
        }
        
        if (messageEl) {
          let friendlyMessage = progress.message;
          if (progress.type === 'start') {
            friendlyMessage = 'Starting to sync your drive...';
            
            // Capture total from start event for accurate progress tracking
            capturedTotal = progress.total || 0;
            console.log('[SYNC PROGRESS] Captured total from start event:', capturedTotal);
            
            // Show drive info section if we have drive details
            const driveInfoSection = document.getElementById('drive-info-section');
            if (driveInfoSection) {
              const driveInfo = (window as any).currentDriveInfo;
              
              if (driveInfo) {
                const driveNameEl = document.getElementById('drive-name');
                const driveTotalFilesEl = document.getElementById('drive-total-files');
                const driveUsedSpaceEl = document.getElementById('drive-used-space');
                const driveFreeSpaceEl = document.getElementById('drive-free-space');
                
                if (driveNameEl) driveNameEl.textContent = driveInfo.name || 'Unknown';
                // Use captured total if available, otherwise fall back to drive info
                const totalFiles = capturedTotal > 0 ? capturedTotal : (driveInfo.fileCount || 0);
                if (driveTotalFilesEl) driveTotalFilesEl.textContent = totalFiles.toLocaleString();
                if (driveUsedSpaceEl) driveUsedSpaceEl.textContent = `${formatBytes(driveInfo.usedSpace || 0)} / ${formatBytes(driveInfo.totalCapacity || 0)}`;
                if (driveFreeSpaceEl) driveFreeSpaceEl.textContent = formatBytes(driveInfo.freeSpace || 0);
                
                driveInfoSection.style.display = 'block';
              }
            }
            
            if (barEl) {
              barEl.style.animation = 'none';
              barEl.style.width = '0%';
            }
            if (percentageEl) {
              percentageEl.textContent = '0%';
            }
            if (statsEl) {
              statsEl.innerHTML = 'Initializing sync engine<span class="bounce-dots">...</span>';
              statsEl.className = 'text-xs text-gray-500 mb-1 animate-pulse';
            }
          } else if (progress.type === 'streaming-progress') {
            if (currentRate > 0) {
              friendlyMessage = `Processing ${Math.round(currentRate).toLocaleString()} files/second`;
            } else {
              friendlyMessage = 'Scanning files and folders...';
            }
            
            if (statsEl) {
              const processed = progress.processed?.toLocaleString() || '0';
              statsEl.innerHTML = `Streaming sync • ${processed} files processed`;
              statsEl.className = 'text-xs text-gray-500 mb-1';
            }
          } else if (progress.type === 'progress') {
            if (currentRate > 0) {
              friendlyMessage = `Processing ${Math.round(currentRate).toLocaleString()} files/second`;
            } else {
              friendlyMessage = 'Scanning files and folders...';
            }
            
            if (statsEl) {
              const processed = progress.processed?.toLocaleString() || '0';
              statsEl.innerHTML = `Syncing • ${processed} files processed`;
              statsEl.className = 'text-xs text-gray-500 mb-1';
            }
          } else if (progress.type === 'complete') {
            friendlyMessage = 'Sync complete! Rendering file tree...';
            if (barEl) {
              barEl.style.animation = 'none';
              barEl.style.width = '100%';
            }
            if (statsEl) {
              statsEl.innerHTML = 'Rendering file tree...';
              statsEl.className = 'text-xs text-gray-500 mb-1 animate-pulse';
            }
          } else if (progress.type === 'batch') {
            if (currentRate > 0) {
              friendlyMessage = `Processing ${Math.round(currentRate).toLocaleString()} files/second`;
            } else if (progress.files && progress.files.length > 0) {
              friendlyMessage = `Processing batch of ${progress.files.length} files...`;
            } else {
              friendlyMessage = 'Saving files to database...';
            }
            
            if (statsEl) {
              const processed = progress.processed?.toLocaleString() || '0';
              // Use captured total for batch processing if available
              const batchTotal = capturedTotal || progress.total;
              const total = batchTotal?.toLocaleString() || '?';
              if (batchTotal) {
                const percentage = Math.min(100, Math.round(((progress.processed || 0) / batchTotal) * 100));
                statsEl.innerHTML = `Batch processing • ${processed} of ${total} files (${percentage}%)`;
              } else {
                statsEl.innerHTML = `Batch processing • ${processed} files scanned`;
              }
              statsEl.className = 'text-xs text-gray-500 mb-1';
            }
          }
          
          messageEl.textContent = friendlyMessage;
        }
        
        if (statsEl && progress.processed !== undefined) {
          const totalScanTime = (currentTime - scanStartTime) / 1000;
          // Use captured total from start event, fall back to progress.total, then to drive info
          const total = capturedTotal || progress.total || (window as any).currentDriveEstimate || 0;
          
          let etaText = '';
          let timeElapsedText = '';
          
          if (total > 0 && progress.processed > 0 && totalScanTime > 0) {
            const remaining = total - progress.processed;
            const overallRate = progress.processed / totalScanTime;
            
            const etaSeconds = overallRate > 0 ? remaining / overallRate : 0;
            const etaMinutes = Math.floor(etaSeconds / 60);
            const etaSecondsRemaining = Math.floor(etaSeconds % 60);
            
            if (etaSeconds > 0 && etaSeconds < 3600) {
              if (etaSeconds >= 60) {
                etaText = ` • est. ${etaMinutes}:${etaSecondsRemaining.toString().padStart(2, '0')} remaining`;
              } else if (etaSeconds >= 10) {
                etaText = ` • est. ${Math.floor(etaSeconds)} seconds remaining`;
              } else if (etaSeconds >= 1) {
                etaText = ` • est. ${Math.ceil(etaSeconds)} second remaining`;
              } else {
                etaText = ` • est. <1 second remaining`;
              }
            }
          }
          
          const elapsedMinutes = Math.floor(totalScanTime / 60);
          const elapsedSeconds = Math.floor(totalScanTime % 60);
          timeElapsedText = `Running for ${elapsedMinutes}:${elapsedSeconds.toString().padStart(2, '0')}`;
          
          const totalText = total > 0 ? ` out of ${total.toLocaleString()}` : '';
          statsEl.textContent = `Processed ${progress.processed.toLocaleString()} files${totalText}`;
          
          if (etaEl) {
            const runningTimeEl = document.getElementById('scan-running-time');
            const etaTimeEl = document.getElementById('scan-eta-time');
            
            if (runningTimeEl) {
              runningTimeEl.textContent = timeElapsedText.replace(' • ', '');
            }
            
            if (etaTimeEl && etaText) {
              etaTimeEl.textContent = etaText.replace(' • ', '');
            }
          }
          
          if (progress.type !== 'start' && progress.type !== 'complete') {
            if (barEl && total > 0) {
              const percentage = Math.min(100, (progress.processed / total) * 100);
              barEl.style.width = `${percentage}%`;
              if (percentageEl) {
                percentageEl.textContent = `${Math.round(percentage)}%`;
              }
            } else if (barEl && progress.processed !== undefined) {
              // If no total available, don't show progress bar
              // Just show the processed count without percentage
              if (percentageEl) {
                percentageEl.textContent = `${progress.processed.toLocaleString()} files`;
              }
            }
          }
          
          lastProcessed = progress.processed;
          lastTime = currentTime;
        }

        if (barEl && (progress.type === 'complete')) {
          barEl.style.width = '100%';
          if (percentageEl) {
            percentageEl.textContent = '100%';
          }
        }

        if (progress.type === 'complete' && Array.isArray((progress as any).errorMessages) && (progress as any).errorMessages.length > 0) {
          if (errWrap && errList && errToggle) {
            (errWrap as HTMLElement).style.display = 'block';
            (errList as HTMLElement).innerHTML = (progress as any).errorMessages.map((m: string) => `<div>• ${m}</div>`).join('');
            (errToggle as HTMLElement).onclick = () => {
              const list = errList as HTMLElement;
              const btn = errToggle as HTMLElement;
              if (list.classList.contains('hidden')) {
                list.classList.remove('hidden');
                btn.textContent = 'Hide details';
              } else {
                list.classList.add('hidden');
                btn.textContent = 'Show details';
              }
            };
          }
        }
      };
      
      // Register the progress handler (only if we don't already have one)
      if (!hasScanProgressListener.current) {
        window.electronAPI.onScanProgress(progressHandler);
        hasScanProgressListener.current = true;
        console.log('[DEBUG] Scan progress listener added (Sync Drive)');
      } else {
        console.log('[DEBUG] Scan progress listener already exists, skipping (Sync Drive)');
      }
      
      // Cleanup function to ensure scan state is reset
      const cleanup = () => {
        setScanActive(false);
        setIsProgressiveRendering(false);
        setIsRenderingPhase(false);
        setRenderingProgress({ current: 0, total: 0, phase: 'initial' });
        setIsWaitingForTree(false);
        setProgressiveFiles([]); // Reset progressive files state
        
        // Cleanup scan progress listener
        if (hasScanProgressListener.current) {
          window.electronAPI.removeScanProgressListener();
          hasScanProgressListener.current = false;
          console.log('[DEBUG] Scan progress listener cleaned up (Sync Drive)');
        }
      };
      
      // No safety timeout - modal will stay open until sync and file tree rendering complete
      
      try {
        // Check if sync was cancelled before proceeding
        if (isCancelled) {
          console.log('[SYNC] Sync was cancelled, skipping sync process');
          cleanup();
          return;
        }
        
        console.log(`[SYNC] ===== CALLING BACKEND SYNC =====`);
        console.log(`[SYNC] About to call syncDrive with:`);
        console.log(`[SYNC]   - Drive ID: ${selectedDriveInfo.id}`);
        console.log(`[SYNC]   - Folder path: ${drivePath}`);
        
        const syncCallStartTime = Date.now();
        const syncResult: any = await window.electronAPI.syncDrive(selectedDriveInfo.id, drivePath);
        const syncCallDuration = Date.now() - syncCallStartTime;
        
        console.log(`[SYNC] syncDrive call completed in ${syncCallDuration}ms`);
        console.log(`[SYNC] syncDrive result:`, syncResult);
        
        if (!syncResult?.success) {
          console.error(`[SYNC] Backend sync failed:`, syncResult);
          const conflicts = syncResult?.conflicts?.length ? `\nConflicts: ${syncResult.conflicts.join('; ')}` : '';
          alert(`Could not sync drive. ${syncResult?.error || 'Unknown error.'}${conflicts}`);
          
          // Close the modal manually since sync failed
          try {
            if (loadingMessage && loadingMessage.parentNode) {
              loadingMessage.parentNode.removeChild(loadingMessage);
            }
          } catch (removeError) {
            console.warn('Error removing loading message after sync failure:', removeError);
          }
          return;
        }
        
        console.log(`[SYNC] Backend sync completed successfully`);
        const syncedDrive = syncResult?.drive ? syncResult.drive : syncResult;
        console.log(`[SYNC] Parsed synced drive:`, syncedDrive);
        

        
        // Store drive info for progress tracking
        if (syncedDrive) {
          (window as any).currentDriveInfo = syncedDrive;
          (window as any).currentDriveEstimate = syncedDrive.fileCount;
          
          // Populate the drive info in the modal
          const driveInfoSection = document.getElementById('drive-info-section');
          if (driveInfoSection) {
            const driveNameEl = document.getElementById('drive-name');
            const driveTotalFilesEl = document.getElementById('drive-total-files');
            const driveUsedSpaceEl = document.getElementById('drive-used-space');
            const driveFreeSpaceEl = document.getElementById('drive-free-space');
            
            if (driveNameEl) driveNameEl.textContent = syncedDrive.name || 'Unknown';
            if (driveTotalFilesEl) driveTotalFilesEl.textContent = (syncedDrive.fileCount || 0).toLocaleString();
            if (driveUsedSpaceEl) driveUsedSpaceEl.textContent = `${formatBytes(syncedDrive.usedSpace || 0)} / ${formatBytes(syncedDrive.totalCapacity || 0)}`;
            if (driveFreeSpaceEl) driveFreeSpaceEl.textContent = formatBytes(syncedDrive.freeSpace || 0);
            
            driveInfoSection.style.display = 'block';
            
            // Start the scan since we have the drive info
            if (isCancelled) {
              console.log('[SYNC] Sync was cancelled, skipping startDriveScan');
              return;
            }
            
            console.log(`[SYNC] ===== STARTING DRIVE SCAN =====`);
            console.log(`[SYNC] Starting scan for synced drive ID: ${syncedDrive.id}`);
            
            try {
              const scanStartTime = Date.now();
              const scanResult = await window.electronAPI.startSyncScan(syncedDrive.id);
              const scanDuration = Date.now() - scanStartTime;
              
              console.log(`[SYNC] startSyncScan call completed in ${scanDuration}ms`);
              console.log(`[SYNC] Scan result:`, scanResult);
              
              if (scanResult.success) {
                console.log(`[SYNC] Scan started successfully`);
                console.log(`[SYNC] Files found: ${scanResult.filesFound || 'Unknown'}`);
                
                // Check if this was a cancelled scan that was successfully restored
                if (scanResult.message && scanResult.message.includes('cancelled') && scanResult.message.includes('restored')) {
                  console.log(`[SYNC] Scan was cancelled but drive was successfully restored from backup`);
                  console.log(`[SYNC] Proceeding with drive setup despite cancellation`);
                }
              } else {
                console.error(`[SYNC] Failed to start scan:`, scanResult.error);
                
                // Check if this was a cancellation - restoration happens automatically in background
                if (scanResult.error && scanResult.error.includes('cancelled')) {
                  console.log(`[SYNC] Scan was cancelled - backup restoration happens automatically in background`);
                  console.log(`[SYNC] Proceeding with drive setup since restoration is handled by cancelScan handler`);
                  
                  // Reset the cancellation flag since restoration happens automatically
                  // This allows drive setup to proceed
                  isCancelled = false;
                  console.log(`[SYNC] Reset cancellation flag to allow drive setup to proceed`);
                }
              }
            } catch (scanError) {
              console.error(`[SYNC] Error starting scan:`, scanError);
              console.error(`[SYNC] Scan error stack:`, (scanError as Error).stack);
            }
          }
        }
        
        // Check if sync was cancelled before proceeding with drive setup
        // Note: If scan was cancelled, restoration happens automatically in background, so we can still proceed with drive setup
        if (isCancelled) {
          console.log('[SYNC] Sync was cancelled, skipping drive setup');
          return;
        }
        
        console.log(`[SYNC] ===== FINALIZING DRIVE SETUP =====`);
        console.log(`[SYNC] Reloading drives list...`);
        
        // Reload drives to include the synced one
        const updatedDrives = await window.electronAPI.getAllDrives();
        authStateManager.setState({ 
          drives: updatedDrives, 
          driveCount: updatedDrives.length 
        });
        
        console.log(`[SYNC] Drives list reloaded successfully`);
        
        if (syncedDrive?.name) {
          console.log(`[SYNC] Selecting newly synced drive: ${syncedDrive.name}`);
          setSelectedDriveId(syncedDrive.id);
          
          try {
            console.log(`[SYNC] Fetching root files for synced drive...`);
            
            // Update progress message to show waiting for database swap
            const renderMessageEl = document.getElementById('scan-progress-message');
            const renderStatsEl = document.getElementById('scan-stats');
            if (renderMessageEl) renderMessageEl.textContent = 'Sync complete! Finalizing database...';
            if (renderStatsEl) {
              renderStatsEl.innerHTML = 'Database swap in progress...';
              renderStatsEl.className = 'text-xs text-gray-500 mb-1 animate-pulse';
            }
            
            console.log(`[SYNC] Drive setup completed successfully`);
            console.log(`[SYNC] Waiting for database swap to complete before closing modal...`);
            
            // Modal will be closed by the global scan progress listener after database swap completes
            
          } catch (e) {
            console.error(`[SYNC] Error fetching files immediately after sync:`, e);
            console.error(`[SYNC] Error stack:`, (e as Error).stack);
            
            // Show error message in the modal
            const errorMessageEl = document.getElementById('scan-progress-message');
            const errorStatsEl = document.getElementById('scan-stats');
            if (errorMessageEl) errorMessageEl.textContent = 'Error during sync process';
            if (errorStatsEl) {
              errorStatsEl.innerHTML = 'Sync failed - check console for details';
              errorStatsEl.className = 'text-xs text-red-500 mb-1';
            }
            
            // Modal will be closed by the global scan progress listener or error handling
          }
        } else {
          console.warn(`[SYNC] Warning: syncedDrive is missing or has no name`);
        }
        
      } finally {
        // Modal will be closed by the global scan progress listener after database swap completes
        // Only reset scan state here - don't close modal manually
        
        // Always ensure scan state is reset in finally block
        setScanActive(false);
        setIsProgressiveRendering(false);
        setIsRenderingPhase(false);
        setRenderingProgress({ current: 0, total: 0, phase: 'initial' });
        setIsWaitingForTree(false);
        setProgressiveFiles([]); // Reset progressive files state
      }

    } catch (error) {
      // Don't show error alert if sync was cancelled
      if (!isCancelled) {
        console.error(`[SYNC] ===== FRONTEND SYNC PROCESS FAILED =====`);
        console.error(`[SYNC] Error syncing drive:`, error);
        console.error(`[SYNC] Error type: ${error instanceof Error ? error.constructor.name : typeof error}`);
        console.error(`[SYNC] Error message: ${error instanceof Error ? error.message : String(error)}`);
        console.error(`[SYNC] Error stack:`, error instanceof Error ? error.stack : 'No stack trace available');
        
        alert(`Error syncing drive: ${error instanceof Error ? error.message : 'Unknown error'}`);
      } else {
        console.log(`[SYNC] Sync was cancelled, not showing error alert`);
      }
      
      // Always ensure scan state is reset on error
      setScanActive(false);
      setIsProgressiveRendering(false);
      setIsRenderingPhase(false);
      setRenderingProgress({ current: 0, total: 0, phase: 'initial' });
      setIsWaitingForTree(false);
      setProgressiveFiles([]); // Reset progressive files state
    }
    
    const totalSyncDuration = Date.now() - syncStartTime;
    console.log(`[SYNC] ===== FRONTEND SYNC PROCESS COMPLETED =====`);
    console.log(`[SYNC] Total frontend sync duration: ${totalSyncDuration}ms`);
    console.log(`[SYNC] Sync was cancelled: ${isCancelled}`);
    
    // Always ensure scan state is reset at the end
    if (isCancelled) {
      setScanActive(false);
      setIsProgressiveRendering(false);
      setIsRenderingPhase(false);
      setRenderingProgress({ current: 0, total: 0, phase: 'initial' });
      setIsWaitingForTree(false);
      setProgressiveFiles([]); // Reset progressive files state
    }
  };

  const handleDeleteDrive = async () => {
    if (!selectedDriveInfo?.id) return;
    
    try {
      await window.electronAPI.deleteDrive(selectedDriveInfo.id);
      // Clear persisted UI state for this drive
      clearExpandedFromStorage(selectedDriveInfo.id);
      
      // Reload drives to reflect the deletion
      const updatedDrives = await window.electronAPI.getAllDrives();
      authStateManager.setState({ 
        drives: updatedDrives, 
        driveCount: updatedDrives.length 
      });
      
      // Clear selected drive if it was deleted
      if (selectedDriveId) {
        const remainingDrives = drives.filter(d => d.id !== selectedDriveId);
        if (remainingDrives.length > 0) {
          setSelectedDriveId(remainingDrives[0].id);
        } else {
          setSelectedDriveId('');
          setSelectedDriveInfo(null);
          setDriveFiles([]);
        }
      }
    } catch (error) {
      console.error('Error deleting drive:', error);
    }
  };

  // (Removed) custom hidden list handlers

  // Handle search result selection
  const handleSearchResultSelect = async (result: any) => {
    // Increment navigation token so only the latest navigation continues
    const myToken = ++navTokenRef.current;
    console.log(`[SearchNav] === STARTING SEARCH NAVIGATION ===`);
    console.log(`[SearchNav] File: "${result.fileName}"`);
    console.log(`[SearchNav] Drive ID: ${result.driveId}`);
    console.log(`[SearchNav] Path: ${result.path}`);
    console.log(`[SearchNav] Full Path: ${result.fullPath}`);
    console.log(`[SearchNav] Current selectedDriveId: ${selectedDriveId}`);
    console.log(`[SearchNav] Current driveFiles count: ${driveFiles.length}`);
    console.log(`[SearchNav] Current expandedFolders count: ${expandedFolders.size}`);
    
    // Lazy-show navigation indicator after short delay
    if (navIndicatorTimerRef.current) {
      console.log(`[SearchNav] Clearing existing navigation timer`);
      window.clearTimeout(navIndicatorTimerRef.current);
      navIndicatorTimerRef.current = null;
    }
    console.log(`[SearchNav] Setting navigation timer for 150ms`);
    navIndicatorTimerRef.current = window.setTimeout(() => {
      console.log(`[SearchNav] Navigation timer fired - showing indicator`);
      setIsNavigatingToSearchResult(true);
      setNavigationStatus('Preparing navigation...');
    }, 150);

    // Ensure details view is active so the file tree is visible
    console.log(`[SearchNav] Checking if details view is visible: ${visibleViews.includes('details')}`);
    if (!visibleViews.includes('details')) {
      console.log(`[SearchNav] Adding details view to show file tree`);
      setVisibleViews(prev => [...prev, 'details']);
    }
    
    try {
      console.log(`[SearchNav] === GETTING FILE DETAILS ===`);
      // Get full file details for navigation
      const fullDetails = await window.electronAPI.getFileDetailsForNavigation(result.fileName, result.driveId, result.path);
      if (myToken !== navTokenRef.current) return; // cancelled
      console.log('[SearchNav] File details loaded:', fullDetails);
      
      if (!fullDetails) {
        console.error('[SearchNav] Failed to get file details - returned null');
        return;
      }
      
      console.log(`[SearchNav] === SETTING HIGHLIGHTED FILE ===`);
      // Set the highlighted file
      console.log(`[SearchNav] Setting highlightedFile to: ${fullDetails.fileId}`);
              console.log('[DEBUG] Setting highlightedFile to fullDetails:', fullDetails.fileId);
        setHighlightedFile(fullDetails.fileId);
      console.log('[SearchNav] Highlighted file set');
      
      console.log(`[SearchNav] === CHECKING DRIVE SWITCH ===`);
      // Switch to the correct drive if needed
      if (selectedDriveId !== result.driveId) {
        console.log(`[SearchNav] Drive switch needed: ${selectedDriveId} -> ${result.driveId}`);
        setNavigationStatus('Switching drive...');
        console.log(`[SearchNav] Setting selectedDriveId to: ${result.driveId}`);
        setSelectedDriveId(result.driveId);
        console.log(`[SearchNav] Calling loadDriveContents for drive: ${result.driveId}`);
        await loadDriveContents(result.driveId);
        if (myToken !== navTokenRef.current) return; // cancelled
        console.log(`[SearchNav] loadDriveContents completed`);
      } else {
        console.log(`[SearchNav] No drive switch needed - already on correct drive`);
      }
      
      console.log(`[SearchNav] === BUILDING EXPANDED FOLDERS ===`);
      // Parse the full path to build the expanded folders set (drive-root aware)
      const driveRoot = (drives.find(d => d.id === result.driveId)?.path) || '';
      const normalizedRoot = driveRoot.replace(/[\\/]+$/, '');
      const normalizedFull = result.fullPath.replace(/[\\/]+$/, '');
      const rel = normalizedRoot && normalizedFull.startsWith(normalizedRoot)
        ? normalizedFull.slice(normalizedRoot.length).replace(/^[\\/]+/, '')
        : normalizedFull;
      const pathParts = rel.split(/[\\/]/).filter(Boolean);
      console.log(`[SearchNav] Path parts:`, pathParts);
      setNavigationStatus('Expanding folders...');
      
      // Build the expanded folders set
      const newExpanded = new Set<string>();
      let currentPath = '';
      
      for (const part of pathParts) {
        currentPath = currentPath ? `${currentPath}/${part}` : (normalizedRoot || '') + `/${part}`;
        newExpanded.add(currentPath);
        console.log(`[SearchNav] Added to expanded: ${currentPath}`);
      }
      
      // Remove the file itself from expanded folders (only expand parent folders)
      newExpanded.delete(result.fullPath);
      console.log(`[SearchNav] Removed file path from expanded: ${result.fullPath}`);
      console.log(`[SearchNav] Final expanded folders:`, Array.from(newExpanded));
      
      // Expanded set ready
      
      console.log(`[SearchNav] === SETTING EXPANDED FOLDERS ===`);
      // Set the expanded folders state and persist per-drive
      console.log(`[SearchNav] Setting expandedFolders state (per-drive)`);
      setExpandedFoldersPersisted(newExpanded);
      
      console.log(`[SearchNav] === WAITING FOR STATE UPDATE ===`);
      // Wait for React state update and then try to expand
      console.log(`[SearchNav] Setting timeout for 100ms to wait for state update`);
      setTimeout(async () => {
        if (myToken !== navTokenRef.current) return; // cancelled
        console.log(`[SearchNav] === LOADING CHILDREN ===`);
        // Load children for all necessary ancestors in one batch
        try {
          const parentList = Array.from(newExpanded).filter(p => p !== normalizedRoot && p !== result.fullPath);
          console.log(`[SearchNav] Parent list to load children for:`, parentList);
          
          if (parentList.length) {
            console.log(`[SearchNav] Loading children for ${parentList.length} parents`);
            const grouped: { [parentPath: string]: FileMetadata[] } = {};
            for (const parent of parentList) {
              try {
                const { files } = await window.electronAPI.listChildren(result.driveId, parent, 1000, 0);
                grouped[parent] = files;
              } catch (error) {
                console.error(`Error loading children for ${parent}:`, error);
                grouped[parent] = [];
              }
            }
            if (myToken !== navTokenRef.current) return; // cancelled
            console.log(`[SearchNav] Children loaded for:`, Object.keys(grouped));
            
            // Merge all children in a single update to reduce renders
            console.log(`[SearchNav] Starting startTransition to merge children`);
            startTransition(() => {
              if (myToken !== navTokenRef.current) return; // cancelled
              console.log(`[SearchNav] Inside startTransition - updating driveFiles`);
              setDriveFiles(prev => {
                console.log(`[SearchNav] Previous driveFiles count: ${prev.length}`);
                const resultFiles: FileMetadata[] = [] as any;
                const existingIds = new Set<string>();
                // Keep all unrelated files
                for (const f of prev) {
                  resultFiles.push(f);
                  if ((f as any).id) existingIds.add((f as any).id);
                }
                console.log(`[SearchNav] Kept ${resultFiles.length} existing files`);
                
                // Append new children per parent path
                for (const parent of parentList) {
                  const children = grouped[parent] || [];
                  console.log(`[SearchNav] Adding ${children.length} children for parent: ${parent}`);
                  for (const child of children) {
                    if (child && (child as any).id && !existingIds.has((child as any).id)) {
                      resultFiles.push(child as any);
                      existingIds.add((child as any).id);
                    }
                  }
                }
                console.log(`[SearchNav] Final resultFiles count: ${resultFiles.length}`);
                return resultFiles;
              });
            });
            console.log(`[SearchNav] startTransition completed`);
          } else {
            console.log(`[SearchNav] No parents to load children for`);
          }
        } catch (error) {
          console.warn('[SearchNav] batch load children failed', error);
        }

        console.log(`[SearchNav] === FINALIZING ===`);
        console.log('[SearchNav] Expanded and hydrated');
        setNavigationStatus('Finalizing...');
        // Finalize immediately if still the latest navigation
        if (myToken === navTokenRef.current) {
          clearNavIndicator();
          setIsNavigatingToSearchResult(false);
          setNavigationStatus('');
          console.log(`[SearchNav] === SEARCH NAVIGATION COMPLETED ===`);
        }
      }, 100);
      
    } catch (error) {
      console.error('[SearchNav] === ERROR OCCURRED ===');
      console.error('[SearchNav] error', error);
      clearNavIndicator();
      setIsNavigatingToSearchResult(false);
      setNavigationStatus('');
      console.log(`[SearchNav] === SEARCH NAVIGATION FAILED ===`);
    }
  };

  // Calculate totals from real drive data
  const totalDrives = drives.length;
  const totalUsedBytes = drives.reduce((sum, drive) => sum + (drive.usedSpace || 0), 0);
  const totalCapacityBytes = drives.reduce((sum, drive) => sum + (drive.totalCapacity || 0), 0);
  const totalFreeBytes = drives.reduce((sum, drive) => sum + (drive.freeSpace || 0), 0);
  
  // Use formatting hooks
  const totalUsed = useFormatBytes(totalUsedBytes);
  const totalCapacity = useFormatBytes(totalCapacityBytes);
  const totalFree = useFormatBytes(totalFreeBytes);

  // Handle view changes - ensure drive is selected when switching to details view  
  useEffect(() => {
    if (visibleViews.includes('details') && drivesLoaded && drives.length > 0) {
      const selectedDrive = drives.find(d => d.id === selectedDriveId);
      
      // If no drive is selected or selected drive doesn't exist, select the first one
      if (!selectedDriveId || !selectedDrive) {
        console.log('[View Change] Switching to details view, selecting first drive');
        const firstDrive = drives[0];
        setSelectedDriveId(firstDrive.id);
        setSelectedDriveInfo(firstDrive);
        
        // Also load the drive contents immediately
        console.log('[View Change] - Loading contents for selected drive');
        loadDriveContents(firstDrive.id);
      }
    }
  }, [visibleViews, selectedDriveId, drives, drivesLoaded]);

  // Drive initialization effect - ensures a drive is always selected when available
  useEffect(() => {
      console.log('[Drive Init] Effect triggered - drives:', drives.length, 'selectedDriveId:', selectedDriveId, 'drivesLoaded:', drivesLoaded);
      console.log('[Drive Init] visibleViews:', visibleViews, 'currentPage:', currentPage);    // Only proceed if drives have been loaded by the AuthStateManager
    if (drivesLoaded && drives.length > 0) {
      const selectedDrive = drives.find(d => d.id === selectedDriveId);
      
      // If no drive is selected, or the selected drive no longer exists, select the first available drive
      if (!selectedDriveId || !selectedDrive) {
        console.log('[Drive Selection] Initializing drive selection');
        console.log('[Drive Selection] - Drives available:', drives.length);
        console.log('[Drive Selection] - Current selectedDriveId:', selectedDriveId);
        console.log('[Drive Selection] - Selected drive exists:', !!selectedDrive);
        console.log('[Drive Selection] - Available drive names:', drives.map(d => d.name));
        
        const firstDrive = drives[0];
        console.log('[Drive Selection] - Selecting first drive:', firstDrive.name, 'ID:', firstDrive.id);
        setSelectedDriveId(firstDrive.id);
        setSelectedDriveInfo(firstDrive);
        
        // Also load the drive contents immediately
        console.log('[Drive Selection] - Loading contents for selected drive');
        loadDriveContents(firstDrive.id);
      } else if (selectedDrive && (!selectedDriveInfo || selectedDriveInfo.id !== selectedDriveId)) {
        // Drive exists but selectedDriveInfo is not set correctly
        console.log('[Drive Selection] Updating selectedDriveInfo for existing drive:', selectedDrive.name);
        setSelectedDriveInfo(selectedDrive);
      } else {
        console.log('[Drive Selection] Drive selection is already correct:', selectedDrive?.name);
      }
    } else if (drivesLoaded && drives.length === 0) {
      console.log('[Drive Selection] Drives loaded but no drives available - clearing selection');
      // Clear selection if no drives are available
      if (selectedDriveId) {
        setSelectedDriveId('');
        setSelectedDriveInfo(null);
      }
    } else {
      console.log('[Drive Selection] Waiting for drives to load...');
    }
  }, [drives, selectedDriveId, selectedDriveInfo, drivesLoaded]);

  // Handle returning to main page - force drive reselection
  useEffect(() => {
    if (currentPage === 'main' && drivesLoaded && drives.length > 0 && visibleViews.includes('details')) {
      console.log('[Page Navigation] Returned to main page, checking drive selection');
      console.log('[Page Navigation] Current selectedDriveId:', selectedDriveId);
      console.log('[Page Navigation] Available drives:', drives.map(d => d.name));
      
      const selectedDrive = drives.find(d => d.id === selectedDriveId);
      if (!selectedDriveId || !selectedDrive) {
        console.log('[Page Navigation] No valid drive selected, selecting first drive');
        const firstDrive = drives[0];
        setSelectedDriveId(firstDrive.id);
        setSelectedDriveInfo(firstDrive);
        console.log('[Page Navigation] Selected drive:', firstDrive.name);
        
        // Also load the drive contents immediately
        console.log('[Page Navigation] - Loading contents for selected drive');
        loadDriveContents(firstDrive.id);
      } else {
        console.log('[Page Navigation] Valid drive already selected:', selectedDrive.name);
        // Ensure selectedDriveInfo is in sync
        if (!selectedDriveInfo || selectedDriveInfo.id !== selectedDriveId) {
          setSelectedDriveInfo(selectedDrive);
        }
        
        // Also ensure contents are loaded for the existing selection
        console.log('[Page Navigation] - Ensuring contents are loaded for existing drive');
        loadDriveContents(selectedDriveId);
      }
    }
  }, [currentPage, drives, selectedDriveId, selectedDriveInfo, visibleViews, drivesLoaded]);

    // Subscription validation is now handled in AuthWrapper

    return (
      <div className={`min-h-screen flex flex-col ${effectiveDarkMode ? 'bg-custom-gray text-custom-white' : 'bg-gray-100 text-custom-black'}`}>        {/* Sidebar Menu */}
        <div 
          className={`fixed left-0 z-30 transition-transform duration-300 ease-in-out ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
          style={{ width: '280px', top: '57px', height: 'calc(100vh - 57px)' }}
        >
          <div className={`h-full ${effectiveDarkMode ? 'bg-custom-black border-r border-gray-800' : 'bg-custom-white border-r border-gray-200'}`}>
            {/* Sidebar Menu Items */}
            <div className="py-4">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  console.log('Home button clicked');
                  setCurrentPage('main');
                }}
                className={`w-full text-left px-6 py-3 text-base font-medium transition-colors flex items-center space-x-3 ${effectiveDarkMode ? 'text-gray-200 hover:bg-custom-gray' : 'text-gray-700 hover:bg-gray-100'}`}
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
                </svg>
                <span>Home</span>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  console.log('Account button clicked');
                  setCurrentPage('account');
                }}
                className={`w-full text-left px-6 py-3 text-base font-medium transition-colors flex items-center space-x-3 ${effectiveDarkMode ? 'text-gray-200 hover:bg-custom-gray' : 'text-gray-700 hover:bg-gray-100'}`}
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                  <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                </svg>
                <span>Account</span>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  console.log('FAQ button clicked');
                  window.open('https://archivist.app/help', '_blank');
                }}
                className={`w-full text-left px-6 py-3 text-base font-medium transition-colors flex items-center justify-between ${effectiveDarkMode ? 'text-gray-200 hover:bg-custom-gray' : 'text-gray-700 hover:bg-gray-100'}`}
              >
                <div className="flex items-center space-x-3">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                  <span>FAQ</span>
                </div>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  console.log('Contact button clicked');
                  setCurrentPage('contact');
                }}
                className={`w-full text-left px-6 py-3 text-base font-medium transition-colors flex items-center space-x-3 ${effectiveDarkMode ? 'text-gray-200 hover:bg-custom-gray' : 'text-gray-700 hover:bg-gray-100'}`}
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
                  <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
                </svg>
                <span>Contact</span>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  console.log('Recover button clicked');
                  setCurrentPage('recover');
                }}
                className={`w-full text-left px-6 py-3 text-base font-medium transition-colors flex items-center space-x-3 ${effectiveDarkMode ? 'text-gray-200 hover:bg-custom-gray' : 'text-gray-700 hover:bg-gray-100'}`}
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                </svg>
                <span>Recover</span>
              </button>
            </div>
          </div>
        </div>

        {/* Header - Fixed position, not affected by sidebar */}
  <div className={`sticky top-0 z-40 border-b ${effectiveDarkMode ? 'border-gray-800 bg-custom-black' : 'border-gray-200 bg-custom-white'}`}>
        <div className="flex items-center justify-between px-6 py-3">
          {/* Left side - Hamburger menu and app name */}
            <div className="flex items-center space-x-3">
              <button 
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className={`p-2 rounded-md ${effectiveDarkMode ? 'hover:bg-custom-gray' : 'hover:bg-gray-200'}`}
                aria-label={sidebarOpen ? "Close sidebar menu" : "Open sidebar menu"}
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                  <path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
                </svg>
              </button>
              <h1 
                onClick={() => setCurrentPage('main')}
                className="font-semibold text-[22px] hover:opacity-70 transition-opacity cursor-pointer"
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setCurrentPage('main');
                  }
                }}
              >
                archivist
              </h1>
          </div>
            
          {/* Right side - Dark mode toggle */}
          <div className="flex items-center">
            <div className="relative">
                              <button
                  onClick={() => {
                    if (preference === 'system') {
                      setPreference('dark');
                    } else if (preference === 'dark') {
                      setPreference('light');
                    } else {
                      setPreference('dark');
                    }
                  }}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2 ${
                    effectiveDarkMode ? 'bg-gray-500/30' : 'bg-gray-200'
                  }`}
                >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                    effectiveDarkMode ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
                <svg
                  className={`absolute left-1 h-3 w-3 text-yellow-500 transition-opacity ${
                    effectiveDarkMode ? 'opacity-0' : 'opacity-100'
                  }`}
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1H8zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z"
                    clipRule="evenodd"
                  />
                </svg>
                <svg
                  className={`absolute right-1 h-3 w-3 text-gray-400 transition-opacity ${
                    effectiveDarkMode ? 'opacity-100' : 'opacity-0'
                  }`}
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
              </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Wrapper - Pushes to the right when sidebar is open */}
      <div 
        className={`transition-all duration-300 ease-in-out ${
          sidebarOpen ? 'ml-[280px]' : 'ml-0'
        }`}
      >

      {/* Show drive content only on main page */}
      {currentPage === 'main' && (
        <>
      {/* Unified Header for both view modes */}
      <div className="w-full max-w-[95vw] lg:max-w-[75vw] mx-auto px-2 sm:px-4 pt-4 pb-0">
  <div className={`rounded-t-lg p-2 sm:p-4 ${effectiveDarkMode ? 'bg-custom-black' : 'bg-custom-white'} shadow-md`}>
          <div className="flex items-center justify-between gap-4 min-w-0 overflow-x-auto overflow-y-visible">
            {/* Left: title + actions */}
            <div className="flex items-center space-x-2 sm:space-x-3 pl-2 sm:pl-6 flex-shrink-0 min-w-0">
              <h2 className="text-base sm:text-lg font-medium whitespace-nowrap">My Drives</h2>
              {/* Segmented view toggle: List (left) and Details (right) */}
              <div className={`inline-flex rounded-md overflow-hidden border ${effectiveDarkMode ? 'border-gray-600' : 'border-gray-300'}`} role="group" aria-label="View switch">
                {/* List (All drives) - left segment */}
                <button
                  onClick={() => {
                    setVisibleViews(['list']);
                  }}
                  aria-pressed={visibleViews.includes('list')}
                  aria-label="Switch to list view showing all drives"
                  className={`px-1.5 sm:px-2 py-1 text-xs sm:text-sm ${visibleViews.includes('list') ? (effectiveDarkMode ? 'bg-gray-700 text-gray-200' : 'bg-blue-500/15 text-blue-700') : (effectiveDarkMode ? 'hover:bg-custom-gray' : 'hover:bg-gray-100')}`}
                  title="List view"
                >
                  <svg className="w-3 h-3 sm:w-4 sm:h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path d="M3 5h14v4H3V5zm0 6h14v4H3v-4z" />
                  </svg>
                </button>
                {/* Divider between segments */}
                <div className={`${effectiveDarkMode ? 'border-gray-600' : 'border-gray-300'} border-l`} />
                {/* Details (Drive) - right segment */}
                <button
                  onClick={() => {
                    setVisibleViews(['details']);
                  }}
                  aria-pressed={visibleViews.includes('details')}
                  aria-label="Switch to details view showing selected drive files"
                  className={`px-1.5 sm:px-2 py-1 text-xs sm:text-sm ${visibleViews.includes('details') ? (effectiveDarkMode ? 'bg-gray-700 text-gray-200' : 'bg-blue-500/15 text-blue-700') : (effectiveDarkMode ? 'hover:bg-custom-gray' : 'hover:bg-gray-100')}`}
                  title="Details view"
                >
                  <svg className="w-3 h-3 sm:w-4 sm:h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path d="M3 5h6v4H3V5zm8 0h6v10h-6V5zM3 11h6v4H3v-4z" />
                  </svg>
                </button>
              </div>
              <button
                onClick={handleAddDrive}
                disabled={addDriveLoading || scanActive}
                className={`px-2 sm:px-3 py-1 text-xs sm:text-sm rounded text-white whitespace-nowrap bg-blue-500 ${addDriveLoading ? 'opacity-50 cursor-not-allowed' : (scanActive ? 'cursor-not-allowed' : 'hover:bg-blue-600')}`}
              >
                <span className="hidden sm:inline">{addDriveLoading ? 'Scanning Drive...' : 'Add New'}</span>
                <span className="sm:hidden">+</span>
              </button>
            </div>

            {/* Center: Overview stats */}
            <div className="hidden md:flex items-center space-x-2 lg:space-x-4 flex-shrink-0 min-w-0">
              <div className="flex flex-col items-center text-center">
                <div className="text-xs lg:text-sm font-semibold">{totalDrives}</div>
                <div className="text-[9px] lg:text-[10px] uppercase tracking-wide opacity-70">DRIVES</div>
              </div>
              <div className="flex flex-col items-center text-center">
                <div className="text-xs lg:text-sm font-semibold">
                  {totalUsed === '0 Bytes' && totalCapacity === '0 Bytes' 
                    ? '—' 
                    : `${totalUsed} / ${totalCapacity}`}
                </div>
                <div className="text-[9px] lg:text-[10px] uppercase tracking-wide opacity-70">USED/CAPACITY</div>
              </div>
              <div className="flex flex-col items-center text-center">
                <div className="text-xs lg:text-sm font-semibold">
                  {totalFree === '0 Bytes' ? '—' : totalFree}
                </div>
                <div className="text-[9px] lg:text-[10px] uppercase tracking-wide opacity-70">FREE SPACE</div>
              </div>
            </div>

            {/* Right: search bar */}
            <div className="flex items-center relative w-48 sm:w-64 lg:w-80 flex-shrink-0 min-w-0" data-search-container>
            <div className="relative w-full">
              <input
                type="text"
                placeholder="Search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                ref={searchInputRef}
                className={`w-full pl-8 pr-28 py-2 text-sm border rounded focus:outline-none focus:ring-0 ${
                  effectiveDarkMode 
                    ? 'bg-gray-700 border-gray-600 text-white focus:border-gray-600' 
                    : 'bg-custom-white border-gray-300 focus:border-gray-300'
                }`}
              />
              <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
              </svg>
              <div className="absolute right-2 inset-y-0 flex items-center pointer-events-none">
                {searchQuery.trim() && (
                                  <div 
                    className={`mr-2 text-xs ${effectiveDarkMode ? 'text-gray-300' : 'text-gray-500'}`}
                    aria-live="polite"
                    role="status"
                  >
                    {searchTotalCount > 0 ? searchTotalCount.toLocaleString() : searchResults.length.toLocaleString()} results
                  </div>
                )}
                <div className="w-4 h-4 flex items-center justify-center">
                  <div className={`h-4 w-4 rounded-full border-2 ${effectiveDarkMode ? 'border-gray-600' : 'border-gray-300'} border-t-gray-400 ${isSearching ? 'animate-spin visible' : 'invisible'}`} />
                </div>
              </div>
            </div>
            
            {/* Search Results Dropdown (Portal) */}
            {searchResults.length > 0 && createPortal(
              <div
                style={{ position: 'fixed', top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width, zIndex: 9999 }}
                role="listbox"
                aria-label="Search results"
              >
                <div ref={searchDropdownRef} className={`max-h-96 overflow-y-auto rounded-lg border shadow-lg ${effectiveDarkMode ? 'bg-custom-black border-gray-700' : 'bg-custom-white border-gray-200'}`}>
                  {searchResults.slice(0, searchResultsVisible).map((result, index) => (
                    <div
                      key={`${result.fileId}-${index}`}
                      className={`px-4 py-3 cursor-pointer border-b last:border-b-0 transition-colors ${
                        effectiveDarkMode 
                          ? 'border-gray-600 hover:bg-custom-gray hover:text-white' 
                          : 'border-gray-200 hover:bg-blue-100 hover:text-blue-900'
                      }`}
                      onClick={() => handleSearchResultSelect(result)}
                      data-search-result
                      data-file-id={result.fileId}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3 min-w-0 flex-1">
                          {result.isDirectory && (
                            <span className="text-lg">📁</span>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="font-medium truncate" title={result.fileName}>
                              {result.fileName}
                            </div>
                            <div className={`text-sm ${effectiveDarkMode ? 'text-gray-300' : 'text-gray-600'}`} title={result.driveName}>
                              {result.driveName}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center space-x-2 text-sm text-right">
                          {!result.isDirectory && result.size && (
                            <span className={`whitespace-nowrap ${effectiveDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                              {result.size === 0 ? '0 Bytes' : (() => {
                                const k = 1024;
                                const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
                                const i = Math.floor(Math.log(result.size) / Math.log(k));
                                return parseFloat((result.size / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
                              })()}
                            </span>
                          )}
                          {result.modified && (
                            <span className={`whitespace-nowrap ${effectiveDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                              {new Date(result.modified).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  {hasMoreResults && !isLoadingMore && (
                    <button
                      onClick={() => {
                        console.log(`[SearchUI] Load More button clicked. Current state:`, {
                          hasMoreResults,
                          isLoadingMore,
                          searchOffset,
                          searchResultsLength: searchResults.length,
                          searchTotalCount
                        });
                        loadMoreSearchResults();
                      }}
                      className={`${effectiveDarkMode ? 'text-gray-300 hover:text-white hover:bg-custom-gray' : 'text-blue-600 hover:text-blue-800 hover:bg-blue-50'} px-4 py-3 w-full text-center text-sm transition-colors`}
                    >
                      Load More Results ({searchResults.length} of {searchTotalCount})
                    </button>
                  )}
                  {isLoadingMore && (
                    <div className="px-4 py-3 text-center text-sm text-gray-500">
                      Loading more results...
                    </div>
                  )}
                </div>
              </div>,
              document.body
            )}
          </div>
        </div>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Single unified container for both views */}
        <div className="w-full max-w-[95vw] lg:max-w-[75vw] mx-auto px-2 sm:px-4 pb-4 pt-0">
          <div className={`rounded-b-lg p-2 sm:p-4 ${effectiveDarkMode ? 'bg-custom-black' : 'bg-custom-white'} overflow-x-auto shadow-md`}>
            
            {/* Render views based on visibleViews array */}
            <div className="h-[80vh] overflow-auto">
              <div className="flex flex-col gap-6 h-full min-w-0">
                {visibleViews.map((viewType) => (
                  <div key={viewType} className="h-full min-w-0">
                  {viewType === 'list' && (
                    <div className="w-full h-full overflow-x-auto" style={{ paddingLeft: '22px' }}>

              {/* Table Header with sorting */}
              <div className={`px-6 py-2 text-xs uppercase tracking-wide ${effectiveDarkMode ? 'text-gray-300' : 'text-gray-500'}`}> 
                <div className="flex select-none items-center min-w-0 justify-between">
                  <button
                    className="w-32 text-left flex-shrink-0"
                    onClick={() => {
                      setDriveSortBy('name');
                      setDriveSortDir(prev => (driveSortBy === 'name' && prev === 'asc') ? 'desc' : 'asc');
                    }}
                  >
                    Drive {driveSortBy === 'name' ? (driveSortDir === 'asc' ? '▲' : '▼') : ''}
                  </button>
                  <button
                    className="w-24 text-left flex-shrink-0"
                    onClick={() => {
                      setDriveSortBy('used');
                      setDriveSortDir(prev => (driveSortBy === 'used' && prev === 'desc') ? 'asc' : 'desc');
                    }}
                  >
                    Used {driveSortBy === 'used' ? (driveSortDir === 'asc' ? '▲' : '▼') : ''}
                  </button>
                  <button
                    className="w-24 text-left flex-shrink-0"
                    onClick={() => {
                      setDriveSortBy('capacity');
                      setDriveSortDir(prev => (driveSortBy === 'capacity' && prev === 'desc') ? 'asc' : 'desc');
                    }}
                  >
                    Capacity {driveSortBy === 'capacity' ? (driveSortDir === 'asc' ? '▲' : '▼') : ''}
                  </button>
                  <button
                    className="w-24 text-left flex-shrink-0"
                    onClick={() => {
                      setDriveSortBy('free');
                      setDriveSortDir(prev => (driveSortBy === 'free' && prev === 'desc') ? 'asc' : 'desc');
                    }}
                  >
                    Free Space {driveSortBy === 'free' ? (driveSortDir === 'asc' ? '▲' : '▼') : ''}
                  </button>
                  <button
                    className="w-32 text-left flex-shrink-0 whitespace-nowrap"
                    onClick={() => {
                      setDriveSortBy('added');
                      setDriveSortDir(prev => (driveSortBy === 'added' && prev === 'desc') ? 'asc' : 'desc');
                    }}
                  >
                    Date Added {driveSortBy === 'added' ? (driveSortDir === 'asc' ? '▲' : '▼') : ''}
                  </button>
                  <button
                    className="w-32 text-left flex-shrink-0 whitespace-nowrap"
                    onClick={() => {
                      setDriveSortBy('updated');
                      setDriveSortDir(prev => (driveSortBy === 'updated' && prev === 'desc') ? 'asc' : 'desc');
                    }}
                  >
                    Last Updated {driveSortBy === 'updated' ? (driveSortDir === 'asc' ? '▲' : '▼') : ''}
                  </button>
                </div>
              </div>

              {/* Sorted Table Rows */}
                <div className="space-y-3">
                {[...drives]
                  .sort((a, b) => {
                    const dir = driveSortDir === 'asc' ? 1 : -1;
                    const val = (key: DriveSortKey, d: DriveInfo) => {
                      switch (key) {
                        case 'name': return (d.name || '').toLowerCase();
                        case 'used': return d.usedSpace || 0;
                        case 'free': return d.freeSpace || 0;
                        case 'capacity': return d.totalCapacity || 0;
                        case 'added': return d.addedDate ? new Date(d.addedDate).getTime() : 0;
                        case 'updated': {
                          const eff = d.lastUpdated || d.addedDate || '';
                          return eff ? new Date(eff).getTime() : 0;
                        }
                      }
                    };
                    const av = val(driveSortBy, a);
                    const bv = val(driveSortBy, b);
                    
                    // Primary sort
                    let comparison = 0;
                    if (typeof av === 'string' && typeof bv === 'string') {
                      comparison = av.localeCompare(bv) * dir;
                    } else {
                      comparison = ((av as number) - (bv as number)) * dir;
                    }
                    
                    // If primary values are equal, sort alphabetically by name
                    if (comparison === 0 && driveSortBy !== 'name') {
                      const nameA = (a.name || '').toLowerCase();
                      const nameB = (b.name || '').toLowerCase();
                      comparison = nameA.localeCompare(nameB);
                    }
                    
                    return comparison;
                  })
                  .map((drive) => (
                    <DriveListItem 
                      key={drive.id}
                      drive={drive}
                      darkMode={effectiveDarkMode}
                      onClick={async () => {
                        setSelectedDriveId(drive.id);
                        setSelectedDriveInfo(drive);
                        setVisibleViews(['details']);
                        await loadDriveContents(drive.id);
                      }}
                    />
                  ))}
                {drives.length === 0 && (
                  <div className={`text-center ${effectiveDarkMode ? 'text-gray-400' : 'text-gray-500'} py-8`}>No drives yet. Click "Add New" to add one.</div>
                )}
              </div>
              </div>
                  )}

                  {viewType === 'details' && (
                    <div className="w-full h-full">
                      <div className="flex gap-4 h-full">
                  {/* Left Sidebar */}
                  <div className="w-1/4">
                  <div className="px-6 pb-6 pt-[1px]">
                    {/* Drive list with card styling */}
                    <div className="space-y-4">
                      {[...drives]
                        .sort((a, b) => {
                          const dir = driveSortDir === 'asc' ? 1 : -1;
                          const val = (key: DriveSortKey, d: DriveInfo) => {
                            switch (key) {
                              case 'name': return (d.name || '').toLowerCase();
                              case 'used': return d.usedSpace || 0;
                              case 'free': return d.freeSpace || 0;
                              case 'capacity': return d.totalCapacity || 0;
                              case 'added': return d.addedDate ? new Date(d.addedDate).getTime() : 0;
                              case 'updated': {
                                const eff = d.lastUpdated || d.addedDate || '';
                                return eff ? new Date(eff).getTime() : 0;
                              }
                            }
                          };
                          const av = val(driveSortBy, a);
                          const bv = val(driveSortBy, b);
                          
                          // Primary sort
                          let comparison = 0;
                          if (typeof av === 'string' && typeof bv === 'string') {
                            comparison = av.localeCompare(bv) * dir;
                          } else {
                            comparison = ((av as number) - (bv as number)) * dir;
                          }
                          
                          // If primary values are equal, sort alphabetically by name
                          if (comparison === 0 && driveSortBy !== 'name') {
                            const nameA = (a.name || '').toLowerCase();
                            const nameB = (b.name || '').toLowerCase();
                            comparison = nameA.localeCompare(nameB);
                          }
                          
                          return comparison;
                        })
                        .map((drive) => (
                        <div
                           key={drive.id}
                          onClick={() => {
                            setSelectedDriveId(drive.id);
                            loadDriveContents(drive.id);
                          }}
                          className={`cursor-pointer rounded-lg border px-4 py-3 transition ${effectiveDarkMode ? 'hover:shadow-[0_6px_16px_rgba(0,0,0,0.55)] hover:ring-1 hover:ring-gray-700' : 'hover:shadow-md'} ${
                             selectedDriveId === drive.id
                              ? (effectiveDarkMode ? 'border-gray-500 bg-custom-black text-custom-white' : 'border-blue-500 bg-custom-white text-custom-black')
                              : (effectiveDarkMode ? 'border-gray-700 bg-gray-800 hover:bg-custom-gray' : 'border-gray-200 bg-custom-white hover:bg-gray-50')
                          }`}
                        >
                          <div className="font-medium text-sm truncate" title={drive.name}>{drive.name}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                  {/* Main Content Area */}
                  <div className="w-3/4 flex flex-col gap-4 h-full">

              {/* Drive info and actions */}
              <div className={`relative p-4 border rounded-lg ${effectiveDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                <div className="flex items-center justify-between gap-4 min-w-0">
                  <SelectedDriveInfo 
                    selectedDriveInfo={selectedDriveInfo} 
                    isProgressiveRendering={isProgressiveRendering}
                  />

                  <div className="flex items-center justify-center flex-shrink-0 p-2 space-x-2">
                    <button 
                      onClick={handleSyncDrive}
                      disabled={!selectedDriveInfo || scanActive}
                      className={`px-3 py-1 text-sm rounded bg-green-500 text-white ${
                        !selectedDriveInfo || scanActive ? 'opacity-50 cursor-not-allowed' : 'hover:bg-green-600'
                      }`}
                  title={'Sync drive contents'}
                >
                  SYNC
                </button>
                <button 
                  onClick={() => {
                    if (selectedDriveInfo) {
                      setShowConfirmationModal(true);
                    }
                  }}
                  disabled={!selectedDriveInfo}
                  className={`p-2 rounded ${effectiveDarkMode ? 'hover:bg-custom-gray' : 'hover:bg-gray-200'} ${
                    !selectedDriveInfo ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                  title="Delete selected drive"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                </button>

              </div>
            </div>


            </div>

            {/* File list */}
            <div className={`relative border rounded-lg flex-1 overflow-y-auto pt-2 ${effectiveDarkMode ? 'border-gray-700' : 'border-gray-200'}`} ref={fileListRef}>
              {/* File table header */}
              <div className={`w-full max-w-[90%] mx-auto px-4 pb-3 text-xs uppercase tracking-wide border-b ${effectiveDarkMode ? 'border-gray-600' : 'border-gray-300'} ${effectiveDarkMode ? 'text-gray-300' : 'text-gray-500'}`}>
                <div className="grid grid-cols-[7fr_3fr_2fr] gap-4 select-none items-center">
                  <button className="text-left" onClick={() => { setFileSortBy('name'); setFileSortDir(prev => (fileSortBy === 'name' && prev === 'asc') ? 'desc' : 'asc'); }}>
                    Name {fileSortBy === 'name' ? (fileSortDir === 'asc' ? '▲' : '▼') : ''}
                  </button>
                                      <button className={`text-center border-l ${effectiveDarkMode ? 'border-gray-600' : 'border-gray-300'} pl-4`} onClick={() => { setFileSortBy('modified'); setFileSortDir(prev => (fileSortBy === 'modified' && prev === 'asc') ? 'desc' : 'asc'); }}>
                    Date Modified {fileSortBy === 'modified' ? (fileSortDir === 'asc' ? '▲' : '▼') : ''}
                  </button>
                                      <button className={`text-right border-l ${effectiveDarkMode ? 'border-gray-600' : 'border-gray-300'} pl-4`} onClick={() => { setFileSortBy('size'); setFileSortDir(prev => (fileSortBy === 'size' && prev === 'asc') ? 'desc' : 'asc'); }}>
                    Size {fileSortBy === 'size' ? (fileSortDir === 'asc' ? '▲' : '▼') : ''}
                  </button>
                </div>
              </div>
              
              {/* Simple loading indicator - no complex progress needed */}
              {isProgressiveRendering && (
                <div className={`w-full max-w-[90%] mx-auto mb-4 p-4 bg-gradient-to-r ${effectiveDarkMode ? 'from-green-900/20 to-emerald-900/20' : 'from-green-50 to-emerald-50'} border ${effectiveDarkMode ? 'border-green-700' : 'border-green-200'} rounded-lg shadow-sm`}>
                  <div className="flex items-center justify-center space-x-3">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-green-600"></div>
                                          <div className={`text-sm font-medium ${effectiveDarkMode ? 'text-green-200' : 'text-green-800'}`}>
                      🎯 Loading file tree...
                    </div>
                  </div>
                </div>
              )}
              
              {/* Rendering phase indicator - shows after scan completes */}
              {isRenderingPhase && (
                <div className={`w-full max-w-[90%] mx-auto mb-4 p-4 ${effectiveDarkMode ? 'bg-gray-800' : 'bg-gray-50'} border ${effectiveDarkMode ? 'border-gray-600' : 'border-gray-200'} rounded-lg`}>
                  <div className="flex items-center justify-center space-x-3">
                    <div className={`animate-spin rounded-full h-5 w-5 border-2 ${effectiveDarkMode ? 'border-gray-600' : 'border-gray-300'} ${effectiveDarkMode ? 'border-t-gray-400' : 'border-t-gray-600'}`}></div>
                    <div className={`text-sm font-medium ${effectiveDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Rendering File Tree
                    </div>
                  </div>
                  <div className={`mt-2 text-xs text-center ${effectiveDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    {renderingProgress.phase === 'initial' && 'Loading initial files...'}
                    {renderingProgress.phase === 'root-loaded' && 'Root files loaded, preparing display...'}
                    {renderingProgress.phase === 'progressive' && `Rendering files: ${renderingProgress.current.toLocaleString()} / ${renderingProgress.total.toLocaleString()}`}
                    {renderingProgress.phase === 'complete' && 'Rendering complete!'}
                  </div>
                  {renderingProgress.phase === 'progressive' && renderingProgress.total > 0 && (
                    <div className={`mt-2 w-full ${effectiveDarkMode ? 'bg-gray-700' : 'bg-gray-200'} rounded-full h-2`}>
                      <div 
                        className={`${effectiveDarkMode ? 'bg-gray-400' : 'bg-gray-600'} h-2 rounded-full transition-all duration-300`}
                        style={{ width: `${Math.min(100, (renderingProgress.current / renderingProgress.total) * 100)}%` }}
                      />
                    </div>
                  )}
                </div>
              )}
              
              {/* Waiting for tree building indicator */}
              {isWaitingForTree && (
                <div className={`w-full max-w-[90%] mx-auto mb-4 p-4 ${effectiveDarkMode ? 'bg-gray-800' : 'bg-gray-50'} border ${effectiveDarkMode ? 'border-gray-600' : 'border-gray-200'} rounded-lg`}>
                  <div className="flex items-center justify-center space-x-3">
                    <div className={`animate-spin rounded-full h-5 w-5 border-2 ${effectiveDarkMode ? 'border-gray-600' : 'border-gray-300'} ${effectiveDarkMode ? 'border-t-gray-400' : 'border-t-gray-600'}`}></div>
                    <div className={`text-sm font-medium ${effectiveDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Preparing File Tree
                    </div>
                  </div>
                  <div className={`mt-2 text-xs text-center ${effectiveDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    Loading file information from database
                  </div>
                </div>
              )}
              
              {/* Tree building indicator for large datasets */}
              {isBuildingTree && (
                <div className={`w-full max-w-[90%] mx-auto mb-4 p-4 ${effectiveDarkMode ? 'bg-gray-800' : 'bg-gray-50'} border ${effectiveDarkMode ? 'border-gray-600' : 'border-gray-200'} rounded-lg`}>
                  <div className="flex items-center justify-center space-x-3">
                    <div className={`animate-spin rounded-full h-5 w-5 border-2 ${effectiveDarkMode ? 'border-gray-600' : 'border-gray-300'} ${effectiveDarkMode ? 'border-t-gray-400' : 'border-t-gray-600'}`}></div>
                    <div className={`text-sm font-medium ${effectiveDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Building File Tree
                    </div>
                  </div>
                  <div className={`mt-2 text-xs text-center ${effectiveDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    {asyncTree.length > 0 
                      ? `Building tree in chunks: ${asyncTree.length} items processed...`
                      : 'Processing large dataset - this may take a moment'
                    }
                  </div>
                  {asyncTree.length > 0 && (
                    <div className={`mt-2 w-full ${effectiveDarkMode ? 'bg-gray-700' : 'bg-gray-200'} rounded-full h-2`}>
                      <div 
                        className={`${effectiveDarkMode ? 'bg-gray-400' : 'bg-gray-600'} h-2 rounded-full transition-all duration-300`}
                        style={{ width: `${Math.min(100, (asyncTree.length / Math.max(driveFiles.length + progressiveFiles.length, 1)) * 100)}%` }}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Navigation overlay: shows only if navigation takes >150ms */}
              {isNavigatingToSearchResult && (
                <div className="absolute inset-0 z-40 pointer-events-none flex items-center justify-center">
                  <div className="flex flex-col items-center space-y-3">
                                         <div className={`animate-spin h-6 w-6 rounded-full border-2 ${effectiveDarkMode ? 'border-gray-600' : 'border-gray-300'} border-t-gray-400`} />
                    {navigationStatus && (
                                          <div className={`text-sm font-medium ${effectiveDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      {navigationStatus}
                    </div>
                    )}
                  </div>
                </div>
              )}
              <div className="space-y-1 pt-2">
                {(driveFiles.length > 0 || progressiveFiles.length > 0) ? (
                  <FileTree 
                    files={asyncTree.length > 0 ? asyncTree : optimizedFileTree}
                    rawFiles={[...driveFiles, ...progressiveFiles]}
                    darkMode={effectiveDarkMode}
                    expandedFolders={expandedFolders}
                    setExpandedFolders={setExpandedFoldersPersisted}
                    hideSystemFiles={hideSystemFiles}
                    highlightedFile={highlightedFile}
                    fileSortBy={fileSortBy}
                    fileSortDir={fileSortDir}
                    onHighlightRendered={(fileId: string) => {
                      if (fileId && fileId === highlightedFile) {
                        // Only clear if this matches the current highlight
                        setIsNavigatingToSearchResult(false);
                        setNavigationStatus('');
                      }
                    }}
                    onLoadChildren={async (driveId: string, parentPath: string) => {
                      await loadChildren(driveId, parentPath);
                    }}
                    onLoadMore={async (driveId: string, parentPath: string) => {
                      try {
                        // Prevent concurrent pagination for the same parent
                        if (pagingParentsRef.current.has(parentPath)) return;
                        pagingParentsRef.current.add(parentPath);
                        const current = driveFiles.filter(f => f.parentPath === parentPath && f.name !== 'Load more…').length;
                        let offset = current;
                        let hasMoreLocal = true;
                        let guard = 0;
                        while (guard < 3 && hasMoreLocal) {
                          const resp = await window.electronAPI.listChildren(driveId, parentPath, PAGE_SIZE, offset);
                          const more = resp.files;
                          hasMoreLocal = resp.hasMore;
                          offset += more.length;
                          if (more && more.length) {
                            startTransition(() => {
                              setDriveFiles(prev => {
                                const result: FileMetadata[] = [] as any;
                                const existingIds = new Set<string>();
                                for (const f of prev) {
                                  if (!(f.parentPath === parentPath && f.name === 'Load more…')) {
                                    result.push(f);
                                    if (f && typeof f === 'object' && (f as any).id) existingIds.add((f as any).id);
                                  }
                                }
                                const uniqueMore = (more as FileMetadata[]).filter(m => !existingIds.has(m.id));
                                result.push(...uniqueMore);
                                if (hasMoreLocal) {
                                  result.push({
                                    id: `${parentPath}__LOAD_MORE__`,
                                    name: 'Load more…',
                                    path: `${parentPath}/${parentPath}__LOAD_MORE__`,
                                    parentPath,
                                    size: 0,
                                    created: '',
                                    modified: '',
                                    isDirectory: false,
                                    folderPath: '',
                                    driveId,
                                    depth: 0
                                  } as unknown as FileMetadata);
                                }
                                return result;
                              });
                            });
                          }
                          // Check buffer and break if enough content is ahead
                          const container = fileListRef.current;
                          if (container) {
                            const remaining = container.scrollHeight - (container.scrollTop + container.clientHeight);
                            if (remaining > 1500) break;
                          }
                          guard++;
                          if (!hasMoreLocal) break;
                        }
                      } catch (e) {
                        console.error('[renderer] onLoadMore failed:', e);
                      } finally {
                        pagingParentsRef.current.delete(parentPath);
                      }
                    }}
                    scrollContainerRef={fileListRef}
                  />
                ) : (
                  <div className="text-center text-gray-500 py-8">
                    {selectedDriveId ? 'No files found' : 'Select a drive to view contents'}
                  </div>
                )}
              </div>
              </div>
              
              {/* Hide system files checkbox - below file tree */}
              <div className="w-full max-w-[90%] mx-auto mt-1 pb-4 flex items-center justify-end">
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    checked={hideSystemFiles}
                    onChange={(e) => setHideSystemFiles(e.target.checked)}
                    className="mr-2"
                  />
                  <span className="text-sm">hide system files</span>
                </div>
              </div>
              {/* Close Main Content Area */}
              </div>
              </div>
              </div>
                  )}
                </div>
              ))}
              </div>
            </div>
            
          </div>
        </div>
      </div>
        </>
      )}
      {/* End of main page content */}

      {/* (Removed) Right-click context menu */}

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={showConfirmationModal}
        onClose={() => setShowConfirmationModal(false)}
        onConfirm={handleDeleteDrive}
        title="Delete Drive"
        message={`Are you sure you want to delete the drive "${selectedDriveInfo?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
      />

      {/* Backup Confirmation Modal */}
      <ConfirmationModal
        isOpen={showBackupConfirmation}
        onClose={() => setShowBackupConfirmation(false)}
        onConfirm={handleConfirmBackup}
        title="Create Backup"
        message={`Are you sure you want to create a backup of "${selectedDriveInfo?.name}"? You can find and restore this backup later in the Recover page in the menu.`}
        confirmText="Yes, Create Backup"
        cancelText="Cancel"
      />

      {/* Backup Success Modal */}
      <ConfirmationModal
        isOpen={showBackupSuccess}
        onClose={() => setShowBackupSuccess(false)}
        onConfirm={() => setShowBackupSuccess(false)}
        title="Backup Created"
        message={backupSuccessMessage}
        confirmText="OK"
        cancelText=""
      />

      {/* Recovery Modal removed for MVP */}

      {/* Page Components - Rendered inside Main Content Wrapper */}
      {currentPage === 'account' && (
        <Account
          darkMode={effectiveDarkMode}
          setDarkMode={(dark: boolean) => {
            if (dark) {
              setPreference('dark');
            } else {
              setPreference('light');
            }
          }}
          preference={preference}
          setPreference={setPreference}
          onSignOut={onSignOut}
          onBack={() => {
            setSidebarOpen(true);
            setCurrentPage('main');
          }}
        />
      )}

      {currentPage === 'contact' && (
        <Contact
          darkMode={effectiveDarkMode}
          onBack={() => {
            setSidebarOpen(true);
            setCurrentPage('main');
          }}
        />
      )}

      {currentPage === 'recover' && (
        <RecoverPage
          darkMode={effectiveDarkMode}
          onBack={() => {
            setSidebarOpen(true);
            setCurrentPage('main');
          }}
        />
      )}

      </div>
      {/* End Main Content Wrapper */}

    </div>
  );
}

// FileTree component for rendering hierarchical file structure
interface FileTreeProps {
  files: any[];
  rawFiles: FileMetadata[];
  darkMode: boolean;
  expandedFolders: Set<string>;
  setExpandedFolders: (folders: Set<string>) => void;
  hideSystemFiles: boolean;
  highlightedFile?: string | null;
  onLoadChildren?: (driveId: string, parentPath: string) => Promise<void> | void;
  onLoadMore?: (driveId: string, parentPath: string) => Promise<void> | void;
  scrollContainerRef?: React.RefObject<HTMLDivElement>;
  fileSortBy?: 'name' | 'type' | 'size' | 'modified';
  fileSortDir?: 'asc' | 'desc';
  onHighlightRendered?: (fileId: string) => void;
}

const FileTree: React.FC<FileTreeProps> = ({ 
  files,
  rawFiles,
  darkMode, 
  expandedFolders, 
  setExpandedFolders,
  hideSystemFiles: _hideSystemFiles,
  highlightedFile,
  onLoadChildren,
  onLoadMore,
  scrollContainerRef,
  fileSortBy = 'name',
  fileSortDir = 'asc',
  onHighlightRendered
}) => {
  const reportedHighlightRef = useRef<string | null>(null);
  // Debug: Log when expandedFolders changes
  // Debug: expandedFolders changes
  // useEffect(() => {
  //   console.debug('[FileTree] expandedFolders', Array.from(expandedFolders));
  // }, [expandedFolders]);
  
  // Debug: Log when highlightedFile changes
  // Debug: highlightedFile changes
  // useEffect(() => {
  //   console.debug('[FileTree] highlightedFile', highlightedFile);
  // }, [highlightedFile]);
  
  // Auto-scroll to highlighted file
  useEffect(() => {
    if (!highlightedFile) return;
    // Wait for element to mount
    const waitForElement = () => {
      const target = document.querySelector(`[data-file-id="${highlightedFile}"]`) as HTMLElement | null;
      if (!target) {
        setTimeout(waitForElement, 50);
        return;
      }
      if (onHighlightRendered && reportedHighlightRef.current !== highlightedFile) {
        onHighlightRendered(highlightedFile);
        reportedHighlightRef.current = highlightedFile;
      }
      const container = scrollContainerRef?.current;
      if (container && typeof container.scrollTo === 'function') {
        // Prefer scrollIntoView centered for simplicity
        try {
          target.scrollIntoView({ block: 'center', behavior: 'smooth' });
          return;
        } catch {}
        // Fallback to manual centering inside container
        const cRect = container.getBoundingClientRect();
        const eRect = target.getBoundingClientRect();
        const nextTop = container.scrollTop + (eRect.top - cRect.top) - (cRect.height / 2) + (eRect.height / 2);
        container.scrollTo({ top: nextTop, behavior: 'smooth' });
        return;
      }
      // Window fallback
      try {
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } catch {
        // last resort
        const eRect = target.getBoundingClientRect();
        const top = window.scrollY + eRect.top - (window.innerHeight / 2) + (eRect.height / 2);
        window.scrollTo({ top, behavior: 'smooth' });
      }
    };
    waitForElement();
  }, [highlightedFile, scrollContainerRef?.current]);
  
  // Sanitize files before rendering
  let sanitizedFiles = files;
  if (typeof sanitizeFileTree === 'function') {
    sanitizedFiles = sanitizeFileTree(files);
  }
  
  const toggleFolder = (filePath: string) => {
    const newExpanded = new Set(expandedFolders);
    if (newExpanded.has(filePath)) {
      newExpanded.delete(filePath);
    } else {
      newExpanded.add(filePath);
    }
    setExpandedFolders(newExpanded);
  };

  // Infinite scroll: observe loader sentinels and auto-fetch next page
  const [loadingParents, setLoadingParents] = useState<Set<string>>(new Set());
  const [rootMarginPx, setRootMarginPx] = useState(800);

  // Dynamically adjust prefetch buffer based on scroll velocity
  useEffect(() => {
    const container = scrollContainerRef?.current || null;
    let lastY = container ? container.scrollTop : window.scrollY;
    let lastT = performance.now();
    const onScroll = () => {
      const now = performance.now();
      const y = container ? container.scrollTop : window.scrollY;
      const dy = Math.abs(y - lastY);
      const dt = Math.max(16, now - lastT);
      const velocityPxPerMs = dy / dt; // px/ms
      // Target prefetch window: base 400px + velocity * 300ms, clamped 300..2000
      const dynamic = Math.round(Math.min(2000, Math.max(300, 400 + velocityPxPerMs * 300)));
      setRootMarginPx(prev => (Math.abs(dynamic - prev) > 50 ? dynamic : prev));
      lastY = y; lastT = now;
    };
    container?.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      container?.removeEventListener('scroll', onScroll);
      window.removeEventListener('scroll', onScroll);
    };
  }, [scrollContainerRef?.current]);

  useEffect(() => {
    if (!onLoadMore) return;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(async (entry) => {
        if (entry.isIntersecting) {
          const el = entry.target as HTMLElement;
          const parentPath = el.dataset.loadMoreParent;
          const driveId = el.dataset.driveId;
          if (!parentPath || !driveId) return;
          setLoadingParents(prev => {
            if (prev.has(parentPath)) return prev;
            const next = new Set(prev);
            next.add(parentPath);
            return next;
          });
          try {
            await onLoadMore(driveId, parentPath);
          } finally {
            setLoadingParents(prev => {
              const next = new Set(prev);
              next.delete(parentPath);
              return next;
            });
          }
        }
      });
    }, { root: scrollContainerRef?.current || null, rootMargin: `0px 0px ${rootMarginPx}px 0px`, threshold: 0 });

    const scope: ParentNode = (scrollContainerRef?.current as unknown as ParentNode) || document;
    const sentinels = scope.querySelectorAll('[data-load-more-parent]');
    sentinels.forEach(el => observer.observe(el));
    return () => {
      sentinels.forEach(el => observer.unobserve(el));
      observer.disconnect();
    };
  }, [rawFiles, onLoadMore, scrollContainerRef?.current, rootMarginPx]);

  // Removed type column/logic

  const compareFiles = (a: any, b: any): number => {
    const dirBiasAllowed = !(fileSortBy === 'size' || fileSortBy === 'modified');
    if (dirBiasAllowed) {
      const dirBias = a.isDirectory === b.isDirectory ? 0 : (a.isDirectory ? -1 : 1);
      if (dirBias !== 0) return dirBias;
    }
    const dir = fileSortDir === 'asc' ? 1 : -1;
    switch (fileSortBy) {
      case 'name': {
        return ((a.name || '').localeCompare(b.name || '')) * dir;
      }
      
      case 'size': {
        const av = typeof a.size === 'number' ? a.size : 0;
        const bv = typeof b.size === 'number' ? b.size : 0;
        return (av - bv) * dir;
      }
      case 'modified': {
        const ad = a.modified ? Date.parse(a.modified) || 0 : 0;
        const bd = b.modified ? Date.parse(b.modified) || 0 : 0;
        return (ad - bd) * dir;
      }
      default:
        return 0;
    }
  };

  const renderFile = (file: any, depth: number = 0) => {
    // Defensive check
    if (!file || typeof file !== 'object') {
      return null;
    }
    
    const isExpanded = expandedFolders.has(file.path);
    
    // Debug: Log expansion check for root items
    if (depth === 0) {
      // console.debug(`[FileTree] File: ${file.name}, Path: ${file.path}, IsExpanded: ${isExpanded}`);
    }
    
    const hasChildren = file.children && file.children.length > 0;
    
    // Ensure we have a stable, unique key per node
    const key = file.id || (file.driveId && file.path ? `${file.driveId}:${file.path}` : `${file.name}-${file.path || ''}-${depth}`);
    
    const childrenElements = file.isDirectory && isExpanded && hasChildren ? (
      <div>
        {file.children
          .slice()
          .sort(compareFiles)
          .filter((child: any) => child && typeof child === 'object')
          .map((child: any) => renderFile(child, depth + 1))
          .filter(Boolean)
        }
      </div>
    ) : null;

    const isHighlighted = highlightedFile === file.id;
    
    return (
      <div key={key}>
        <div 
          className={`w-full max-w-[90%] mx-auto grid grid-cols-[7fr_3fr_2fr] gap-4 items-center py-2 px-3 rounded ${
            isHighlighted
              ? (darkMode ? 'bg-custom-black text-custom-white' : 'bg-blue-100 text-blue-900')
              : (darkMode ? 'hover:bg-custom-gray' : 'hover:bg-gray-100')
          } ${file.isDirectory ? 'cursor-pointer' : ''}`}
          
          onClick={async (e) => {
            if (!file.isDirectory) return;
            const rowEl = e.currentTarget as HTMLElement;
            const containerEl = (scrollContainerRef?.current as HTMLElement | null);
            const containerTop = containerEl ? containerEl.getBoundingClientRect().top : 0;
            const beforeTop = rowEl.getBoundingClientRect().top - containerTop;
            // If expanding a folder with no children, load from DB on demand
            const wasExpanded = expandedFolders.has(file.path);
            toggleFolder(file.path);
            const nowExpanded = !wasExpanded;
            if (nowExpanded && (!file.children || file.children.length === 0)) {
              try {
                const driveId = file.driveId;
                if (driveId && onLoadChildren) {
                  await onLoadChildren(driveId, file.path);
                  const newExpanded = new Set(expandedFolders);
                  newExpanded.add(file.path);
                  setExpandedFolders(newExpanded);
                }
              } catch (e) {
                console.error('[renderer] Hydrate failed:', e);
              }
            }
            // After render, adjust scroll to keep clicked row at same visual position
            const adjust = () => {
              const afterTop = rowEl.getBoundingClientRect().top - containerTop;
              const delta = afterTop - beforeTop;
              if (Math.abs(delta) > 1) {
                if (containerEl) {
                  containerEl.scrollTop += delta;
                } else {
                  window.scrollBy(0, delta);
                }
              }
            };
            requestAnimationFrame(() => requestAnimationFrame(adjust));
          }}
          data-file-item
          data-file-id={file.id}
        >
          <div className="flex items-center space-x-3 min-w-0" style={{ paddingLeft: `${depth * 20 + 12}px` }}>
            {file.isDirectory && (
              <span className="text-lg">📁</span>
            )}
            <span className="text-sm truncate" title={file.name}>{file.name}</span>
            {/* (Removed) inline hidden-list controls */}
          </div>
          <FileDate file={file} darkMode={darkMode} />
          <FileSize file={file} darkMode={darkMode} />
        </div>
        {childrenElements}
        {/* Load more handler for very large directories */}
        {file.isDirectory && isExpanded && rawFiles.some(f => f.parentPath === file.path && f.name === 'Load more…') && (
          <div
            className="py-1"
            style={{ paddingLeft: `${(depth + 1) * 20 + 12}px` }}
          >
            <div
              data-load-more-parent={file.path}
              data-drive-id={file.driveId}
              className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}
            >
              {loadingParents.has(file.path) ? 'Loading…' : ''}
            </div>
          </div>
        )}
      </div>
    );
  };

  const items = useMemo(() => sanitizedFiles.filter((file: any) => file && typeof file === 'object'), [sanitizedFiles]);
  const sortedRootItems = useMemo(
    () => items.slice().sort(compareFiles),
    [items, fileSortBy, fileSortDir]
  );
  return (
    <Virtuoso
      // Use the outer scroll container instead of an internal scroller to avoid nested scrollbars
      customScrollParent={scrollContainerRef?.current || undefined}
      // Add a small footer spacer to provide a tasteful bit of empty space at the end
      components={{ Footer: () => <div style={{ height: 32 }} /> }}
      data={sortedRootItems}
      overscan={300}
      itemContent={(_index: number, item: any) => renderFile(item)}
    />
  );
};

// Removed unused SearchResultItem component

// File date component with formatting hook
const FileDate: React.FC<{ file: any; darkMode: boolean }> = ({ file, darkMode }) => {
  const formattedDate = useFormatDate(file.modified);
  
  return (
    <div className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'} text-center`}>
      {file.modified ? formattedDate : ''}
    </div>
  );
};

// File size component with formatting hook
const FileSize: React.FC<{ file: any; darkMode: boolean }> = ({ file, darkMode }) => {
  const formattedSize = useFormatBytes(file.size || 0);
  
  return (
    <div className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'} text-right`}>
      {file.isDirectory && (file.size === undefined || file.size === null) ? (
        <span className="text-gray-400">Calculating...</span>
      ) : file.size && file.size > 0 ? (
        formattedSize
      ) : file.isDirectory && file.size === 0 ? (
        '0'
      ) : (
        ''
      )}
    </div>
  );
};

// Removed unused SearchResultSize component

// Selected drive info component with formatting hooks
const SelectedDriveInfo: React.FC<{ 
  selectedDriveInfo: DriveInfo | null; 
  isProgressiveRendering?: boolean;
}> = ({ selectedDriveInfo, isProgressiveRendering }) => {
  const usedSpace = useFormatBytes(selectedDriveInfo?.usedSpace || 0);
  const totalCapacity = useFormatBytes(selectedDriveInfo?.totalCapacity || 0);
  const freeSpace = useFormatBytes(selectedDriveInfo?.freeSpace || 0);
  // Hooks must not be conditional; always call and conditionally display
  const addedDateFormatted = useFormatDate(selectedDriveInfo?.addedDate || '');
  const lastUpdatedFormatted = useFormatDate(selectedDriveInfo?.lastUpdated || '');
  
  return (
    <>
      <div className="flex items-center flex-1 min-w-0 relative">
        <div className="flex items-center gap-3 lg:gap-2 xl:gap-3 overflow-x-auto scrollbar-thin scrollbar-thumb-gray-400 scrollbar-track-gray-100 hover:scrollbar-thumb-gray-500 pb-2 -mb-2 w-full">
          {/* Used/Capacity Container */}
          <div className="flex flex-col items-center text-center min-w-20 lg:min-w-18 xl:min-w-20 p-1 flex-shrink-0">
            <div className="text-sm lg:text-xs xl:text-sm font-semibold w-full overflow-hidden text-ellipsis whitespace-nowrap">
              {selectedDriveInfo
                ? (selectedDriveInfo.usedSpace === 0 && selectedDriveInfo.totalCapacity === 0
                    ? '—'
                    : `${usedSpace} / ${totalCapacity}`)
                : '—'}
            </div>
            <div className="text-[10px] lg:text-[9px] xl:text-[10px] uppercase tracking-wide opacity-70 whitespace-nowrap">USED/CAPACITY</div>
          </div>
          
          {/* Free Space Container */}
          <div className="flex flex-col items-center text-center min-w-20 lg:min-w-18 xl:min-w-20 p-1 flex-shrink-0">
            <div className="text-sm lg:text-xs xl:text-sm font-semibold w-full overflow-hidden text-ellipsis whitespace-nowrap">
              {selectedDriveInfo
                ? (selectedDriveInfo.freeSpace === 0
                    ? '—'
                    : freeSpace)
                : '—'}
            </div>
            <div className="text-[10px] lg:text-[9px] xl:text-[10px] uppercase tracking-wide opacity-70 whitespace-nowrap">FREE SPACE</div>
          </div>
          
          {/* Date Added Container */}
          <div className="flex flex-col items-center text-center min-w-20 lg:min-w-18 xl:min-w-20 p-1 flex-shrink-0">
            <div className="text-sm lg:text-xs xl:text-sm font-semibold w-full overflow-hidden text-ellipsis whitespace-nowrap">
              {selectedDriveInfo?.addedDate ? addedDateFormatted : '—'}
            </div>
            <div className="text-[10px] lg:text-[9px] xl:text-[10px] uppercase tracking-wide opacity-70 whitespace-nowrap">DATE ADDED</div>
          </div>
          
          {/* Last Updated Container */}
          <div className="flex flex-col items-center text-center min-w-20 lg:min-w-18 xl:min-w-20 p-1 flex-shrink-0">
            <div className="text-sm lg:text-xs xl:text-sm font-semibold w-full overflow-hidden text-ellipsis whitespace-nowrap">
              {selectedDriveInfo?.lastUpdated && lastUpdatedFormatted ? lastUpdatedFormatted : '—'}
            </div>
            <div className="text-[10px] lg:text-[9px] xl:text-[10px] uppercase tracking-wide opacity-70 whitespace-nowrap">LAST UPDATED</div>
          </div>
          
          {/* Format Container */}
          <div className="flex flex-col items-center text-center min-w-16 lg:min-w-14 xl:min-w-16 p-1 flex-shrink-0">
            <div className="text-sm lg:text-xs xl:text-sm font-semibold w-full overflow-hidden text-ellipsis whitespace-nowrap">
              {selectedDriveInfo?.formatType || '—'}
            </div>
            <div className="text-[10px] lg:text-[9px] xl:text-[10px] uppercase tracking-wide opacity-70 whitespace-nowrap">FORMAT</div>
          </div>
          
          {/* Loading Container */}
          {isProgressiveRendering && (
            <div className="flex flex-col items-center text-center min-w-20 lg:min-w-18 xl:min-w-20 p-1 flex-shrink-0">
              <div className="flex items-center space-x-1">
                <div className="animate-spin rounded-full h-3 w-3 lg:h-2 lg:w-2 xl:h-3 xl:w-3 border-b-2 border-green-600"></div>
                <div className="text-sm lg:text-xs xl:text-sm font-semibold text-green-600">
                  Loading...
                </div>
              </div>
              <div className="text-[10px] lg:text-[9px] xl:text-[10px] uppercase tracking-wide opacity-70 text-green-600 whitespace-nowrap">LOADING</div>
            </div>
          )}
        </div>
      </div>
      

      
      {/* Auth State Debugger - Development Only */}
      {/* <AuthStateDebugger /> */}
      
      {/* Storage Status Indicator - Top Right */}
      {/* <div className="fixed top-4 right-4 z-40">
        <CompactStorageStatus />
      </div> */}
    </>
  );
};

// Drive list item component with formatting hooks
const DriveListItem: React.FC<{ 
  drive: DriveInfo; 
  darkMode: boolean;
  onClick: () => void;
}> = ({ drive, darkMode, onClick }) => {
  const usedSpace = useFormatBytes(drive.usedSpace || 0);
  const totalCapacity = useFormatBytes(drive.totalCapacity || 0);
  const freeSpace = useFormatBytes(drive.freeSpace || 0);
  const addedDate = useFormatDate(drive.addedDate);
  const lastUpdatedFormatted = useFormatDate(drive.lastUpdated || '');
  const lastUpdated = drive.lastUpdated && lastUpdatedFormatted ? lastUpdatedFormatted : '—';
  
  return (
    <div
      onClick={onClick}
      className={`cursor-pointer rounded-lg border ${darkMode ? 'border-gray-700 bg-gray-800 hover:bg-custom-gray' : 'border-gray-200 bg-custom-white hover:bg-gray-50'} px-6 py-4 transition ${darkMode ? 'hover:shadow-[0_8px_20px_rgba(0,0,0,0.55)] hover:ring-1 hover:ring-gray-700' : 'hover:shadow-md'}`}
    >
      <div className="flex items-center min-w-0 justify-between">
        <div className="w-32 min-w-0 flex-shrink-0">
          <div className="font-medium truncate" title={drive.name}>{drive.name}</div>
        </div>
        <div className="w-24 whitespace-nowrap flex-shrink-0">
          <div className="text-sm font-semibold">
            {drive.usedSpace === 0 && drive.totalCapacity === 0 ? '—' : usedSpace}
          </div>
        </div>
        <div className="w-24 whitespace-nowrap flex-shrink-0">
          <div className="text-sm font-semibold">
            {totalCapacity}
          </div>
        </div>
        <div className="w-24 whitespace-nowrap flex-shrink-0">
          <div className="text-sm font-semibold">
            {drive.freeSpace === 0 ? '—' : freeSpace}
          </div>
        </div>
        <div className="w-32 text-left text-sm whitespace-nowrap flex-shrink-0">
          {addedDate}
        </div>
        <div className="w-32 text-left text-sm whitespace-nowrap">
          {lastUpdated}
        </div>
      </div>
    </div>
  );
};

export default App; 