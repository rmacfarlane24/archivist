import { useState, useEffect } from 'react';

export function useFormatBytes(bytes: number): string {
  const [formatted, setFormatted] = useState<string>('');

  useEffect(() => {
    const formatBytes = async () => {
      try {
        if (window.electronAPI.formatBytes) {
          const result = await window.electronAPI.formatBytes(bytes);
          setFormatted(result);
        } else {
          // Fallback formatting
          if (bytes === 0) setFormatted('0 Bytes');
          else {
            const k = 1024;
            const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            setFormatted(parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]);
          }
        }
      } catch (error) {
        // Fallback formatting on error
        if (bytes === 0) setFormatted('0 Bytes');
        else {
          const k = 1024;
          const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
          const i = Math.floor(Math.log(bytes) / Math.log(k));
          setFormatted(parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]);
        }
      }
    };

    formatBytes();
  }, [bytes]);

  return formatted;
}

export function useFormatDate(dateString: string): string {
  const [formatted, setFormatted] = useState<string>('');

  useEffect(() => {
    const formatDate = () => {
      // Early validation - if dateString is empty, undefined, or invalid, return empty
      if (!dateString || dateString.trim() === '' || dateString === 'Invalid Date') {
        setFormatted('');
        return;
      }

      try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) {
          setFormatted('');
          return;
        }

        // Use locale-aware formatting that respects user's system settings
        const datePart = date.toLocaleDateString(undefined, {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        });
        
        const timePart = date.toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
          hour12: undefined // Let the system decide based on user's locale
        });
        
        setFormatted(`${datePart} ${timePart}`);
      } catch (error) {
        // Fallback formatting on error
        const date = new Date(dateString);
        if (isNaN(date.getTime())) {
          setFormatted('');
          return;
        }
        
        // Simple fallback that still respects locale
        const datePart = date.toLocaleDateString();
        const timePart = date.toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
          hour12: undefined
        });
        
        setFormatted(`${datePart} ${timePart}`);
      }
    };

    formatDate();
  }, [dateString]);

  return formatted;
}
