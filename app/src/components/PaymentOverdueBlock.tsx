/**
 * Payment Overdue Block Component
 * 
 * Shown to paying customers whose subscription payment has failed.
 * Different from trial expiry - focuses on payment resolution rather than plan selection.
 */

import React, { useState } from 'react';
import { SubscriptionStatus } from '../types/enhanced-subscription';
import ContactSupportModal from './ContactSupportModal';
import { supabaseClient } from '../supabase-client';

interface PaymentOverdueBlockProps {
  darkMode: boolean;
  onSignOut: () => void;
  subscriptionStatus: SubscriptionStatus;
}

const PaymentOverdueBlock: React.FC<PaymentOverdueBlockProps> = ({ 
  darkMode, 
  onSignOut, 
  subscriptionStatus 
}) => {
  const [showContactModal, setShowContactModal] = useState(false);
  const [isCreatingPortalSession, setIsCreatingPortalSession] = useState(false);

  const handleManageBilling = async () => {
    try {
      setIsCreatingPortalSession(true);
      
      // Create Stripe billing portal session
      const { data, error } = await supabaseClient.functions.invoke('create-portal-session');
      
      if (error) {
        console.error('Error creating portal session:', error);
        throw error;
      }
      
      if (data?.url) {
        // Open billing portal in new tab
        window.open(data.url, '_blank');
      } else {
        throw new Error('No portal URL returned');
      }
    } catch (error) {
      console.error('Failed to open billing portal:', error);
      alert('Unable to open billing portal. Please contact support.');
    } finally {
      setIsCreatingPortalSession(false);
    }
  };

  const formatLastPaymentDate = (date: Date | null) => {
    if (!date) return 'Unknown';
    return date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  };

  const formatLastFailureDate = (date: Date | null) => {
    if (!date) return 'Recently';
    return date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    });
  };

  return (
    <div className={`fixed inset-0 z-[100] ${darkMode ? 'bg-black/80' : 'bg-custom-white/95'}`}>
      <div className="flex items-center justify-center min-h-screen p-4">
        <div className={`max-w-lg w-full rounded-lg shadow-xl p-8 ${
          darkMode ? 'bg-custom-black border border-gray-700' : 'bg-custom-white border border-gray-200'
        }`}>
          <div className="text-left">
            {/* App Name */}
            <div className="mb-6">
              <h1 className="font-bold text-4xl">
                archivist
              </h1>
            </div>
            
            {/* Payment Failed Icon */}
            <div className="mb-6 flex justify-left">
              <div className={`flex items-center justify-center h-16 w-16 rounded-full ${
                darkMode ? 'bg-red-900' : 'bg-red-100'
              }`}>
                <svg className="h-8 w-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
                </svg>
              </div>
            </div>
            
            <h2 className="text-xl font-semibold mb-3">Payment Required</h2>
            <p className={`text-base mb-6 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
              Your {subscriptionStatus.plan} subscription payment has failed. 
              Please update your payment method to continue using Archivist.
            </p>
            
            {/* Payment Details */}
            <div className={`p-4 rounded-lg mb-6 ${
              darkMode ? 'bg-gray-800 border border-gray-700' : 'bg-gray-50 border border-gray-200'
            }`}>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className={darkMode ? 'text-gray-400' : 'text-gray-600'}>Plan:</span>
                  <span className="font-medium capitalize">{subscriptionStatus.plan}</span>
                </div>
                <div className="flex justify-between">
                  <span className={darkMode ? 'text-gray-400' : 'text-gray-600'}>Last Payment:</span>
                  <span className="font-medium">{formatLastPaymentDate(subscriptionStatus.lastPaymentDate)}</span>
                </div>
                <div className="flex justify-between">
                  <span className={darkMode ? 'text-gray-400' : 'text-gray-600'}>Payment Failed:</span>
                  <span className="font-medium text-red-600">{formatLastFailureDate(subscriptionStatus.lastPaymentFailure)}</span>
                </div>
              </div>
            </div>
            
            {/* Action Buttons */}
            <div className="space-y-4 mb-8">
              <button
                onClick={handleManageBilling}
                disabled={isCreatingPortalSession}
                className={`w-full py-3 px-4 rounded-lg font-medium transition-all ${
                  darkMode 
                    ? 'bg-blue-600 hover:bg-blue-700 text-white disabled:bg-blue-800' 
                    : 'bg-blue-600 hover:bg-blue-700 text-white disabled:bg-blue-400'
                } disabled:cursor-not-allowed`}
              >
                {isCreatingPortalSession ? (
                  <div className="flex items-center justify-center">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Opening Billing Portal...
                  </div>
                ) : (
                  'Update Payment Method'
                )}
              </button>
              
              <div className={`text-xs text-center ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                You'll be redirected to Stripe's secure billing portal
              </div>
            </div>
            
            {/* Additional Options */}
            <div className="flex justify-start space-x-6 text-sm">
              <button
                onClick={() => setShowContactModal(true)}
                className={`${
                  darkMode ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-500'
                } transition-colors`}
              >
                Contact Support
              </button>
              <button
                onClick={onSignOut}
                className={`${
                  darkMode ? 'text-red-400 hover:text-red-300' : 'text-red-600 hover:text-red-500'
                } transition-colors no-underline`}
              >
                Sign out
              </button>
            </div>
            
            {/* Help Text */}
            <div className={`mt-6 p-3 rounded-lg ${
              darkMode ? 'bg-gray-800 border border-gray-700' : 'bg-blue-50 border border-blue-200'
            }`}>
              <p className={`text-xs ${darkMode ? 'text-gray-300' : 'text-blue-800'}`}>
                <strong>Need help?</strong> Common payment issues include expired cards, 
                insufficient funds, or bank blocks on international transactions. 
                You can update your payment method or contact your bank.
              </p>
            </div>
          </div>
        </div>
      </div>
      
      {/* Contact Support Modal */}
      <ContactSupportModal 
        isOpen={showContactModal}
        onClose={() => setShowContactModal(false)}
        darkMode={darkMode}
      />
    </div>
  );
};

export default PaymentOverdueBlock;