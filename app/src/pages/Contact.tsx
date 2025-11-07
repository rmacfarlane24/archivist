import React, { useState } from 'react';

interface ContactProps {
  darkMode: boolean;
  onBack: () => void;
}

export const Contact: React.FC<ContactProps> = ({ darkMode, onBack }) => {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    subject: '',
    message: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle');

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitStatus('idle');

    try {
      // Get Supabase URL from environment
      const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
      const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
      
      if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error('Supabase configuration missing');
      }

      // Send support ticket via Supabase Edge Function
      const response = await fetch(`${supabaseUrl}/functions/v1/support-ticket`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify({
          userId: 'contact-form', // Since this might not be authenticated
          email: formData.email,
          subject: formData.subject,
          message: `From: ${formData.name} (${formData.email})\n\n${formData.message}`
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to send support request');
      }

      const result = await response.json();
      console.log('Support ticket sent:', result);
      
      setSubmitStatus('success');
      setFormData({ name: '', email: '', subject: '', message: '' });
    } catch (error) {
      console.error('Error sending support request:', error);
      setSubmitStatus('error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={`min-h-screen ${darkMode ? 'bg-custom-gray text-custom-white' : 'bg-gray-100 text-custom-black'}`}>
      {/* Content */}
      <div className="p-8">
        <div className="max-w-4xl mx-auto">
          {/* Contact Form with Header */}
          <div className={`p-6 rounded-lg shadow-sm ${darkMode ? 'bg-custom-black' : 'bg-custom-white'}`}>
            <div className="flex items-center justify-between mb-6">
              <button
                onClick={onBack}
                className={`p-1 rounded ${darkMode ? 'hover:bg-custom-gray' : 'hover:bg-gray-200'}`}
                aria-label="Go back to previous page"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
              </button>
              <h1 className="text-xl font-medium">Contact</h1>
              <div className="w-6"></div>
            </div>
            <div className="text-left mb-6">
              <h2 className="text-lg font-medium mb-2">Need Help?</h2>
              <p className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                Having an issue? Ask for help and a real human being will be in touch as soon as possible.
              </p>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="name" className={`block text-sm font-medium mb-2 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                  Name
                </label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  value={formData.name}
                  onChange={handleInputChange}
                  required
                  className={`w-full px-3 py-2 border rounded-md ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-custom-white border-gray-300 text-custom-black'} focus:outline-none focus:ring-2 focus:ring-gray-500`}
                  placeholder="Your name"
                />
              </div>

              <div>
                <label htmlFor="email" className={`block text-sm font-medium mb-2 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                  Email
                </label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  required
                  className={`w-full px-3 py-2 border rounded-md ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-custom-white border-gray-300 text-custom-black'} focus:outline-none focus:ring-2 focus:ring-gray-500`}
                  placeholder="your.email@example.com"
                />
              </div>

              <div>
                <label htmlFor="subject" className={`block text-sm font-medium mb-2 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                  Subject
                </label>
                <input
                  type="text"
                  id="subject"
                  name="subject"
                  value={formData.subject}
                  onChange={handleInputChange}
                  required
                  className={`w-full px-3 py-2 border rounded-md ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-custom-white border-gray-300 text-custom-black'} focus:outline-none focus:ring-2 focus:ring-gray-500`}
                  placeholder="Brief description of your issue"
                />
              </div>

              <div>
                <label htmlFor="message" className={`block text-sm font-medium mb-2 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                  Message
                </label>
                <textarea
                  id="message"
                  name="message"
                  value={formData.message}
                  onChange={handleInputChange}
                  required
                  rows={6}
                  className={`w-full px-3 py-2 border rounded-md ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-custom-white border-gray-300 text-custom-black'} focus:outline-none focus:ring-2 focus:ring-gray-500`}
                  placeholder="Please describe your issue in detail..."
                />
              </div>

              {/* Status Messages */}
              {submitStatus === 'success' && (
                <div 
                  className={`p-4 border rounded-md ${darkMode ? 'bg-green-900 border-green-700 text-green-200' : 'bg-green-100 border-green-400 text-green-700'}`}
                  role="status"
                  aria-live="polite"
                >
                  <p className="text-sm font-medium">Message sent successfully! We'll get back to you soon.</p>
                </div>
              )}
              {submitStatus === 'error' && (
                <div 
                  className={`p-4 border rounded-md ${darkMode ? 'bg-red-900 border-red-700 text-red-200' : 'bg-red-100 border-red-400 text-red-700'}`}
                  role="alert"
                  aria-live="assertive"
                >
                  <p className="text-sm font-medium">Failed to send message. Please try again.</p>
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className={`px-4 py-2 rounded-md font-medium transition-colors ${
                  isSubmitting
                    ? 'bg-gray-400 text-gray-600 cursor-not-allowed'
                    : (darkMode ? 'bg-gray-700 hover:bg-custom-gray text-white' : 'bg-white hover:bg-gray-100 text-black border border-gray-300')
                }`}
              >
                {isSubmitting ? 'Sending...' : 'Send'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};
