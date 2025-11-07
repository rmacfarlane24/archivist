// LEGACY PAYMENT SYSTEM - DORMANT
// This component is disabled while implementing the new Supabase Edge Functions payment system
// To revive: Remove the early return statement below

import React, { useEffect, useRef } from 'react';

interface PaymentWebviewProps {
  isOpen: boolean;
  onClose: () => void;
  checkoutUrl: string;
  planName: string;
  onPaymentSuccess?: (plan: string, sessionId?: string) => void;
  onPaymentCancel?: () => void;
  isPaymentSuccessful?: boolean;
}

export const PaymentWebview: React.FC<PaymentWebviewProps> = ({
  isOpen,
  onClose,
  checkoutUrl,
  planName,
  onPaymentSuccess,
  onPaymentCancel,
  isPaymentSuccessful = false
}) => {
  // LEGACY SYSTEM DISABLED - Return null to prevent usage
  console.warn('PaymentWebview is disabled - new payment system in development');
  return null;

  const webviewRef = useRef<HTMLWebViewElement>(null);

  useEffect(() => {
    if (webviewRef.current) {
      // Listen for webview events
      const webview = webviewRef.current;
      
      const handleLoadStart = () => {
        console.log('Payment webview loading started');
      };

      const handleLoadStop = () => {
        console.log('Payment webview loading stopped');
      };

      const handleDomReady = () => {
        console.log('Payment webview DOM ready');
      };

      const handleNewWindow = (event: any) => {
        console.log('New window requested:', event.url);
        // Handle any popup windows if needed
      };

      // Monitor URL changes to detect payment success or cancellation
      const handleDidNavigate = (event: any) => {
        const url = event.url;
        console.log('Webview navigated to:', url);
        
        // Check if this is a success redirect from Stripe
        if (url.includes('/success') || url.includes('?plan=')) {
          // Extract plan and session ID from URL
          const urlParams = new URLSearchParams(url.split('?')[1] || '');
          const planParam = urlParams.get('plan');
          const sessionId = urlParams.get('session_id') || urlParams.get('sessionId');
          const plan = planParam || planName.toLowerCase();
          
          console.log('Payment success detected for plan:', plan, 'session ID:', sessionId);
          
          // Call the success callback if provided
          if (onPaymentSuccess) {
            onPaymentSuccess(plan, sessionId || undefined);
          }
        }
        
        // Check if this is a cancellation redirect from Stripe
        if (url.includes('/cancel') || url.includes('?canceled=true')) {
          console.log('Payment cancellation detected');
          
          // Call the cancel callback if provided
          if (onPaymentCancel) {
            onPaymentCancel();
          }
        }
      };

      webview.addEventListener('load-start', handleLoadStart);
      webview.addEventListener('load-stop', handleLoadStop);
      webview.addEventListener('dom-ready', handleDomReady);
      webview.addEventListener('new-window', handleNewWindow);
      webview.addEventListener('did-navigate', handleDidNavigate);

      return () => {
        webview.removeEventListener('load-start', handleLoadStart);
        webview.removeEventListener('load-stop', handleLoadStop);
        webview.removeEventListener('dom-ready', handleDomReady);
        webview.removeEventListener('new-window', handleNewWindow);
        webview.removeEventListener('did-navigate', handleDidNavigate);
      };
    }
  }, [planName, onPaymentSuccess]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white dark:bg-custom-black rounded-lg shadow-xl max-w-4xl w-full mx-4 h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Complete Payment - {planName}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Webview Container */}
        <div className="flex-1 p-4">
          <webview
            ref={webviewRef}
            src={checkoutUrl}
            className="w-full h-full rounded border border-gray-200 dark:border-gray-700"
            allowpopups="true"
            webpreferences="contextIsolation=no, nodeIntegration=no"
          />
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 dark:border-gray-700">
          <div className="text-center text-sm text-gray-500 dark:text-gray-400">
            {isPaymentSuccessful ? (
              <div>
                <p className="text-green-600 dark:text-green-400 font-medium">
                  ✅ Payment successful! Your subscription is being updated...
                </p>
                <p className="mt-1 text-xs">This window will close automatically in a few seconds.</p>
              </div>
            ) : (
              <div>
                <p>Complete your payment on the secure Stripe checkout page above.</p>
                <p className="mt-1">Your email has been pre-filled for convenience.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};


