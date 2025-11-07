import React from 'react';

interface HelpProps {
  darkMode: boolean;
  onClose: () => void;
}

const Help: React.FC<HelpProps> = ({
  darkMode,
  onClose
}) => {
  const faqs = [
    {
      question: "How do I add a new drive?",
      answer: "Click the 'Add Drive' button in the main interface, then select the folder containing your drive. The app will scan and index all files automatically."
    },
    {
      question: "What file types are supported?",
      answer: "The app supports all file types. It indexes metadata like file size, creation date, and modification date for all files and folders."
    },
    {
      question: "How do I search for files?",
      answer: "Use the search bar at the top of the interface. Type any part of a filename or path to find matching files across all your drives."
    },
    {
      question: "Can I sync an existing drive?",
      answer: "Yes! Select a drive and click 'Sync Drive' to re-scan and update the file index with any changes since the last scan."
    },
    {
      question: "How do I hide system files?",
      answer: "Go to Settings → File Display and toggle 'Hide System Files' to automatically filter out system files like .DS_Store and Thumbs.db."
    },
    {
      question: "What happens if I disconnect a drive?",
      answer: "The drive will remain in your index but show as offline. Reconnect the drive and use 'Sync Drive' to update the index."
    }
  ];

  return (
    <div className={`fixed inset-0 z-50 ${darkMode ? 'bg-custom-gray text-custom-white' : 'bg-custom-white text-custom-black'}`}>
      {/* Header */}
      <div className={`flex items-center justify-between p-6 border-b ${darkMode ? 'border-gray-700' : 'border-gray-300'}`}>
        <h1 className="text-xl font-medium">Help & FAQ</h1>
        <button
          onClick={onClose}
          className={`p-1 rounded ${darkMode ? 'hover:bg-custom-gray' : 'hover:bg-gray-100'}`}
          aria-label="Close help dialog"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="p-8">
        <div className="w-full max-w-2xl space-y-8">
          {/* Getting Started */}
          <div>
            <h2 className="text-lg font-medium mb-4">Getting Started</h2>
            <div className={`p-4 rounded-lg border ${darkMode ? 'border-gray-600 bg-black' : 'border-gray-200 bg-gray-50'}`}>
              <div className="space-y-4">
                <div className="flex items-start space-x-3">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-medium ${darkMode ? 'bg-gray-700 text-gray-200' : 'bg-gray-200 text-gray-800'}`}>
                    1
                  </div>
                  <div>
                    <h3 className="text-sm font-medium">Add Your First Drive</h3>
                    <p className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                      Click "Add Drive" and select a folder to begin indexing your files.
                    </p>
                  </div>
                </div>
                <div className="flex items-start space-x-3">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-medium ${darkMode ? 'bg-gray-700 text-gray-200' : 'bg-gray-200 text-gray-800'}`}>
                    2
                  </div>
                  <div>
                    <h3 className="text-sm font-medium">Wait for Indexing</h3>
                    <p className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                      The app will scan and index all files. This may take a few minutes for large drives.
                    </p>
                  </div>
                </div>
                <div className="flex items-start space-x-3">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-medium ${darkMode ? 'bg-gray-700 text-gray-200' : 'bg-gray-200 text-gray-800'}`}>
                    3
                  </div>
                  <div>
                    <h3 className="text-sm font-medium">Start Exploring</h3>
                    <p className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                      Browse your files, use search, and explore your drive structure.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* FAQ Section */}
          <div>
            <h2 className="text-lg font-medium mb-4">Frequently Asked Questions</h2>
            <div className="space-y-3">
              {faqs.map((faq, index) => (
                <div
                  key={index}
                  className={`p-4 rounded-lg border ${darkMode ? 'border-gray-600 bg-black' : 'border-gray-200 bg-gray-50'}`}
                >
                  <h3 className="text-sm font-medium mb-2">{faq.question}</h3>
                  <p className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                    {faq.answer}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Contact Support */}
          <div>
            <h2 className="text-lg font-medium mb-4">Need More Help?</h2>
            <div className={`p-4 rounded-lg border ${darkMode ? 'border-gray-600 bg-black' : 'border-gray-200 bg-gray-50'}`}>
              <div className="space-y-4">
                <p className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  Can't find what you're looking for? Our support team is here to help.
                </p>
                                  <div className="space-x-6">
                    <a href="#" className={`${darkMode ? 'text-gray-300 hover:text-white' : 'text-blue-600 hover:underline'} text-sm`}>
                      Contact Support
                    </a>
                    <a href="#" className={`${darkMode ? 'text-gray-300 hover:text-white' : 'text-blue-600 hover:underline'} text-sm`}>
                      View Documentation
                    </a>
                  </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Help;
